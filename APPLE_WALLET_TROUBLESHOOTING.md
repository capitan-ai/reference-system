# 🔧 Apple Wallet Troubleshooting Guide

## Current Issue: "Invalid PEM formatted message"

You're getting a 500 error with message: `"Invalid PEM formatted message"`

This error comes from the `passkit-generator` library when it tries to read your certificates.

## 🔍 How to Diagnose

### Step 1: Check Vercel Function Logs

1. Go to **Vercel Dashboard** → Your Project
2. Click **Deployments** → Latest deployment
3. Click **Functions** → Select `/api/wallet/pass/[gan]`
4. Look for error logs - they should show:
   - Which certificate is failing
   - More detailed error messages
   - Certificate validation errors

### Step 2: Verify Certificate Format in Vercel

The certificates in Vercel must be:
- ✅ Base64 encoded
- ✅ **NO newlines or spaces** (single line)
- ✅ Valid PEM format after decoding

**Common Issues:**
- ❌ Base64 string has newlines (should be one continuous line)
- ❌ Base64 string has spaces
- ❌ Extra characters at start/end
- ❌ Wrong certificate (not the Pass Type ID certificate)

### Step 3: Verify Certificate Content

The decoded certificates should look like:

**Certificate (PEM):**
```
-----BEGIN CERTIFICATE-----
MII... (base64 content)
-----END CERTIFICATE-----
```

**Private Key (PEM):**
```
-----BEGIN PRIVATE KEY-----
MII... (base64 content)
-----END PRIVATE KEY-----
```

**WWDR Certificate:**
```
-----BEGIN CERTIFICATE-----
MII... (base64 content)
-----END CERTIFICATE-----
```

## 🛠️ How to Fix

### Option 1: Re-encode Certificates (Recommended)

1. **Extract certificates from .p12:**
   ```bash
   openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out pass-cert.pem -passin pass:Step7nett.Umit
   openssl pkcs12 -in Certificates.p12 -nocerts -out pass-key.pem -passin pass:Step7nett.Umit -passout pass:
   openssl rsa -in pass-key.pem -out pass-key.pem
   ```

2. **Download WWDR:**
   ```bash
   curl -O https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer
   openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem
   ```

3. **Encode to base64 (NO newlines):**
   ```bash
   # Certificate
   base64 -i pass-cert.pem | tr -d '\n' | pbcopy
   # Paste into Vercel: APPLE_PASS_CERTIFICATE_PEM_BASE64
   
   # Private Key
   base64 -i pass-key.pem | tr -d '\n' | pbcopy
   # Paste into Vercel: APPLE_PASS_KEY_PEM_BASE64
   
   # WWDR
   base64 -i wwdr.pem | tr -d '\n' | pbcopy
   # Paste into Vercel: APPLE_WWDR_CERTIFICATE_BASE64
   ```

4. **Important:** Make sure the base64 string is:
   - ✅ One continuous line (no line breaks)
   - ✅ No spaces
   - ✅ No extra characters

### Option 2: Use Legacy .p12 Format

If PEM format continues to have issues, you can use the legacy .p12 format:

1. **Encode .p12 file:**
   ```bash
   base64 -i Certificates.p12 | tr -d '\n' | pbcopy
   ```

2. **Add to Vercel:**
   - Variable: `APPLE_PASS_CERTIFICATE_BASE64`
   - Value: (paste base64 string)
   - Also set: `APPLE_PASS_CERTIFICATE_PASSWORD=Step7nett.Umit`

3. **Keep WWDR in base64:**
   - Variable: `APPLE_WWDR_CERTIFICATE_BASE64`
   - Value: (base64 encoded wwdr.pem)

## ✅ Verification Checklist

After updating certificates in Vercel:

- [ ] All 3 base64 variables are set (or use legacy .p12)
- [ ] Base64 strings are single lines (no newlines)
- [ ] Variables are in **Production** environment
- [ ] Redeploy the project
- [ ] Check Vercel logs for detailed errors
- [ ] Test endpoint again

## 📊 Expected Behavior

**Success:**
- Status: 200 OK
- Content-Type: `application/vnd.apple.pkpass`
- File downloads as `.pkpass`

**Failure:**
- Status: 500 Internal Server Error
- Check Vercel logs for specific error

## 🆘 Still Not Working?

1. **Check Vercel Logs** - Most important step!
   - Look for specific certificate errors
   - Check which certificate is failing

2. **Verify Certificate Validity:**
   ```bash
   # Test certificate locally (if you have files)
   openssl x509 -in pass-cert.pem -text -noout
   ```

3. **Check Certificate Expiry:**
   - Certificates expire - make sure yours are valid
   - Check in Keychain Access on Mac

4. **Verify Pass Type ID:**
   - Certificate must match `pass.com.zorinastudio.giftcard`
   - Check in Apple Developer Portal

5. **Team ID:**
   - Must match: `MXAWQYBV2L`
   - Check in Apple Developer Portal → Membership

## 📝 Next Steps

1. Check Vercel function logs for detailed error
2. Verify certificate format in Vercel
3. Re-encode certificates if needed
4. Redeploy and test again

The error message in Vercel logs will tell us exactly what's wrong!
