# 🔍 How to Check Apple Wallet Certificates in Vercel

## Current Issue

You're getting: `"Invalid PEM formatted message"`

This means the certificates in Vercel are not properly formatted.

## 🔧 Quick Fix Steps

### Step 1: Check Vercel Function Logs

1. Go to **Vercel Dashboard** → Your Project
2. Click **Deployments** → Latest deployment
3. Click **Functions** → Click on `/api/wallet/pass/[gan]`
4. Look for error logs - you should now see:
   - Which certificate is failing
   - First 100 characters of the decoded certificate
   - Base64 length
   - More detailed error messages

### Step 2: Verify Certificate Format

The certificates in Vercel must be:

1. **Base64 encoded** (single line, no newlines)
2. **Valid PEM format** after decoding

**What valid PEM looks like:**
```
-----BEGIN CERTIFICATE-----
MII... (base64 content) ...
-----END CERTIFICATE-----
```

### Step 3: Re-encode Certificates (If Needed)

If the logs show the certificates are invalid, re-encode them:

```bash
# 1. Extract from .p12 (if you have it)
openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out pass-cert.pem -passin pass:Step7nett.Umit
openssl pkcs12 -in Certificates.p12 -nocerts -out pass-key.pem -passin pass:Step7nett.Umit -passout pass:
openssl rsa -in pass-key.pem -out pass-key.pem

# 2. Download WWDR
curl -O https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer
openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem

# 3. Encode to base64 (CRITICAL: remove all newlines!)
base64 -i pass-cert.pem | tr -d '\n' | pbcopy
# Paste into Vercel: APPLE_PASS_CERTIFICATE_PEM_BASE64

base64 -i pass-key.pem | tr -d '\n' | pbcopy
# Paste into Vercel: APPLE_PASS_KEY_PEM_BASE64

base64 -i wwdr.pem | tr -d '\n' | pbcopy
# Paste into Vercel: APPLE_WWDR_CERTIFICATE_BASE64
```

**Important:** The `tr -d '\n'` removes all newlines - this is critical!

### Step 4: Verify in Vercel

After updating:

1. Make sure variables are in **Production** environment
2. **Redeploy** the project
3. Test again: `node scripts/test-wallet-endpoint.js 2A47E49DFEAC4394 https://www.zorinastudio-referral.com`
4. Check Vercel logs again for new error messages

## 📊 What the Logs Will Show

With the improved error handling, you'll see:

```
✅ Using base64 encoded certificate (PEM) from environment variable
   Certificate written to: /tmp/pass-cert.pem (1234 chars)
   Certificate preview: -----BEGIN CERTIFICATE-----MII...
```

Or if there's an error:

```
❌ Certificate validation failed:
   First 100 chars: [shows what was decoded]
   Base64 length: 1234
```

This will tell you exactly what's wrong!

## 🎯 Most Common Issues

1. **Base64 has newlines** - Use `tr -d '\n'` when encoding
2. **Base64 has spaces** - Make sure it's one continuous line
3. **Wrong certificate** - Must be the Pass Type ID certificate, not the WWDR
4. **Certificate expired** - Check in Keychain Access

## ✅ Next Steps

1. Check Vercel function logs (most important!)
2. Look for the detailed error messages
3. Re-encode certificates if needed
4. Redeploy and test again

The improved logging will show you exactly what's wrong!

