# Migration Summary: Add merchant_id to Locations

## What Changed

We added `square_merchant_id` column to the `locations` table to enable fast `organization_id` resolution from `location_id` when `merchant_id` is missing from webhooks.

## Schema Changes

**File: `prisma/schema.prisma`**

```prisma
model Location {
  // ... existing fields ...
  square_merchant_id String? // NEW: Square merchant ID (from Square API)
  // ... rest of fields ...
  
  @@index([square_merchant_id])  // NEW: Index for faster lookups
  @@index([square_location_id])  // NEW: Index for faster lookups
}
```

## SQL Migration Required

Run this SQL directly on your database:

```sql
-- Add square_merchant_id column to locations table
ALTER TABLE locations 
ADD COLUMN IF NOT EXISTS square_merchant_id VARCHAR(255);

-- Add index for faster lookups by merchant_id
CREATE INDEX IF NOT EXISTS idx_locations_square_merchant_id 
ON locations(square_merchant_id);

-- Add index for faster lookups by location_id (if not already exists)
CREATE INDEX IF NOT EXISTS idx_locations_square_location_id 
ON locations(square_location_id);
```

## Why This Migration?

1. **Performance**: Fast database lookup of `organization_id` from `location_id` (no API call needed)
2. **Reliability**: `location_id` is always in webhooks, unlike `merchant_id`
3. **Efficiency**: Once stored, future lookups are instant

## How to Apply

### Option 1: Direct SQL (Recommended if migration system has issues)
```bash
# Connect to your database and run the SQL above
psql $DATABASE_URL -f prisma/migrations/add_merchant_id_to_locations.sql
```

### Option 2: Prisma Migrate (if migration history is clean)
```bash
npx prisma migrate dev --name add_merchant_id_to_locations
```

### Option 3: Prisma DB Push (if you want to sync schema without migration history)
```bash
npx prisma db push
```

## Verification

After migration, verify the column exists:
```sql
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'locations' 
AND column_name = 'square_merchant_id';

-- Should return:
-- column_name: square_merchant_id
-- data_type: character varying
-- is_nullable: YES
```

## What Happens Next

Once the migration is applied:
1. The application code will automatically fetch `merchant_id` from Square API when processing webhooks
2. Locations will be updated with `merchant_id` for future fast lookups
3. `organization_id` resolution will prioritize `location_id` lookup (fastest path)

## No Data Migration Needed

- Existing locations will have `square_merchant_id = NULL` initially
- The application will populate this field automatically when:
  - Processing new webhooks
  - Fetching location data from Square API
  - Resolving `organization_id` from `location_id`



