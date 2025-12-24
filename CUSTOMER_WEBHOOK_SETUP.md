# Square Customer Webhook Setup Guide

This guide will help you set up automatic customer synchronization from Square to your database.

## 🎯 Overview

The webhook system will automatically:
- ✅ Add new customers to your `square_existing_clients` table
- ✅ Update existing customer information when changed in Square
- ✅ Generate unique personal codes for each customer
- ✅ Preserve Square's original timestamps

## 📋 Prerequisites

1. **Square Production Access Token** (already configured)
2. **Webhook URL** (your deployed application URL)
3. **Environment Variables** set up

## 🔧 Setup Steps

### Step 1: Add Environment Variables

Add these to your `.env` file:

```bash
# Square Configuration (already set)
SQUARE_ACCESS_TOKEN=your_production_access_token
SQUARE_ENVIRONMENT=production

# Webhook Configuration
WEBHOOK_URL=https://your-domain.com/api/webhooks/square/customers
SQUARE_WEBHOOK_SECRET=will_be_generated_during_setup
```

### Step 2: Deploy Your Application

Deploy your application to get a public webhook URL. The webhook endpoint is located at:
```
/api/webhooks/square/customers
```

### Step 3: Set Up Square Webhook Subscription

Run the webhook setup script:

```bash
node scripts/setup-customer-webhook.js
```

This will:
- Create a webhook subscription in Square
- Generate a webhook secret key
- Display the secret key for you to add to your environment variables

### Step 4: Add Webhook Secret

After running the setup script, add the generated secret to your environment variables:

```bash
SQUARE_WEBHOOK_SECRET=generated_secret_key_here
```

### Step 5: Test the Webhook

Test your webhook locally or in production:

```bash
node scripts/test-customer-webhook.js
```

## 🔍 Webhook Events

The system listens for these Square events:

- **`customer.created`** - New customer added to Square
- **`customer.updated`** - Existing customer information updated

## 📊 Webhook Handler Features

### New Customer Processing
- ✅ Verifies webhook signature for security
- ✅ Checks for duplicate customers
- ✅ Generates unique personal code
- ✅ Preserves Square timestamps
- ✅ Sets default values for referral fields

### Customer Update Processing
- ✅ Updates existing customer information
- ✅ Syncs name, email, phone changes
- ✅ Updates Square timestamps

## 🛡️ Security Features

- **Signature Verification**: All webhooks are verified using HMAC-SHA256
- **Duplicate Prevention**: Checks for existing customers before insertion
- **Error Handling**: Comprehensive error logging and handling

## 📝 Database Schema

New customers are added to `square_existing_clients` with:

```sql
INSERT INTO square_existing_clients (
  square_customer_id,    -- Square's customer ID
  given_name,            -- First name
  family_name,           -- Last name
  email_address,         -- Email address
  phone_number,          -- Phone number
  got_signup_bonus,      -- Default: FALSE
  activated_as_referrer, -- Default: FALSE
  personal_code,         -- Generated unique code
  created_at,            -- Square's creation timestamp
  updated_at             -- Square's update timestamp
)
```

## 🧪 Testing

### Local Testing
1. Start your development server: `npm run dev`
2. Use ngrok or similar to expose localhost: `ngrok http 3000`
3. Update `WEBHOOK_URL` to your ngrok URL
4. Run the test script: `node scripts/test-customer-webhook.js`

### Production Testing
1. Deploy your application
2. Update `WEBHOOK_URL` to your production URL
3. Run the test script
4. Create a test customer in Square to verify real-time sync

## 🔧 Troubleshooting

### Common Issues

1. **Webhook not receiving events**
   - Check webhook URL is publicly accessible
   - Verify webhook subscription is enabled in Square
   - Check webhook secret is correctly set

2. **Signature verification failed**
   - Ensure `SQUARE_WEBHOOK_SECRET` matches Square's secret
   - Check webhook payload is not modified

3. **Database errors**
   - Verify database connection
   - Check table schema matches expected format

### Debug Commands

```bash
# List existing webhook subscriptions
node scripts/setup-customer-webhook.js list

# Test webhook locally
node scripts/test-customer-webhook.js

# Check webhook logs in your application
```

## 📈 Monitoring

Monitor your webhook performance:

1. **Check webhook logs** in your application
2. **Verify customer count** in database matches Square
3. **Test with Square's webhook simulator** in Square Dashboard

## 🎉 Success Indicators

You'll know the webhook is working when:

- ✅ New customers appear in your database automatically
- ✅ Customer updates sync from Square
- ✅ Webhook test script returns success
- ✅ No duplicate customers are created

## 🔄 Maintenance

- **Regular Testing**: Test webhook monthly
- **Monitor Logs**: Check for webhook errors
- **Update Secrets**: Rotate webhook secrets periodically
- **Database Cleanup**: Monitor for any data inconsistencies

---

**Your customer sync workflow is now ready!** 🚀
