# Booking.Updated Fix - Create Missing Bookings

## Problem

When a `booking.updated` webhook arrives for a booking that doesn't exist in the database, the system would:
1. Log a warning
2. Return early without saving the booking
3. Lose the booking data

This happened because:
- The `booking.created` webhook was never received, OR
- The `booking.created` webhook failed to process, OR
- The booking was created before webhook handling was implemented

## Example Case

**Booking ID**: `gb2c2hdlkqguo4`
- Customer: `NR74ABD2W5PBXC46R41B9HPA4M` (Umit Rakhimbekova)
- Status: `CANCELLED_BY_CUSTOMER`
- Created: `2026-01-27T18:39:09Z`
- Updated: `2026-01-27T19:06:14Z`

**Issue**: Booking was NOT in database when `booking.updated` webhook arrived at `2026-01-27 19:06:16`.

## Solution

Modified `processBookingUpdated` function in `app/api/webhooks/square/referrals/route.js` to:

1. **Check if booking exists** (existing behavior)
2. **If booking doesn't exist**: Create it using `saveBookingToDatabase` (NEW)
3. **If booking exists**: Update it (existing behavior)

This ensures that even if `booking.created` webhook is missed, we can still capture the booking data from `booking.updated` webhook.

## Code Changes

**File**: `app/api/webhooks/square/referrals/route.js`
**Function**: `processBookingUpdated` (lines ~3204-3208)

**Before**:
```javascript
if (!existingBookings || existingBookings.length === 0) {
  console.warn(`⚠️ booking.updated: Booking ${baseBookingId} not found in database`)
  console.warn(`   This might be a booking that was created before webhook handling was implemented`)
  console.warn(`   Consider running backfill script to sync missing bookings`)
  return  // <-- Just returns, loses booking data
}
```

**After**:
```javascript
if (!existingBookings || existingBookings.length === 0) {
  console.warn(`⚠️ booking.updated: Booking ${baseBookingId} not found in database`)
  console.warn(`   This might be a booking that was created before webhook handling was implemented`)
  console.warn(`   OR the booking.created webhook was missed/failed`)
  console.log(`   Creating booking from booking.updated webhook data...`)
  
  // Create booking if it doesn't exist (fallback for missed booking.created webhooks)
  // ... resolves organization_id, customer_id, etc.
  // ... calls saveBookingToDatabase() to create the booking
  // ... handles multi-service bookings
  
  console.log(`✅ Successfully created booking ${baseBookingId} from booking.updated webhook`)
  return
}
```

## Benefits

1. **No data loss**: Bookings are saved even if `booking.created` webhook fails
2. **Resilient**: System can recover from missed webhooks
3. **Consistent**: Uses same `saveBookingToDatabase` logic as `processBookingCreated`
4. **Backward compatible**: Still updates existing bookings as before

## Testing

To test this fix:
1. Create a booking in Square
2. Manually delete it from database (simulating missed `booking.created`)
3. Trigger a `booking.updated` webhook (e.g., cancel the booking)
4. Verify booking is created in database

## Related Files

- `app/api/webhooks/square/referrals/route.js` - Main fix location
- `app/api/webhooks/square/route.js` - Webhook route handler
- `scripts/check-booking-gb2c2hdlkqguo4.js` - Diagnostic script for the example case



