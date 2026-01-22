-- ============================================================================
-- Create organization_users table with primary organization support
-- ============================================================================
-- Links Supabase Auth users to organizations with roles
-- Each user has ONE primary organization (is_primary = true)
-- ============================================================================

BEGIN;

-- Create organization_users table
CREATE TABLE IF NOT EXISTS organization_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL, -- Supabase Auth user ID (auth.users.id)
    organization_id UUID NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'viewer')),
    is_primary BOOLEAN NOT NULL DEFAULT false, -- Main organization for this user
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT organization_users_user_org_unique UNIQUE (user_id, organization_id),
    CONSTRAINT organization_users_organization_id_fkey 
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_organization_users_user_id ON organization_users(user_id);
CREATE INDEX IF NOT EXISTS idx_organization_users_organization_id ON organization_users(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_users_role ON organization_users(role);
CREATE INDEX IF NOT EXISTS idx_organization_users_user_primary ON organization_users(user_id, is_primary) WHERE is_primary = true;

-- Function to ensure only one primary organization per user
CREATE OR REPLACE FUNCTION ensure_single_primary_organization()
RETURNS TRIGGER AS $$
BEGIN
    -- If setting is_primary = true, unset all other primary organizations for this user
    IF NEW.is_primary = true THEN
        UPDATE organization_users
        SET is_primary = false
        WHERE user_id = NEW.user_id
          AND organization_id != NEW.organization_id
          AND is_primary = true;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to enforce single primary organization
DROP TRIGGER IF EXISTS trigger_ensure_single_primary_organization ON organization_users;
CREATE TRIGGER trigger_ensure_single_primary_organization
    BEFORE INSERT OR UPDATE ON organization_users
    FOR EACH ROW
    EXECUTE FUNCTION ensure_single_primary_organization();

-- Enable RLS (will be configured later)
ALTER TABLE organization_users ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ============================================================================
-- Verification queries
-- ============================================================================

-- Check table structure
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'organization_users'
ORDER BY ordinal_position;

-- Check constraints
SELECT 
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_name = 'organization_users'
ORDER BY tc.constraint_type, tc.constraint_name;

