-- ============================================================================
-- Backfill organization_id for all tenant tables
-- ============================================================================
-- This script fills organization_id for all existing records
-- Assumes single organization exists (MLJSE2F6EE60D)
-- ============================================================================

BEGIN;

-- Step 1: Get organization ID
DO $$
DECLARE
    org_id UUID;
    locations_count INT;
    bookings_count INT;
    orders_count INT;
    payments_count INT;
BEGIN
    -- Get the single organization ID
    SELECT id INTO org_id FROM organizations LIMIT 1;
    
    IF org_id IS NULL THEN
        RAISE EXCEPTION 'No organization found. Create organizations table first.';
    END IF;
    
    RAISE NOTICE 'Backfilling organization_id = %', org_id;
    RAISE NOTICE 'Organization: %', (SELECT square_merchant_id FROM organizations WHERE id = org_id);
    
    -- Backfill all tables
    UPDATE locations SET organization_id = org_id WHERE organization_id IS NULL;
    GET DIAGNOSTICS locations_count = ROW_COUNT;
    
    UPDATE square_existing_clients SET organization_id = org_id WHERE organization_id IS NULL;
    
    UPDATE team_members SET organization_id = org_id WHERE organization_id IS NULL;
    
    -- Note: service_variation (singular, not plural)
    UPDATE service_variation SET organization_id = org_id WHERE organization_id IS NULL;
    
    UPDATE bookings SET organization_id = org_id WHERE organization_id IS NULL;
    GET DIAGNOSTICS bookings_count = ROW_COUNT;
    
    UPDATE orders SET organization_id = org_id WHERE organization_id IS NULL;
    GET DIAGNOSTICS orders_count = ROW_COUNT;
    
    UPDATE order_line_items SET organization_id = org_id WHERE organization_id IS NULL;
    
    UPDATE payments SET organization_id = org_id WHERE organization_id IS NULL;
    GET DIAGNOSTICS payments_count = ROW_COUNT;
    
    UPDATE payment_tenders SET organization_id = org_id WHERE organization_id IS NULL;
    
    RAISE NOTICE '✅ Backfill complete!';
    RAISE NOTICE '   Locations: % rows', locations_count;
    RAISE NOTICE '   Bookings: % rows', bookings_count;
    RAISE NOTICE '   Orders: % rows', orders_count;
    RAISE NOTICE '   Payments: % rows', payments_count;
END $$;

-- Step 2: Verify all organization_id are populated
DO $$
DECLARE
    null_count INT;
BEGIN
    -- Check for NULL organization_id
    SELECT 
        (SELECT COUNT(*) FROM locations WHERE organization_id IS NULL) +
        (SELECT COUNT(*) FROM square_existing_clients WHERE organization_id IS NULL) +
        (SELECT COUNT(*) FROM team_members WHERE organization_id IS NULL) +
        (SELECT COUNT(*) FROM service_variation WHERE organization_id IS NULL) +
        (SELECT COUNT(*) FROM bookings WHERE organization_id IS NULL) +
        (SELECT COUNT(*) FROM orders WHERE organization_id IS NULL) +
        (SELECT COUNT(*) FROM order_line_items WHERE organization_id IS NULL) +
        (SELECT COUNT(*) FROM payments WHERE organization_id IS NULL) +
        (SELECT COUNT(*) FROM payment_tenders WHERE organization_id IS NULL)
    INTO null_count;
    
    IF null_count > 0 THEN
        RAISE WARNING 'Found % rows with NULL organization_id', null_count;
    ELSE
        RAISE NOTICE '✅ All organization_id values populated (0 NULLs)';
    END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verification queries
-- ============================================================================

-- 1. Check organization_id coverage
SELECT 
    'locations' AS table_name,
    COUNT(*) AS total_rows,
    COUNT(organization_id) AS org_id_populated,
    COUNT(*) - COUNT(organization_id) AS org_id_null
FROM locations
UNION ALL
SELECT 'square_existing_clients', COUNT(*), COUNT(organization_id), COUNT(*) - COUNT(organization_id) FROM square_existing_clients
UNION ALL
SELECT 'team_members', COUNT(*), COUNT(organization_id), COUNT(*) - COUNT(organization_id) FROM team_members
UNION ALL
SELECT 'service_variation', COUNT(*), COUNT(organization_id), COUNT(*) - COUNT(organization_id) FROM service_variation
UNION ALL
SELECT 'bookings', COUNT(*), COUNT(organization_id), COUNT(*) - COUNT(organization_id) FROM bookings
UNION ALL
SELECT 'orders', COUNT(*), COUNT(organization_id), COUNT(*) - COUNT(organization_id) FROM orders
UNION ALL
SELECT 'order_line_items', COUNT(*), COUNT(organization_id), COUNT(*) - COUNT(organization_id) FROM order_line_items
UNION ALL
SELECT 'payments', COUNT(*), COUNT(organization_id), COUNT(*) - COUNT(organization_id) FROM payments
UNION ALL
SELECT 'payment_tenders', COUNT(*), COUNT(organization_id), COUNT(*) - COUNT(organization_id) FROM payment_tenders
ORDER BY table_name;

-- 2. Verify all point to same organization
SELECT 
    table_name,
    COUNT(DISTINCT organization_id) AS unique_org_ids,
    string_agg(DISTINCT organization_id::text, ', ') AS org_ids
FROM (
    SELECT 'locations' AS table_name, organization_id::text FROM locations
    UNION ALL
    SELECT 'square_existing_clients', organization_id::text FROM square_existing_clients
    UNION ALL
    SELECT 'team_members', organization_id::text FROM team_members
    UNION ALL
    SELECT 'service_variation', organization_id::text FROM service_variation
    UNION ALL
    SELECT 'bookings', organization_id FROM bookings
    UNION ALL
    SELECT 'orders', organization_id FROM orders
    UNION ALL
    SELECT 'order_line_items', organization_id FROM order_line_items
    UNION ALL
    SELECT 'payments', organization_id FROM payments
    UNION ALL
    SELECT 'payment_tenders', organization_id FROM payment_tenders
) AS all_org_ids
GROUP BY table_name
ORDER BY table_name;

