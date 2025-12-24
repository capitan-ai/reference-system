# 📧 Email Setup Verification & Quick Start

## ✅ Current Status

Your email system is ready to send:
- ✅ **Referral Code Emails** - When customers are created/updated
- ✅ **Gift Card Emails** - When gift cards are issued
- ✅ **Test Email Endpoint** - `/api/test-email` (for testing)

## 🔧 Required Environment Variables

Make sure these are set in **Vercel Dashboard** → **Settings** → **Environment Variables** → **Production**:

### 1. SendGrid Configuration (Required)

```env
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FROM_EMAIL=info@studiozorina.com
```

**Where to get SendGrid API Key:**
1. Go to https://app.sendgrid.com/
2. Settings → API Keys
3. Create API Key (Full Access)
4. Copy the key (starts with `SG.`)

**FROM_EMAIL:**
- Must be verified in SendGrid
- Usually: `info@studiozorina.com` or `noreply@studiozorina.com`

### 2. Optional: Disable Email (for testing)

```env
DISABLE_EMAIL_SENDING=false  # Set to 'true' to disable (emails logged but not sent)
EMAIL_ENABLED=true            # Set to 'false' to disable
```

## 🧪 Test Email Sending

### Option 1: Test Endpoint

```bash
# Test the email endpoint
curl "https://www.zorinastudio-referral.com/api/test-email?email=your@email.com"
```

Or visit in browser:
```
https://www.zorinastudio-referral.com/api/test-email?email=your@email.com
```

### Option 2: Check Vercel Logs

1. Go to **Vercel Dashboard** → Your Project
2. Click **Deployments** → Latest
3. Click **Functions** → `/api/test-email`
4. Look for email sending logs

## 📨 When Emails Are Sent

### 1. Referral Code Emails

**Triggered by:**
- Square webhook: `customer.created` or `customer.updated`
- When a customer gets a referral code assigned

**Sent to:** Customer's email address from Square

**Content:**
- Personalized referral code
- Referral URL
- Instructions on how to use it

**Route:** `app/api/webhooks/square/referrals/route.js` (line 1149)

### 2. Gift Card Emails

**Triggered by:**
- Square webhook: `gift_card.created` or `gift_card.updated`
- When a gift card is issued to a customer

**Sent to:** Customer's email address from Square

**Content:**
- Gift card GAN (number)
- QR code
- Balance amount
- "Add to Apple Wallet" button
- Activation URL

**Route:** `app/api/webhooks/square/referrals/route.js` (line 205)

## ✅ Verification Checklist

- [ ] `SENDGRID_API_KEY` is set in Vercel (Production)
- [ ] `FROM_EMAIL` is set in Vercel (Production)
- [ ] FROM_EMAIL is verified in SendGrid
- [ ] Test endpoint works: `/api/test-email`
- [ ] Webhook route is deployed and working
- [ ] Square webhooks are configured to call your endpoint

## 🐛 Troubleshooting

### Emails Not Sending

1. **Check Vercel Logs:**
   - Look for error messages
   - Check if `SENDGRID_API_KEY` is found
   - Check if `FROM_EMAIL` is set

2. **Check SendGrid:**
   - Verify API key is active
   - Check API key permissions (needs Mail Send)
   - Verify FROM_EMAIL is verified

3. **Check Environment Variables:**
   - Make sure they're in **Production** environment
   - Redeploy after adding variables

### Email Sending Disabled

If you see: `⏸️ Email sending is disabled`

Check these environment variables:
- `DISABLE_EMAIL_SENDING` should be `false` or not set
- `EMAIL_ENABLED` should be `true` or not set

### "Email service not configured"

This means `SENDGRID_API_KEY` is missing. Add it to Vercel and redeploy.

## 🚀 Quick Start: Send Your First Email

1. **Set up SendGrid:**
   ```bash
   # Get API key from SendGrid dashboard
   # Add to Vercel: SENDGRID_API_KEY
   # Add to Vercel: FROM_EMAIL=info@studiozorina.com
   ```

2. **Test it:**
   ```bash
   curl "https://www.zorinastudio-referral.com/api/test-email?email=your@email.com"
   ```

3. **Check your email inbox!**

4. **Verify in logs:**
   - Vercel function logs should show: `✅ Referral email sent successfully`

## 📊 Email Routes Status

| Route | Status | Purpose |
|-------|-------|---------|
| `/api/test-email` | ✅ Fixed | Test email sending |
| `/api/webhooks/square/referrals` | ✅ Working | Sends referral & gift card emails |

Both routes use the same email service: `lib/email-service-simple.js`

## 🎯 Next Steps

1. ✅ Add `SENDGRID_API_KEY` to Vercel
2. ✅ Add `FROM_EMAIL` to Vercel  
3. ✅ Verify FROM_EMAIL in SendGrid
4. ✅ Test with `/api/test-email`
5. ✅ Check that webhooks are configured in Square
6. ✅ Monitor Vercel logs for email sending

Once configured, emails will automatically send when:
- Customers are created/updated (referral codes)
- Gift cards are issued (gift card notifications)

