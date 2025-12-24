# Referral Code Capture - The Real Problem & Solution

## ✅ Your Logic is CORRECT

You're absolutely right about the flow:

1. **New customer books with referral code** → Should get $10 gift card IMMEDIATELY
2. **Customer completes first payment** → Referrer gets $10, customer becomes referrer

The code logic (lines 766-799) is correct and WOULD work if the referral code was captured.

## ❌ The Problem: Square Doesn't Capture Referral Code

### Current Flow (Broken):
1. Friend clicks: `/ref/ABY2144` → Code stored in cookie/localStorage
2. Friend clicks "BOOK YOUR VISIT" → Redirects to `https://studio-zorina.square.site/?ref=ABY2144`
3. **Problem:** Square doesn't automatically capture `?ref=` parameter
4. Friend books → Square has NO referral code
5. Webhook fires → System checks for referral code → **NOT FOUND**

### Why It's Not Working:

**The tracking page stores code in cookies, but:**
- Square site is a different domain → Can't access our cookies
- Square doesn't automatically capture URL parameters
- Square doesn't have a custom field for referral codes (yet)

## 🔧 Solutions

### **Solution 1: Add Custom Field to Square Booking Form** (RECOMMENDED)

1. Go to Square Dashboard → Appointments → Booking Settings
2. Add a custom field: "Referral Code (Optional)" - Text field
3. Friend enters code when booking
4. Square stores it in booking data
5. Update code to read from correct booking field

**Update Code:**
```javascript
// Check booking custom fields
if (bookingData.customFields) {
  for (const field of bookingData.customFields) {
    if (field.key === 'referral_code' || field.name?.toLowerCase().includes('referral')) {
      referralCode = field.value
      break
    }
  }
}
```

### **Solution 2: Set Custom Attribute via API** (BEFORE Booking)

When friend clicks referral link, set custom attribute in Square BEFORE redirect:

**Update tracking page:**
```javascript
// In /ref/[refCode]/page.js
const handleBookVisit = async () => {
  // First, set custom attribute in Square
  try {
    await fetch('/api/set-referral-attribute', {
      method: 'POST',
      body: JSON.stringify({ 
        refCode: refCode,
        // Need customer ID - but we don't have it yet!
      })
    })
  } catch (error) {
    console.error('Failed to set referral attribute')
  }
  
  // Then redirect
  window.open(`https://studio-zorina.square.site/?ref=${refCode}`, '_blank')
}
```

**Problem:** We don't have customer ID until they create account in Square.

### **Solution 3: Use URL Parameter + Set Attribute After Customer Created**

1. Friend clicks: `/ref/ABY2144` → Redirects to Square with `?ref=ABY2144`
2. When `customer.created` webhook fires:
   - Check if they came from referral link (via tracking API)
   - Set custom attribute: `referral_code = ABY2144`
3. When `booking.created` fires:
   - Read from custom attribute (already set)

**This requires:**
- Tracking API to match customer to referral code
- Setting custom attribute in `customer.created` webhook

### **Solution 4: Use Square's Custom Attributes API** (Best Long-term)

When customer is created, check if they visited referral link, then set attribute:

```javascript
// In processCustomerCreated()
async function processCustomerCreated(customerData, request) {
  // ... existing code ...
  
  // Check if customer came from referral link
  const refClick = await findReferralClickByCustomer(customerData.emailAddress)
  
  if (refClick && refClick.refCode) {
    // Set custom attribute immediately
    await customersApi.upsertCustomerCustomAttribute(customerData.id, {
      customAttribute: {
        key: 'referral_code',
        value: refClick.refCode
      }
    })
    
    // Store in database
    await prisma.$executeRaw`
      UPDATE square_existing_clients 
      SET used_referral_code = ${refClick.refCode}
      WHERE square_customer_id = ${customerData.id}
    `
  }
}
```

## 🎯 Recommended Approach: Hybrid Solution

### **Step 1: Add Custom Field to Square Booking Form** (IMMEDIATE)
- Quick fix
- Friend enters code manually when booking
- Works right away

### **Step 2: Implement Automatic Capture** (LONG-TERM)
- Track referral clicks in database
- Match customer email/phone to referral click
- Set custom attribute automatically when customer created
- Fallback: Friend can still enter code manually if tracking fails

## 🔍 Current Code Status

Your code logic is **100% correct**:
- ✅ Checks if customer is new (`got_signup_bonus = FALSE`)
- ✅ Looks for referral code in booking data
- ✅ Looks for referral code in custom attributes
- ✅ Gives $10 gift card immediately if found
- ✅ Updates referrer reward on payment

**The only issue:** Square isn't capturing/storing the referral code, so your code can't find it.

## 📝 Action Items

1. **Immediate:** Add custom field to Square booking form
2. **Update code:** Read from Square booking custom fields
3. **Long-term:** Implement automatic referral code capture via tracking API





