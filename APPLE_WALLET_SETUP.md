# Apple Wallet Pass Setup Guide

This guide explains how to set up and use custom Apple Wallet passes for gift cards.

## Overview

The system generates custom Apple Wallet passes (.pkpass files) that customers can add to their iPhone Wallet app. This provides a native iOS experience for gift cards.

## Configuration

### Environment Variables

Add these to your `.env` file:

```env
APPLE_PASS_TYPE_ID=pass.com.zorinastudio.giftcard
APPLE_PASS_CERTIFICATE_PATH=./certs/Certificates.p12
APPLE_PASS_CERTIFICATE_PASSWORD=your_certificate_password
APPLE_WWDR_CERTIFICATE_PATH=./certs/wwdr.pem
APPLE_PASS_TEAM_ID=your_team_id
```

### Certificate Files

1. **Pass Type ID Certificate** (`Certificates.p12`)
   - Export from Keychain Access on Mac
   - Must be in `certs/` folder
   - Password set during export

2. **WWDR Certificate** (`wwdr.pem`)
   - Download from: https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer
   - Convert to .pem: `openssl x509 -inform DER -in AppleWWDRCAG4.cer -out certs/wwdr.pem`
   - Or download directly as .pem

## How It Works

1. **Pass Generation**: When a gift card is created, the system can generate a .pkpass file
2. **API Endpoint**: `/api/wallet/pass/[gan]` serves the pass file
3. **Email Integration**: Gift card emails include a link to add the pass to Apple Wallet
4. **Automatic Updates**: Passes can be updated when balance changes (requires web service setup)

## Testing

### Test Pass Generation

```bash
node scripts/test-apple-wallet-pass.js [GAN] [balanceCents] [customerName]
```

Example:
```bash
node scripts/test-apple-wallet-pass.js TEST1234567890 1000 "John Doe"
```

This will create a `test-pass.pkpass` file that you can:
- Open on Mac (opens in Wallet app)
- Email to yourself and open on iPhone
- Test the pass appearance and functionality

### Test via API

1. Start your development server: `npm run dev`
2. Visit: `http://localhost:3000/api/wallet/pass/[GAN]`
3. The browser will download a .pkpass file
4. Open it on your iPhone or Mac

## Pass Features

- **Balance Display**: Shows current gift card balance
- **Card Number**: Displays the GAN (Gift Account Number)
- **QR Code**: Scannable QR code for checkout
- **Customer Name**: Shows who the card belongs to
- **Branding**: Custom colors matching Zorina brand

## Email Integration

Gift card emails automatically include an "Add to Apple Wallet" button that links to:
```
${APP_BASE_URL}/api/wallet/pass/${giftCardGan}
```

The button appears alongside Square's PassKit URL (if available).

## Troubleshooting

### Certificate Errors

**Error: Certificate not found**
- Ensure `Certificates.p12` is in `certs/` folder
- Check the path in `.env` matches actual file location

**Error: WWDR certificate not found**
- Download WWDR certificate from Apple
- Convert to .pem format if needed
- Ensure it's in `certs/` folder

**Error: Invalid certificate password**
- Check `APPLE_PASS_CERTIFICATE_PASSWORD` in `.env`
- Must match the password used when exporting .p12

### Pass Generation Errors

**Error: Pass template not found**
- Ensure `lib/wallet/pass-template/pass.json` exists
- Check file permissions

**Error: Invalid Team ID**
- Verify `APPLE_PASS_TEAM_ID` matches your Apple Developer Team ID
- Find it in Apple Developer Portal → Membership

### Pass Not Opening

- Ensure certificates are valid and not expired
- Check that Pass Type ID matches in certificate and .env
- Verify Team ID is correct
- Test on actual iOS device (simulator may have issues)

## Security Notes

- Certificate files are in `.gitignore` - never commit them
- Keep certificate passwords secure
- Use environment variables, never hardcode credentials
- Rotate certificates before they expire

## Next Steps

1. ✅ Certificates configured
2. ✅ Pass generator created
3. ✅ API endpoint created
4. ✅ Email integration added
5. ⏳ Add pass images (optional but recommended)
6. ⏳ Test with real gift cards
7. ⏳ Set up web service for pass updates (optional)

## Pass Images (Optional)

To improve pass appearance, add these images to `lib/wallet/pass-template/`:
- `icon.png` (29x29px)
- `icon@2x.png` (58x58px)
- `logo.png` (160x50px)
- `logo@2x.png` (320x100px)

Use your logo from `/public/logo.png` and resize as needed.

