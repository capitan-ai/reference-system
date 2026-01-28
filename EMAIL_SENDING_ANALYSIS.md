# Email Sending Logic Analysis

## Issue: Email not sent for Natalia's gift card

### Known Facts:
- ✅ Gift card created: `gftc:469e17f9f6f04d649ca31a668fbb23d0`
- ✅ Balance: $10.00 (verified via Square API)
- ✅ Email exists: `Nataliaebijak@gmail.com`
- ✅ GAN exists: `7783328144194860`
- ✅ Delivery channel: `owner_funded_activate` (activation attempted)
- ❌ No notification events found (email not sent)

## Code Flow Analysis

### 1. Gift Card Creation (line 2833-2839)
```javascript
const friendGiftCard = await createGiftCard(
  customerId,
  `${customer.given_name || ''} ${customer.family_name || ''}`.trim(),
  rewardAmountCents, // $10 = 1000 cents
  false, // Friend gift card
  friendGiftCardOptions
)
```

### 2. createGiftCard Return Value (line 1134-1145)
```javascript
return {
  giftCardId,
  giftCardGan,
  activationChannel,
  orderId: successfulOrderInfo?.orderId || null,
  lineItemUid: successfulOrderInfo?.lineItemUid || null,
  activationUrl,
  passKitUrl,
  digitalEmail,
  balanceCents: activityBalanceNumber,  // From activation activity or verification
  amountCents: amountMoney.amount       // From amountMoney (line 890-892)
}
```

**Key point**: `amountMoney.amount` is set at line 890-892:
```javascript
const amountMoney = {
  amount: Number.isFinite(amountCents) ? Math.trunc(amountCents) : 0,
  currency: 'USD'
}
```

### 3. Email Notification Call (line 2880-2895)
```javascript
await sendGiftCardEmailNotification({
  customerName: friendNameBase || friendEmail || 'there',
  email: friendEmail,
  giftCardGan: friendGiftCard.giftCardGan,
  amountCents: friendGiftCard.amountCents,  // ⚠️ POTENTIAL ISSUE HERE
  balanceCents: friendGiftCard.balanceCents,
  activationUrl: friendGiftCard.activationUrl,
  passKitUrl: friendGiftCard.passKitUrl,
  giftCardId: friendGiftCard.giftCardId,
  waitForPassKit: true,
  locationId: bookingLocationId,
  notificationMetadata: {
    customerId,
    referralCode
  }
})
```

### 4. Email Validation (line 386-390)
```javascript
const meaningfulAmount = Number.isFinite(amountCents) ? amountCents : 0
if (!isReminder && meaningfulAmount <= 0) {
  console.log('ℹ️ Gift card amount is zero, skipping issuance email')
  return { success: false, skipped: true, reason: 'zero-amount' }
}
```

## Potential Issues

### Issue 1: amountCents might be undefined/null
**Scenario**: If `friendGiftCard.amountCents` is `undefined`:
- `Number.isFinite(undefined)` = `false`
- `meaningfulAmount` = `0`
- Email gets skipped with "Gift card amount is zero"

**Why this could happen**:
- If `createGiftCard` returns an object without `amountCents` property
- If there's an error in `createGiftCard` that causes it to return early without setting `amountCents`
- If `amountMoney.amount` becomes 0 somehow (though unlikely given balance is $10)

### Issue 2: BigInt conversion issue
**Scenario**: If `amountMoney.amount` is somehow a BigInt:
- `Math.trunc(BigInt)` would work, but the value might not serialize correctly
- When passed to `sendGiftCardEmailNotification`, it might not be recognized as a finite number

### Issue 3: waitForPassKitUrl timeout
**Scenario**: If PassKit URL wait times out (5 minutes max):
- The function waits for PassKit URL if `waitForPassKit: true` and `!passKitUrl`
- After timeout, it continues (line 316-317)
- But there might be an error thrown that's not caught

### Issue 4: Email sending error after validation
**Scenario**: If validation passes but email sending fails:
- Should create a notification event, but we see none
- Could be a silent failure in `sendGiftCardIssuedEmail`

## Recommended Fixes

### Fix 1: Add defensive logging before email call
```javascript
console.log(`📧 Preparing to send gift card email:`)
console.log(`   - amountCents: ${friendGiftCard.amountCents} (type: ${typeof friendGiftCard.amountCents})`)
console.log(`   - balanceCents: ${friendGiftCard.balanceCents} (type: ${typeof friendGiftCard.balanceCents})`)
console.log(`   - giftCardGan: ${friendGiftCard.giftCardGan}`)
console.log(`   - giftCardId: ${friendGiftCard.giftCardId}`)

if (friendEmail) {
  const emailResult = await sendGiftCardEmailNotification({
    // ... parameters
  })
  console.log(`📧 Email result:`, emailResult)
}
```

### Fix 2: Ensure amountCents is always a number
In `createGiftCard`, ensure return value:
```javascript
return {
  // ... other fields
  amountCents: Number(amountMoney.amount || 0),  // Explicit conversion
  balanceCents: Number(activityBalanceNumber || 0)  // Explicit conversion
}
```

### Fix 3: Add fallback in email function
```javascript
// If amountCents is missing but balanceCents exists, use balanceCents
const meaningfulAmount = Number.isFinite(amountCents) 
  ? amountCents 
  : (Number.isFinite(balanceCents) ? balanceCents : 0)

if (!isReminder && meaningfulAmount <= 0) {
  console.log('ℹ️ Gift card amount is zero, skipping issuance email')
  console.log(`   Debug: amountCents=${amountCents}, balanceCents=${balanceCents}`)
  return { success: false, skipped: true, reason: 'zero-amount' }
}
```

### Fix 4: Add error handling around email sending
```javascript
try {
  const emailResult = await sendGiftCardEmailNotification({
    // ... parameters
  })
  
  if (emailResult.success === false && emailResult.skipped) {
    console.log(`⚠️ Email skipped: ${emailResult.reason}`)
  } else if (emailResult.success === false) {
    console.error(`❌ Email sending failed:`, emailResult.error)
  } else {
    console.log(`✅ Email sent successfully`)
  }
} catch (emailError) {
  console.error(`❌ Error in sendGiftCardEmailNotification:`, emailError.message)
  console.error(emailError.stack)
}
```

## Next Steps

1. Add the logging above to identify which condition is causing the skip
2. Check Vercel logs around `2026-01-15T22:00:32.872Z` for:
   - The `amountCents` value when email function is called
   - Any "Gift card amount is zero" messages
   - Any `waitForPassKitUrl` timeout messages
   - Any errors in `sendGiftCardIssuedEmail`
3. Verify that `createGiftCard` always returns `amountCents` as a number



