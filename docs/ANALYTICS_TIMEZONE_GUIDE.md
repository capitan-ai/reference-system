# Analytics Queries — Timezone Handling Guide

## TL;DR

Two buckets of columns in this database, **two different patterns** to convert to Pacific time. Using the wrong pattern shifts dates 7–8 hours in the wrong direction.

| Column type | Correct pattern to get Pacific calendar date |
|---|---|
| `timestamp without time zone` (stores UTC values) | `(col AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date` |
| `timestamp with time zone` (timestamptz) | `(col AT TIME ZONE 'America/Los_Angeles')::date` |

Never use naked `date(col)` or `col::date` for analytics grouping — those return UTC dates.

---

## Why two patterns?

Historically these tables were created with `timestamp without time zone` (no tz). The application writes UTC values into them. For a no-tz column holding UTC, this is what PostgreSQL does:

```sql
-- BACKWARDS: Postgres reads "treat this no-tz value as LA local time, then convert to UTC"
SELECT '2026-04-08 23:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles';
-- → 2026-04-09 06:00:00+00  (wrong direction — shifted +7h)

-- CORRECT: first mark it as UTC, then convert to LA local time
SELECT ('2026-04-08 23:00:00'::timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles';
-- → 2026-04-08 16:00:00    (4pm LA, as intended)
```

For a proper `timestamptz` column, the single `AT TIME ZONE 'America/Los_Angeles'` is correct and the double version is backwards.

---

## Column type reference

**`timestamp without time zone` (need double AT TIME ZONE):**
- `bookings.start_at`, `bookings.created_at`, `bookings.updated_at`
- `booking_segments.booking_start_at`
- `orders.created_at`, `orders.updated_at`, `orders.closed_at`
- `payments.created_at`, `payments.updated_at`, `payments.square_created_at`
- `order_line_items.order_created_at`
- `notification_events."createdAt"`, `notification_events."sentAt"`
- `device_pass_registrations."createdAt"`
- `locations.created_at/updated_at`, `team_members.created_at/updated_at`

**`timestamp with time zone` (need single AT TIME ZONE):**
- `customer_analytics.first_visit_at`, `.first_booking_at`, `.last_booking_at`, `.created_at`, `.updated_at`
- `master_earnings_ledger.created_at`
- `referral_rewards.created_at`
- `gift_card_transactions.created_at`
- `booking_segments.created_at`, `.updated_at`
- `admin_created_booking_facts.updated_at`
- `master_performance_daily.updated_at`

When in doubt, check:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='<your_table>'
  AND data_type LIKE '%timestamp%';
```

> ⚠️ A single query file can reference both buckets — for example, `get_master_salary` filters on both `bookings.start_at` (no-tz) and `master_earnings_ledger.created_at` (tz). Fixes must be per-column, not a blanket find-and-replace.

---

## Example queries

### 1. Daily revenue (Pacific)

```sql
-- payments.created_at is timestamp without time zone → double AT TIME ZONE
SELECT
  (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS date_pacific,
  SUM(p.total_money_amount)::numeric / 100.0 AS revenue_dollars
FROM payments p
WHERE p.status = 'COMPLETED'
  AND (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
      >= (CURRENT_DATE - INTERVAL '30 days')::date
GROUP BY 1
ORDER BY 1 DESC;
```

### 2. Bookings per Pacific day

```sql
-- bookings.start_at is timestamp without time zone → double AT TIME ZONE
SELECT
  (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS date_pacific,
  COUNT(*) AS bookings_count
FROM bookings b
WHERE b.status = 'ACCEPTED'
GROUP BY 1
ORDER BY 1 DESC;
```

### 3. Query mixing both bucket types

```sql
-- bookings.start_at      → no-tz, needs double
-- master_earnings_ledger.created_at → tz, needs single
SELECT
  mel.team_member_id,
  SUM(mel.amount_amount) AS total_cents
FROM master_earnings_ledger mel
LEFT JOIN bookings b ON b.id = mel.booking_id
WHERE (
  (b.id IS NOT NULL
    AND (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date >= '2026-04-01')
  OR
  (b.id IS NULL
    AND (mel.created_at AT TIME ZONE 'America/Los_Angeles')::date >= '2026-04-01')
)
GROUP BY mel.team_member_id;
```

### 4. "Today" in Pacific time

```sql
-- For filtering against "today in LA" — CURRENT_TIMESTAMP is a timestamptz,
-- so use the single AT TIME ZONE pattern.
WHERE (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
    = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date
```

---

## Common mistakes

1. **Naked `date(col)` on a no-tz UTC column** — returns UTC date; a 4pm Pacific booking (11pm UTC same day) still shows up today, but a 5pm Pacific booking (00:00 UTC next day) jumps forward one day.

   ```sql
   -- WRONG (returns UTC calendar date)
   SELECT date(b.start_at) FROM bookings b;

   -- RIGHT
   SELECT (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date FROM bookings b;
   ```

2. **Single `AT TIME ZONE 'America/Los_Angeles'` on a no-tz UTC column** — treats the stored value as if it were LA local time and converts it to UTC. Shifts dates 7–8 hours in the wrong direction.

3. **Double `AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles'` on a timestamptz column** — the first `AT TIME ZONE 'UTC'` strips timezone info (returning a no-tz value in UTC), then the second treats it as LA time. Also wrong, shifts dates 7–8 hours in the wrong direction.

4. **Comparing a timestamp column directly against a date literal**

   ```sql
   -- For a no-tz column with UTC values this compares in UTC, not Pacific.
   WHERE b.start_at >= '2026-04-01'
   ```

---

## DST

PostgreSQL handles DST automatically when you use a named zone like `'America/Los_Angeles'`. No special handling needed — both UTC→LA conversions above correctly cross the DST boundary.

---

## Longer-term fix

The right structural fix is to migrate all no-tz UTC columns (`bookings.start_at`, `orders.created_at`, `payments.created_at`, etc.) to `timestamptz`, which removes the two-bucket footgun and lets every query use the single `AT TIME ZONE` pattern. This is tracked as a separate project — until then, respect the two-bucket rule above.
