# Booking Fields Fix - Square IDs vs UUIDs

## Problem Summary

The webhook processing code was storing **Square IDs** (external identifiers) directly in fields that should store **internal UUIDs** (database foreign keys). This caused:

1. **Foreign key constraint violations** - Square IDs can't be used as foreign keys
2. **Data inconsistency** - 66+ bookings had mismatched or NULL values
3. **Broken relationships** - Queries joining bookings with service_variations or team_members would fail

## Root Causes

### 1. `saveBookingToDatabase` Function (Line ~3339)
**Problem:** Directly stored Square IDs without resolving to UUIDs
```javascript
// WRONG - stored Square ID string
${segment?.service_variation_id || segment?.serviceVariationId || null}
// This stored: "ZEAKNB35I37RMXNUBGWDZQIM" (Square ID)
// Should store: "1ddde7c9-775a-4c89-b4bf-737a5cfaa0a3" (UUID)
```

### 2. `processBookingUpdated` Function (Line ~3519)
**Problem:** Used wrong column name (`id` instead of `uuid`) and didn't properly resolve Square IDs

### 3. ON CONFLICT Clause (Line ~3356)
**Problem:** Preserved old values instead of updating from new webhook data
```javascript
// WRONG - preserves old value if new is null
service_variation_id = COALESCE(EXCLUDED.service_variation_id, bookings.service_variation_id)
```

## Fixes Applied

### ✅ Fix 1: Added UUID Resolution in `saveBookingToDatabase`

**Location:** `app/api/webhooks/square/referrals/route.js` (around line 3308)

**What was added:**
- Code to resolve `serviceVariationId` (Square ID) → `service_variation_id` (UUID)
- Code to resolve `teamMemberId` (Square ID) → `technician_id` (UUID)
- Proper error handling and logging

**Before:**
```javascript
${segment?.service_variation_id || segment?.serviceVariationId || null}
${segment?.team_member_id || segment?.teamMemberId || null}
```

**After:**
```javascript
// Resolve Square IDs to UUIDs first
let serviceVariationUuid = null
const squareServiceVariationId = segment?.service_variation_id || segment?.serviceVariationId
if (squareServiceVariationId && finalOrganizationId) {
  const svRecord = await prisma.$queryRaw`
    SELECT uuid::text as id FROM service_variation
    WHERE square_variation_id = ${squareServiceVariationId}
      AND organization_id = ${finalOrganizationId}::uuid
    LIMIT 1
  `
  serviceVariationUuid = svRecord && svRecord.length > 0 ? svRecord[0].id : null
}

// Then use UUID
${serviceVariationUuid || null}
```

### ✅ Fix 2: Fixed ON CONFLICT Clause

**Location:** `app/api/webhooks/square/referrals/route.js` (around line 3352)

**What changed:**
- Removed `COALESCE` that preserved old values
- Now always updates from new webhook data

**Before:**
```javascript
service_variation_id = COALESCE(EXCLUDED.service_variation_id, bookings.service_variation_id),
service_variation_version = COALESCE(EXCLUDED.service_variation_version, bookings.service_variation_version),
technician_id = COALESCE(EXCLUDED.technician_id, bookings.technician_id),
```

**After:**
```javascript
service_variation_id = EXCLUDED.service_variation_id,
service_variation_version = EXCLUDED.service_variation_version,
technician_id = EXCLUDED.technician_id,
```

### ✅ Fix 3: Fixed `processBookingUpdated` Function

**Location:** `app/api/webhooks/square/referrals/route.js` (around line 3557)

**What was fixed:**
- Corrected column name from `id` to `uuid` for service_variation table
- Added proper Square ID → UUID resolution
- Improved version update logic to always get from raw_json if available

**Before:**
```javascript
const squareServiceVariationId = await prisma.$queryRaw`
  SELECT square_variation_id FROM service_variation
  WHERE id = ${existingBooking.service_variation_id}::uuid  // WRONG: column is 'uuid', not 'id'
```

**After:**
```javascript
const svRecord = await prisma.$queryRaw`
  SELECT uuid::text as id FROM service_variation
  WHERE square_variation_id = ${squareServiceVariationId}
    AND organization_id = ${organizationId}::uuid
  LIMIT 1
`
serviceVariationId = svRecord && svRecord.length > 0 ? svRecord[0].id : null
```

## Fix Script for Existing Data

### Script: `scripts/fix-booking-fields-from-raw-json.js`

**What it does:**
1. Checks ALL bookings with raw_json
2. Extracts Square IDs from raw_json
3. Resolves Square IDs to UUIDs
4. Updates `service_variation_id`, `service_variation_version`, and `technician_id`
5. Only updates bookings that need fixing

**Usage:**
```bash
node scripts/fix-booking-fields-from-raw-json.js
```

**What to expect:**
- Processes all bookings (could be thousands)
- Shows progress every 100 fixed bookings
- Reports summary at the end:
  - Total checked
  - Fixed count
  - Skipped (no changes needed)
  - Errors
  - Missing service variations/team members (warnings)

## Testing

### Before Running Fix Script

1. **Backup your database** (recommended)
2. **Test on a small subset first** (modify script to add `LIMIT 10` to the query)

### After Running Fix Script

1. **Verify fixes:**
   ```bash
   node scripts/compare-booking-raw-json.js
   ```
   Should show 0 mismatches after fix

2. **Check specific booking:**
   ```bash
   node scripts/check-specific-booking.js d0ane0kkznbroo
   ```

## Impact

### Before Fix
- ❌ 24 bookings with NULL or wrong `service_variation_id`
- ❌ 42 bookings with wrong `service_variation_version`
- ❌ Foreign key relationships broken
- ❌ Future webhooks would continue creating bad data

### After Fix
- ✅ All new webhooks properly resolve Square IDs to UUIDs
- ✅ Existing bookings can be fixed with the script
- ✅ Foreign key relationships work correctly
- ✅ Data consistency maintained

## Related Files

- `docs/SQUARE_IDS_EXPLANATION.md` - Detailed explanation of Square IDs vs UUIDs
- `scripts/fix-booking-fields-from-raw-json.js` - Fix script for existing data
- `scripts/compare-booking-raw-json.js` - Comparison script to verify fixes
- `scripts/check-specific-booking.js` - Check individual booking

## Next Steps

1. ✅ Code fixes applied (webhook processing)
2. ⏳ Run fix script on production data
3. ⏳ Verify all bookings are fixed
4. ⏳ Monitor webhook logs to ensure no new issues



