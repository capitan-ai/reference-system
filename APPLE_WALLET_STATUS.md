# 🍎 Apple Wallet - Current Status & Action Plan

## ✅ What's Working

1. **Code is Complete:**
   - ✅ Pass generator (`lib/wallet/pass-generator.js`)
   - ✅ API endpoint (`app/api/wallet/pass/[gan]/route.js`)
   - ✅ Email integration (includes "Add to Apple Wallet" button)
   - ✅ Web service endpoints for pass updates
   - ✅ Improved error logging

2. **Environment Variables Set in Vercel:**
   - ✅ `APPLE_PASS_TYPE_ID=pass.com.zorinastudio.giftcard`
   - ✅ `APPLE_PASS_TEAM_ID=MXAWQYBV2L`
   - ✅ `APPLE_PASS_CERTIFICATE_PEM_BASE64` (set)
   - ✅ `APPLE_PASS_KEY_PEM_BASE64` (set)
   - ✅ `APPLE_WWDR_CERTIFICATE_BASE64` (set)
   - ✅ `APPLE_PASS_CERTIFICATE_PASSWORD=Step7nett.Umit`

## ❌ Current Issue

**Error:** `"Invalid PEM formatted message"` (500 error)

**What this means:** The certificates in Vercel are not properly formatted. The base64 strings decode correctly, but the PEM format is invalid or corrupted.

## 🔍 How to Diagnose

### Step 1: Check Vercel Function Logs

The improved error logging will show exactly what's wrong:

1. Go to **Vercel Dashboard** → Your Project
2. Click **Deployments** → Latest deployment
3. Click **Functions** → `/api/wallet/pass/[gan]`
4. Look for error logs - you should see:
   - Certificate preview (first 100 chars)
   - Base64 length
   - Specific validation errors
   - Which certificate is failing

### Step 2: Test the Endpoint

```bash
node scripts/test-wallet-endpoint.js 2A47E49DFEAC4394 https://www.zorinastudio-referral.com
```

Or visit:
```
https://www.zorinastudio-referral.com/api/wallet/pass/2A47E49DFEAC4394
```

## 🛠️ Most Likely Fix

The certificates in Vercel probably have formatting issues. Here's how to fix:

### Option 1: Re-encode Certificates (Recommended)

1. **If you have the original `.p12` file:**

```bash
# Extract certificate (PEM)
openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out pass-cert.pem -passin pass:Step7nett.Umit

# Extract private key (PEM)
openssl pkcs12 -in Certificates.p12 -nocerts -out pass-key.pem -passin pass:Step7nett.Umit -passout pass:
openssl rsa -in pass-key.pem -out pass-key.pem

# Download WWDR
curl -O https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer
openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem

# Encode to base64 (CRITICAL: remove all newlines!)
base64 -i pass-cert.pem | tr -d '\n' | pbcopy
# Paste into Vercel: APPLE_PASS_CERTIFICATE_PEM_BASE64

base64 -i pass-key.pem | tr -d '\n' | pbcopy
# Paste into Vercel: APPLE_PASS_KEY_PEM_BASE64

base64 -i wwdr.pem | tr -d '\n' | pbcopy
# Paste into Vercel: APPLE_WWDR_CERTIFICATE_BASE64
```

**Important:** The `tr -d '\n'` removes all newlines - this is critical!

### Option 2: Verify Current Certificates

If you want to check what's currently in Vercel:

1. Copy one of the base64 strings from Vercel
2. Decode it locally:
   ```bash
   echo "PASTE_BASE64_HERE" | base64 -d | head -5
   ```
3. Should show: `-----BEGIN CERTIFICATE-----` or `-----BEGIN PRIVATE KEY-----`

## 📋 Verification Checklist

After updating certificates:

- [ ] All 3 base64 variables updated in Vercel
- [ ] Base64 strings are single lines (no newlines)
- [ ] Variables are in **Production** environment
- [ ] **Redeploy** the project
- [ ] Test endpoint: `/api/wallet/pass/[gan]`
- [ ] Check Vercel logs for detailed errors

## 🎯 What Should Happen

**Success:**
- Status: 200 OK
- Content-Type: `application/vnd.apple.pkpass`
- File downloads as `.pkpass`
- Can open in Wallet app

**Current (Failure):**
- Status: 500 Internal Server Error
- Error: "Invalid PEM formatted message"
- Need to check logs for details

## 🔧 Next Steps

1. **Check Vercel Logs** (most important!)
   - Look for the improved error messages
   - See which certificate is failing
   - See what the decoded content looks like

2. **Re-encode Certificates** (if needed)
   - Follow the steps above
   - Make sure to remove newlines with `tr -d '\n'`

3. **Redeploy and Test**
   - After updating variables, redeploy
   - Test the endpoint again
   - Check logs again

## 📚 Related Files

- `APPLE_WALLET_SETUP_COMPLETE.md` - Complete setup guide
- `APPLE_WALLET_CHECK_CERTIFICATES.md` - Certificate troubleshooting
- `APPLE_WALLET_TROUBLESHOOTING.md` - General troubleshooting
- `lib/wallet/pass-generator.js` - Pass generation code (with improved logging)

## 💡 Quick Test

To see what the logs say:

1. Visit: `https://www.zorinastudio-referral.com/api/wallet/pass/TEST123`
2. Check Vercel function logs
3. Look for error messages showing:
   - Certificate preview
   - Validation errors
   - Specific failure point

The improved logging will tell you exactly what's wrong!

