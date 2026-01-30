# Fix orders_location_id_fkey Foreign Key Constraint Migration

## Problem Identified

The foreign key constraint `orders_location_id_fkey` is incorrectly pointing to the wrong column:

- **Current (WRONG)**: `orders.location_id` → `locations.square_location_id`
- **Should be (CORRECT)**: `orders.location_id` → `locations.id`

### Why This Causes FK Violations

1. `orders.location_id` stores **UUIDs** (from `locations.id`)
2. The constraint checks against `locations.square_location_id` (which contains Square location IDs like "GB2C2HDLKQGUO4")
3. UUIDs don't match Square IDs, causing `P2003` foreign key constraint violations

## Migration Files

1. **`scripts/fix-orders-location-fk-constraint.sql`** - SQL migration script
2. **`scripts/fix-orders-location-fk-constraint.js`** - JavaScript wrapper (recommended)

## How to Run

### Option 1: Using JavaScript Script (Recommended)

```bash
node scripts/fix-orders-location-fk-constraint.js
```

This script:
- ✅ Checks current constraint state
- ✅ Verifies no orphaned records
- ✅ Drops incorrect constraint
- ✅ Creates correct constraint
- ✅ Verifies the fix

### Option 2: Using SQL Script Directly

```bash
psql $DATABASE_URL -f scripts/fix-orders-location-fk-constraint.sql
```

## What the Migration Does

1. **Verifies current state** - Checks if constraint exists and what it points to
2. **Checks for orphaned records** - Finds orders with location_id not in locations.id
3. **Drops incorrect constraint** - Removes `orders_location_id_fkey`
4. **Creates correct constraint** - Adds new constraint pointing to `locations.id`
5. **Verifies the fix** - Confirms constraint points to correct column

## Safety Features

- ✅ Transaction-based (rolls back on error)
- ✅ Checks for orphaned records before proceeding
- ✅ Verifies constraint after creation
- ✅ Skips if constraint is already correct

## Expected Output

```
🔧 Fixing orders_location_id_fkey Foreign Key Constraint
============================================================

📋 Step 1: Checking current constraint state...
   Current constraint:
      orders.location_id → locations.square_location_id
   ❌ Constraint points to wrong column: square_location_id
   ✅ This is the issue we need to fix!

📋 Step 2: Checking for orphaned records...
   ✅ No orphaned records found

📋 Step 3: Executing migration...
   Dropping incorrect constraint...
   ✅ Dropped old constraint
   Creating correct constraint...
   ✅ Created new constraint

📋 Step 4: Verifying new constraint...
   New constraint:
      orders.location_id → locations.id
   ✅ Constraint is now correct!

📋 Step 5: Final verification...
   ✅ No orphaned records

============================================================
✅ Migration completed successfully!

The foreign key constraint now correctly points to:
  orders.location_id → locations.id
```

## After Migration

After running the migration, the FK constraint violations should be resolved. The next `order.created` webhook should successfully create orders without P2003 errors.

## Verification

You can verify the fix by running:

```bash
node scripts/check-fk-constraint.js
```

Expected output:
```
✅ Referenced table is correct: locations
✅ FK constraint mapping is CORRECT
   orders.location_id → locations.id
```

