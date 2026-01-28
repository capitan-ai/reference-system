# Analytics Views Usage Guide

## Overview

The analytics layer provides pre-computed daily metrics for dashboard display. All views are **tenant-scoped** by `organization_id` and computed server-side from raw Square data.

**⚠️ IMPORTANT:** Never query raw tables (`payments`, `bookings`, etc.) directly from the frontend. Always use these analytics views.

## Available Views

### 1. `analytics_overview_daily`

Daily KPIs aggregated per organization.

**Columns:**
- `organization_id` (UUID) - Tenant identifier
- `date` (DATE) - Date of the metrics
- `total_revenue_cents` (BIGINT) - Total revenue in cents
- `total_revenue_dollars` (DECIMAL) - Total revenue in dollars
- `appointments_count` (BIGINT) - Number of appointments
- `new_customers_count` (BIGINT) - Number of new customers (first booking)
- `avg_ticket_dollars` (DECIMAL) - Average ticket size (revenue / appointments)
- `referral_revenue_cents` (BIGINT) - Revenue from referred customers
- `referral_revenue_dollars` (DECIMAL) - Referral revenue in dollars
- `rebooking_rate` (DECIMAL) - Percentage of customers who rebooked (0.0-1.0)
- `total_customers_with_bookings` (BIGINT) - Total customers with at least one booking

**Example Query:**
```sql
SELECT 
  date,
  total_revenue_dollars,
  appointments_count,
  new_customers_count,
  avg_ticket_dollars,
  referral_revenue_dollars,
  rebooking_rate
FROM analytics_overview_daily
WHERE organization_id = 'your-org-id'
  AND date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY date DESC;
```

### 2. `analytics_revenue_by_location_daily`

Daily revenue breakdown by location.

**Columns:**
- `organization_id` (UUID)
- `location_id` (UUID) - Location identifier
- `location_name` (TEXT) - Friendly location name
- `date` (DATE)
- `revenue_cents` (BIGINT)
- `revenue_dollars` (DECIMAL)
- `payment_count` (BIGINT) - Number of payments
- `unique_customers` (BIGINT) - Unique customers

**Example Query:**
```sql
SELECT 
  location_name,
  date,
  revenue_dollars,
  unique_customers
FROM analytics_revenue_by_location_daily
WHERE organization_id = 'your-org-id'
  AND date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY date DESC, revenue_dollars DESC;
```

### 3. `analytics_appointments_by_location_daily`

Daily appointments breakdown by location.

**Columns:**
- `organization_id` (UUID)
- `location_id` (UUID)
- `location_name` (TEXT)
- `date` (DATE)
- `appointments_count` (BIGINT)
- `unique_customers` (BIGINT)
- `new_customers_count` (BIGINT)

**Example Query:**
```sql
SELECT 
  location_name,
  date,
  appointments_count,
  new_customers_count
FROM analytics_appointments_by_location_daily
WHERE organization_id = 'your-org-id'
  AND date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY date DESC;
```

### 4. `analytics_master_performance_daily`

Daily performance metrics by technician/master.

**Columns:**
- `organization_id` (UUID)
- `technician_id` (UUID) - Team member identifier
- `technician_name` (TEXT) - Full name
- `date` (DATE)
- `appointments_count` (BIGINT)
- `line_items_count` (BIGINT) - Order line items
- `revenue_cents` (BIGINT)
- `revenue_dollars` (DECIMAL)
- `unique_customers` (BIGINT)

**Example Query:**
```sql
SELECT 
  technician_name,
  date,
  appointments_count,
  revenue_dollars,
  unique_customers
FROM analytics_master_performance_daily
WHERE organization_id = 'your-org-id'
  AND date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY date DESC, revenue_dollars DESC;
```

### 5. `analytics_service_performance_daily`

Daily performance metrics by service.

**Columns:**
- `organization_id` (UUID)
- `service_variation_id` (UUID) - Service identifier
- `service_name` (TEXT) - Service name
- `date` (DATE)
- `appointments_count` (BIGINT)
- `line_items_count` (BIGINT)
- `revenue_cents` (BIGINT)
- `revenue_dollars` (DECIMAL)
- `unique_customers` (BIGINT)
- `avg_duration_minutes` (DECIMAL) - Average service duration

**Example Query:**
```sql
SELECT 
  service_name,
  date,
  appointments_count,
  revenue_dollars,
  avg_duration_minutes
FROM analytics_service_performance_daily
WHERE organization_id = 'your-org-id'
  AND date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY date DESC, revenue_dollars DESC;
```

## Usage Patterns

### Frontend Integration (Next.js / React)

```typescript
// Example: Fetch overview metrics
async function getOverviewMetrics(organizationId: string, days: number = 30) {
  const result = await prisma.$queryRaw`
    SELECT 
      date,
      total_revenue_dollars,
      appointments_count,
      new_customers_count,
      avg_ticket_dollars,
      referral_revenue_dollars,
      rebooking_rate
    FROM analytics_overview_daily
    WHERE organization_id = ${organizationId}
      AND date >= CURRENT_DATE - INTERVAL '${days} days'
    ORDER BY date DESC
  `
  return result
}
```

### Date Range Queries

Always filter by `date` for time-based queries:

```sql
-- Last 7 days
WHERE date >= CURRENT_DATE - INTERVAL '7 days'

-- Last 30 days
WHERE date >= CURRENT_DATE - INTERVAL '30 days'

-- Specific date range
WHERE date >= '2026-01-01' AND date <= '2026-01-31'

-- Current month
WHERE date >= DATE_TRUNC('month', CURRENT_DATE)
```

### Aggregating Across Dates

```sql
-- Monthly totals
SELECT 
  DATE_TRUNC('month', date) as month,
  SUM(total_revenue_dollars) as monthly_revenue,
  SUM(appointments_count) as monthly_appointments
FROM analytics_overview_daily
WHERE organization_id = 'your-org-id'
  AND date >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE_TRUNC('month', date)
ORDER BY month DESC;
```

### Filtering by Location

```sql
-- Revenue by location (last 30 days)
SELECT 
  location_name,
  SUM(revenue_dollars) as total_revenue,
  SUM(payment_count) as total_payments
FROM analytics_revenue_by_location_daily
WHERE organization_id = 'your-org-id'
  AND date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY location_name
ORDER BY total_revenue DESC;
```

## Tenant Isolation

**CRITICAL:** Always include `organization_id` in WHERE clauses:

```sql
-- ✅ CORRECT
SELECT * FROM analytics_overview_daily
WHERE organization_id = 'your-org-id'

-- ❌ WRONG - Will return data from all organizations
SELECT * FROM analytics_overview_daily
```

In Supabase with RLS, views inherit policies from underlying tables. Ensure RLS policies enforce `organization_id` checks.

## Performance Considerations

1. **Indexes:** All views use optimized indexes on `organization_id`, `date`, and relevant filters
2. **Query Time:** Views compute on-demand. Typical queries should complete in < 500ms
3. **Date Ranges:** Limit date ranges to reasonable periods (30-90 days for dashboards)
4. **Materialization:** If queries exceed 2 seconds, consider materialized views (see below)

## Troubleshooting

### No Data Returned

1. Check that `organization_id` is correct
2. Verify date range includes actual data dates
3. Check raw tables have data:
   ```sql
   SELECT COUNT(*) FROM payments 
   WHERE organization_id = 'your-org-id' 
     AND status = 'COMPLETED'
   ```

### Incorrect Metrics

1. Verify raw data quality in source tables
2. Check that `organization_id` is set correctly on all records
3. Review metric definitions in main documentation

### Slow Queries

1. Check if indexes exist: `\d+ analytics_overview_daily`
2. Use `EXPLAIN ANALYZE` to identify bottlenecks
3. Consider materialized views for large date ranges

## Migration to Materialized Views

If views become too slow (> 2 seconds), use materialized views:

```sql
-- Create materialized view
CREATE MATERIALIZED VIEW analytics_overview_daily_mv AS
SELECT * FROM analytics_overview_daily;

-- Create unique index
CREATE UNIQUE INDEX ON analytics_overview_daily_mv(organization_id, date);

-- Refresh (run nightly via cron)
REFRESH MATERIALIZED VIEW CONCURRENTLY analytics_overview_daily_mv;
```

Then query the materialized view instead:
```sql
SELECT * FROM analytics_overview_daily_mv
WHERE organization_id = 'your-org-id'
```

## Support

For issues or questions:
1. Check this documentation
2. Review SQL migration file: `prisma/migrations/20260121150000_add_analytics_views/migration.sql`
3. Run test scripts: `node scripts/test-analytics-views.js`



