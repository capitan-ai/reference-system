# ✅ Customer Analytics - Deployment Checklist

## What Was Implemented

### 1. Database Schema ✅
- [x] `CustomerAnalytics` model added to `prisma/schema.prisma`
- [x] Composite key: `(organization_id, square_customer_id)`
- [x] 65+ columns with all metrics
- [x] Relations to `Organization` and `SquareExistingClient`
- [x] SQL migration created with proper indexes

### 2. Data Refresh System ✅
- [x] `scripts/refresh-customer-analytics.js` - Manual refresh script
  - Modes: `full` (all data), `recent` (90 days), `org` (specific org)
  - Uses raw SQL for performance
  - Upserts on conflict (idempotent)
- [x] `app/api/cron/refresh-customer-analytics/route.js` - Cron endpoint
  - Vercel Cron compatible
  - CRON_SECRET authorization
  - Logs to application_logs
  - GET and POST support

### 3. Configuration ✅
- [x] `vercel.json` updated with cron schedule
  - Path: `/api/cron/refresh-customer-analytics`
  - Schedule: `0 * * * *` (every hour)

### 4. View Updates ✅
- [x] `scripts/update-analytics-appointments-view.js` - View update script
  - Fixes `new_customers` calculation
  - Uses `customer_analytics.first_booking_at`
  - Backward compatible with existing queries

### 5. Verification & Monitoring ✅
- [x] `scripts/sanity-check-customer-analytics.js` - 8-step verification
  - Table existence check
  - Row count check
  - Segment distribution
  - avg_ticket calculations
  - first_booking_at correctness
  - Referral data validation
  - VIEW availability check

### 6. Deployment Tools ✅
- [x] `deploy-customer-analytics.sh` - Automated deployment script
  - 4-step deployment process
  - Error handling
  - Progress reporting
  - Made executable

### 7. Documentation ✅
- [x] `CUSTOMER_ANALYTICS_IMPLEMENTATION.md` - Full technical guide
- [x] `CUSTOMER_ANALYTICS_QUICKSTART.md` - 3-step quick start
- [x] `CUSTOMER_ANALYTICS_COMPLETE.md` - Overview and deployment guide
- [x] `DEPLOYMENT_CHECKLIST.md` - This file

## Pre-Deployment Checklist

Before deploying to production:

- [ ] Review `CUSTOMER_ANALYTICS_IMPLEMENTATION.md` for technical details
- [ ] Ensure `CRON_SECRET` environment variable is set in Vercel
- [ ] Verify database connection works
- [ ] Check disk space for migration (< 100 MB for most datasets)
- [ ] Schedule deployment during low-traffic window
- [ ] Have rollback plan ready (documented in IMPLEMENTATION.md)

## Deployment Checklist

### Step 1: Code Deployment
- [ ] Commit changes to git
  ```bash
  git add .
  git commit -m "feat: add customer_analytics table and refresh system"
  ```
- [ ] Push to main branch
  ```bash
  git push origin main
  ```
- [ ] Verify Vercel deployment completes
- [ ] Check that new cron schedule appears in Vercel dashboard

### Step 2: Database Migration
- [ ] Run migration in production
  ```bash
  npx prisma migrate deploy
  ```
- [ ] Verify table created: `SELECT COUNT(*) FROM customer_analytics;`
- [ ] Check indexes exist
  ```sql
  SELECT indexname FROM pg_indexes 
  WHERE tablename = 'customer_analytics';
  ```

### Step 3: Initial Data Load
- [ ] Run full refresh script
  ```bash
  node scripts/refresh-customer-analytics.js full
  ```
- [ ] Monitor execution time (should be 1-5 minutes)
- [ ] Check application_logs for any errors
  ```sql
  SELECT * FROM application_logs 
  WHERE logType = 'cron' AND status = 'error'
  ORDER BY created_at DESC LIMIT 5;
  ```

### Step 4: View Update
- [ ] Update analytics view
  ```bash
  node scripts/update-analytics-appointments-view.js
  ```
- [ ] Verify view creation
  ```sql
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views 
    WHERE table_name = 'analytics_appointments_by_location_daily'
  );
  ```

### Step 5: Verification
- [ ] Run sanity checks
  ```bash
  node scripts/sanity-check-customer-analytics.js
  ```
- [ ] All checks should pass or be explained
- [ ] Check sample customer data
  ```sql
  SELECT * FROM customer_analytics LIMIT 1;
  ```

### Step 6: Monitor
- [ ] Check cron job status at `/admin/jobs/status`
- [ ] Wait for next cron run (up to 1 hour)
- [ ] Verify cron execution logged successfully
  ```sql
  SELECT * FROM application_logs 
  WHERE payload->>'cron_name' = 'refresh-customer-analytics'
  ORDER BY created_at DESC LIMIT 1;
  ```

### Step 7: Validate Dashboard
- [ ] Check KPI "New Customers" displays correctly
- [ ] Verify "Bookings" count matches total_accepted_bookings
- [ ] Check "Rebooking Rate" calculation (should use unique - new)
- [ ] Monitor dashboard for 24 hours for any issues

## Post-Deployment Checklist

- [ ] Document deployment date and time
- [ ] Create runbook for troubleshooting
- [ ] Set up monitoring/alerts for cron failures
- [ ] Schedule optional nightly full refresh (if desired)
- [ ] Archive this checklist with deployment notes
- [ ] Notify team of new analytics system

## Rollback Plan (If Needed)

If critical issues occur:

1. **Disable cron** (immediate):
   - Remove cron from `vercel.json`
   - Deploy: `git push`
   - Vercel will stop scheduling refreshes

2. **Revert view** (if new_customers broken):
   ```bash
   # Switch back to old logic
   git checkout HEAD~1 -- scripts/update-analytics-appointments-view.js
   node scripts/update-analytics-appointments-view.js
   ```

3. **Drop table** (if data corrupted):
   ```sql
   DROP TABLE customer_analytics CASCADE;
   ```
   Then redeploy migration and reload data.

4. **Full rollback** (if everything broken):
   ```bash
   npx prisma migrate resolve --rolled-back 20260218000000_add_customer_analytics
   git push
   # Old schema is now active
   ```

## Files Modified

```
✅ prisma/schema.prisma
   + Added CustomerAnalytics model
   + Added analytics relation to Organization
   + Added analytics relation to SquareExistingClient

✅ vercel.json
   + Added cron entry for refresh-customer-analytics

✅ NEW: prisma/migrations/20260218000000_add_customer_analytics/migration.sql
✅ NEW: scripts/refresh-customer-analytics.js
✅ NEW: app/api/cron/refresh-customer-analytics/route.js
✅ NEW: scripts/update-analytics-appointments-view.js
✅ NEW: scripts/sanity-check-customer-analytics.js
✅ NEW: deploy-customer-analytics.sh
✅ NEW: CUSTOMER_ANALYTICS_IMPLEMENTATION.md
✅ NEW: CUSTOMER_ANALYTICS_QUICKSTART.md
✅ NEW: CUSTOMER_ANALYTICS_COMPLETE.md
✅ NEW: DEPLOYMENT_CHECKLIST.md
```

## Support & Troubleshooting

### Common Issues

**Q: Migration fails with "relation already exists"**
- A: Table already exists from previous attempt. Check `schema.sql_migrations` table.

**Q: Cron job not running**
- A: Check CRON_SECRET env var is set in Vercel. Verify schedule in vercel.json.

**Q: Refresh takes too long**
- A: First full refresh is normal (1-5 min). Hourly refreshes should be 5-10 sec.

**Q: New customers count still wrong**
- A: Verify VIEW was updated. Check if using old query. Restart app instance.

### Getting Help

1. Check application_logs table for error messages
2. Run sanity-check script to identify data issues
3. Consult CUSTOMER_ANALYTICS_IMPLEMENTATION.md for detailed troubleshooting
4. Review database query logs in production

---

**Status: 🟢 READY FOR DEPLOYMENT**

Deployment estimated time: **15-30 minutes**
(5 min code deploy + 10 min migration + 5 min data load + 5 min verification)

---

*Deployment Guide for Zorina Reference System*
*Customer Analytics Implementation*
*Feb 18, 2026*
