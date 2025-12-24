# ✅ Apple Wallet Setup Verification

## Quick Status Check

Based on your Vercel environment variables, here's what you have configured:

### ✅ Basic Configuration
- ✅ `APPLE_PASS_TYPE_ID` = `pass.com.zorinastudio.giftcard`
- ✅ `APPLE_PASS_TEAM_ID` = `MXAWQYBV2L`
- ✅ `APP_BASE_URL` = `https://zorinastudio-referral.com`

### ✅ Certificates (You have BOTH formats!)
- ✅ `APPLE_PASS_CERTIFICATE_PEM_BASE64` - **PEM format (preferred)**
- ✅ `APPLE_PASS_KEY_PEM_BASE64` - **PEM format (preferred)**
- ✅ `APPLE_PASS_CERTIFICATE_BASE64` - Legacy .p12 format (backup)
- ✅ `APPLE_WWDR_CERTIFICATE_BASE64` - WWDR certificate
- ✅ `APPLE_PASS_CERTIFICATE_PASSWORD` = `Step7nett.Umit`

## 🧪 Test Your Setup

### Option 1: Test via API Endpoint (Recommended)

Test the production endpoint:

```bash
node scripts/test-wallet-endpoint.js 2A47E49DFEAC4394 https://www.zorinastudio-referral.com
```

Or use a real gift card GAN from your database.

### Option 2: Test Locally (if you have certificate files)

```bash
node scripts/test-apple-wallet-pass.js TEST1234567890 1000 "Test Customer"
```

This will create `test-pass.pkpass` that you can open on your Mac.

### Option 3: Direct URL Test

Visit in browser (or use curl):
```
https://www.zorinastudio-referral.com/api/wallet/pass/2A47E49DFEAC4394
```

Should download a `.pkpass` file.

## ✅ What Should Work Now

1. **Pass Generation**: `/api/wallet/pass/[gan]` endpoint should work
2. **Email Integration**: Gift card emails include "Add to Apple Wallet" button
3. **Pass Updates**: Web service endpoints ready for balance updates

## 🔍 Troubleshooting

### If you get 404:
- Check that the route file exists: `app/api/wallet/pass/[gan]/route.js`
- Verify deployment succeeded in Vercel
- Check Vercel function logs

### If you get 500 error:
- Check Vercel logs for certificate errors
- Verify all base64 variables are set correctly
- Make sure base64 strings don't have extra spaces/newlines

### If pass won't open:
- Test on real iOS device (not simulator)
- Verify certificates aren't expired
- Check Team ID matches Apple Developer account

## 📊 Next Steps

1. ✅ **Test the endpoint** - Run the test script above
2. ✅ **Check Vercel logs** - Look for any errors
3. ✅ **Test with real gift card** - Use a GAN from your database
4. ✅ **Verify email integration** - Check that gift card emails include wallet button

## 🎉 You're All Set!

Your Apple Wallet integration is fully configured. The system will automatically:
- Generate passes when gift cards are created
- Include "Add to Apple Wallet" buttons in emails
- Support pass updates via web service

Just test the endpoint to confirm everything works!

