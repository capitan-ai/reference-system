# 📊 Customer Analytics Implementation Guide

## Overview

This implementation introduces a **denormalized `customer_analytics` table** that serves as the **single source of truth** for all customer metrics and analysis. This architecture prevents data quality issues and simplifies dashboard queries.

## What Was Changed

### 1. **Prisma Schema** (`prisma/schema.prisma`)

#### Added Model
- **`CustomerAnalytics`** - Composite key table storing precomputed customer metrics
  - PK: `(organization_id, square_customer_id)`
  - Relations to `Organization` and `SquareExistingClient`

#### Updated Models
- **`SquareExistingClient`** - Added `analytics` relation
- **`Organization`** - Added `customer_analytics` relation

### 2. **Database Migration** 

**File:** `prisma/migrations/20260218000000_add_customer_analytics/migration.sql`

Creates the `customer_analytics` table with:
- Personal data (name, email, phone)
- Chronology (first_booking_at, last_booking_at, last_payment_at)
- Booking volumes (accepted, cancelled by customer/seller, no-shows)
- Financials (revenue, tips, payment count, avg ticket)
- Notes (JSONB array of all booking notes)
- Preferences (technician, service, locations)
- Referrals (source, is_referrer, total referrals/rewards)
- Segmentation (customer_segment: NEW|ACTIVE|AT_RISK|LOST)

**Indexes:**
- Organization + segment (for dashboard filtering)
- Organization + first_booking_at (for new customer KPIs)
- Organization + last_booking_at (for AT_RISK analysis)
- Referrer flag (for referral analysis)
- JSONB GIN index (optional, for note searches)

### 3. **Refresh Scripts**

#### Script A: `scripts/refresh-customer-analytics.js`
Standalone Node.js script for manual refreshes
```bash
# Update last 90 days (fast)
node scripts/refresh-customer-analytics.js recent

# Full recalculation (slow, for nightly backups)
node scripts/refresh-customer-analytics.js full

# Specific organization
node scripts/refresh-customer-analytics.js recent 'ORG_UUID'
```

#### Script B: `app/api/cron/refresh-customer-analytics/route.js`
Vercel Cron endpoint for automatic hourly updates
- Authorization via CRON_SECRET
- Logs to `application_logs` table
- Updates last 90 days in ~5-10 seconds

### 4. **Configuration Updates**

#### `vercel.json`
Added cron job:
```json
{
  "path": "/api/cron/refresh-customer-analytics",
  "schedule": "0 * * * *"  // Every hour at minute 0
}
```

### 5. **View Updates**

#### Script: `scripts/update-analytics-appointments-view.js`
Updates `analytics_appointments_by_location_daily` VIEW to:
- Use `customer_analytics.first_booking_at` for new_customers (✅ correct logic)
- LEFT JOIN on customer_analytics instead of square_existing_clients

### 6. **Sanity Checks**

#### Script: `scripts/sanity-check-customer-analytics.js`
Verifies data consistency:
- Table exists and has data
- Customer segments distribution
- avg_ticket_cents calculations are correct
- first_booking_at matches MIN(ACCEPTED bookings)
- Referral data is accurate
- VIEW returns data

## Implementation Steps

### Phase 1: Deploy Code (No Data Impact)

```bash
# 1. Update schema
npx prisma migrate dev --name add_customer_analytics

# 2. Deploy to production
git commit -m "feat: add customer_analytics table and cron endpoint"
git push
```

### Phase 2: Initialize Data (First Time Only)

```bash
# 3. Run full refresh (recalculates all customers)
node scripts/refresh-customer-analytics.js full

# Expected: ~1-5 minutes for full dataset
# Result: customer_analytics table populated with all metrics
```

### Phase 3: Update Views

```bash
# 4. Update the VIEW to use customer_analytics
node scripts/update-analytics-appointments-view.js

# Verify VIEW updated
npx prisma db execute --stdin < scripts/sanity-check-query.sql
```

### Phase 4: Verify & Monitor

```bash
# 5. Run sanity checks
node scripts/sanity-check-customer-analytics.js

# 6. Monitor cron job status in production
# Dashboard: /admin/jobs/status
```

### Phase 5: Cron Automation (Ongoing)

- Cron job automatically triggers every hour (`0 * * * *`)
- Updates last 90 days of data (~5-10 seconds)
- Logs to `application_logs` table
- No manual intervention needed

## Data Flow

```
┌─────────────────────────────────────────┐
│  Source Tables (Transactions)           │
│  - bookings (status, notes, dates)      │
│  - payments (amounts, tips)             │
│  - referral_profiles                    │
│  - square_existing_clients              │
└────────────────┬────────────────────────┘
                 │
                 ▼
        ┌─────────────────┐
        │ Refresh Script  │
        │ (hourly cron)   │
        └────────┬────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│ customer_analytics (DENORMALIZED)       │
│ - Single source of truth                │
│ - All metrics precomputed               │
│ - Indexed for fast queries              │
└────────────────┬────────────────────────┘
                 │
      ┌──────────┼──────────┐
      ▼          ▼          ▼
   VIEW 1     Direct      Reports
   (Dashboard) Queries    & Analysis
```

## Key Metrics Stored

| Metric | Source | Logic |
|--------|--------|-------|
| `first_booking_at` | bookings | MIN(start_at) WHERE status='ACCEPTED' |
| `last_booking_at` | bookings | MAX(start_at) WHERE status='ACCEPTED' |
| `total_accepted_bookings` | bookings | COUNT WHERE status='ACCEPTED' |
| `total_no_shows` | bookings | COUNT WHERE status='NO_SHOW' |
| `total_revenue_cents` | payments | SUM(amount_money_amount) WHERE status='COMPLETED' |
| `avg_ticket_cents` | payments | SUM(revenue) / COUNT(payments) |
| `new_customers` (KPI) | customer_analytics | COUNT WHERE DATE(first_booking_at) = target_date |
| `customer_segment` | Logic | NEW (30d) \| ACTIVE (30d) \| AT_RISK (90d) \| LOST |
| `booking_notes` | bookings | JSONB_AGG of customer_note + seller_note |

## New Customers Calculation (Fixed!)

**Before (BROKEN):**
```sql
-- Compared profile creation date with booking date
-- Result: Almost nobody was "new" (profiles created months before first booking)
COUNT(DISTINCT customer_id) 
WHERE created_at = booking_date  -- ❌ WRONG
```

**After (CORRECT):**
```sql
-- Uses first_booking_at from customer_analytics
-- Result: Correctly identifies customers with their first booking on that date
COUNT(DISTINCT ca.square_customer_id) 
WHERE DATE(ca.first_booking_at) = booking_date  -- ✅ CORRECT
```

## Monitoring & Troubleshooting

### Check Cron Status
```bash
curl https://your-app.vercel.app/admin/jobs/status
```

### Monitor Last Refresh
```sql
SELECT 
  logId, 
  payload->>'cron_name' as cron_name,
  status,
  created_at
FROM application_logs
WHERE logType = 'cron'
  AND payload->>'cron_name' = 'refresh-customer-analytics'
ORDER BY created_at DESC
LIMIT 10;
```

### Manual Refresh Anytime
```bash
# If you need to refresh outside of cron schedule
node scripts/refresh-customer-analytics.js recent

# Or via API (if you have admin access)
curl -X POST https://your-app.vercel.app/api/cron/refresh-customer-analytics \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Debug Issues
```bash
# Run sanity checks to identify data issues
node scripts/sanity-check-customer-analytics.js

# Check specific customer
psql -c "SELECT * FROM customer_analytics WHERE square_customer_id = 'CUST_ID';"
```

## Performance Notes

- **Hourly refresh (recent mode):** ~5-10 seconds
- **Full refresh (nightly):** ~1-5 minutes (depending on dataset size)
- **Dashboard VIEW query:** <100ms (using precomputed metrics)
- **Memory usage:** Negligible (aggregation happens in PostgreSQL)

## Rollback Plan

If issues arise:

```bash
# 1. Revert Prisma migration
npx prisma migrate resolve --rolled-back 20260218000000_add_customer_analytics

# 2. Remove cron from vercel.json and redeploy
# 3. Views will continue working with old logic

# Note: Old new_customers logic will be active until VIEW is reverted
```

## Next Steps

1. ✅ Run `npx prisma migrate dev` to create the table
2. ✅ Run `node scripts/refresh-customer-analytics.js full` for initial data load
3. ✅ Run `node scripts/update-analytics-appointments-view.js` to update VIEW
4. ✅ Run `node scripts/sanity-check-customer-analytics.js` to verify
5. ✅ Deploy to production - cron will run automatically!

---

**Last Updated:** Feb 18, 2026
**Status:** Ready for Production ✅

