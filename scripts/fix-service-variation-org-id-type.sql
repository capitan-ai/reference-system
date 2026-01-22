-- ============================================================================
-- Fix service_variation.organization_id type: text → uuid
-- ============================================================================

BEGIN;

-- Step 1: Verify current state
DO $$
DECLARE
    current_type TEXT;
    org_id_value TEXT;
    valid_uuid_count INT;
    total_count INT;
BEGIN
    -- Get current data type
    SELECT data_type INTO current_type
    FROM information_schema.columns
    WHERE table_name = 'service_variation'
    AND column_name = 'organization_id';
    
    RAISE NOTICE 'Current type: %', current_type;
    
    -- Check if values are valid UUIDs
    SELECT COUNT(*) INTO total_count FROM service_variation;
    SELECT COUNT(*) INTO valid_uuid_count 
    FROM service_variation 
    WHERE organization_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    
    RAISE NOTICE 'Total rows: %', total_count;
    RAISE NOTICE 'Valid UUID format: %', valid_uuid_count;
    
    IF current_type != 'text' THEN
        RAISE NOTICE 'Type is already %, no change needed', current_type;
        RETURN;
    END IF;
    
    IF valid_uuid_count != total_count THEN
        RAISE EXCEPTION 'Not all organization_id values are valid UUIDs! Found % valid out of % total', valid_uuid_count, total_count;
    END IF;
    
    -- Get the organization_id value to verify
    SELECT organization_id INTO org_id_value FROM service_variation LIMIT 1;
    RAISE NOTICE 'Sample organization_id: %', org_id_value;
END $$;

-- Step 2: Change column type from text to uuid
-- PostgreSQL will automatically cast valid UUID strings to UUID type
ALTER TABLE service_variation 
    ALTER COLUMN organization_id TYPE UUID 
    USING organization_id::uuid;

-- Step 3: Verify type change
DO $$
DECLARE
    new_type TEXT;
BEGIN
    SELECT data_type INTO new_type
    FROM information_schema.columns
    WHERE table_name = 'service_variation'
    AND column_name = 'organization_id';
    
    IF new_type = 'uuid' THEN
        RAISE NOTICE '✅ Type successfully changed to UUID';
    ELSE
        RAISE EXCEPTION 'Type change failed! Current type: %', new_type;
    END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verification
-- ============================================================================

-- Verify type
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'service_variation'
AND column_name = 'organization_id';

-- Verify data integrity
SELECT 
    'service_variation' AS table_name,
    COUNT(*) AS total_rows,
    COUNT(organization_id) AS org_id_populated,
    COUNT(DISTINCT organization_id) AS unique_org_ids
FROM service_variation;

-- Verify it matches organization
SELECT 
    sv.organization_id,
    o.square_merchant_id,
    COUNT(*) AS count
FROM service_variation sv
LEFT JOIN organizations o ON sv.organization_id = o.id
GROUP BY sv.organization_id, o.square_merchant_id;

