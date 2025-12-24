# 🔧 Apple Wallet URL - Final Fix Instructions

## Current Status

✅ **Code is correct** - hardcoded to production domain:
```javascript
const baseUrl = 'https://www.zorinastudio-referral.com'
const customWalletUrl = `${baseUrl}/api/wallet/pass/${giftCardGan}`
```

✅ **Local testing shows correct URL**
✅ **Production endpoint test shows correct URL**

## Issue

User is still seeing preview URL in emails, even after deployment.

## Possible Causes & Solutions

### 1. Vercel Build Cache
**Solution:**
1. Go to Vercel Dashboard
2. Project → Settings → General
3. Click "Clear Build Cache"
4. Redeploy the project

### 2. Email Sent Before Deployment
**Solution:**
- Send a NEW email after clearing cache and redeploying
- Don't use old emails - they were generated before the fix

### 3. Check Email HTML Source
**To verify the actual URL in the email:**
1. Open the email in your email client
2. View email source/HTML (varies by client)
3. Search for "wallet/pass" in the HTML
4. Check what URL is actually there

### 4. Force Redeploy
**Solution:**
```bash
# In your local terminal
git commit --allow-empty -m "Force redeploy - fix wallet URL"
git push
```

## Verification Steps

1. **Clear Vercel build cache**
2. **Redeploy project**
3. **Send test email from production:**
   ```
   https://www.zorinastudio-referral.com/api/test-giftcard-email?email=umit0912@icloud.com&gan=TEST123
   ```
4. **Check the NEW email** (not old ones)
5. **Verify URL in email HTML source**

## Expected Result

After clearing cache and redeploying:
- ✅ Email should have: `https://www.zorinastudio-referral.com/api/wallet/pass/...`
- ❌ Should NOT have: `https://referral-system-salon-*.vercel.app/api/wallet/pass/...`

## Next Steps

1. Clear Vercel build cache
2. Redeploy
3. Send fresh test email
4. Check email HTML source to confirm URL

