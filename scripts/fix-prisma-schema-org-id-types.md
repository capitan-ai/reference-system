# Fix Prisma Schema: Add @db.Uuid to organization_id Fields

## Problem

The Prisma schema has many `organization_id String` fields **without** `@db.Uuid` annotation, but the actual database columns are **UUID type**. This mismatch caused commits c966e87 and 9439007 to incorrectly change `organization_id` from `::uuid` to `::text` in VALUES clauses.

## Root Cause

1. **Database Reality**: All `organization_id` columns are UUID type (see `scripts/migrate-pk-to-uuid.sql` line 273)
2. **Prisma Schema**: Many models have `organization_id String` without `@db.Uuid` annotation
3. **Confusion**: Developers see `String` in Prisma and assume TEXT, leading to incorrect `::text` casts

## Solution

Add `@db.Uuid` annotation to all `organization_id` fields in Prisma schema that are missing it.

## Models That Need Fixing

Based on `scripts/migrate-pk-to-uuid.sql`, these tables have UUID `organization_id` columns:

### Core Reference Tables
- ✅ `locations` - Already has `@db.Uuid` (line 82)
- ✅ `square_existing_clients` - Already has `@db.Uuid` (line 182)
- ✅ `team_members` - Already has `@db.Uuid` (line 182)
- ❌ `service_variation` - Missing `@db.Uuid` (line 557)

### Business Entity Tables
- ❌ `bookings` - Missing `@db.Uuid` (line 583)
- ❌ `orders` - Missing `@db.Uuid` (need to check)
- ❌ `order_line_items` - Missing `@db.Uuid` (need to check)
- ❌ `payments` - Missing `@db.Uuid` (need to check)
- ❌ `payment_tenders` - Missing `@db.Uuid` (need to check)

### Referral Tables
- ❌ `gift_cards` - Missing `@db.Uuid` (line 253)
- ❌ `gift_card_transactions` - Missing `@db.Uuid` (line 303)
- ❌ `referral_profiles` - Missing `@db.Uuid` (line 343)
- ❌ `referral_rewards` - Missing `@db.Uuid` (line 395)

## Verification

Run `scripts/verify-organization-id-types.sql` to check database column types.

## Prevention

1. Always check migration scripts to see actual database column types
2. Prisma schema should match database reality
3. Use `@db.Uuid` annotation for all UUID columns
4. Add lint rule to prevent `::text` casts on UUID columns (see `scripts/prevent-uuid-text-casts.js`)

