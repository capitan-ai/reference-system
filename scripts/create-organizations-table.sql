-- ============================================================================
-- Create organizations table and populate from existing merchant_id data
-- ============================================================================

BEGIN;

-- Step 1: Create organizations table
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    square_merchant_id TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_organizations_square_merchant_id 
    ON organizations(square_merchant_id);

-- Add comments
COMMENT ON TABLE organizations IS 'Multi-tenant isolation: One Square merchant = one organization';
COMMENT ON COLUMN organizations.square_merchant_id IS 'External Square merchant identifier';

-- Step 2: Extract merchant_id from existing data and create organization
-- Get merchant_id from bookings or payments (prefer non-null)
INSERT INTO organizations (square_merchant_id)
SELECT DISTINCT merchant_id
FROM (
    SELECT merchant_id FROM bookings WHERE merchant_id IS NOT NULL
    UNION
    SELECT merchant_id FROM payments WHERE merchant_id IS NOT NULL
) AS merchant_ids
WHERE NOT EXISTS (SELECT 1 FROM organizations)
LIMIT 1
ON CONFLICT (square_merchant_id) DO NOTHING;

-- Step 3: Verify organization was created
DO $$
DECLARE
    org_count INT;
    org_id_val UUID;
    merchant_id_val TEXT;
BEGIN
    SELECT COUNT(*) INTO org_count FROM organizations;
    
    IF org_count = 0 THEN
        RAISE EXCEPTION 'No organization created! Check if merchant_id exists in bookings or payments.';
    END IF;
    
    SELECT id, square_merchant_id INTO org_id_val, merchant_id_val 
    FROM organizations LIMIT 1;
    
    RAISE NOTICE '✅ Organization created successfully!';
    RAISE NOTICE '   ID: %', org_id_val;
    RAISE NOTICE '   Square Merchant ID: %', merchant_id_val;
END $$;

COMMIT;

-- ============================================================================
-- Verification queries
-- ============================================================================

-- Verify organization exists
SELECT 
    'organizations' AS table_name,
    COUNT(*) AS row_count,
    string_agg(square_merchant_id, ', ') AS merchant_ids
FROM organizations;

-- Check merchant_id distribution in source tables
SELECT 
    'bookings' AS source_table,
    COUNT(DISTINCT merchant_id) AS unique_merchants,
    COUNT(*) FILTER (WHERE merchant_id IS NOT NULL) AS rows_with_merchant_id
FROM bookings
WHERE merchant_id IS NOT NULL
UNION ALL
SELECT 
    'payments' AS source_table,
    COUNT(DISTINCT merchant_id) AS unique_merchants,
    COUNT(*) FILTER (WHERE merchant_id IS NOT NULL) AS rows_with_merchant_id
FROM payments
WHERE merchant_id IS NOT NULL;



