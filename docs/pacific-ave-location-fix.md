# Pacific Ave Location Data Fix

**Date:** 2026-01-27  
**Issue:** Missing Pacific Ave data in analytics views after 2026-01-02

## Problem

Pacific Ave location data stopped appearing in analytics views after 2026-01-02:
- `analytics_revenue_by_location_daily`: Pacific Ave max date = 2025-12-31
- `analytics_appointments_by_location_daily`: Pacific Ave stops at 2026-01-01
- Union St continues normally to 2026-01-16 and beyond

## Root Cause

The `saveBookingToDatabase` function in `app/api/webhooks/square/referrals/route.js` was saving the **Square location ID directly** instead of resolving it to a **UUID** from the `locations` table.

**Before (Line 2931):**
```javascript
${bookingData.location_id || bookingData.locationId},  // ❌ Square ID string
```

**After:**
```javascript
// ✅ Resolve Square location ID to UUID
const squareLocationId = bookingData.location_id || bookingData.locationId
// ... lookup UUID from locations table ...
${locationUuid}::uuid,  // ✅ UUID
```

## Fix Applied

1. **Added location resolution logic** in `saveBookingToDatabase`:
   - Extract Square location ID from booking data
   - Ensure location exists in `locations` table (upsert if needed)
   - Look up location UUID by `square_location_id` and `organization_id`
   - Use UUID in booking record instead of Square ID

2. **Location Details:**
   - Pacific Ave: `square_location_id = "LNQKVBTQZN3EZ"`, UUID = `01ae4ff0-f69d-48d8-ab12-ccde01ce0abc`
   - Union St: `square_location_id = "LT4ZHFBQQYB2N"`, UUID = `9dc99ffe-8904-4f9b-895f-f1f006d0d380`

## Impact

- **Before fix:** Bookings with Pacific Ave location were either:
  - Not being saved (if foreign key constraint failed)
  - Being saved with wrong location_id (if constraint allowed it)
  - Resulting in missing data in analytics views

- **After fix:** All new bookings will correctly resolve Square location IDs to UUIDs, ensuring:
  - Pacific Ave bookings appear in analytics views
  - Location filtering works correctly
  - Data integrity maintained

## Verification

- ✅ No existing bookings/payments have invalid location_id values
- ✅ Payment webhook handler already resolves locations correctly
- ✅ Booking webhook handler now resolves locations correctly
- ✅ Location resolution includes organization_id for multi-tenant isolation

## Existing Data

**Important Finding:** After checking the database, there are **no existing bookings** with Pacific Ave `location_id` in `raw_json` after 2026-01-02. This suggests that:

1. **Bookings weren't saved at all** - The booking webhook likely failed silently when trying to save with an invalid location_id
2. **Data needs to be fetched from Square API** - If Pacific Ave bookings/payments exist in Square but weren't ingested, they need to be backfilled

## Backfill Script

A backfill script has been created: `scripts/backfill-pacific-ave-location.js`

**What it does:**
- Finds bookings with Pacific Ave `locationId` in `raw_json` but wrong `location_id` in database
- Fixes payments linked to Pacific Ave bookings
- Updates `location_id` to the correct Pacific Ave UUID

**Usage:**
```bash
node scripts/backfill-pacific-ave-location.js [limit] [offset]
```

**Note:** If no bookings are found (which is the current case), you may need to:
1. Fetch missing bookings from Square API using `scripts/replay-square-events.js`
2. Or manually backfill from Square's booking/payment APIs

## Next Steps

1. **Monitor:** Watch for new Pacific Ave bookings/payments after deployment
2. **Verify:** Check `analytics_revenue_by_location_daily` and `analytics_appointments_by_location_daily` for Pacific Ave data
3. **Backfill Missing Data:**
   - Run the backfill script: `node scripts/backfill-pacific-ave-location.js`
   - If no data found, fetch from Square API: `node scripts/replay-square-events.js` (for bookings)
   - Check Square dashboard to confirm if Pacific Ave transactions exist but weren't ingested

## Files Changed

- `app/api/webhooks/square/referrals/route.js` - Fixed `saveBookingToDatabase` function

