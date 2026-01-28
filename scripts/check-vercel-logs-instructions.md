# How to Get Vercel Logs for Square Webhooks

## Method 1: Vercel Dashboard (Recommended)

1. Go to: https://vercel.com/dashboard
2. Select your project: `referral-system-salon`
3. Navigate to: **Deployments** → **Latest Deployment** → **Logs**
4. Filter logs by:
   - `payment`
   - `webhook`
   - `square`
   - `location_id`
   - `💳` (payment emoji)
   - `🔔` (webhook emoji)

## Method 2: Vercel CLI (Real-time Streaming)

```bash
# Get latest deployment URL
vercel ls

# Stream logs from specific deployment (streams in real-time)
vercel logs <deployment-url>

# Stream logs with JSON format
vercel logs <deployment-url> --json | jq 'select(.message | contains("payment") or contains("webhook"))'
```

## Method 3: Check Production URL Directly

Based on your webhook configuration, the production URL is:
- **Production**: `https://www.zorinastudio-referral.com`
- **Webhook Endpoint**: `https://www.zorinastudio-referral.com/api/webhooks/square/referrals`

## What to Look For in Logs

### Payment Webhook Logs Should Show:

1. **Webhook Received:**
   ```
   🔔 Webhook received
   💳 Payment payment.updated event received
   ```

2. **Payment Data Extraction:**
   ```
   🔍 Payment.updated webhook - checking location_id:
      location_id (snake_case): [value or MISSING]
      locationId (camelCase): [value or MISSING]
      order_id: [value]
   ```

3. **Payment Saving:**
   ```
   💾 Attempting to save payment [ID] to database...
   ✅ Payment saved to database
   OR
   ❌ Error saving payment to database: [error]
   ```

4. **Location Resolution:**
   ```
   📍 Payment missing locationId, attempting to resolve from order...
   ✅ Found locationId from order in DB
   OR
   ✅ Found locationId from Square API order
   ```

## Recent Deployment URLs

Latest deployments (from `vercel ls`):
- `https://referral-system-salon-r0hv541eg-umis-projects-e802f152.vercel.app` (2 days ago)
- `https://referral-system-salon-k61pwglbf-umis-projects-e802f152.vercel.app` (2 days ago)

## Quick Command

```bash
# Stream logs and filter for payment webhooks
vercel logs https://referral-system-salon-r0hv541eg-umis-projects-e802f152.vercel.app --json | \
  jq -r 'select(.message | test("payment|webhook|location_id"; "i")) | "\(.timestamp // .date) \(.message)"'
```



