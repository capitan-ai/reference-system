# Deployment & Bulk Email Guide

## 🔧 Prisma Database Setup (Important!)

### Running Migrations

When deploying or updating the database schema, **always** ensure Prisma client is regenerated after migrations:

```bash
# For production deployments - applies migrations AND regenerates client
npm run prisma:deploy

# Or manually:
prisma migrate deploy && prisma generate
```

**Why this matters:**
- Migrations update the database schema
- Prisma client must be regenerated to use new models (GiftCardRun, GiftCardJob)
- Without regeneration, you'll see warnings and lose tracking/job queue functionality
- Health check at `/api/health` will show if models are available

### Verifying Prisma Models

After deployment, check the health endpoint:

```bash
curl https://your-domain.com/api/health
```

Look for:
- `giftCardRun.available: true` ✅
- `giftCardJob.available: true` ✅

If either shows `false`, run `npx prisma generate` and restart the application.

---

## 🚀 Step 1: Deploy the Dynamic Route (One Time Only!)

### How Dynamic Routing Works:
- **ONE file** (`app/ref/[refCode]/page.js`) handles **ALL 7000+ referral codes**
- When someone visits `/ref/CUST_MHA4LEYB5ERA`, Next.js automatically extracts the code
- No need to create 7000 different files!

### Deployment Steps:

1. **Commit changes:**
   ```bash
   git add .
   git commit -m "Add dynamic referral routing with personalized URLs"
   git push
   ```

2. **Vercel auto-deploys** (if connected to GitHub)
   - OR deploy manually in Vercel dashboard

3. **Test the route:**
   - Visit: `https://referral-system-salon.vercel.app/ref/CUST_MHA4LEYB5ERA`
   - Should display: `CUST_MHA4LEYB5ERA`
   - Try another: `https://referral-system-salon.vercel.app/ref/TEST123`
   - Should display: `TEST123`

**That's it!** All referral codes now work automatically!

---

## 📧 Step 2: Send Personalized URLs to All 7000 Customers

### Option A: Test Run (Recommended First!)

Test with a few customers first:

```bash
# Dry run - see what would be sent (no emails actually sent)
node scripts/send-referral-urls-to-all-customers.js
```

This will:
- Show how many customers will receive emails
- Show sample emails that would be sent
- **NO emails are actually sent** (safe!)

### Option B: Send to All Customers

Once you're ready:

```bash
# Actually send emails to all customers
DRY_RUN=false node scripts/send-referral-urls-to-all-customers.js
```

**Script Details:**
- Sends emails in batches of 10 (to avoid rate limits)
- Waits 5 seconds between batches
- Updates database to mark emails as sent
- Shows progress and errors
- Can be stopped and resumed

**Estimated Time:**
- 7000 customers ÷ 10 per batch = 700 batches
- 700 batches × 5 seconds = ~58 minutes
- Plus email sending time (~1-2 seconds per email)
- **Total: ~2-3 hours**

### Option C: Send to Specific Subset

Modify the script to send to:
- Only customers who haven't received email yet
- Only customers in a specific date range
- Only customers with certain criteria

---

## 📋 Email Content

Each customer receives:
- **Subject:** "🎁 Your Referral Code - Earn $10 for Each Friend!"
- **Personalized referral code:** e.g., `CUST_MHA4LEYB5ERA`
- **Personalized referral URL:** `https://referral-system-salon.vercel.app/ref/CUST_MHA4LEYB5ERA`
- **Instructions** on how to use it

---

## ✅ Verification

After deployment, verify:

1. **Dynamic route works:**
   - Visit: `https://referral-system-salon.vercel.app/ref/CUST_MHA4LEYB5ERA`
   - Should show code: `CUST_MHA4LEYB5ERA`

2. **Booking link works:**
   - Click "BOOK YOUR VISIT"
   - Should redirect to: `https://studio-zorina.square.site/?ref=CUST_MHA4LEYB5ERA`

3. **Email tracking:**
   - Check database: `referral_email_sent = TRUE` for customers who received emails
   - Check email service logs for delivery status

---

## 🔄 Resuming After Interruption

If the script stops (power loss, etc.):

1. The script updates `referral_email_sent = TRUE` for each successful send
2. Run again - it will skip customers who already received emails
3. Or modify script to only send to: `WHERE referral_email_sent = FALSE`

---

## 📊 Monitoring Progress

The script shows:
- ✅ Successfully sent count
- ❌ Failed count
- Progress by batch
- Error details

Monitor the output to track progress!
