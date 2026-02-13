# Solution Summary: organization_id UUID Type Casting Fix

## Problem

Commits `c966e87` and `9439007` incorrectly changed `organization_id` from `::uuid` to `::text` in VALUES clauses, causing PostgreSQL errors:
```
ERROR: column "organization_id" is of type uuid but expression is of type text
HINT: You will need to rewrite or cast the expression.
```

## Root Cause

1. **Prisma Schema Mismatch**: Many `organization_id String` fields were missing `@db.Uuid` annotation
2. **Misinterpretation**: Developers saw `String` in Prisma and assumed TEXT type
3. **Database Reality**: All `organization_id` columns are actually UUID type (see `scripts/migrate-pk-to-uuid.sql` line 273)

## Solution Applied

### ✅ 1. Fixed Prisma Schema
Added `@db.Uuid` annotation to all `organization_id` fields that were missing it:

- ✅ `Booking.organization_id` (line 583)
- ✅ `Order.organization_id` (line 703)
- ✅ `OrderLineItem.organization_id` (line 753)
- ✅ `Payment.organization_id` (line 864)
- ✅ `PaymentTender.organization_id` (line 986)
- ✅ `GiftCard.organization_id` (line 253)
- ✅ `GiftCardTransaction.organization_id` (line 303)
- ✅ `ReferralProfile.organization_id` (line 343)
- ✅ `ReferralReward.organization_id` (line 395)
- ✅ `Location.organization_id` (line 487)
- ✅ `ServiceVariation.organization_id` (line 557)
- ✅ `TeamMember.organization_id` (line 519)

### ✅ 2. Fixed Code
- Changed `${bookingOrgId}::text` to `${bookingOrgId}::uuid` in `app/api/webhooks/square/route.js` (line 1782)
- Fixed WHERE clauses in `app/api/webhooks/square/referrals/route.js` (lines 858, 884)

### ✅ 3. Created Prevention Tools

1. **`scripts/verify-organization-id-types.sql`**
   - Verifies database column types match expectations
   - Shows which columns are UUID vs TEXT

2. **`scripts/prevent-uuid-text-casts.js`**
   - Lint script to detect incorrect `::text` casts on UUID columns
   - Can be run in CI/CD pipeline
   - Scans codebase for problematic patterns

3. **`docs/UUID_TYPE_CASTING_GUIDE.md`**
   - Comprehensive guide on UUID type casting
   - Rules and patterns
   - Prevention checklist

4. **`scripts/fix-prisma-schema-org-id-types.md`**
   - Documentation of the issue and fix

## Files Changed

### Code Files
- `app/api/webhooks/square/route.js` - Fixed booking INSERT (line 1782)
- `app/api/webhooks/square/referrals/route.js` - Fixed WHERE clauses (lines 858, 884)

### Schema Files
- `prisma/schema.prisma` - Added `@db.Uuid` to 12 models

### New Files
- `scripts/verify-organization-id-types.sql`
- `scripts/prevent-uuid-text-casts.js`
- `scripts/fix-prisma-schema-org-id-types.md`
- `docs/UUID_TYPE_CASTING_GUIDE.md`

## Prevention Strategy

### Before Making Changes
1. ✅ Check Prisma schema for `@db.Uuid` annotation
2. ✅ Check migration scripts (`scripts/migrate-pk-to-uuid.sql`) for actual column types
3. ✅ Run `node scripts/prevent-uuid-text-casts.js` to verify
4. ✅ Test with actual database if unsure

### CI/CD Integration
Add to your CI pipeline:
```bash
node scripts/prevent-uuid-text-casts.js
```

## Verification

Run these commands to verify the fix:

```bash
# 1. Check Prisma schema has @db.Uuid annotations
grep "organization_id.*@db.Uuid" prisma/schema.prisma

# 2. Verify database column types
psql $DATABASE_URL -f scripts/verify-organization-id-types.sql

# 3. Run prevention script
node scripts/prevent-uuid-text-casts.js
```

## Related Commits

- `c966e87` - Incorrectly changed `::uuid` to `::text` in VALUES clauses
- `9439007` - Incorrectly changed remaining `::uuid` to `::text`
- **Current fix** - Reverted to `::uuid` and added prevention tools

## Status

✅ **FIXED** - All issues resolved:
- Prisma schema updated
- Code fixed
- Prevention tools created
- Documentation added

The error should no longer occur, and future mistakes will be caught by the prevention script.

