# Referral Logic Clarification - Correct Understanding

## ✅ Correct Flow Understanding

### 1. **Referrer Gets Code (After First Payment)**
- Customer completes first payment
- System creates `personal_code` (e.g., `BOZHENA8884`)
- System stores `personal_code` in database
- System sends email with referral code
- **Referrer now has code in database** ✅

### 2. **Friend Uses Referral Code**
- Friend clicks referral link or enters code
- Code gets stored in friend's Square custom attributes
- Friend books appointment
- **`booking.created` webhook fires**

### 3. **System Processes Booking** (Current Step)
- System checks friend's custom attributes
- Finds referral code (e.g., `BOZHENA8884`) in custom attributes
- **Looks up referrer in database by `personal_code = 'BOZHENA8884'`**
- **Referrer MUST exist** because they already have `personal_code` (completed first payment)
- Gives friend $10 gift card immediately

### 4. **Friend Pays**
- `payment.updated` webhook fires
- System gives referrer $10 reward
- System creates referral code for friend (friend becomes referrer)

## 🔑 Key Points

1. **If referral code appears in custom attributes** → It means friend used someone's code
2. **If `personal_code` exists in database** → It means referrer already completed first payment
3. **Referrer code MUST exist in database** if it's in custom attributes (because referrer got it after first payment)
4. **The lookup should always find the referrer** - if it doesn't, there's a bug

## 🐛 The Bug

The code was **skipping Square-generated keys** (starting with `square:`), but your referral code `BOZHENA8884` is stored under a Square-generated key:
- Key: `square:a3dde506-f69e-48e4-a98a-004c1822d3ad`
- Value: `BOZHENA8884`

**Fix Applied:**
- Now checks ALL custom attribute values, including Square-generated keys
- Only skips values that look like text/reviews (length > 20 or multiple words)
- Improved case-insensitive matching
- Better logging to show exactly what's being checked

## ✅ What Should Happen Now

When `booking.created` fires:
1. System checks custom attributes
2. Finds `BOZHENA8884` under Square-generated key
3. Looks up in database: `WHERE personal_code = 'BOZHENA8884'`
4. **Should find referrer** (because they have `personal_code` after first payment)
5. Gives friend $10 gift card immediately

## 🧪 Testing

Next booking with referral code should show:
```
🔍 Checking custom attribute value: "BOZHENA8884" (key: square:...)
🔍 Looking up referral code in database: "BOZHENA8884"
✅ Found referrer with code "BOZHENA8884": Bozhene LastName
✅ Found referral code in custom attribute
🎁 Customer used referral code: BOZHENA8884
✅ Friend received $10 gift card IMMEDIATELY
```





