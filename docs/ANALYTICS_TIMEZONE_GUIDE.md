# Analytics Queries - Timezone Handling Guide

## Overview

All timestamps are stored in **UTC** in the database. Use `AT TIME ZONE 'America/Los_Angeles'` to convert to Pacific time for analytics and dashboards.

## Key Principles

1. **Storage**: UTC (timestamptz)
2. **Grouping**: Convert to Pacific time
3. **Filtering**: Can filter on UTC or converted time
4. **Aggregation**: Apply at UTC level, then convert for display

---

## Example Queries for Dashboard

### 1. Daily Revenue (Pacific Time)

```sql
-- Group bookings by date in Pacific timezone
SELECT 
  DATE(b.created_at AT TIME ZONE 'America/Los_Angeles') as booking_date_pst,
  COUNT(DISTINCT b.id) as total_bookings,
  COUNT(DISTINCT p.id) as total_payments,
  SUM(p.total_money_amount)::DECIMAL / 100.0 as revenue_dollars,
  SUM(p.tip_money_amount)::DECIMAL / 100.0 as tips_dollars
FROM bookings b
LEFT JOIN payments p ON b.id = p.booking_id AND p.status = 'COMPLETED'
WHERE b.status = 'ACCEPTED'
  AND b.created_at >= (NOW() AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '30 days'
GROUP BY booking_date_pst
ORDER BY booking_date_pst DESC;
```

### 2. Hourly Performance (Pacific Time)

```sql
-- Group by hour in Pacific time
SELECT 
  DATE_TRUNC('hour', 
    b.start_at AT TIME ZONE 'America/Los_Angeles'
  )::timestamp as booking_hour_pst,
  COUNT(*) as bookings,
  COUNT(DISTINCT b.technician_id) as unique_technicians,
  COUNT(CASE WHEN p.id IS NOT NULL THEN 1 END) as payments_received
FROM bookings b
LEFT JOIN payments p ON b.id = p.booking_id AND p.status = 'COMPLETED'
WHERE b.status = 'ACCEPTED'
  AND b.start_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', b.start_at AT TIME ZONE 'America/Los_Angeles')
ORDER BY booking_hour_pst DESC;
```

### 3. Technician Performance (Pacific Time)

```sql
-- Performance by technician, grouped by Pacific date
SELECT 
  DATE(b.start_at AT TIME ZONE 'America/Los_Angeles') as booking_date_pst,
  tm.given_name || ' ' || tm.family_name as technician_name,
  COUNT(b.id) as total_bookings,
  COUNT(CASE WHEN b.status = 'ACCEPTED' THEN 1 END) as completed_bookings,
  COUNT(CASE WHEN b.status = 'CANCELLED_BY_CUSTOMER' THEN 1 END) as cancelled_by_customer,
  COUNT(CASE WHEN p.id IS NOT NULL THEN 1 END) as paid_bookings,
  SUM(p.total_money_amount)::DECIMAL / 100.0 as revenue_dollars
FROM bookings b
LEFT JOIN payments p ON b.id = p.booking_id AND p.status = 'COMPLETED'
LEFT JOIN team_members tm ON b.technician_id = tm.id
WHERE b.created_at >= NOW() - INTERVAL '30 days'
GROUP BY booking_date_pst, technician_name
ORDER BY booking_date_pst DESC, revenue_dollars DESC;
```

### 4. Revenue by Day of Week (Pacific Time)

```sql
-- See which days of week are busiest
SELECT 
  TO_CHAR(
    b.start_at AT TIME ZONE 'America/Los_Angeles',
    'Day'
  ) as day_of_week,
  COUNT(b.id) as total_bookings,
  AVG(p.total_money_amount)::DECIMAL / 100.0 as avg_transaction_dollars,
  SUM(p.total_money_amount)::DECIMAL / 100.0 as total_revenue_dollars
FROM bookings b
LEFT JOIN payments p ON b.id = p.booking_id AND p.status = 'COMPLETED'
WHERE b.status = 'ACCEPTED'
  AND b.created_at >= NOW() - INTERVAL '90 days'
GROUP BY TO_CHAR(b.start_at AT TIME ZONE 'America/Los_Angeles', 'Day')
ORDER BY 
  CASE 
    WHEN day_of_week = 'Sunday' THEN 1
    WHEN day_of_week = 'Monday' THEN 2
    WHEN day_of_week = 'Tuesday' THEN 3
    WHEN day_of_week = 'Wednesday' THEN 4
    WHEN day_of_week = 'Thursday' THEN 5
    WHEN day_of_week = 'Friday' THEN 6
    WHEN day_of_week = 'Saturday' THEN 7
  END;
```

### 5. YTD Revenue (Year-to-Date, Pacific Time)

```sql
-- Fiscal year starting Jan 1 Pacific time
SELECT 
  b.organization_id,
  DATE_TRUNC('month', 
    b.start_at AT TIME ZONE 'America/Los_Angeles'
  )::date as month_start_pst,
  COUNT(DISTINCT b.id) as bookings,
  COUNT(DISTINCT p.id) as payments,
  SUM(p.total_money_amount)::DECIMAL / 100.0 as revenue_dollars,
  SUM(p.tip_money_amount)::DECIMAL / 100.0 as tips_dollars,
  (SUM(p.total_money_amount)::DECIMAL / 100.0) / 
    NULLIF(COUNT(DISTINCT b.id), 0) as avg_transaction_dollars
FROM bookings b
LEFT JOIN payments p ON b.id = p.booking_id AND p.status = 'COMPLETED'
WHERE b.status = 'ACCEPTED'
  AND DATE_TRUNC('year', 
    b.start_at AT TIME ZONE 'America/Los_Angeles'
  ) = DATE_TRUNC('year', NOW() AT TIME ZONE 'America/Los_Angeles')
GROUP BY b.organization_id, month_start_pst
ORDER BY month_start_pst DESC;
```

### 6. Same Day Performance (Pacific Time)

```sql
-- Filter by today (Pacific time), not UTC today
SELECT 
  b.id,
  b.booking_id,
  tm.given_name || ' ' || tm.family_name as technician,
  b.start_at AT TIME ZONE 'America/Los_Angeles' as start_time_pst,
  b.status,
  p.status as payment_status,
  p.total_money_amount::DECIMAL / 100.0 as payment_amount
FROM bookings b
LEFT JOIN payments p ON b.id = p.booking_id
LEFT JOIN team_members tm ON b.technician_id = tm.id
WHERE DATE(b.start_at AT TIME ZONE 'America/Los_Angeles') = 
      DATE(NOW() AT TIME ZONE 'America/Los_Angeles')
ORDER BY b.start_at ASC;
```

---

## Important Notes

### Timezone Conversion Formula

```sql
-- Basic pattern for all queries
timestamp_column AT TIME ZONE 'America/Los_Angeles'
```

### When Filtering by Date Range

```sql
-- CORRECT: Compare Pacific dates
WHERE DATE(b.start_at AT TIME ZONE 'America/Los_Angeles') 
      BETWEEN '2026-02-01' AND '2026-02-28'

-- WRONG: This filters by UTC, not Pacific
WHERE b.start_at >= '2026-02-01' AND b.start_at <= '2026-02-28'
```

### DST Handling

PostgreSQL automatically handles Daylight Saving Time transitions:
- PST (UTC-8): November - March
- PDT (UTC-7): March - November

Using `'America/Los_Angeles'` timezone includes DST logic automatically.

### Group By with Timezone

Always apply timezone conversion BEFORE grouping:

```sql
-- CORRECT
GROUP BY DATE(b.created_at AT TIME ZONE 'America/Los_Angeles')

-- WRONG (groups by UTC dates)
GROUP BY DATE(b.created_at)
```

---

## Testing Your Queries

### Verify Timezone Handling

```sql
-- Check current UTC time
SELECT NOW();

-- Check current Pacific time
SELECT NOW() AT TIME ZONE 'America/Los_Angeles';

-- Check a booking's times
SELECT 
  id,
  booking_id,
  created_at as utc_time,
  created_at AT TIME ZONE 'America/Los_Angeles' as pacific_time
FROM bookings
LIMIT 1;
```

### Validate Data Integrity

```sql
-- Make sure all timestamps are timestamptz
SELECT 
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name IN ('bookings', 'payments', 'orders', 'booking_segments')
  AND data_type LIKE '%timestamp%'
ORDER BY table_name, column_name;
```

---

## Migration Checklist

- [x] Change `webhook-processors.js` to use `::timestamptz`
- [x] Verify `referrals/route.js` uses `::timestamptz`
- [x] Run migration script to convert columns to `timestamptz`
- [ ] Update all analytics queries to use `AT TIME ZONE 'America/Los_Angeles'`
- [ ] Test dashboard with new timezone handling
- [ ] Update documentation for engineers

---

## Common Mistakes to Avoid

1. **❌ Forgetting AT TIME ZONE**
   ```sql
   -- WRONG: Returns UTC dates
   SELECT DATE(created_at) FROM bookings;
   
   -- CORRECT: Returns Pacific dates
   SELECT DATE(created_at AT TIME ZONE 'America/Los_Angeles') FROM bookings;
   ```

2. **❌ Comparing dates without timezone**
   ```sql
   -- WRONG: Day boundaries are in UTC
   WHERE created_at > '2026-02-01'
   
   -- CORRECT: Day boundaries are in Pacific time
   WHERE created_at AT TIME ZONE 'America/Los_Angeles' > '2026-02-01'
   ```

3. **❌ Forgetting to cast result back to timestamp**
   ```sql
   -- WRONG: Returns time with timezone offset string
   SELECT created_at AT TIME ZONE 'America/Los_Angeles'
   
   -- CORRECT: Returns clean timestamp for display
   SELECT (created_at AT TIME ZONE 'America/Los_Angeles')::timestamp
   ```

4. **❌ Using NOW() instead of NOW() AT TIME ZONE**
   ```sql
   -- WRONG: NOW() returns UTC
   WHERE created_at > NOW()
   
   -- CORRECT: For Pacific-based logic
   WHERE created_at AT TIME ZONE 'America/Los_Angeles' > 
        (NOW() AT TIME ZONE 'America/Los_Angeles')::date
   ```



