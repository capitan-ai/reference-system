# Custom Domain Setup Guide

## Current Issue
You have two different URLs:
- `https://referral-system-salon.vercel.app` - Shows video ✅
- `https://zorinastudio-referral.com` - Missing video ❌

## Root Cause
1. Referral URLs are hardcoded to Vercel preview URL
2. Environment variable for custom domain is not set
3. Database URLs still point to old domain
4. Possible caching issue on custom domain

## Solution Steps

### 1. Set Environment Variable

**In Vercel Dashboard:**
1. Go to your project → Settings → Environment Variables
2. Add:
   ```
   NEXT_PUBLIC_APP_URL=https://zorinastudio-referral.com
   ```
   Or:
   ```
   APP_BASE_URL=https://zorinastudio-referral.com
   ```

**In local `.env.local`:**
```env
NEXT_PUBLIC_APP_URL=https://zorinastudio-referral.com
```

### 2. Update Database URLs

Run the update script:
```bash
node scripts/update-referral-urls-to-custom-domain.js
```

### 3. Redeploy to Vercel

After setting environment variables:
```bash
vercel --prod
```

### 4. Clear Cache

The custom domain might be serving cached content. Try:
- Hard refresh (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)
- Clear browser cache
- Wait a few minutes for Vercel CDN to update

### 5. Verify Custom Domain in Vercel

1. Go to Vercel Dashboard → Your Project → Settings → Domains
2. Verify `zorinastudio-referral.com` is listed
3. Check DNS configuration matches Vercel requirements

## Code Changes Made

✅ Created `lib/utils/referral-url.js` - Centralized URL generation
✅ Updated `app/api/webhooks/square/referrals/route.js` - Uses environment variable
✅ Updated `lib/webhooks/giftcard-processors.js` - Uses environment variable
✅ Updated `scripts/add-ref-codes-bozhena-iana.js` - Uses environment variable
✅ Created `scripts/update-referral-urls-to-custom-domain.js` - Updates existing URLs

## Testing

After setup, test:
1. Visit: `https://zorinastudio-referral.com/ref/BOZHENA8884`
2. Verify video appears
3. Check that all referral links use custom domain

## Why Video Might Not Show

1. **Caching**: Vercel CDN might be serving old cached version
2. **Deployment**: Custom domain might point to different deployment
3. **Build**: New deployment needed after environment variable change

## Next Steps

1. ✅ Set `NEXT_PUBLIC_APP_URL` in Vercel
2. ✅ Redeploy
3. ✅ Run update script to fix database URLs
4. ✅ Test custom domain
5. ✅ Clear cache if needed

