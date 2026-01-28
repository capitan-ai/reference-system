# Payment Webhook Investigation Report

## Critical Finding: 100% of 2025 Orders Missing Payments

### Statistics
- **Total Orders**: 29,070
- **Orders with Payments**: 27,174 (93.5%)
- **Orders without Payments**: 1,896 (6.5%)
- **2025 Orders**: 248 orders, **0 with payments (100% missing)**
- **Last 7 Days**: 240 orders, **0 with payments (100% missing)**

### Specific Order Analysis
- **Order**: `P1c1WYwCzcpQQkLaHIiiDTQokLSZY` (Dec 15, 2025)
  - Has `booking_id` ✅
  - Has 2 line items with `booking_id` ✅
  - **0 payments** ❌

## Root Cause Hypotheses

### Hypothesis H: Payment Webhooks Not Being Received
**Evidence:**
- 100% of recent orders missing payments
- All payments in database have `order_id` (100% linked) - no unlinked payments
- Suggests webhooks stopped arriving entirely, not just failing to link

**Possible Causes:**
1. Square webhook configuration disabled/changed
2. Webhook endpoint URL changed
3. Webhook signature key misconfigured
4. Square stopped sending webhooks due to repeated failures

### Hypothesis I: Payment Webhook Handler Throwing Errors
**Evidence:**
- Handler has try-catch that swallows errors (returns 200 even on failure)
- Errors logged but webhook returns success
- Square might stop retrying if it thinks webhooks are succeeding

**Code Location:** `app/api/webhooks/square/route.js:729-735`
```javascript
} catch (error) {
  console.error(`❌ Failed to save payment to database:`, error.message)
  // Don't throw - allow webhook to continue processing
  // BUT: This might be hiding errors!
}
```

### Hypothesis J: Missing organization_id or location_id
**Evidence:**
- Handler has early returns if `organization_id` or `location_id` missing
- These return without throwing, so webhook returns 200
- Square thinks webhook succeeded but payment not saved

**Code Locations:**
- `route.js:323` - Missing organization_id
- `route.js:353` - Missing location_id

## Fixes Applied

### 1. Added Comprehensive Error Handling
- Wrapped `savePaymentToDatabase` in try-catch
- Re-throws errors to return 500 (so Square retries)
- Added error logging with full context

### 2. Added Instrumentation
Instrumentation added at key points:
- Payment webhook received
- Payment data extraction
- Order lookup results
- Payment save success/failure
- Missing organization_id errors
- Missing location_id errors
- All errors caught

### 3. Added Payment Linking Logic
- When order webhook arrives, links unlinked payments
- Handles case where payment webhook arrived before order webhook

## Webhook Signature Verification

The webhook handler verifies Square signatures:
- **Location**: `app/api/webhooks/square/route.js:43-57`
- **Requirement**: `SQUARE_WEBHOOK_SIGNATURE_KEY` environment variable
- **Behavior**: Returns 401 if signature invalid, 500 if key missing

**If signature verification fails:**
- Square will retry webhooks
- But if key is wrong, ALL webhooks will be rejected
- Square may stop sending webhooks after repeated failures

## Next Steps

### 1. Check Square Webhook Configuration
- Verify webhook endpoint URL is correct
- Verify webhook events are enabled (payment.created, payment.updated)
- Check webhook delivery status in Square dashboard

### 2. Check Environment Variables
- Verify `SQUARE_WEBHOOK_SIGNATURE_KEY` is set correctly
- Verify `SQUARE_ACCESS_TOKEN` is valid
- Check if environment changed around 2025

### 3. Monitor Webhook Endpoint
- Check server logs for webhook requests
- Look for signature verification failures
- Check for 401/500 responses

### 4. Test Webhook Endpoint
- Run `node scripts/test-payment-webhook-endpoint.js`
- Verify endpoint responds correctly
- Check debug.log for instrumentation

### 5. Check for Recent Code Changes
- Review git history around 2025
- Check if webhook handler was modified
- Check if environment variables changed

## Monitoring

### Log Files to Check
- `.cursor/debug.log` - Instrumentation logs
- `worker.log` - Worker logs (shows payment processing from Dec 2025)
- `worker-prod.log` - Production worker logs
- Server logs - Webhook endpoint access logs

### Key Metrics to Monitor
- Payment webhook receipt rate
- Payment save success rate
- Missing organization_id errors
- Missing location_id errors
- Signature verification failures

## Recommendations

### Immediate Actions
1. ✅ **DONE**: Added error handling and instrumentation
2. ⏳ **TODO**: Check Square webhook configuration
3. ⏳ **TODO**: Verify environment variables
4. ⏳ **TODO**: Monitor webhook endpoint logs
5. ⏳ **TODO**: Test webhook endpoint manually

### Long-term Improvements
1. Add webhook delivery monitoring/alerting
2. Add metrics for webhook success/failure rates
3. Consider re-throwing critical errors instead of swallowing
4. Add retry mechanism for failed payment saves
5. Add backfill script to fetch missing payments from Square API

## Code Changes Summary

### Files Modified
1. `app/api/webhooks/square/route.js`
   - Added error handling to payment webhook handler
   - Added instrumentation at key points
   - Added payment linking logic in order webhook handler

### Scripts Created
1. `scripts/compare-orders-with-payments.js` - Compare orders vs payments
2. `scripts/analyze-payment-webhook-issue.js` - Analyze webhook processing
3. `scripts/test-payment-webhook-endpoint.js` - Test webhook endpoint
4. `scripts/investigate-missing-payments.js` - Investigate specific orders
5. `scripts/find-unlinked-payments-for-order.js` - Find unlinked payments



