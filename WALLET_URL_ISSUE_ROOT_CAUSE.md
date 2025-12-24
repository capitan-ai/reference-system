# 🔍 Root Cause Analysis: Wallet URL Issue

## Investigation Results

### ✅ Code is CORRECT
- **Line 480:** `const baseUrl = 'https://www.zorinastudio-referral.com'`
- **Committed:** Latest commit `98a0a7c` includes the hardcoded production URL
- **No APP_BASE_URL usage:** Code doesn't use environment variable for wallet URLs

### ❌ Issue: Vercel Deployment

The code is correct, but **Vercel may not have deployed the latest commit yet**, or is using cached code.

## Solution Steps

### 1. Verify Latest Commit is Deployed
- Check Vercel Dashboard → Deployments
- Verify latest commit `98a0a7c` is deployed
- If not, trigger a new deployment

### 2. Clear Build Cache
- Vercel Dashboard → Settings → General
- Click "Clear Build Cache"
- Redeploy

### 3. Check Vercel Function Logs
When an email is sent, look for this log:
```
🔗 Generating wallet URL: https://www.zorinastudio-referral.com/api/wallet/pass/...
```

If you see a preview URL in the logs, the old code is still running.

### 4. Force Fresh Deployment
```bash
# Add an empty commit to force redeploy
git commit --allow-empty -m "Force redeploy - wallet URL fix"
git push
```

### 5. Test After Deployment
```bash
curl "https://www.zorinastudio-referral.com/api/test-giftcard-email?email=test@example.com&gan=TEST123"
```

Check the response - should show production URL.

## Expected Behavior After Fix

1. **Email HTML** should contain: `https://www.zorinastudio-referral.com/api/wallet/pass/...`
2. **Vercel logs** should show: `🔗 Generating wallet URL: https://www.zorinastudio-referral.com/api/wallet/pass/...`
3. **No preview URLs** in emails

## If Still Not Working

1. Check Vercel deployment logs for errors
2. Verify the deployed code matches commit `98a0a7c`
3. Check if there are multiple deployments (preview vs production)
4. Verify the email is being sent from the correct environment

