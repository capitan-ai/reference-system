# Location ID Fallback Implementation

## Problem

Webhooks often have `location_id` but may be missing `merchant_id`. This causes booking processing to fail because `organization_id` cannot be resolved.

## Solution

Use `location_id` as a fallback to resolve `organization_id` by:
1. Fetching location from Square API to get `merchant_id`
2. Resolving `organization_id` from `merchant_id`
3. Storing `merchant_id` in locations table for future use

## Changes Made

### 1. Database Schema (`prisma/schema.prisma`)
- Added `square_merchant_id` column to `Location` model
- Added indexes on `square_merchant_id` and `square_location_id`

### 2. Helper Functions (`app/api/webhooks/square/referrals/route.js`)

#### `fetchAndUpdateLocationFromSquare(squareLocationId)`
- Fetches location from Square API
- Updates `merchant_id` in database if missing or different
- Returns location data including `merchant_id`, `name`, `address`

#### `resolveOrganizationIdFromLocationId(squareLocationId)`
- First tries to get `organization_id` from existing location in database
- If missing, fetches location from Square API
- Resolves `organization_id` from `merchant_id`
- Updates location record with `organization_id` for future use

### 3. Updated Booking Processing Functions

#### `processBookingCreated`
- Now uses `location_id` as fallback when `merchant_id` is missing
- Resolves `organization_id` from `location_id` via Square API if needed

#### `processBookingUpdated`
- Now uses `location_id` as fallback when creating missing bookings
- Resolves `organization_id` from `location_id` via Square API if needed

#### `saveBookingToDatabase`
- Now uses `location_id` as fallback when `merchant_id` is missing
- Fetches location from Square API to get `merchant_id` and location details
- Updates location record with `merchant_id`, `name`, and `address` from Square API

### 4. Location Creation/Update
- When creating locations, now fetches from Square API to populate:
  - `square_merchant_id`
  - `name` (from Square API)
  - `address_line_1`, `locality`, `administrative_district_level_1`, `postal_code`

## Resolution Order (OPTIMIZED - Location First!)

When processing bookings, payments, and orders, `organization_id` is resolved in this order:
1. From `runContext.organizationId` (if provided)
2. **From `location_id` via `resolveOrganizationIdFromLocationId(locationId)`** ← FIRST PRIORITY (fast DB lookup)
3. From `merchant_id` via `resolveOrganizationId(merchantId)` (fallback)
4. From `customer_id` (lookup in `square_existing_clients`) (fallback)

**Why location_id first?**
- `location_id` is ALWAYS present in webhooks (unlike `merchant_id`)
- Fast database lookup (no API call needed if location exists)
- Only calls Square API if location not in database
- More reliable and faster than merchant_id lookup

## Benefits

1. **Resilient**: Bookings can be processed even when `merchant_id` is missing
2. **Automatic**: Locations are automatically updated with `merchant_id` from Square API
3. **Efficient**: Once `merchant_id` is stored, future lookups are fast (no API call needed)
4. **Complete**: Location details (name, address) are also populated from Square API

## Migration

Run the migration script to add `square_merchant_id` column:
```sql
-- See prisma/migrations/add_merchant_id_to_locations.sql
```

Or use Prisma migrate:
```bash
npx prisma migrate dev --name add_merchant_id_to_locations
```

## Testing

To test this fix:
1. Create a booking webhook payload with `location_id` but no `merchant_id`
2. Verify booking is saved successfully
3. Check that location record has `square_merchant_id` populated
4. Verify `organization_id` is correctly resolved

## Related Files

- `prisma/schema.prisma` - Added `square_merchant_id` to Location model
- `app/api/webhooks/square/referrals/route.js` - Added helper functions and updated booking processing
- `prisma/migrations/add_merchant_id_to_locations.sql` - Migration script

