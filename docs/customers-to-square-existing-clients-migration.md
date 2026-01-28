# Migration: Customers Table to Square Existing Clients

## Overview

This migration aligns the entire system to use `square_existing_clients` as the single source of truth for customer data, replacing the `customers` table for all foreign key relationships.

## Changes Made

### 1. Prisma Schema Updates

- **Updated `SquareExistingClient` model** (renamed from `square_existing_clients`):
  - Added relations: `refLinks`, `refMatches`, `friendRewards`, `referrerRewards`, `refClicks`, `bookings`, `payments`
  - Now serves as the primary customer table for all FK relationships

- **Updated `RefLink` model**:
  - Changed `customerId` to reference `square_customer_id` (String) instead of UUID `id`
  - Relation now points to `SquareExistingClient.square_customer_id`

- **Updated `RefMatch` model**:
  - Changed `customerId` to reference `square_customer_id` (String)
  - Relation now points to `SquareExistingClient.square_customer_id`

- **Updated `RefReward` model**:
  - Changed `referrerCustomerId` and `friendCustomerId` to reference `square_customer_id` (String)
  - Relations now point to `SquareExistingClient.square_customer_id`

- **Updated `RefClick` model**:
  - Changed `customerId` to reference `square_customer_id` (String)
  - Relation now points to `SquareExistingClient.square_customer_id`

- **Updated `Booking` model**:
  - Changed relation from `Customer.squareCustomerId` to `SquareExistingClient.square_customer_id`

- **Updated `Payment` model**:
  - Changed relation from `Customer.squareCustomerId` to `SquareExistingClient.square_customer_id`

- **Deprecated `Customer` model**:
  - Kept in schema for backwards compatibility during migration
  - All relations removed
  - Can be deleted after migration is complete

### 2. Data Migration Script

Created `scripts/migrate-customers-to-square-existing-clients.js`:
- Converts all UUID references to `square_customer_id` strings
- Migrates:
  - `ref_links.customer_id` (UUID → square_customer_id)
  - `ref_matches.customer_id` (UUID → square_customer_id)
  - `ref_rewards.referrer_customer_id` (UUID → square_customer_id)
  - `ref_rewards.friend_customer_id` (UUID → square_customer_id)
  - `ref_clicks.customer_id` (UUID → square_customer_id)

### 3. Code Updates

- **`lib/square-bookings-backfill.js`**:
  - Removed customer upsert logic (no longer needed)
  - FK constraints now reference `square_existing_clients` directly

- **`scripts/generate-referral-links-for-all-customers.js`**:
  - Updated to query `square_existing_clients` directly using raw SQL
  - Changed `customerId` in `RefLink.create()` to use `square_customer_id` instead of UUID

## Migration Steps

### Step 1: Backup Database
```bash
# Already completed
```

### Step 2: Run Data Migration
```bash
node scripts/migrate-customers-to-square-existing-clients.js
```

This script will:
- Find all UUID references in referral tables
- Look up corresponding `square_customer_id` from `customers` table
- Update referral tables to use `square_customer_id` instead

### Step 3: Update Prisma Schema
```bash
# Schema already updated in prisma/schema.prisma
npx prisma format
```

### Step 4: Generate Prisma Client
```bash
npx prisma generate
```

### Step 5: Create Database Migration
```bash
npx prisma migrate dev --name migrate_to_square_existing_clients
```

This will:
- Drop old FK constraints referencing `customers.id`
- Create new FK constraints referencing `square_existing_clients.square_customer_id`
- Apply all schema changes

### Step 6: Verify Migration
```bash
# Test queries
node scripts/check-all-customers-referral-urls.js
```

### Step 7: Update Remaining Scripts (Optional)
The following scripts still reference `prisma.customer` but are primarily for analysis:
- `scripts/analyze-all-database-data.js`
- `scripts/backfill-bookings-by-customer.js`
- `scripts/check-all-customers-referral-urls.js`
- `scripts/send-referral-emails-to-customers.js`
- `scripts/verify-email-readiness.js`

These can be updated to use `prisma.squareExistingClient` or raw SQL queries on `square_existing_clients`.

## Benefits

1. ✅ **Single Source of Truth**: All customer data in `square_existing_clients` (~7,486 records)
2. ✅ **No Data Sync Issues**: Eliminates need to sync between two customer tables
3. ✅ **Simpler Queries**: Business logic already uses `square_existing_clients`
4. ✅ **Better Data Integrity**: FK constraints ensure referential integrity

## Risks & Mitigation

- **Breaking Changes**: 
  - All scripts using `prisma.customer` need updates
  - Migration: Update gradually, test thoroughly

- **Data Loss Risk**:
  - Migration script includes validation
  - Backup created before migration

- **Rollback Plan**:
  - `Customer` model kept in schema
  - Can revert schema changes if needed
  - Data migration is one-way (UUID → string), but can be reversed with lookup

## Post-Migration Cleanup

After verifying migration:
1. Remove `Customer` model from Prisma schema (if no longer needed)
2. Update remaining scripts that reference `prisma.customer`
3. Drop `customers` table from database (optional, after full verification)

## Verification Checklist

- [ ] Data migration script runs successfully
- [ ] All referral links still work
- [ ] All referral matches still work
- [ ] All referral rewards still work
- [ ] Booking creation works with new FK constraints
- [ ] Payment creation works with new FK constraints
- [ ] Referral link generation works
- [ ] All tests pass

## Notes

- The `customers` table had ~23 records vs `square_existing_clients` with ~7,486
- Most business logic already used `square_existing_clients` via raw SQL
- This migration aligns the Prisma schema with actual data usage patterns




