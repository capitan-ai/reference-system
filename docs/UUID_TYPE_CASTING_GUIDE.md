# UUID Type Casting Guide

## Problem Summary

**Issue**: Commits `c966e87` and `9439007` incorrectly changed `organization_id` from `::uuid` to `::text` in VALUES clauses, causing PostgreSQL errors:
```
ERROR: column "organization_id" is of type uuid but expression is of type text
```

**Root Cause**: Prisma schema showed `organization_id String` without `@db.Uuid` annotation, leading developers to assume TEXT type. However, the actual database columns are UUID type (see `scripts/migrate-pk-to-uuid.sql`).

## Solution Applied

### 1. Fixed Prisma Schema ✅
Added `@db.Uuid` annotation to all `organization_id` fields that were missing it:
- `Booking.organization_id`
- `Order.organization_id`
- `OrderLineItem.organization_id`
- `Payment.organization_id`
- `PaymentTender.organization_id`
- `GiftCard.organization_id`
- `GiftCardTransaction.organization_id`
- `ReferralProfile.organization_id`
- `ReferralReward.organization_id`
- `Location.organization_id`
- `ServiceVariation.organization_id`

### 2. Fixed Code ✅
- Changed `${bookingOrgId}::text` to `${bookingOrgId}::uuid` in `route.js` (line 1782)
- Fixed similar issues in `referrals/route.js` WHERE clauses

### 3. Created Prevention Tools ✅
- `scripts/verify-organization-id-types.sql` - Verify database column types
- `scripts/prevent-uuid-text-casts.js` - Lint script to detect incorrect casts
- `scripts/fix-prisma-schema-org-id-types.md` - Documentation

## Rules for UUID Type Casting

### ✅ CORRECT Patterns

```javascript
// In VALUES clauses (INSERT)
await prisma.$executeRaw`
  INSERT INTO bookings (organization_id, ...) 
  VALUES (${organizationId}::uuid, ...)
`

// In WHERE clauses
await prisma.$queryRaw`
  SELECT * FROM bookings 
  WHERE organization_id = ${organizationId}::uuid
`

// In UPDATE SET clauses
await prisma.$executeRaw`
  UPDATE bookings 
  SET organization_id = ${organizationId}::uuid
`
```

### ❌ INCORRECT Patterns

```javascript
// WRONG: Casting UUID to text
await prisma.$executeRaw`
  INSERT INTO bookings (organization_id, ...) 
  VALUES (${organizationId}::text, ...)  // ❌ WRONG!
`

// WRONG: Missing cast (may work but inconsistent)
await prisma.$executeRaw`
  INSERT INTO bookings (organization_id, ...) 
  VALUES (${organizationId}, ...)  // ⚠️ Better to be explicit
`
```

## How to Verify Column Types

### Option 1: Check Migration Scripts
Look in `scripts/migrate-pk-to-uuid.sql` to see actual database column types:
```sql
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS organization_id UUID;
```

### Option 2: Query Database
Run `scripts/verify-organization-id-types.sql`:
```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE column_name = 'organization_id'
  AND table_schema = 'public';
```

### Option 3: Check Prisma Schema
Look for `@db.Uuid` annotation:
```prisma
model Booking {
  organization_id String @db.Uuid // ✅ Has annotation
}
```

## Prevention Checklist

Before changing `organization_id` casting:
1. ✅ Check Prisma schema for `@db.Uuid` annotation
2. ✅ Check migration scripts for actual column type
3. ✅ Run `scripts/prevent-uuid-text-casts.js` to verify
4. ✅ Test with actual database query if unsure

## Common Mistakes

1. **Assuming Prisma `String` = TEXT**: Prisma uses `String` for both TEXT and UUID. Always check `@db.Uuid` annotation or migration scripts.

2. **Copying patterns from other columns**: Not all `String` columns are UUID. Check each column individually.

3. **Fixing errors reactively**: Use the prevention script proactively before committing.

## Related Files

- `scripts/migrate-pk-to-uuid.sql` - Database migration showing UUID types
- `scripts/verify-organization-id-types.sql` - Verification script
- `scripts/prevent-uuid-text-casts.js` - Lint/prevention script
- `prisma/schema.prisma` - Prisma schema (now has correct annotations)

## History

- **2026-01-30**: Commits `c966e87` and `9439007` incorrectly changed `::uuid` to `::text`
- **2026-02-13**: Fixed Prisma schema and code, added prevention tools

