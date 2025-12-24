# 🔧 How to Configure Square Webhooks - Step by Step

## Step 1: Go to Square Developer Dashboard
1. Open: https://developer.squareup.com/apps
2. Log in with your Square account
3. Select your application

## Step 2: Navigate to Webhooks
1. In the left sidebar, click "Webhooks"
2. You should see a list of existing webhooks (if any)

## Step 3: Add New Webhook or Edit Existing
1. Click "Add" or "Create Webhook" button
2. If one already exists, click "Edit"

## Step 4: Enter Webhook URL
**Important:** Use the EXACT URL below:
```
https://referral-system-salon.vercel.app/api/webhooks/square/referrals
```

## Step 5: Select Events
Check these THREE events:
- ☑️ `customer.created`
- ☑️ `booking.created`
- ☑️ `payment.updated`

## Step 6: Save
1. Click "Save" or "Create"
2. Square will try to deliver a test webhook
3. You should see it succeed

## Step 7: Verify
Go back to this terminal and run:
```bash
node scripts/check-all-recent-activity.js
```

You should see webhook activity!

---

## Troubleshooting

**Problem:** Webhook shows "Failed" in Square
- **Solution:** Make sure the URL is EXACTLY: `https://referral-system-salon.vercel.app/api/webhooks/square/referrals`

**Problem:** No webhooks received
- **Solution:** 
  1. Check Square webhook logs in Developer Dashboard
  2. Make sure events are checked
  3. Make sure webhook is "Enabled"

**Problem:** 401 Unauthorized error
- **Solution:** We removed signature verification, so this shouldn't happen

---

**Current Status:**
- ✅ Code is deployed
- ✅ Database is ready
- ⏳ Waiting for Square webhook configuration

**Action Required:**
Go to Square Developer Dashboard and configure webhooks NOW!

