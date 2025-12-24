# Apple Wallet - Quick Start ✅

## ✅ Setup Complete!

All files have been created and configured. Here's what's ready:

### Files Created:
- ✅ `lib/wallet/pass-generator.js` - Pass generation service
- ✅ `app/api/wallet/pass/[gan]/route.js` - API endpoint
- ✅ `lib/wallet/pass-template/pass.json` - Pass template
- ✅ `scripts/test-apple-wallet-pass.js` - Test script
- ✅ Email service updated with wallet links

### Certificates:
- ✅ `certs/Certificates.p12` - Found
- ✅ `certs/wwdr.pem` - Found

### Configuration:
Your `.env` should have:
```env
APPLE_PASS_TYPE_ID=pass.com.zorinastudio.giftcard
APPLE_PASS_CERTIFICATE_PATH=./certs/Certificates.p12
APPLE_PASS_CERTIFICATE_PASSWORD=Step7nett.Umit
APPLE_WWDR_CERTIFICATE_PATH=./certs/wwdr.pem
APPLE_PASS_TEAM_ID=MXAWQYBV2L
```

## 🧪 Test It Now!

### Option 1: Test Script
```bash
node scripts/test-apple-wallet-pass.js TEST1234567890 1000 "Test Customer"
```

This creates `test-pass.pkpass` - open it on your Mac or iPhone!

### Option 2: Test via API
1. Start server: `npm run dev`
2. Visit: `http://localhost:3000/api/wallet/pass/TEST1234567890`
3. Download opens in Wallet app

### Option 3: Test with Real Gift Card
Use a real GAN from your database:
```bash
node scripts/test-apple-wallet-pass.js [REAL_GAN] [BALANCE] [CUSTOMER_NAME]
```

## 📧 Email Integration

Gift card emails now automatically include:
- "Add to Apple Wallet" button (your custom pass)
- "Add to Apple Wallet (Square)" button (if Square provides PassKit URL)

The custom button links to: `${APP_BASE_URL}/api/wallet/pass/${giftCardGan}`

## 🎨 Optional: Add Images

To make passes look better, add these to `lib/wallet/pass-template/`:
- `icon.png` (29x29px)
- `icon@2x.png` (58x58px)  
- `logo.png` (160x50px)
- `logo@2x.png` (320x100px)

Use your logo from `/public/logo.png` and resize.

## 🐛 Troubleshooting

**Error: Certificate not found**
- Check files are in `certs/` folder
- Verify paths in `.env`

**Error: Invalid password**
- Check `APPLE_PASS_CERTIFICATE_PASSWORD` matches export password

**Pass won't open**
- Test on real iOS device (not simulator)
- Verify certificates aren't expired
- Check Team ID matches Apple Developer account

## 📚 Full Documentation

See `APPLE_WALLET_SETUP.md` for complete details.

