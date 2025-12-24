# 🔧 Apple Wallet - Missing Certificate Fix

## ✅ Problem Found!

The test endpoint shows:
- ❌ `APPLE_PASS_CERTIFICATE_PEM_BASE64`: **MISSING**
- ✅ `APPLE_PASS_KEY_PEM_BASE64`: Found (2272 chars)
- ✅ `APPLE_WWDR_CERTIFICATE_BASE64`: Found (2084 chars)
- ✅ `APPLE_PASS_CERTIFICATE_BASE64`: Found (legacy .p12 format)

## 🎯 Solution: Add Missing Variable

You need to add `APPLE_PASS_CERTIFICATE_PEM_BASE64` to Vercel.

### Option 1: Extract from .p12 (If you have it)

```bash
# Extract certificate from .p12
openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out pass-cert.pem -passin pass:Step7nett.Umit

# Encode to base64 (remove newlines!)
base64 -i pass-cert.pem | tr -d '\n' | pbcopy
```

Then paste into Vercel as `APPLE_PASS_CERTIFICATE_PEM_BASE64`

### Option 2: Use Legacy Format (Temporary Fix)

The code should fall back to `.p12` format, but there might be an issue. Let me check the fallback logic.

## 🔍 Quick Test

Visit this URL to see current status:
```
https://www.zorinastudio-referral.com/api/test-apple-env
```

This shows exactly which variables are missing!

## 📋 Action Items

1. **Add `APPLE_PASS_CERTIFICATE_PEM_BASE64` to Vercel:**
   - Go to Vercel Dashboard → Settings → Environment Variables
   - Add: `APPLE_PASS_CERTIFICATE_PEM_BASE64`
   - Value: (base64 encoded certificate PEM, no newlines)
   - Environment: **Production**

2. **Redeploy** after adding the variable

3. **Test again:**
   ```bash
   node scripts/test-wallet-endpoint.js 2A47E49DFEAC4394 https://www.zorinastudio-referral.com
   ```

## 💡 Why This Happened

You have:
- ✅ Certificate key in PEM format
- ✅ WWDR certificate
- ✅ Legacy .p12 certificate

But missing:
- ❌ Certificate in PEM format

The code prefers PEM format (cert + key separately), but falls back to .p12 if PEM cert is missing. However, the error suggests the fallback isn't working correctly.

## 🚀 Quick Fix

**Easiest solution:** Extract the certificate from your existing .p12 file and add it as `APPLE_PASS_CERTIFICATE_PEM_BASE64`.

If you don't have the .p12 file, you can:
1. Download it from Apple Developer Portal
2. Or use the legacy format (but we need to fix the fallback logic)

