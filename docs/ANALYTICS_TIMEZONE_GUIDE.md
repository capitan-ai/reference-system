# Analytics Queries — Timezone Handling Guide

## TL;DR

Two buckets of columns in this database, **two different patterns** to convert to Pacific time. Using the wrong pattern shifts dates 7–8 hours in the wrong direction.

| Column type | Correct pattern to get Pacific calendar date |
|---|---|
| `timestamp without time zone` (stores UTC values) | `(col AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date` |
| `timestamp with time zone` (timestamptz) | `(col AT TIME ZONE 'America/Los_Angeles')::date` |

Never use naked `date(col)` or `col::date` for analytics grouping — those return UTC dates.

> **2026-04-29:** `bookings.{start_at, created_at, updated_at}` were migrated from `timestamp` → `timestamptz`. They now use the **single** `AT TIME ZONE 'America/Los_Angeles'` pattern (see [migration](../prisma/migrations/20260429120000_bookings_timestamptz/migration.sql)). The double-AT-TZ form on bookings columns is now **wrong**.

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

**`timestamp without time zone` (need DOUBLE AT TIME ZONE):**
- `booking_segments.booking_start_at`, `.booking_created_at`
- `orders.created_at`, `orders.updated_at`, `orders.closed_at`
- `payments.created_at`, `payments.updated_at`, `payments.square_created_at`, `payments.delayed_until`
- `payment_tenders.created_at`, `payment_tenders.card_payment_timeline_*`
- `order_line_items.order_created_at`, `.order_closed_at`, `.order_updated_at`, `.created_at`, `.updated_at`
- `notification_events."createdAt"`, `notification_events."sentAt"`, `notification_events."statusAt"`
- `device_pass_registrations."createdAt"`, `."updatedAt"`
- `locations.created_at/updated_at`, `team_members.created_at/updated_at`
- `service_variation.created_at/updated_at`
- `analytics_dead_letter."createdAt"`, `."lastTriedAt"`
- `phone_verifications.*`, `verified_phone_sessions.*`

**`timestamp with time zone` (need SINGLE AT TIME ZONE):**
- ✅ `bookings.start_at`, `bookings.created_at`, `bookings.updated_at` *(migrated 2026-04-29)*
- `customer_analytics.first_visit_at`, `.first_booking_at`, `.last_booking_at`, `.last_visit_at`, `.last_payment_at`, `.created_at`, `.updated_at`, `.activated_as_referrer_at`
- `master_earnings_ledger.created_at`
- `master_adjustments.created_at`, `.updated_at`
- `master_settings.created_at`, `.updated_at`
- `master_weekly_schedule.created_at`, `.updated_at`
- `referral_rewards.created_at`, `.paid_at`
- `referral_profiles.*`
- `gift_cards.*`, `gift_card_transactions.created_at`, `giftcard_jobs.*`, `giftcard_runs.*`
- `booking_segments.created_at`, `.updated_at`, `.deleted_at`
- `booking_snapshots.created_at`, `.updated_at`
- `square_existing_clients.created_at`, `.updated_at`, `.first_visit_at`, `.email_sent_at`, `.referral_sms_sent_at`
- `square_booking_sdk_snapshot.start_at`, `.fetched_at`, `.square_updated_at`, `.window_start`, `.window_end`
- `admin_created_booking_facts.start_at_utc`, `.created_at_utc`, `.snapshot_calculated_at`, `.inserted_at`, `.updated_at`
- `master_performance_daily.updated_at`
- `client_notes.captured_at`, `.occurred_at`, `.square_updated_at`
- `webhook_jobs.*`, `application_logs.*`, `customer_packages.*`, `package_usages.used_at`
- `organizations.*`, `organization_users.*`, `profiles.*`, `user_roles.*`
- `training_records.*`, `referral_analytics_daily.updated_at`
- `_prisma_migrations.*`

When in doubt, check:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='<your_table>'
  AND data_type LIKE '%timestamp%';
```

> ⚠️ A single query can reference both buckets — e.g., `get_master_salary` filters on `bookings.start_at` (now tz) and `payments.created_at` (still no-tz). Fixes must be per-column, not a blanket find-and-replace.

---

## Example queries

### 1. Daily revenue (Pacific) — payments.created_at is no-tz, double AT TZ

```sql
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

### 2. Bookings per Pacific day — bookings.start_at is timestamptz, single AT TZ ✅

```sql
SELECT
  (b.start_at AT TIME ZONE 'America/Los_Angeles')::date AS date_pacific,
  COUNT(*) AS bookings_count
FROM bookings b
WHERE b.status = 'ACCEPTED'
GROUP BY 1
ORDER BY 1 DESC;
```

### 3. Query mixing both bucket types

```sql
-- bookings.start_at        → tz, single
-- payments.created_at      → no-tz, double
SELECT
  (b.start_at AT TIME ZONE 'America/Los_Angeles')::date AS service_date,
  (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS payment_date,
  COUNT(*)
FROM bookings b
JOIN payments p ON p.booking_id = b.id
WHERE b.status = 'ACCEPTED' AND p.status = 'COMPLETED'
GROUP BY 1, 2;
```

### 4. "Today" in Pacific time

```sql
-- bookings.start_at is timestamptz now → single AT TZ on both sides
WHERE (b.start_at AT TIME ZONE 'America/Los_Angeles')::date
    = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date
```

---

## Common mistakes

1. **Naked `date(col)` on a no-tz UTC column** — returns UTC date; a 4pm Pacific booking (11pm UTC same day) still shows up today, but a 5pm Pacific booking (00:00 UTC next day) jumps forward one day.

   ```sql
   -- WRONG (returns UTC calendar date)
   SELECT date(p.created_at) FROM payments p;

   -- RIGHT (payments.created_at is no-tz UTC)
   SELECT (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date FROM payments p;
   ```

2. **Single `AT TIME ZONE 'America/Los_Angeles'` on a no-tz UTC column** — treats the stored value as if it were LA local time and converts it to UTC. Shifts dates 7–8 hours in the wrong direction.

3. **Double `AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles'` on a timestamptz column** — the first `AT TIME ZONE 'UTC'` strips timezone info (returning a no-tz value in UTC), then the second treats it as LA time. Also wrong, shifts dates 7–8 hours in the wrong direction. **As of 2026-04-29 this is the trap on `bookings.*` columns** — the double form was correct before the migration; it is now wrong.

4. **Comparing a timestamp column directly against a date literal**

   ```sql
   -- For a no-tz column with UTC values this compares in UTC, not Pacific.
   WHERE p.created_at >= '2026-04-01'
   ```

---

## DST

PostgreSQL handles DST automatically when you use a named zone like `'America/Los_Angeles'`. No special handling needed — both UTC→LA conversions above correctly cross the DST boundary.

---

## Migration history

| Date | Tables migrated to `timestamptz` |
|---|---|
| 2026-04-29 | `bookings.start_at`, `bookings.created_at`, `bookings.updated_at` |

The right structural fix is to migrate all remaining no-tz UTC columns (`payments.*`, `orders.*`, `order_line_items.*`, `booking_segments.booking_start_at`, etc.) to `timestamptz`, which removes the two-bucket footgun. The pattern is in `prisma/migrations/20260429120000_bookings_timestamptz/migration.sql` — drop dependent views → `ALTER COLUMN ... TYPE timestamptz USING col AT TIME ZONE 'UTC'` → recreate views with single `AT TIME ZONE`. Until each table is migrated, respect the two-bucket rule above.
