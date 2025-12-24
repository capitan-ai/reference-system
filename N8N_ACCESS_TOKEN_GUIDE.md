# 🔑 Getting Access Token from n8n

## Step 1: Get Your Access Token from n8n

### Option A: If Access Token is in n8n Workflow

1. **Go to your n8n instance:**
   - URL: https://aisolutionss.app.n8n.cloud/
   - Login to your n8n account

2. **Find your Square workflow:**
   - Look for workflows that use Square API
   - Open the workflow that contains the access token

3. **Copy the Access Token:**
   - Look for a Square node in your workflow
   - Open the Square node settings
   - Find the "Access Token" field
   - Copy the token (it should start with `EAAA` or similar)

### Option B: If Access Token is in Environment Variables

1. **Go to n8n Settings:**
   - Click on "Settings" (gear icon)
   - Navigate to "Environment Variables"

2. **Find the Square Access Token:**
   - Look for variables like:
     - `SQUARE_ACCESS_TOKEN`
     - `SQUARE_TOKEN`
     - Or similar naming

3. **Copy the value**

### Option C: Check n8n Workflow Credentials

1. **Go to Credentials:**
   - Click on "Credentials" in the sidebar
   - Look for Square credentials

2. **Open Square credentials:**
   - Click on the credential set
   - Copy the Access Token

---

## Step 2: Set Up Production Webhooks

### Quick Setup

Once you have your access token, run this command:

```bash
# Replace YOUR_ACCESS_TOKEN with the actual token from n8n
node scripts/setup-production-webhooks.js YOUR_ACCESS_TOKEN
```

Or update your `.env.local` file first:

```bash
# Edit .env.local
nano .env.local
```

Add or update this line:
```env
SQUARE_ACCESS_TOKEN="your_access_token_from_n8n"
```

Then run:
```bash
node scripts/setup-production-webhooks.js
```

---

## Step 3: Update Environment Variables

Once you have your access token, update your `.env.local`:

```env
# Square Configuration (Production)
SQUARE_ENV=production
SQUARE_ACCESS_TOKEN="your_token_from_n8n"
SQUARE_LOCATION_ID="your_production_location_id"
SQUARE_WEBHOOK_SIGNATURE_KEY="your_webhook_signature_key"

# Application
APP_BASE_URL="https://your-production-domain.com"
NODE_ENV=production
```

---

## Step 4: Configure Webhooks in Square Dashboard

### Manual Configuration (Recommended)

1. **Go to Square Developer Dashboard:**
   - URL: https://developer.squareup.com/apps
   - Login to your Square Developer account

2. **Select Your Application:**
   - Click on your application
   - Go to "Webhooks" tab

3. **Add Webhook Subscription:**
   - Click "Add Subscription" or "Create Webhook"
   - Set the webhook URL:
     ```
     https://referral-system-salon-fbbq6x1wt-umis-projects-e802f152.vercel.app/api/webhooks/square
     ```
   - Or use your custom production domain

4. **Select Events:**
   Check these events:
   - ✅ `booking.created`
   - ✅ `payment.updated`
   - ✅ `customer.created` (optional)

5. **Save and Get Signature Key:**
   - Click "Save" or "Create"
   - Copy the "Signature Key" or "Webhook Signature"
   - Add it to your `.env.local`:
     ```env
     SQUARE_WEBHOOK_SIGNATURE_KEY="your_signature_key_here"
     ```

---

## Step 5: Test the Setup

### Test 1: Verify Access Token

```bash
# Test connection with your production token
node scripts/test-square-connection.js
```

### Test 2: Check Webhook Subscriptions

```bash
# Check if webhooks are configured
node scripts/test-webhook-subscription.js
```

### Test 3: Test Webhook Processing

```bash
# Test webhook endpoint
npm run test-webhook
```

---

## Step 6: Deploy to Production

Once everything is configured:

```bash
# Build the project
npm run build

# Deploy to Vercel
vercel --prod

# Or use Vercel Dashboard to deploy
```

### Set Environment Variables in Vercel:

1. Go to Vercel Dashboard
2. Select your project
3. Go to Settings → Environment Variables
4. Add all the variables from `.env.local`:
   - `SQUARE_ACCESS_TOKEN`
   - `SQUARE_LOCATION_ID`
   - `SQUARE_WEBHOOK_SIGNATURE_KEY`
   - `SQUARE_ENV=production`
   - `DATABASE_URL`
   - `APP_BASE_URL`
   - `N8N_WEBHOOK_URL`

---

## 🎯 Complete Checklist

- [ ] Get access token from n8n
- [ ] Update `.env.local` with production token
- [ ] Run `node scripts/setup-production-webhooks.js`
- [ ] Configure webhook in Square Dashboard
- [ ] Copy webhook signature key
- [ ] Add signature key to `.env.local`
- [ ] Test connection with `node scripts/test-square-connection.js`
- [ ] Test webhook subscription with `node scripts/test-webhook-subscription.js`
- [ ] Deploy to production
- [ ] Set environment variables in Vercel
- [ ] Test with real booking in production

---

## 🚨 Common Issues

### Issue 1: "Invalid Access Token"
- **Solution:** Make sure you copied the entire token from n8n
- Check if the token is for production, not sandbox
- Verify the token hasn't expired

### Issue 2: "Webhook Not Working"
- **Solution:** 
  - Check webhook URL is correct
  - Verify signature key is set
  - Make sure your app is deployed and accessible
  - Check webhook events are selected

### Issue 3: "Cannot Connect to Square"
- **Solution:** 
  - Verify access token permissions
  - Check internet connection
  - Make sure you're using the production token, not sandbox

---

## 📞 Need Help?

If you get stuck:
1. Check the error message in the terminal
2. Review the webhook logs
3. Verify all environment variables are set correctly
4. Check Square Developer Dashboard for webhook status

---

## ✅ Success!

Once everything is set up, you should see:
- ✅ Square API connection working
- ✅ Webhook subscriptions active
- ✅ Production environment configured
- ✅ Ready to process real bookings and payments!

**You're almost there!** 🚀
