# Deployment Guide: Remove Recipient Fields from Order Line Items

## Overview
This migration removes unused recipient, shipping, and fulfillment fields from the `order_line_items` table. These fields were removed from the Prisma schema to match the actual database structure.

## Migration Details
- **Migration Name**: `20260129203527_remove_recipient_fields_from_order_line_items`
- **Fields Removed**:
  - `recipient_name`
  - `recipient_email`
  - `recipient_phone`
  - `shipping_address_line_1`
  - `shipping_address_line_2`
  - `shipping_locality`
  - `shipping_administrative_district_level_1`
  - `shipping_postal_code`
  - `shipping_country`
  - `fulfillment_type`
  - `fulfillment_state`

## Pre-Deployment Checklist

✅ **Code Changes**:
- [x] Fields removed from `prisma/schema.prisma`
- [x] Defensive `delete` statements added to `app/api/webhooks/square/route.js`
- [x] Prisma Client regenerated locally (`npx prisma generate`)
- [x] Migration file created

✅ **Testing**:
- [ ] Test locally that webhook handler works without errors
- [ ] Verify no code references the removed fields

## Deployment Steps

### Step 1: Deploy Database Migration

Run the migration in production:

```bash
# Connect to production database and run:
npx prisma migrate deploy
```

Or if you have direct database access:

```bash
# Set production DATABASE_URL
export DATABASE_URL="your-production-database-url"

# Deploy migration
npx prisma migrate deploy
```

**Expected Output**:
```
Applying migration `20260129203527_remove_recipient_fields_from_order_line_items`
The following migration(s) have been applied:
  - 20260129203527_remove_recipient_fields_from_order_line_items
```

### Step 2: Regenerate Prisma Client in Production

The Prisma Client needs to be regenerated to match the updated schema:

```bash
# In production environment
npx prisma generate
```

**Note**: If deploying via Vercel, the `installCommand` in `vercel.json` already includes `npx prisma generate`, so this happens automatically during deployment.

### Step 3: Restart Application

Restart the application to load the new Prisma Client:

**For Vercel**:
- Push changes to trigger automatic deployment
- Or manually redeploy from Vercel dashboard

**For other platforms**:
- Restart the application service/container
- Ensure the new Prisma Client is loaded

## Verification

After deployment, verify:

1. **Check Migration Applied**:
   ```sql
   SELECT column_name 
   FROM information_schema.columns 
   WHERE table_name = 'order_line_items' 
   AND column_name IN (
     'recipient_name', 'recipient_email', 'recipient_phone',
     'shipping_address_line_1', 'shipping_address_line_2',
     'shipping_locality', 'shipping_administrative_district_level_1',
     'shipping_postal_code', 'shipping_country',
     'fulfillment_type', 'fulfillment_state'
   );
   ```
   Expected: 0 rows (columns don't exist)

2. **Monitor Webhook Logs**:
   - Check for any `recipient_name` errors
   - Verify webhook processing works correctly
   - Confirm no Prisma errors related to removed fields

3. **Test Webhook Processing**:
   - Send a test `order.created` webhook
   - Verify line items are created successfully
   - Check logs for any errors

## Rollback Plan

If issues occur, the migration can be rolled back by recreating the columns:

```sql
-- Rollback: Recreate columns (if needed)
ALTER TABLE order_line_items
  ADD COLUMN IF NOT EXISTS recipient_name TEXT,
  ADD COLUMN IF NOT EXISTS recipient_email TEXT,
  ADD COLUMN IF NOT EXISTS recipient_phone TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address_line_1 TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address_line_2 TEXT,
  ADD COLUMN IF NOT EXISTS shipping_locality TEXT,
  ADD COLUMN IF NOT EXISTS shipping_administrative_district_level_1 TEXT,
  ADD COLUMN IF NOT EXISTS shipping_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS shipping_country TEXT,
  ADD COLUMN IF NOT EXISTS fulfillment_type TEXT,
  ADD COLUMN IF NOT EXISTS fulfillment_state TEXT;
```

**Note**: The defensive `delete` statements in the code ensure backward compatibility, so rollback should not be necessary unless the columns actually exist in production.

## Vercel-Specific Notes

Vercel automatically:
1. Runs `npm install && npx prisma generate` during build (from `vercel.json`)
2. Regenerates Prisma Client on each deployment
3. Restarts the application after deployment

**Important**: You still need to run `npx prisma migrate deploy` manually to apply the database migration, as Vercel doesn't run migrations automatically.

## Timeline

- **Migration**: Safe to run anytime (uses `IF EXISTS` for safety)
- **Code Deployment**: Can be deployed before or after migration (defensive code handles both cases)
- **Recommended Order**:
  1. Deploy code changes first (defensive deletes prevent errors)
  2. Run database migration
  3. Verify everything works

## Support

If you encounter issues:
1. Check application logs for Prisma errors
2. Verify Prisma Client version matches schema
3. Ensure migration was applied successfully
4. Check that application was restarted after deployment

