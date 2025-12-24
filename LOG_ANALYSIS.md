# Log Analysis - Booking Processing Issues

## Issues Found

### 1. ❌ Customer Name is "null null"

**Problem:**
```
Customer: null null
```

**Root Cause:**
- Customer exists in database but `given_name` and `family_name` are NULL
- The code tries to fetch from Square API (lines 1917-1936) but:
  - Either Square API doesn't have the customer's name
  - Or the customer was created in Square without a name
  - Or the update query didn't work

**Current Behavior:**
- Code checks if names are missing (line 1917)
- Fetches from Square API (line 1918)
- Updates database (lines 1925-1934)
- BUT: The log at line 1915 shows names BEFORE the update happens

**Impact:**
- Email notifications might show "null null" as customer name
- Gift card emails might look unprofessional
- Hard to identify customers in logs

**Fix Needed:**
1. Add better logging after the update to confirm names were fetched
2. Add fallback: if Square doesn't have name, use email or "Customer" as fallback
3. Re-fetch customer data after update to verify

---

### 2. ⚠️ Missing BUSINESS_EMAIL Environment Variable

**Problem:**
```
⚠️ Environment variable validation failed:
- Missing required environment variable: BUSINESS_EMAIL (Business email address for sending emails)
```

**Root Cause:**
- `BUSINESS_EMAIL` is not set in production environment
- This is required for sending emails via Gmail SMTP

**Impact:**
- **CRITICAL**: Email sending will fail
- Gift card emails won't be sent
- Referral code emails won't be sent
- Customers won't receive notifications

**Fix Needed:**
1. **URGENT**: Add `BUSINESS_EMAIL` to Vercel environment variables
2. Set it to your business Gmail address (e.g., `yourbusiness@gmail.com`)
3. Also ensure `GMAIL_APP_PASSWORD` is set

**How to Fix:**
1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add:
   - `BUSINESS_EMAIL` = your Gmail address
   - `GMAIL_APP_PASSWORD` = your Gmail app password (if not already set)
3. Redeploy the application

---

### 3. ✅ Referral Code Detection Working Correctly

**What Happened:**
```
Custom attribute: key="square:c11dd5ac-8382-4570-9c7b-2bdcb1c781f1", value="af5791f8-348a-422e-98d1-5e865121bb19"
Final referral code result: None
ℹ️ Customer booked without referral code
```

**Analysis:**
- System correctly detected a custom attribute
- But the value is a UUID, not a referral code format
- System correctly identified it's not a valid referral code
- This is **working as expected**

**No Action Needed** - The system is correctly handling invalid referral codes.

---

### 4. ⚠️ GiftCardRun/GiftCardJob Warnings (Already Discussed)

**Problem:**
```
⚠️ GiftCardRun model not available - skipping tracking
⚠️ GiftCardJob model not available - skipping job queue
```

**Status:** Code is fixed, but Prisma client needs regeneration in production.

**Fix:** Redeploy to trigger Prisma client regeneration.

---

## Priority Actions

### 🔴 CRITICAL (Do Immediately):
1. **Add BUSINESS_EMAIL to Vercel environment variables**
   - Without this, NO emails will be sent
   - Customers won't receive gift cards or referral codes

### 🟡 HIGH (Do Soon):
2. **Fix customer name handling**
   - Add better logging after name update
   - Add fallback for missing names
   - Re-fetch customer after update

### 🟢 MEDIUM (Can Wait):
3. **Redeploy to fix GiftCardRun/GiftCardJob warnings**
   - System works without them, but tracking/queue would be better

---

## Code Improvements Needed

### 1. Better Name Handling

**Current Code (lines 1917-1936):**
- Updates names if missing
- But doesn't verify the update worked
- Doesn't re-fetch to confirm

**Suggested Fix:**
```javascript
if ((!customer.given_name || !customer.family_name || !customer.email_address || !customer.phone_number)) {
  const squareCustomer = await fetchSquareCustomerProfile(customerId)
  if (squareCustomer) {
    const squareGivenName = cleanValue(squareCustomer.givenName)
    const squareFamilyName = cleanValue(squareCustomer.familyName)
    const squareEmail = cleanValue(squareCustomer.emailAddress)
    const squarePhone = cleanValue(squareCustomer.phoneNumber)

    await prisma.$executeRaw`
      UPDATE square_existing_clients
      SET
        given_name = COALESCE(square_existing_clients.given_name, ${squareGivenName}),
        family_name = COALESCE(square_existing_clients.family_name, ${squareFamilyName}),
        email_address = COALESCE(square_existing_clients.email_address, ${squareEmail}),
        phone_number = COALESCE(square_existing_clients.phone_number, ${squarePhone}),
        updated_at = NOW()
      WHERE square_customer_id = ${customerId}
    `
    
    // ADD: Re-fetch to verify update
    const updatedCustomer = await prisma.$queryRaw`
      SELECT given_name, family_name, email_address, phone_number
      FROM square_existing_clients
      WHERE square_customer_id = ${customerId}
    `
    
    if (updatedCustomer && updatedCustomer[0]) {
      customer.given_name = updatedCustomer[0].given_name || customer.given_name
      customer.family_name = updatedCustomer[0].family_name || customer.family_name
      customer.email_address = updatedCustomer[0].email_address || customer.email_address
      customer.phone_number = updatedCustomer[0].phone_number || customer.phone_number
      
      // ADD: Fallback for missing names
      const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 
                          customer.email_address?.split('@')[0] || 
                          'Customer'
      
      console.log(`✅ Customer name updated: ${customerName}`)
    }
  } else {
    console.warn(`⚠️ Could not fetch customer profile from Square for ${customerId}`)
  }
}
```

### 2. Environment Variable Validation

**Current Status:**
- ✅ Validation exists and works (shows warning)
- ❌ But it's non-blocking (doesn't stop processing)
- ❌ Missing variables cause email failures

**Suggested Fix:**
- Make email-related env vars block email sending (not webhook processing)
- Add clear error messages when emails fail due to missing env vars

---

## Summary

**Critical Issue:**
- ❌ `BUSINESS_EMAIL` missing → **NO emails will be sent**

**Important Issues:**
- ⚠️ Customer names are null → Emails look unprofessional
- ⚠️ GiftCardRun/GiftCardJob warnings → No tracking/queue

**Working Correctly:**
- ✅ Referral code detection (correctly rejects invalid codes)
- ✅ Booking processing logic
- ✅ Environment variable validation (detects missing vars)

