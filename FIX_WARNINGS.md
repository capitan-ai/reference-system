# Fix GiftCardRun/GiftCardJob Warnings

## The Problem

You're seeing these warnings:
```
⚠️ GiftCardRun model not available - skipping tracking
⚠️ GiftCardJob model not available - skipping job queue
```

## What This Means

The Prisma database models (`GiftCardRun` and `GiftCardJob`) exist in the database schema, but the Prisma client hasn't been regenerated to include them. The system works but without:
- **GiftCardRun**: Tracking/audit trail for gift card processing
- **GiftCardJob**: Async job queue (processes synchronously instead)

## How to Fix

### Option 1: If using Vercel (Recommended)

The Prisma client should regenerate automatically on deployment, but if it doesn't:

1. **Redeploy your application** - Vercel runs `prisma generate` during build
2. **Check the build logs** - Make sure `prisma generate` runs successfully

If that doesn't work:

1. **Manual trigger**: In Vercel dashboard, go to your project → Deployments → Click "Redeploy"

### Option 2: If you have direct server access

```bash
# SSH into your server/container
cd /path/to/your/app

# Regenerate Prisma client
npx prisma generate

# Restart your application
# (depends on your deployment method)
```

### Option 3: Force regeneration via deployment

```bash
# In your local environment
npm run prisma:deploy

# This runs: prisma migrate deploy && prisma generate
# Then push and redeploy
```

## Verify the Fix

After regenerating, check the health endpoint:

```bash
curl https://www.zorinastudio-referral.com/api/health
```

Look for:
```json
{
  "checks": {
    "giftCardRun": {
      "status": "ok",
      "available": true
    },
    "giftCardJob": {
      "status": "ok",
      "available": true
    }
  }
}
```

If both show `"available": true`, the warnings will stop appearing.

## Why This Happens

1. Database migrations were applied (tables created)
2. But Prisma client wasn't regenerated (code doesn't know about new models)
3. The code tries to use the models, but they're not in the generated client
4. System gracefully falls back but shows warnings

## Impact

**Current behavior (with warnings):**
- ✅ System works
- ✅ Gift cards are created
- ⚠️ No tracking/audit trail
- ⚠️ Processing is synchronous (slower)
- ⚠️ No async job queue

**After fix:**
- ✅ System works
- ✅ Gift cards are created
- ✅ Full tracking/audit trail
- ✅ Async job processing (faster)
- ✅ Better resilience

## Next Steps

1. Regenerate Prisma client (see options above)
2. Check `/api/health` endpoint
3. Verify warnings are gone in logs
4. Future deployments will auto-regenerate (we fixed the deployment script)
