# Referral Code Capture Issue Analysis

## Current Logic Flow (Should Work, But Has Issue)

### What SHOULD Happen:

1. **New Customer Books with Referral Code**
   - `booking.created` webhook fires
   - System checks if customer is new (`got_signup_bonus = FALSE`)
   - System looks for referral code in:
     - Booking extension data (`serviceVariationCapabilityDetails`)
     - Customer custom attributes
   - **If referral code found → Give $10 gift card IMMEDIATELY**
   - Customer can use gift card for their first payment

2. **Customer Completes First Payment**
   - `payment.updated` webhook fires
   - System gives referrer $10 (if friend used referral code)
   - System creates referral code for the customer (now they become a referrer)
   - System sends email with referral code

## The Problem in Your Logs:

```
Customer: null null  ← Customer exists but has no name
🔍 Step 3: Checking for referral code...
   No referral code in booking, checking custom attributes...
   Custom attributes from Square: {
     "square:a3dde506-f69e-48e4-a98a-004c1822d3ad": "They do such clean work..."  ← Only review, no referral code
   }
   Final referral code result: None  ← ❌ REFERRAL CODE NOT FOUND
```

## Root Cause:

**The referral code is NOT being captured when the customer books!**

### Why Referral Code Wasn't Found:

1. **Not in booking extension data** - Square doesn't automatically capture `?ref=CODE` in booking data
2. **Not in custom attributes** - Custom attributes only have a review/testimonial, no referral code

### How Square Should Capture Referral Code:

**Option 1: URL Parameter** (Current approach - but not working)
- Friend clicks: `https://studio-zorina.square.site/?ref=ABY2144`
- Square needs to capture this and store it somewhere
- **Problem:** Square may not automatically capture `?ref=` parameter

**Option 2: Custom Field in Booking Form**
- Add a custom field to Square booking form: "Referral Code (Optional)"
- Friend enters code when booking
- Square stores it in booking data
- **Current code checks:** `serviceVariationCapabilityDetails` but may not be correct field

**Option 3: Custom Attribute Set Before Booking**
- When friend clicks referral link, set custom attribute BEFORE they book
- Use tracking page (`/ref/[refCode]`) to set cookie/attribute
- **Current code checks:** Custom attributes but referral code wasn't set

## The Fix Needed:

### Option A: Add Custom Field to Square Booking Form (Recommended)

1. Go to Square Dashboard → Booking Settings
2. Add custom field: "Referral Code" (optional text field)
3. Friend enters code when booking
4. Update code to read from correct booking field

### Option B: Use Tracking Page to Set Custom Attribute

1. Update referral URLs to use tracking page: `/ref/[refCode]`
2. Tracking page should:
   - Set custom attribute in Square BEFORE redirect
   - Or store in cookie/localStorage
3. Webhook reads from custom attribute or booking data

### Option C: Capture from URL Parameter (If Square Supports It)

1. Check if Square captures `?ref=` parameter
2. If yes, find where Square stores it
3. Update code to read from that location

## Current Code Logic (Lines 727-762):

```javascript
// Checks booking extension data
if (bookingData.serviceVariationCapabilityDetails) {
  // Try to get from booking extension data
  // ...
}

// Checks custom attributes
if (!referralCode) {
  const attributes = await getCustomerCustomAttributes(customerId)
  // Check all custom attribute values for a referral code
  // ...
}
```

**This logic is correct, but the referral code isn't being captured by Square!**

## Immediate Action Needed:

1. **Verify how Square captures referral codes**
   - Check Square booking form settings
   - Check if custom field exists
   - Check if URL parameter is captured

2. **Test referral code capture**
   - Have someone book with a referral code
   - Check what data Square sends in webhook
   - Find where referral code appears (if at all)

3. **Update code to read from correct location**
   - Once we know where Square stores it, update the code

## Summary:

**The logic is correct** - it checks for referral codes and gives gift cards.  
**The problem is** - Square isn't capturing/storing the referral code when the customer books.

We need to:
1. Configure Square to capture referral codes (custom field or URL parameter)
2. Update code to read from the correct location where Square stores it





