# 🔍 Apple Wallet URL Debug

## Issue
Emails are still showing preview deployment URL instead of production domain.

## Code Status
✅ **Code is correct** - hardcoded to production domain:
```javascript
const baseUrl = 'https://www.zorinastudio-referral.com'
const customWalletUrl = `${baseUrl}/api/wallet/pass/${giftCardGan}`
```

## Possible Causes

1. **Email was sent before deployment**
   - Solution: Send a NEW email after deployment

2. **Vercel build cache**
   - Solution: Clear build cache and redeploy

3. **Email HTML cached in email client**
   - Solution: Check email source HTML directly

4. **Different code path**
   - Check if email is sent from webhook vs API endpoint

## Verification Steps

1. **Test production endpoint:**
   ```bash
   curl "https://www.zorinastudio-referral.com/api/test-giftcard-email?email=test@example.com&gan=TEST123"
   ```
   Should show: `https://www.zorinastudio-referral.com/api/wallet/pass/TEST123`

2. **Check email HTML source:**
   - Open email in email client
   - View source/HTML
   - Search for "wallet/pass"
   - Should see: `https://www.zorinastudio-referral.com/api/wallet/pass/...`

3. **Verify deployment:**
   - Check Vercel deployment logs
   - Ensure latest commit is deployed
   - Check build output includes updated file

## Next Steps

1. Clear Vercel build cache
2. Force redeploy
3. Send test email from production endpoint
4. Check email HTML source to verify URL

