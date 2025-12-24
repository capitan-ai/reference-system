# 🧪 **TESTING GUIDE FOR REFERRAL SYSTEM**

## 📋 **PRE-TESTING CHECKLIST**

### **1. Environment Setup**
- [ ] Database column `referral_email_sent` added
- [ ] All environment variables configured in Vercel
- [ ] Webhooks configured in Square (test with your Square account first)
- [ ] Email service credentials verified

### **2. Square Configuration**
- [ ] Webhook URL: `https://your-domain.vercel.app/api/webhooks/square/referrals`
- [ ] Webhook events: `customer.created`, `booking.created`, `payment.updated`
- [ ] Webhook signature key configured in environment variables

---

## 🧪 **TESTING METHODOLOGY**

### **Option 1: Manual Testing (Recommended for First Time)**

This involves using the Square sandbox/test environment to simulate real bookings.

#### **Setup Square Test Account:**
1. Go to Square Developer Dashboard
2. Create a test account or use sandbox mode
3. Set up webhook subscriptions pointing to your Vercel URL
4. Configure test events

---

### **Option 2: Script-Based Testing**

We'll create a script that simulates webhook calls without real Square events.

---

## 🎯 **TEST SCENARIOS**

### **Scenario 1: New Customer WITH Referral Code**

**Steps:**
1. Test customer creates account on Square
2. Customer books service with referral code in custom field
3. Customer pays for booking
4. Verify gift cards created correctly

**Expected Results:**
- ✅ Friend gets $10 gift card when booking created
- ✅ Referrer gets $10 loaded when friend pays
- ✅ Friend receives email with their own referral code
- ✅ Database updated correctly

---

### **Scenario 2: New Customer WITHOUT Referral Code**

**Steps:**
1. Test customer creates account
2. Customer books without referral code
3. Customer pays
4. Customer receives referral code after payment

**Expected Results:**
- ✅ No gift card on booking
- ✅ Customer gets referral code after payment
- ✅ Customer becomes a referrer
- ✅ Email sent with their referral code

---

## 🚀 **RECOMMENDED: START WITH 1 REAL TEST**

Before full rollout, test with ONE real customer in production:

### **Phase 1: Send Codes to ONE Existing Customer**
- Pick 1 existing customer (not all 7000!)
- Generate their referral code manually
- Send them their code via email

### **Phase 2: Have That Customer Share**
- They share code with 1 friend
- Friend uses code to book
- Friend pays
- Verify both get gift cards

### **Phase 3: Verify**
- Check Vercel logs
- Check Square for gift cards
- Check database
- Verify emails sent

### **Phase 4: Full Rollout**
- If Phase 1-3 work perfectly
- Run Step 0 script for all customers
- Monitor first 10 bookings closely
- Scale gradually

---

## ⚠️ **IMPORTANT: TEST IN SQUARE SANDBOX FIRST**

**Why?**
- Real Square customers = real money
- Real gift cards = real costs
- Better to test in sandbox with test transactions

**How:**
1. Set up Square sandbox environment
2. Configure test webhook URL (localhost or staging)
3. Create test bookings
4. Verify logic works
5. Then deploy to production

---

## 📊 **TESTING SCRIPT WE'LL CREATE**

I'll create a script that:
1. Creates a test referrer customer
2. Simulates they send code to a friend
3. Simulates friend creates account
4. Simulates friend books
5. Simulates friend pays
6. Verifies gift cards created
7. Verifies database updated

This lets you test WITHOUT real Square events!

---

**Next Step:** Would you like me to create the testing script?
