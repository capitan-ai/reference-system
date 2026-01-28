# Order Webhook Fix - Jan 16-18 Issue

## Problem Summary

Orders and `order_line_items` tables stopped updating from webhooks since Jan 16-18. Investigation revealed:

- **Last orders saved**: Jan 17, 2026
- **Last line items saved**: Jan 18, 2026  
- **No new orders/line items**: After Jan 18

## Root Causes Identified

1. **Silent failures in organization_id resolution**: If `organization_id` couldn't be resolved, the webhook handler would return early without saving anything, but the webhook would still return 200 OK, so Square wouldn't retry.

2. **Poor error handling**: Errors were being caught but not properly logged or surfaced, making debugging difficult.

3. **No fallback mechanisms**: If the primary method of resolving `organization_id` failed, there were no fallback options.

4. **Order save failures**: If order save failed, line items couldn't be saved either, but the error wasn't properly handled.

## Fixes Applied

### 1. Enhanced organization_id Resolution (`app/api/webhooks/square/route.js`)

Added multiple fallback mechanisms:
- ✅ Primary: Resolve from `merchant_id` → `organizations` table
- ✅ Secondary: Resolve from `location_id` → `locations` table  
- ✅ Tertiary: Resolve from existing orders with same `order_id`
- ✅ Last resort: Use first active organization (with warning log)

**Before**: Would silently return if `organization_id` couldn't be resolved
**After**: Tries all methods, throws error if all fail (so Square retries)

### 2. Improved Error Handling

- ✅ Added detailed logging at each step of `organization_id` resolution
- ✅ Errors now throw instead of silently returning (ensures Square retries)
- ✅ Better error messages with context (merchant_id, location_id, order_id)
- ✅ Stack traces logged for debugging

### 3. Enhanced Order Save Logic

- ✅ If order save fails, attempts to get existing order UUID
- ✅ If order UUID not found, retries order creation with explicit UUID
- ✅ Better error messages and logging throughout
- ✅ Ensures line items can still be saved even if initial order save fails

### 4. Better Webhook Response Handling

- ✅ Order webhook errors are now caught and re-thrown
- ✅ Webhook returns 500 status on errors (so Square will retry)
- ✅ Detailed error logging with event type and stack traces

## Code Changes

### File: `app/api/webhooks/square/route.js`

**Lines 791-870**: Enhanced `organization_id` resolution with fallbacks
**Lines 959-1015**: Improved order save error handling with retry logic
**Lines 125-130**: Added try-catch around order webhook processing
**Lines 139-150**: Enhanced error response with detailed logging

## Testing Recommendations

1. **Monitor webhook logs** for the next few days to see:
   - If orders are being saved successfully
   - If `organization_id` resolution is working
   - Any new errors that might appear

2. **Check database** for new orders:
   ```sql
   SELECT COUNT(*), DATE(created_at) as date
   FROM orders
   WHERE created_at >= NOW() - INTERVAL '7 days'
   GROUP BY DATE(created_at)
   ORDER BY date DESC;
   ```

3. **Verify webhook endpoint** is receiving events:
   - Check Vercel logs for `order.created` and `order.updated` events
   - Verify webhook signature validation is working

4. **Check for any remaining issues**:
   - Orders without line items
   - Line items without orders
   - Missing `organization_id` values

## Diagnostic Scripts Created

1. **`scripts/diagnose-order-webhook-issues.js`**: 
   - Checks recent orders and line items
   - Verifies organizations and locations exist
   - Checks environment variables

2. **`scripts/check-order-gaps.js`**:
   - Identifies gaps in order processing by date
   - Finds orders without line items
   - Compares payments vs orders

## Next Steps

1. ✅ **Deploy the fixes** to production
2. ⏳ **Monitor logs** for the next 24-48 hours
3. ⏳ **Verify orders are being saved** from new webhooks
4. ⏳ **Check for any new errors** in webhook processing
5. ⏳ **Consider backfilling** any missing orders from Jan 18 onwards (if needed)

## Potential Backfill

If orders are missing from Jan 18 onwards, you may need to:

1. Query Square API for orders created after Jan 18
2. Process them through the webhook handler (or create a backfill script)
3. Verify all orders and line items are saved

## Monitoring

Watch for these log messages:
- ✅ `✅ Resolved organization_id from merchant_id` - Good
- ✅ `✅ Saved order ... to orders table` - Good
- ⚠️ `⚠️ Using fallback organization_id` - Should investigate why primary methods failed
- ❌ `❌ CRITICAL: Cannot process order` - Needs immediate attention

## Related Files

- `app/api/webhooks/square/route.js` - Main webhook handler (FIXED)
- `scripts/diagnose-order-webhook-issues.js` - Diagnostic script (NEW)
- `scripts/check-order-gaps.js` - Gap analysis script (NEW)



