# 🔧 Final Wallet URL Fix - Step by Step Verification

## Step 1: Code Verification ✅

**Local code is CORRECT:**
- Line 480: `const baseUrl = 'https://www.zorinastudio-referral.com'`
- Hardcoded to production domain (not using APP_BASE_URL)
- No preview URLs in the code

## Step 2: The Real Issue

The code is correct, but **Vercel may be serving cached code** or the changes haven't been deployed yet.

## Step 3: Solution

### Option A: Force Redeploy (Recommended)

1. **Commit and push the current code:**
   ```bash
   git add lib/email-service-simple.js
   git commit -m "Fix: Hardcode production domain for wallet URLs"
   git push
   ```

2. **Clear Vercel build cache:**
   - Go to Vercel Dashboard
   - Project → Settings → General
   - Click "Clear Build Cache"
   - Or trigger a new deployment

3. **Verify deployment:**
   - Check Vercel deployment logs
   - Look for the log message: `🔗 Generating wallet URL: https://www.zorinastudio-referral.com/api/wallet/pass/...`

### Option B: Check Vercel Function Logs

1. Go to Vercel Dashboard
2. Project → Functions
3. Find a recent email send (check webhook logs)
4. Look for: `🔗 Generating wallet URL:`
5. Verify it shows the production domain

## Step 4: Verification

After redeploy, test:
```bash
curl "https://www.zorinastudio-referral.com/api/test-giftcard-email?email=test@example.com&gan=TEST123"
```

Check the response - it should show:
```json
{
  "details": {
    "appleWalletUrl": "https://www.zorinastudio-referral.com/api/wallet/pass/TEST123"
  }
}
```

## Step 5: Check Email HTML

1. Send a test email
2. View email source/HTML
3. Search for "wallet/pass"
4. Should see: `https://www.zorinastudio-referral.com/api/wallet/pass/...`
5. Should NOT see: `https://referral-system-salon-*.vercel.app/api/wallet/pass/...`

## Root Cause

The code is correct, but Vercel is likely:
- Using cached build
- Not picking up the latest changes
- Need to force a fresh deployment

## Next Steps

1. ✅ Code is correct (verified)
2. ⏳ Commit and push changes
3. ⏳ Clear Vercel build cache
4. ⏳ Force redeploy
5. ⏳ Test with fresh email
6. ⏳ Verify email HTML source

