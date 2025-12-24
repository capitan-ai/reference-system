# 🚀 GO-LIVE CHECKLIST - Final Steps to Launch

## 🔴 CRITICAL BLOCKERS (Must Fix Before Launch)

### 1. ✅ Webhook Signature Verification - **FIXED**
**Status:** ✅ Implemented proper HMAC SHA-256 signature verification
**Fix Applied:**
- Added signature verification to `/api/webhooks/square/referrals/route.js`
- Added signature verification to `/api/webhooks/square/route.js`
- Both endpoints now verify signatures using `SQUARE_WEBHOOK_SIGNATURE_KEY`

**⚠️ ACTION REQUIRED:**
- Set environment variable in Vercel: `SQUARE_WEBHOOK_SIGNATURE_KEY=XxCh23h7L2zBxEz-M8iFYQ`
- Go to Vercel Dashboard → Settings → Environment Variables → Add

---

### 2. ✅ Database Schema - **NOT A PROBLEM**
**Status:** ✅ System is correctly using `square_existing_clients` table with Prisma as database client

**Current Setup (Working Correctly):**
- ✅ Prisma is used as database connection client (via `prisma.$queryRaw` and `prisma.$executeRaw`)
- ✅ All code uses raw SQL queries against `square_existing_clients` table
- ✅ Table exists and is being used throughout the codebase
- ✅ Prisma schema.prisma defines `customers` table, but this is **unused** (just leftover schema)

**What This Means:**
- **You DO need Prisma** - but only as a database client (for connection pooling, etc.)
- **You DON'T need Prisma models** - raw SQL is working perfectly fine
- The Prisma schema.prisma file is unused and can be ignored or removed

**Action Required:** 
- ✅ **None needed** - your current setup is correct
- Optional: Run `node scripts/fix-database-schema.js` to ensure all columns exist
- Optional: Remove or update Prisma schema.prisma to match actual table (for documentation only)

---

### 3. ✅ Missing Database Column - **COMPLETED**
**Status:** ✅ Column has been added successfully
**Issue:** `referral_email_sent` column may not exist in `square_existing_clients` table
**Impact:** 
- ❌ **Without this column:** Email sending will fail with SQL errors
- ❌ **Without this column:** Duplicate emails will be sent (no duplicate prevention)

**Why This Column is Critical:**
- Used in `sendReferralCodeToNewClient()` function to prevent duplicate emails
- Checks: `if (customerData[0].referral_email_sent) { return }` 
- Sets: `referral_email_sent = TRUE` after sending email
- Without it, the system will try to send emails multiple times

**✅ COMPLETED:**
- Script executed successfully
- Column `referral_email_sent` added to `square_existing_clients` table
- Type: `BOOLEAN DEFAULT FALSE`
- Column is now ready to prevent duplicate emails

---

## ⚠️ IMPORTANT PRE-LAUNCH ITEMS

### 4. Square Webhook Configuration
**Status:** Needs to be configured in Square Dashboard
**Required:**
- Webhook URL: `https://referral-system-salon.vercel.app/api/webhooks/square/referrals`
- Events to subscribe:
  - ✅ `customer.created`
  - ✅ `booking.created`
  - ✅ `payment.created`
  - ✅ `payment.updated`

**Action:** Go to Square Developer Dashboard → Webhooks → Add subscription

---

### 5. Environment Variables Verification
**Status:** Must verify all are set in Vercel production

**Required Variables:**
- ✅ `DATABASE_URL` - PostgreSQL connection string
- ✅ `SQUARE_ACCESS_TOKEN` - Production Square API token
- ✅ `SQUARE_LOCATION_ID` - Square location ID
- ✅ `SQUARE_WEBHOOK_SIGNATURE_KEY` - Webhook signature key (**Value: `XxCh23h7L2zBxEz-M8iFYQ`**)
- ✅ `BUSINESS_EMAIL` - Gmail address for sending emails
- ✅ `GMAIL_APP_PASSWORD` - Gmail app password

**Action:** 
1. Go to Vercel Dashboard → Settings → Environment Variables
2. **ADD/UPDATE:** `SQUARE_WEBHOOK_SIGNATURE_KEY` = `XxCh23h7L2zBxEz-M8iFYQ`
3. Verify all other variables are set
4. Redeploy after adding new variable

---

### 6. Production Deployment
**Status:** Check if latest code is deployed
**Action:** 
- Verify deployment in Vercel dashboard
- Check if route `/api/webhooks/square/referrals` is accessible
- Test endpoint: `GET https://referral-system-salon.vercel.app/api/webhooks/square/referrals`

---

## ✅ FUNCTIONALITY TO VERIFY

### 7. Email Service
**Status:** Code exists, needs testing
**Verify:**
- Email templates load correctly
- Gmail SMTP credentials work
- Emails send successfully
- Email content is correct (no hardcoded examples)

**Location:** `lib/email-service-simple.js`

---

### 8. Gift Card Creation
**Status:** Code exists, needs testing
**Verify:**
- Gift cards create successfully via Square API
- Amounts are correct ($10 = 1000 cents)
- Gift cards link to correct customers
- Referrer rewards load correctly

---

### 9. Referral Code Capture
**Status:** Logic exists but needs verification
**Issue:** Unclear if Square automatically captures `?ref=CODE` parameter
**Current Logic:** Checks custom attributes and booking extension data

**Action Required:**
- Test booking with referral code
- Verify code is captured from Square
- May need to add Square custom field for referral code input

---

### 10. Referral URL Strategy
**Status:** Currently uses direct Square URLs
**Issue:** No click tracking, no analytics

**Current:** `https://studio-zorina.square.site/?ref=ABY2144`
**Alternative:** Use tracking page `https://referral-system-salon.vercel.app/ref/ABY2144`

**Recommendation:** Switch to tracking page for better analytics

---

## 🧪 TESTING REQUIREMENTS

### 11. End-to-End Testing
**Status:** Must test before go-live

**Test Scenarios:**
1. ✅ New customer books WITHOUT referral code
   - Should receive referral code after first payment
   - Should receive email with code

2. ✅ New customer books WITH referral code
   - Friend should get $10 gift card immediately
   - Referrer should get $10 when friend pays
   - Both should work automatically

3. ✅ Existing customer behavior
   - Should not receive duplicate codes
   - Should not receive duplicate emails

---

## 📋 PRE-LAUNCH VERIFICATION

### 12. Code Review Checklist
- [ ] Webhook signature verification implemented
- [ ] Database schema aligned
- [ ] All environment variables set
- [ ] Square webhooks configured
- [ ] Email service tested
- [ ] Gift card creation tested
- [ ] Referral code capture verified
- [ ] Error handling and logging in place
- [ ] No test mode code in production
- [ ] No hardcoded test values

---

## 🚀 GO-LIVE STEPS

### Phase 1: Pre-Launch (Do First)
1. Fix webhook signature verification
2. Run database migration script
3. Verify environment variables
4. Configure Square webhooks
5. Test with 1-2 real customers

### Phase 2: Soft Launch (Test with Small Group)
1. Deploy to production
2. Test with 5-10 existing customers
3. Monitor for errors
4. Verify all flows work correctly

### Phase 3: Full Launch
1. Send referral codes to all existing customers
2. Monitor system for first week
3. Track metrics and issues

---

## 📊 MONITORING POST-LAUNCH

### Daily Checks (First Week)
- [ ] Monitor Vercel logs for errors
- [ ] Check database for new customers
- [ ] Verify gift cards created correctly
- [ ] Check for duplicate emails
- [ ] Track referral usage
- [ ] Monitor Square API errors

### Metrics to Track
- Number of referral codes sent
- Number of bookings with referral codes
- Number of gift cards created
- Number of referrer rewards given
- Email delivery success rate
- Webhook processing errors

---

## 🆘 ROLLBACK PLAN

If issues occur:
1. Disable Square webhooks temporarily
2. Check Vercel logs for errors
3. Verify database state
4. Test webhook endpoint manually
5. Fix issues and redeploy

---

## 📝 SUMMARY

**CRITICAL (Must Fix):**
1. Webhook signature verification
2. Database schema alignment
3. Database column migration

**IMPORTANT (Should Fix):**
4. Square webhook configuration
5. Environment variables
6. Production deployment verification

**RECOMMENDED (Nice to Have):**
7. Switch to tracking page URLs
8. Add better error logging
9. Add monitoring dashboard

---

**ESTIMATED TIME TO COMPLETE:** 2-4 hours for critical fixes, 1-2 days for full testing

**READY FOR GO-LIVE:** After completing Critical and Important items + successful end-to-end testing

