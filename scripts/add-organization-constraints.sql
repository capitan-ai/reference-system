-- ============================================================================
-- Add organization_id constraints: NOT NULL + Foreign Keys
-- ============================================================================
-- This script:
-- 1. Makes organization_id NOT NULL in all tenant tables
-- 2. Adds foreign key constraints to organizations table
-- ============================================================================

BEGIN;

-- Step 1: Make organization_id NOT NULL
-- Verify all are populated first
DO $$
DECLARE
    null_count INT;
BEGIN
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
        RAISE EXCEPTION 'Cannot set NOT NULL: Found % rows with NULL organization_id', null_count;
    END IF;
    
    RAISE NOTICE '✅ All organization_id values are populated (0 NULLs)';
END $$;

-- Make NOT NULL
ALTER TABLE locations ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE square_existing_clients ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE team_members ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE service_variation ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bookings ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE orders ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE order_line_items ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE payments ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE payment_tenders ALTER COLUMN organization_id SET NOT NULL;

-- Step 2: Add foreign key constraints
-- Organizations → Locations
ALTER TABLE locations 
    ADD CONSTRAINT locations_organization_id_fkey 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- Organizations → Square Existing Clients
ALTER TABLE square_existing_clients 
    ADD CONSTRAINT square_existing_clients_organization_id_fkey 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- Organizations → Team Members
ALTER TABLE team_members 
    ADD CONSTRAINT team_members_organization_id_fkey 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- Organizations → Service Variations
ALTER TABLE service_variation 
    ADD CONSTRAINT service_variation_organization_id_fkey 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- Organizations → Bookings
ALTER TABLE bookings 
    ADD CONSTRAINT bookings_organization_id_fkey 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- Organizations → Orders
ALTER TABLE orders 
    ADD CONSTRAINT orders_organization_id_fkey 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- Organizations → Order Line Items
ALTER TABLE order_line_items 
    ADD CONSTRAINT order_line_items_organization_id_fkey 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- Organizations → Payments
ALTER TABLE payments 
    ADD CONSTRAINT payments_organization_id_fkey 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- Organizations → Payment Tenders
ALTER TABLE payment_tenders 
    ADD CONSTRAINT payment_tenders_organization_id_fkey 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

COMMIT;

-- ============================================================================
-- Verification
-- ============================================================================

-- 1. Verify NOT NULL constraints
SELECT 
    table_name,
    column_name,
    is_nullable,
    data_type
FROM information_schema.columns
WHERE column_name = 'organization_id'
AND table_schema = 'public'
ORDER BY table_name;

-- 2. Verify foreign key constraints
SELECT 
    tc.table_name AS fk_table,
    kcu.column_name AS fk_column,
    ccu.table_name AS referenced_table,
    ccu.column_name AS referenced_column,
    tc.constraint_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
AND ccu.table_name = 'organizations'
ORDER BY tc.table_name, kcu.column_name;

-- 3. Verify no orphaned rows
SELECT 
    'locations' AS check_name,
    COUNT(*) AS orphaned_count
FROM locations l
LEFT JOIN organizations o ON l.organization_id = o.id
WHERE o.id IS NULL
UNION ALL
SELECT 'bookings', COUNT(*)
FROM bookings b
LEFT JOIN organizations o ON b.organization_id = o.id
WHERE o.id IS NULL
UNION ALL
SELECT 'orders', COUNT(*)
FROM orders o
LEFT JOIN organizations org ON o.organization_id = org.id
WHERE org.id IS NULL
UNION ALL
SELECT 'payments', COUNT(*)
FROM payments p
LEFT JOIN organizations o ON p.organization_id = o.id
WHERE o.id IS NULL;

