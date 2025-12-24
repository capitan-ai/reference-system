# 🔧 Apple Wallet URL Fix

## Issue

The email was using a preview deployment URL instead of the production domain:
- ❌ `https://referral-system-salon-fbbq6x1wt-umis-projects-e802f152.vercel.app/api/wallet/pass/...` (404)
- ✅ `https://www.zorinastudio-referral.com/api/wallet/pass/...` (200 - works!)

## Root Cause

The `APP_BASE_URL` environment variable in Vercel might be set to the preview deployment URL instead of the production domain.

## Solution

**Set `APP_BASE_URL` in Vercel to the production domain:**

1. Go to Vercel Dashboard
2. Select your project
3. Go to **Settings → Environment Variables**
4. Find `APP_BASE_URL`
5. Set it to: `https://www.zorinastudio-referral.com`
6. Make sure it's set for **Production** environment (not Preview/Development)
7. Redeploy

## Verification

After fixing, test:
```bash
curl -I "https://www.zorinastudio-referral.com/api/wallet/pass/2A47E49DFEAC4394"
```

Should return:
- `HTTP/2 200`
- `Content-Type: application/vnd.apple.pkpass`
- `Content-Disposition: inline`

## Current Status

✅ Route works on production domain  
✅ Pass generation works  
✅ Headers are correct (auto-opens in Wallet)  
❌ Email using wrong URL (needs `APP_BASE_URL` fix)

## Next Steps

1. Update `APP_BASE_URL` in Vercel to production domain
2. Redeploy
3. Send another test email
4. Verify the button uses the correct URL

