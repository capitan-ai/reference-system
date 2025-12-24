# 🍎 Apple Wallet Setup - Complete Guide

## ✅ Current Status

The Apple Wallet integration is **code-complete** and ready to use. You just need to configure the environment variables in Vercel.

## 📋 Required Environment Variables

Add these to **Vercel Dashboard** → **Settings** → **Environment Variables** → **Production**:

### 1. Basic Configuration (Already Set)
```env
APPLE_PASS_TYPE_ID=pass.com.zorinastudio.giftcard
APPLE_PASS_TEAM_ID=MXAWQYBV2L
```

### 2. Certificates (PEM Format - Required)

You need to add these three base64-encoded certificates:

```env
APPLE_PASS_CERTIFICATE_PEM_BASE64=<base64_encoded_certificate>
APPLE_PASS_KEY_PEM_BASE64=<base64_encoded_private_key>
APPLE_WWDR_CERTIFICATE_BASE64=<base64_encoded_wwdr_certificate>
APPLE_PASS_CERTIFICATE_PASSWORD=Step7nett.Umit  # Optional, only if key is encrypted
```

## 🔧 How to Get Base64 Certificates

### Step 1: Extract Certificate and Key from .p12

If you have `Certificates.p12` file:

```bash
# Extract certificate (PEM format)
openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out pass-cert.pem

# Extract private key (PEM format)
openssl pkcs12 -in Certificates.p12 -nocerts -out pass-key-encrypted.pem

# Remove password from key (optional, but recommended)
openssl rsa -in pass-key-encrypted.pem -out pass-key.pem
```

### Step 2: Download WWDR Certificate

```bash
# Download WWDR certificate from Apple
curl -O https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer

# Convert to PEM format
openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem
```

### Step 3: Encode to Base64

```bash
# Encode certificate
base64 -i pass-cert.pem | tr -d '\n' | pbcopy
# Paste into Vercel: APPLE_PASS_CERTIFICATE_PEM_BASE64

# Encode private key
base64 -i pass-key.pem | tr -d '\n' | pbcopy
# Paste into Vercel: APPLE_PASS_KEY_PEM_BASE64

# Encode WWDR certificate
base64 -i wwdr.pem | tr -d '\n' | pbcopy
# Paste into Vercel: APPLE_WWDR_CERTIFICATE_BASE64
```

## 📝 Quick Setup Script

Create a script to automate this (optional):

```bash
#!/bin/bash
# encode-certificates.sh

# Extract from .p12
openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out pass-cert.pem -passin pass:Step7nett.Umit
openssl pkcs12 -in Certificates.p12 -nocerts -out pass-key.pem -passin pass:Step7nett.Umit -passout pass:
openssl rsa -in pass-key.pem -out pass-key.pem

# Download WWDR if not exists
if [ ! -f wwdr.pem ]; then
  curl -O https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer
  openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem
fi

# Encode to base64
echo "APPLE_PASS_CERTIFICATE_PEM_BASE64:"
base64 -i pass-cert.pem | tr -d '\n'
echo ""
echo ""
echo "APPLE_PASS_KEY_PEM_BASE64:"
base64 -i pass-key.pem | tr -d '\n'
echo ""
echo ""
echo "APPLE_WWDR_CERTIFICATE_BASE64:"
base64 -i wwdr.pem | tr -d '\n'
echo ""
```

## ✅ Verification Steps

### 1. Add Variables to Vercel

1. Go to **Vercel Dashboard** → Your Project
2. Click **Settings** → **Environment Variables**
3. Add all 5 variables (3 base64 + 2 basic)
4. Make sure they're set for **Production** environment
5. **Redeploy** your project

### 2. Test the Endpoint

After redeploy, test the pass generation:

```bash
# Test with a real GAN
curl https://www.zorinastudio-referral.com/api/wallet/pass/[GAN] \
  --output test-pass.pkpass

# Open on Mac
open test-pass.pkpass
```

Or use the test script:

```bash
node scripts/test-apple-wallet-pass.js [GAN] [BALANCE_CENTS] [CUSTOMER_NAME]
```

### 3. Check Vercel Logs

If it doesn't work:
1. Go to **Vercel Dashboard** → **Deployments**
2. Click on the latest deployment
3. Click **Functions** → Select the function
4. Check for errors in logs

## 🎯 What's Already Working

✅ Pass generator (`lib/wallet/pass-generator.js`)
✅ API endpoint (`app/api/wallet/pass/[gan]/route.js`)
✅ Email integration (includes "Add to Apple Wallet" button)
✅ Web service endpoints for pass updates
✅ Support for both PEM and .p12 formats

## 🐛 Troubleshooting

### Error: "Certificate not found"
- Check that all 3 base64 variables are set in Vercel
- Verify base64 strings don't have spaces/newlines
- Make sure variables are in **Production** environment

### Error: "Invalid certificate format"
- Verify PEM format starts with `-----BEGIN CERTIFICATE-----`
- Check that base64 decoding works: `echo $VAR | base64 -d | head -1`

### Pass won't open on iPhone
- Test on real device (not simulator)
- Verify certificates aren't expired
- Check Team ID matches Apple Developer account
- Ensure Pass Type ID matches certificate

### 404 Error on endpoint
- Check route file exists: `app/api/wallet/pass/[gan]/route.js`
- Verify deployment succeeded
- Check Vercel function logs

## 📚 Related Documentation

- `APPLE_WALLET_SETUP.md` - Detailed setup guide
- `APPLE_WALLET_ENV_VARS.md` - Environment variables reference
- `APPLE_WALLET_QUICK_START.md` - Quick start guide
- `APPLE_WALLET_DEPLOYMENT.md` - Deployment troubleshooting

## 🚀 Next Steps

1. ✅ Extract certificates from .p12
2. ✅ Encode to base64
3. ✅ Add to Vercel environment variables
4. ✅ Redeploy project
5. ✅ Test pass generation
6. ✅ Verify email integration works

Once these steps are complete, Apple Wallet passes will work automatically for all gift cards!

