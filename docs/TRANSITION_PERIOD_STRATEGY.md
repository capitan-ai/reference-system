# Transition Period Strategy: Dual Table Support

## Overview

During the migration to normalized tables, we maintain **both** the old `square_existing_clients` table and new normalized tables (`gift_cards`, `referral_profiles`, `referral_rewards`) in sync.

## Tables Being Migrated

### 1. Gift Card Data
- **Old Location:** `square_existing_clients` (fields: `gift_card_id`, `gift_card_gan`, `gift_card_order_id`, etc.)
- **New Location:** `gift_cards` table + `gift_card_transactions` table
- **Strategy:** Write to both tables simultaneously

### 2. Referral Data
- **Old Location:** `square_existing_clients` (fields: `personal_code`, `referral_code`, `referral_url`, `total_referrals`, etc.)
- **New Location:** `referral_profiles` table + `referral_rewards` table
- **Strategy:** Write to both tables simultaneously

## Current Implementation

### Code Pattern: Dual Write

All updates follow this pattern:

```javascript
// 1. Write to new normalized table
try {
  await prisma.referralProfile.upsert({...})
} catch (error) {
  // Log but continue - don't fail entire operation
  console.error('Error updating ReferralProfile:', error.message)
}

// 2. Also write to old table (backward compatibility)
await prisma.$executeRaw`
  UPDATE square_existing_clients 
  SET ...
  WHERE square_customer_id = ${customerId}
`
```

### Benefits of This Approach

1. **Zero Downtime** - Existing code continues to work
2. **Gradual Migration** - New code can use normalized tables
3. **Safety** - No data loss if one write fails
4. **Rollback Safety** - Can revert to old table if needed

### Risks & Mitigations

#### Risk: Data Inconsistency
**Problem:** If one write succeeds and the other fails, tables can become out of sync.

**Mitigation:**
- Run `scripts/validate-table-sync.js` regularly to detect inconsistencies
- Errors in new table writes are logged but don't block operations
- Old table is always updated (more critical for immediate operations)

#### Risk: Partial Updates
**Problem:** Some fields may update in one table but not the other.

**Mitigation:**
- Both tables are updated in sequence
- Critical fields (like `gift_card_id`, `personal_code`) are always written to both
- Validation script catches mismatches

## Validation & Monitoring

### Validation Script

Run regularly to check for inconsistencies:

```bash
node scripts/validate-table-sync.js
```

This checks:
- ✅ Gift cards in `square_existing_clients` that aren't in `gift_cards`
- ✅ Gift cards in `gift_cards` that don't match `square_existing_clients`
- ✅ Customers with referral data missing from `referral_profiles`
- ✅ Mismatched `personal_code` values
- ✅ Mismatched `used_referral_code` values

### Recommended Schedule

- **Daily:** Run validation script
- **Weekly:** Review inconsistencies and sync missing data
- **After Deployments:** Run validation to ensure no regressions

## Migration Scripts

### Existing Data Migration

1. **Gift Cards:** `scripts/migrate-gift-cards-to-new-tables.js`
   - Migrates existing gift card data from `square_existing_clients` to `gift_cards`

2. **Referral Profiles:** (To be created)
   - Migrates referral data to `referral_profiles`

## Future: Removing Old Fields

Once we're confident in the new tables:

1. ✅ Run migration scripts to ensure all data is in new tables
2. ✅ Run validation script - should show 0 issues
3. ✅ Update all code to read from new tables only
4. ✅ Remove writes to old table fields
5. ✅ Wait 1-2 weeks to ensure no issues
6. ✅ Drop old columns from `square_existing_clients`

## Current Status

- ✅ New tables created (`gift_cards`, `referral_profiles`, `referral_rewards`)
- ✅ Code writes to both tables
- ✅ Validation script available
- ⏳ Migration scripts in progress
- ⏳ All data migrated to new tables
- ⏳ Code fully switched to new tables only
- ⏳ Old fields removed

## Notes

- During transition, **both tables are source of truth**
- Reads check new tables first, fall back to old table
- Writes update both tables
- Validation ensures they stay in sync



