-- ============================================================================
-- Add super_admin support to organization_users
-- ============================================================================
-- Super admin has access to all organizations
-- Super admin record has organization_id = NULL
-- ============================================================================

BEGIN;

-- Step 1: Allow NULL organization_id for super_admin
ALTER TABLE organization_users 
    ALTER COLUMN organization_id DROP NOT NULL;

-- Step 2: Update FK constraint to allow NULL
ALTER TABLE organization_users 
    DROP CONSTRAINT IF EXISTS organization_users_organization_id_fkey;

ALTER TABLE organization_users 
    ADD CONSTRAINT organization_users_organization_id_fkey 
    FOREIGN KEY (organization_id) 
    REFERENCES organizations(id) 
    ON DELETE CASCADE;

-- Step 3: Update CHECK constraint for role to include super_admin
ALTER TABLE organization_users 
    DROP CONSTRAINT IF EXISTS organization_users_role_check;

ALTER TABLE organization_users 
    ADD CONSTRAINT organization_users_role_check 
    CHECK (role IN ('super_admin', 'owner', 'admin', 'viewer'));

-- Step 4: Add constraint: super_admin must have NULL organization_id
ALTER TABLE organization_users 
    ADD CONSTRAINT organization_users_super_admin_org_null 
    CHECK (
        (role = 'super_admin' AND organization_id IS NULL) OR
        (role != 'super_admin' AND organization_id IS NOT NULL)
    );

-- Step 5: Update unique constraint to handle NULL organization_id
-- Drop existing unique constraint
ALTER TABLE organization_users 
    DROP CONSTRAINT IF EXISTS organization_users_user_org_unique;

-- Create unique index for regular users (with organization_id)
CREATE UNIQUE INDEX IF NOT EXISTS organization_users_user_org_unique 
    ON organization_users(user_id, organization_id)
    WHERE organization_id IS NOT NULL;

-- Super admin can only have one record (with NULL org)
CREATE UNIQUE INDEX IF NOT EXISTS organization_users_user_super_admin_unique
    ON organization_users(user_id)
    WHERE role = 'super_admin';

-- Step 6: Update trigger to handle super_admin (skip is_primary check for super_admin)
CREATE OR REPLACE FUNCTION ensure_single_primary_organization()
RETURNS TRIGGER AS $$
BEGIN
    -- If setting is_primary = true, unset all other primary organizations for this user
    -- Skip for super_admin (they don't have primary org)
    IF NEW.is_primary = true AND NEW.role != 'super_admin' THEN
        UPDATE organization_users
        SET is_primary = false
        WHERE user_id = NEW.user_id
          AND organization_id != NEW.organization_id
          AND is_primary = true
          AND role != 'super_admin';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ============================================================================
-- Verification queries
-- ============================================================================

-- Check constraints
SELECT 
    tc.constraint_name,
    tc.constraint_type,
    cc.check_clause
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.check_constraints cc
    ON tc.constraint_name = cc.constraint_name
WHERE tc.table_name = 'organization_users'
ORDER BY tc.constraint_type, tc.constraint_name;

-- Check indexes
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'organization_users'
ORDER BY indexname;

