# Admin Scorecard – Refresh and Creator Revenue

## Data sources in admin_analytics_daily

- **Table**: `admin_analytics_daily`
- **creator_revenue_cents** = **Net Sales** (payment total minus tips). Tips are not included.
- **new_customers_booked_count** и **rebookings_count** = prior-paid логика из `admin_created_booking_facts` (букинги, созданные админом; NEW_CLIENT = нет prior completed payment, REBOOKING = есть prior paid). См. [ADMIN_CREATED_BOOKINGS_NEW_REBOOK_CONTRACT.md](./ADMIN_CREATED_BOOKINGS_NEW_REBOOK_CONTRACT.md).
- **bookings_current_month_count**, **bookings_future_months_count** = агрегаты из `admin_created_booking_facts` (is_same_month, is_future_month).

## Why "Creator revenue still not updated"?

The Scorecard reads from `admin_analytics_daily` (e.g. via Supabase). For Creator Revenue to update you need **both**:

1. **Run the backend refresh** so the table is recomputed (Net Sales logic, latest bookings).
2. **Refetch** the table in the UI after the refresh completes.

If the "Refresh" button only refetches from the DB without calling the backend, the numbers will not change until a cron run or someone runs the manual script.

## Required flow when user clicks "Refresh"

1. **Call the refresh API** (with the same auth as the rest of the admin app):
   - `POST /api/admin/analytics/refresh-admin`  
   - or `GET /api/admin/analytics/refresh-admin`  
   - Optional query: `?days=35` or `?from=YYYY-MM-DD&to=YYYY-MM-DD`
2. **On success** (e.g. `200` and `{ success: true }`):
   - Refetch `admin_analytics_daily` from Supabase (or your data source) for the same filters (org, date range, location).
   - Re-run your scorecard aggregation (e.g. `aggregateAdminRows()`) on the new rows.
3. **Then** show "Data refreshed" / "Scorecard recalculated successfully".

If the button only does step 2 without step 1, the table may still contain old data and Creator Revenue will look unchanged.

## Backend response after refresh

Example:

```json
{
  "success": true,
  "message": "Admin analytics refreshed successfully",
  "rows_updated": 204,
  "note": "creator_revenue_cents and cashier_revenue_cents are Net Sales (tips excluded). Refetch admin_analytics_daily to see updated Creator Revenue."
}
```

Use `rows_updated` if you want to show how many rows were refreshed.

## Manual refresh (without UI)

To update the table from the server or a script:

```bash
node scripts/manual-refresh-admin-analytics.js
# or with date range:
node scripts/manual-refresh-admin-analytics.js --from=2026-02-01 --to=2026-02-28
```

Cron also runs periodically: `GET /api/cron/refresh-admin-analytics` (with cron secret).
