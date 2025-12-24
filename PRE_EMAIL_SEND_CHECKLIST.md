# ✅ Pre-Email Send Checklist

## 📊 Current Database Status

### ✅ What We Have:
- **Total customers in database:** 7,134
- **Customers with email addresses:** 6,653 (93.3%)
- **Customers with referral codes:** 6,995 (98.1%)
- **Ready for emails:** 6,538 (have both email + code)
- **Already sent emails:** 65
- **Pending emails:** 6,473

### ⚠️ What Needs Attention:

1. **139 customers missing referral codes**
   - These need codes before they can receive emails
   - Action: Generate codes for them

2. **481 customers missing email addresses**
   - Cannot send emails to these customers
   - No action needed (they'll be skipped automatically)

3. **Square API Connection Issue**
   - Getting 401 error (authentication)
   - **Not blocking** - we have all data in database
   - Can fix later if needed for future syncs

## ✅ Pre-Send Checklist

### Step 1: Generate Missing Referral Codes ⚠️ REQUIRED
```bash
node scripts/generate-referral-links-for-all-customers.js
```
**Why:** 139 customers don't have referral codes yet. This script will:
- Generate unique referral codes for all customers missing them
- Create referral URLs
- Update the database

**Expected result:** All 7,134 customers will have referral codes

### Step 2: Verify Everything is Ready ✅
```bash
node scripts/verify-all-customers-email-readiness.js
```
**Why:** Double-check that:
- Email service is configured
- All customers have codes
- Ready to send

**Expected result:** Should show ~6,677 customers ready (6,538 + 139)

### Step 3: Test Email Sending (Dry Run) ⚠️ RECOMMENDED
```bash
node scripts/send-referral-emails-to-all-customers.js
```
**Why:** See what emails would be sent without actually sending them
- Shows customer names, codes, and URLs
- No emails are actually sent
- Safe to run multiple times

**Expected result:** Preview of all emails that would be sent

### Step 4: Send Real Emails 🚀
```bash
DRY_RUN=false node scripts/send-referral-emails-to-all-customers.js
```
**Why:** Actually send the emails to customers

**Expected result:** 
- ~6,677 emails sent successfully
- Progress updates every 10 customers
- Summary at the end

## 📊 Email Sending Details

### Batch Processing:
- **Batch size:** 10 emails per batch
- **Delay between batches:** 5 seconds
- **Total batches:** ~668 batches
- **Estimated time:** ~55-60 minutes

### What Happens:
1. Script fetches customers from `square_existing_clients` table
2. Filters for customers with:
   - Email address ✅
   - Referral code ✅
3. Sends personalized email with:
   - Customer name
   - Their referral code
   - Their referral URL
4. Marks email as sent in database (`referral_email_sent = TRUE`)
5. Continues until all customers are processed

### Error Handling:
- Failed emails are logged with error details
- Script continues processing other customers
- Summary shows success/failure counts

## 🎯 Quick Start Commands

```bash
# 1. Generate missing codes
node scripts/generate-referral-links-for-all-customers.js

# 2. Verify readiness
node scripts/verify-all-customers-email-readiness.js

# 3. Test (dry run)
node scripts/send-referral-emails-to-all-customers.js

# 4. Send real emails
DRY_RUN=false node scripts/send-referral-emails-to-all-customers.js
```

## 📝 Notes

- **Square API:** Not required for sending emails (we have all data in DB)
- **Email Service:** Already configured (SendGrid)
- **Database:** All customer data is present
- **Scripts:** All ready and tested

## ✅ You're Ready!

Everything is set up. Just run the commands above in order, and you'll send referral codes to all your customers!

---

**Last Check:** Database has 7,134 customers, 6,538 ready for emails (after generating codes for 139, will be ~6,677)

