# 🚀 **PRODUCTION TESTING PLAN - STEP BY STEP**

## ⚠️ **IMPORTANT: Read This First**

**DO NOT run Step 0 (send to all 7000 customers) until you've tested with 1-5 real customers!**

---

## 📋 **PHASE 1: PRE-FLIGHT CHECKLIST**

### **1. Database Setup**
```bash
node scripts/add-referral-email-sent-column.js
```

### **2. Verify Environment Variables**
Make sure these are set in Vercel:
- `DATABASE_URL`
- `SQUARE_ACCESS_TOKEN` (production)
- `SQUARE_LOCATION_ID`
- `SQUARE_WEBHOOK_SIGNATURE_KEY`
- `BUSINESS_EMAIL`
- `GMAIL_APP_PASSWORD`

### **3. Configure Square Webhooks**
- Go to Square Developer Dashboard
- Add webhook subscription
- URL: `https://your-domain.vercel.app/api/webhooks/square/referrals`
- Events: `customer.created`, `booking.created`, `payment.updated`

---

## 🧪 **PHASE 2: TEST WITH SCRIPT (No Real Square)**

### **Run Simulation:**
```bash
node scripts/test-complete-referral-flow-simulation.js
```

This tests the logic WITHOUT real Square events.

**Expected Output:**
- ✅ Test referrer created
- ✅ Friend 1 gets gift card with referral code
- ✅ Friend 2 gets referral code without referral code
- ✅ Database updated correctly

---

## 🎯 **PHASE 3: TEST WITH 1 REAL CUSTOMER**

### **Step 1: Create Manual Test**
1. Pick ONE existing customer from your database
2. Give them a referral code manually
3. Send them their code via personal email (not automated)

### **Step 2: Have Customer Share**
1. Friend creates account on Square
2. Friend enters referral code in booking form
3. Friend books and pays

### **Step 3: Monitor**
```bash
# Check Vercel logs
vercel logs --follow

# Check database
# Query square_existing_clients for the test customers
```

### **Step 4: Verify**
- [ ] Friend received $10 gift card
- [ ] Referrer received $10 loaded
- [ ] Friend received email with their code
- [ ] Database updated correctly
- [ ] No errors in logs

---

## 🎯 **PHASE 4: TEST WITH 5 REAL CUSTOMERS**

If Phase 3 works perfectly:

1. Select 5 more existing customers
2. Generate referral codes for them
3. Send codes manually
4. Track their friends' bookings
5. Monitor for issues

**If all 5 work perfectly → Ready for full rollout!**

---

## 🚀 **PHASE 5: FULL ROLLOUT**

### **OPTION A: Gradual (Recommended)**

**Week 1:** Send to 100 customers
**Week 2:** If stable, send to 500 customers
**Week 3:** If stable, send to remaining ~6400 customers

### **OPTION B: All at Once**

```bash
# ⚠️ WARNING: This sends ~7000 emails!
node scripts/step-0-distribute-referral-codes.js
```

---

## 🔍 **MONITORING DURING FIRST WEEK**

### **Daily Checks:**
1. Monitor Vercel logs for errors
2. Check database for new customers
3. Verify gift cards created correctly
4. Check for duplicate emails
5. Track referral usage

### **Metrics to Track:**
- Number of referral codes shared
- Number of bookings with referral codes
- Number of gift cards created
- Number of referrer rewards given
- Any errors or issues

---

## 🚨 **WHAT TO DO IF ISSUES ARISE**

### **Issue: No Gift Cards Created**
1. Check Vercel logs for errors
2. Verify webhook signature
3. Check booking.created webhook firing
4. Verify referral code lookup working

### **Issue: Duplicate Emails**
1. Check `referral_email_sent` flag
2. Add manual check in database
3. Update script if needed

### **Issue: Wrong Gift Card Amount**
1. Check Square API calls
2. Verify gift card creation logic
3. Check for multiple bookings

---

## ✅ **GO-LIVE CHECKLIST**

Before full rollout, verify:

- [ ] Database column added
- [ ] Script simulation works
- [ ] 1 real customer test passed
- [ ] 5 real customer tests passed
- [ ] No errors in logs
- [ ] Email delivery working
- [ ] Gift cards created correctly
- [ ] Webhooks configured
- [ ] Monitoring in place

---

## 📞 **SUPPORT**

If issues occur:
1. Check Vercel logs first
2. Check Square webhook delivery
3. Verify database state
4. Contact if needed

---

**Remember: Start small, test thoroughly, scale gradually!** 🎯
