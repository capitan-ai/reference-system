-- ============================================================================
-- Add organization_id to gift_cards, referral_profiles, referral_rewards
-- ============================================================================
-- This migration:
-- 1. Adds organization_id (nullable) to all three tables
-- 2. Backfills organization_id from square_existing_clients via square_customer_id
-- 3. Sets organization_id NOT NULL
-- 4. Adds FK constraints
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Add organization_id column (nullable initially)
-- ============================================================================

ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE referral_profiles ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE referral_rewards ADD COLUMN IF NOT EXISTS organization_id UUID;

DO $$ BEGIN
    RAISE NOTICE '✅ Added organization_id columns';
END $$;

-- ============================================================================
-- STEP 2: Backfill organization_id from square_existing_clients
-- ============================================================================

-- gift_cards: via square_customer_id -> square_existing_clients.organization_id
UPDATE gift_cards gc
SET organization_id = sec.organization_id
FROM square_existing_clients sec
WHERE gc.square_customer_id = sec.square_customer_id
AND gc.organization_id IS NULL;

-- referral_profiles: via square_customer_id -> square_existing_clients.organization_id
UPDATE referral_profiles rp
SET organization_id = sec.organization_id
FROM square_existing_clients sec
WHERE rp.square_customer_id = sec.square_customer_id
AND rp.organization_id IS NULL;

-- referral_rewards: via referrer_customer_id -> referral_profiles.square_customer_id -> square_existing_clients.organization_id
-- OR via referred_customer_id -> square_existing_clients.organization_id
-- We'll use referrer_customer_id as primary source
UPDATE referral_rewards rr
SET organization_id = sec.organization_id
FROM referral_profiles rp
JOIN square_existing_clients sec ON rp.square_customer_id = sec.square_customer_id
WHERE rr.referrer_customer_id = rp.square_customer_id
AND rr.organization_id IS NULL;

-- If still NULL, try via referred_customer_id
UPDATE referral_rewards rr
SET organization_id = sec.organization_id
FROM square_existing_clients sec
WHERE rr.referred_customer_id = sec.square_customer_id
AND rr.organization_id IS NULL;

-- Verify backfill
DO $$
DECLARE
    gift_cards_null_count INT;
    referral_profiles_null_count INT;
    referral_rewards_null_count INT;
    gift_cards_total INT;
    referral_profiles_total INT;
    referral_rewards_total INT;
BEGIN
    SELECT COUNT(*) INTO gift_cards_total FROM gift_cards;
    SELECT COUNT(*) INTO gift_cards_null_count FROM gift_cards WHERE organization_id IS NULL;
    
    SELECT COUNT(*) INTO referral_profiles_total FROM referral_profiles;
    SELECT COUNT(*) INTO referral_profiles_null_count FROM referral_profiles WHERE organization_id IS NULL;
    
    SELECT COUNT(*) INTO referral_rewards_total FROM referral_rewards;
    SELECT COUNT(*) INTO referral_rewards_null_count FROM referral_rewards WHERE organization_id IS NULL;
    
    RAISE NOTICE '✅ Backfill results:';
    RAISE NOTICE '   gift_cards: % / % mapped (%, NULL)', 
        (gift_cards_total - gift_cards_null_count), gift_cards_total, gift_cards_null_count;
    RAISE NOTICE '   referral_profiles: % / % mapped (%, NULL)', 
        (referral_profiles_total - referral_profiles_null_count), referral_profiles_total, referral_profiles_null_count;
    RAISE NOTICE '   referral_rewards: % / % mapped (%, NULL)', 
        (referral_rewards_total - referral_rewards_null_count), referral_rewards_total, referral_rewards_null_count;
    
    IF gift_cards_null_count > 0 OR referral_profiles_null_count > 0 OR referral_rewards_null_count > 0 THEN
        RAISE WARNING '⚠️ Some rows have NULL organization_id. These may need manual review.';
    END IF;
END $$;

-- ============================================================================
-- STEP 3: Set organization_id NOT NULL
-- ============================================================================

-- Check if all are populated
DO $$
DECLARE
    null_count INT;
BEGIN
    SELECT 
        (SELECT COUNT(*) FROM gift_cards WHERE organization_id IS NULL) +
        (SELECT COUNT(*) FROM referral_profiles WHERE organization_id IS NULL) +
        (SELECT COUNT(*) FROM referral_rewards WHERE organization_id IS NULL)
    INTO null_count;
    
    IF null_count > 0 THEN
        RAISE EXCEPTION 'Cannot set NOT NULL: Found % rows with NULL organization_id', null_count;
    END IF;
    
    RAISE NOTICE '✅ All organization_id values are populated (0 NULLs)';
END $$;

-- Set NOT NULL
ALTER TABLE gift_cards ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE referral_profiles ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE referral_rewards ALTER COLUMN organization_id SET NOT NULL;

DO $$ BEGIN
    RAISE NOTICE '✅ Set organization_id NOT NULL';
END $$;

-- ============================================================================
-- STEP 4: Add FK constraints
-- ============================================================================

ALTER TABLE gift_cards 
    ADD CONSTRAINT gift_cards_organization_id_fkey 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE referral_profiles 
    ADD CONSTRAINT referral_profiles_organization_id_fkey 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE referral_rewards 
    ADD CONSTRAINT referral_rewards_organization_id_fkey 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

DO $$ BEGIN
    RAISE NOTICE '✅ Added FK constraints';
END $$;

-- ============================================================================
-- STEP 5: Add indexes for performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_gift_cards_organization_id ON gift_cards(organization_id);
CREATE INDEX IF NOT EXISTS idx_referral_profiles_organization_id ON referral_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_organization_id ON referral_rewards(organization_id);

DO $$ BEGIN
    RAISE NOTICE '✅ Added indexes';
END $$;

COMMIT;

-- ============================================================================
-- Verification queries
-- ============================================================================

-- Check column types and constraints
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE (table_name = 'gift_cards' AND column_name = 'organization_id')
   OR (table_name = 'referral_profiles' AND column_name = 'organization_id')
   OR (table_name = 'referral_rewards' AND column_name = 'organization_id')
ORDER BY table_name;

-- Check FK constraints
SELECT 
    tc.table_name AS fk_table,
    kcu.column_name AS fk_column,
    ccu.table_name AS referenced_table,
    ccu.column_name AS referenced_column
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
AND ccu.table_name = 'organizations'
AND tc.table_name IN ('gift_cards', 'referral_profiles', 'referral_rewards')
ORDER BY tc.table_name;

