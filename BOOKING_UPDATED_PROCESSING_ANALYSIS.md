# Booking.Updated Webhook Processing Analysis

## Summary

This document explains how `booking.updated` webhooks are processed in the system and answers key questions about the processing flow.

## How Booking.Updated Works

### 1. Webhook Reception
- **Location**: `app/api/webhooks/square/route.js` (lines 111-133)
- **Handler**: When Square sends a `booking.updated` webhook, it's received by the main webhook route
- **Processing**: The webhook calls `processBookingUpdated` from `app/api/webhooks/square/referrals/route.js`

### 2. Processing Logic (`processBookingUpdated`)
**Location**: `app/api/webhooks/square/referrals/route.js` (lines 3176-3379)

**Key Steps**:
1. **Extract booking ID** from webhook payload
2. **Check for existing booking** (lines 3197-3209):
   ```sql
   SELECT id, organization_id, booking_id, service_variation_id, technician_id, administrator_id
   FROM bookings
   WHERE booking_id LIKE ${baseBookingId}%
   ```
3. **If booking exists**: UPDATE the existing booking record (lines 3358-3367)
4. **If booking doesn't exist**: Log warning and return (lines 3204-3208) - **DOES NOT CREATE NEW BOOKING**

### 3. Update Fields
The function updates these fields if they're present in the webhook:
- `status`
- `customer_note`
- `seller_note`
- `version`
- `location_id`
- `service_variation_id`
- `technician_id`
- `duration_minutes`
- `service_variation_version`
- `updated_at` (always updated)
- `raw_json` (always updated)

## Answers to Your Questions

### Q1: If booking won't change, do we not get booking.updated webhook?

**Answer**: **Correct**. Square only sends `booking.updated` webhooks when there are actual changes to the booking data. If nothing changes, no webhook is sent.

### Q2: When we get updated webhook, how do we process?

**Answer**: The processing flow is:
1. Webhook received at `app/api/webhooks/square/route.js`
2. Extracts booking data from webhook payload
3. Calls `processBookingUpdated()` function
4. **Checks for existing booking first** (searches by `booking_id`)
5. **Updates existing booking** if found
6. **Logs warning and returns** if booking not found (does NOT create new booking)

### Q3: Do we check first existing booking or we create new data?

**Answer**: **We check for existing booking FIRST, then UPDATE existing data**. We do NOT create new bookings from `booking.updated` webhooks.

**Code Evidence**:
```javascript
// Line 3197-3209: Check for existing booking
const existingBookings = await prisma.$queryRaw`
  SELECT id, organization_id, booking_id, service_variation_id, technician_id, administrator_id
  FROM bookings
  WHERE booking_id LIKE ${`${baseBookingId}%`}
  ORDER BY created_at ASC
`

if (!existingBookings || existingBookings.length === 0) {
  console.warn(`⚠️ booking.updated: Booking ${baseBookingId} not found in database`)
  console.warn(`   This might be a booking that was created before webhook handling was implemented`)
  console.warn(`   Consider running backfill script to sync missing bookings`)
  return  // <-- Returns early, does NOT create new booking
}

// Line 3358-3367: Update existing booking
const updateQuery = `
  UPDATE bookings
  SET ${updateFields.join(', ')}
  WHERE id = $${updateValues.length + 1}::uuid
`
await prisma.$executeRawUnsafe(updateQuery, ...updateValues)
```

## Cron Jobs and Booking.Updated

### Current State
**Cron jobs do NOT process `booking.updated` events**. The cron jobs/workers only handle:
- `customer_ingest` → `processCustomerCreated`
- `booking` → `processBookingCreated` (only for `booking.created`)
- `payment` → `processPaymentCompletion`
- `payment_save` → `processPaymentSave`

**There is NO `booking_updated` stage in the cron job system.**

### Why This Matters
- **Webhook processing**: `booking.updated` is handled **directly** by the webhook route
- **No retry mechanism**: If the webhook processing fails, there's no cron job fallback to retry `booking.updated` events
- **Only webhook retries**: Square will retry failed webhooks, but there's no internal job queue for `booking.updated`

## Potential Issues

### Issue 1: Missing Bookings
If a `booking.updated` webhook arrives for a booking that doesn't exist in the database:
- The function logs a warning and returns
- **No booking is created**
- The booking data is lost

**Solution**: Run backfill scripts to sync missing bookings, or modify `processBookingUpdated` to create bookings if they don't exist (similar to how `processBookingCreated` works).

### Issue 2: No Cron Job Retry
If webhook processing fails:
- Square will retry the webhook (up to their retry limit)
- But there's no internal job queue to retry `booking.updated` events
- Unlike `payment_save`, there's no fallback mechanism

**Solution**: Add a `booking_updated` stage to the cron job system, similar to how `payment_save` works.

## Recommendations

1. **Add booking_updated stage to cron jobs**: Create a job queue stage for `booking.updated` events that can be retried by cron jobs
2. **Consider creating missing bookings**: If `booking.updated` arrives for a non-existent booking, consider creating it (though this is unusual)
3. **Add logging**: Add more detailed logging to track when `booking.updated` webhooks are received and processed
4. **Monitor webhook failures**: Track failed `booking.updated` webhook processing to identify patterns

## Code Locations

- **Webhook handler**: `app/api/webhooks/square/route.js` (lines 111-133)
- **Processing function**: `app/api/webhooks/square/referrals/route.js` (lines 3176-3379)
- **Export**: `app/api/webhooks/square/referrals/route.js` (line 5069)
- **Cron job runner**: `lib/workers/giftcard-job-runner.js` (no `booking_updated` stage)



