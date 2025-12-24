# Apple Wallet Pass - Deployment Guide

## Issue: 404 Error on Production

If you're getting a 404 error when clicking "Add to Apple Wallet", here's how to fix it:

## Problem

1. **Certificate files not on Vercel**: The `certs/` folder is in `.gitignore`, so certificates don't get deployed
2. **URL double slash**: Fixed in code (removes trailing slash from APP_BASE_URL)
3. **Module import**: Fixed to use `createRequire` for CommonJS compatibility

## Solution: Upload Certificates to Vercel

### Option 1: Base64 Encode Certificates (Recommended)

1. **Encode certificates locally:**
   ```bash
   # Encode .p12 file
   base64 -i certs/Certificates.p12 | pbcopy
   # Paste into Vercel env var: APPLE_PASS_CERTIFICATE_BASE64
   
   # Encode .pem file
   base64 -i certs/wwdr.pem | pbcopy
   # Paste into Vercel env var: APPLE_WWDR_CERTIFICATE_BASE64
   ```

2. **Add to Vercel Environment Variables:**
   - Go to Vercel Dashboard → Your Project → Settings → Environment Variables
   - Add:
     - `APPLE_PASS_CERTIFICATE_BASE64` = (paste base64 encoded .p12)
     - `APPLE_WWDR_CERTIFICATE_BASE64` = (paste base64 encoded .pem)

3. **Update code to decode certificates** (if needed):
   - The pass generator will need to decode these at runtime
   - Or use a build script to write them to `/tmp` on Vercel

### Option 2: Use Vercel File Storage

1. Upload certificates to a secure storage (AWS S3, etc.)
2. Download them at runtime in the API route
3. Store paths in environment variables

### Option 3: Include Certificates in Build (Less Secure)

1. Remove `certs/` from `.gitignore` temporarily
2. Commit certificates (⚠️ **NOT RECOMMENDED** - security risk)
3. Deploy to Vercel
4. Re-add to `.gitignore`

## Quick Fix: Test Locally First

Before deploying, test the endpoint locally:

```bash
# Start dev server
npm run dev

# Test endpoint
curl http://localhost:3000/api/wallet/pass/TEST1234567890 \
  --output test-pass.pkpass

# Open on Mac
open test-pass.pkpass
```

## Environment Variables Needed on Vercel

Make sure these are set in Vercel:

```env
APPLE_PASS_TYPE_ID=pass.com.zorinastudio.giftcard
APPLE_PASS_CERTIFICATE_PATH=./certs/Certificates.p12
APPLE_PASS_CERTIFICATE_PASSWORD=Step7nett.Umit
APPLE_WWDR_CERTIFICATE_PATH=./certs/wwdr.pem
APPLE_PASS_TEAM_ID=MXAWQYBV2L
APP_BASE_URL=https://your-domain.com  # No trailing slash!
```

## After Deployment

1. **Check Vercel logs** for errors:
   - Go to Vercel Dashboard → Your Project → Deployments → Click latest → View Function Logs

2. **Test the endpoint:**
   ```
   https://your-domain.com/api/wallet/pass/TEST1234567890
   ```

3. **Check for errors:**
   - Certificate not found → Upload certificates
   - Module import error → Already fixed
   - 404 → Route not found → Check file structure

## Current Status

✅ Fixed: URL double slash issue
✅ Fixed: CommonJS import compatibility  
⚠️ TODO: Upload certificates to Vercel

## Next Steps

1. Encode certificates as base64
2. Add to Vercel environment variables
3. Update pass-generator.js to decode from base64 if needed
4. Redeploy
5. Test endpoint

