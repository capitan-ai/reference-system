-- ============================================================================
-- MIGRATION: Convert FK columns from Square IDs (TEXT) to Internal UUIDs
-- ============================================================================
-- This migration:
-- 1. Drops old FK constraints that reference Square IDs
-- 2. Creates mapping tables (Square ID → UUID)
-- 3. Updates all FK columns with UUID values
-- 4. Alters column types from TEXT to UUID
-- 5. Adds new FK constraints referencing internal UUID PKs
--
-- IMPORTANT: Run validation queries before and after migration!
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Drop old FK constraints that reference Square IDs
-- ============================================================================

-- Bookings
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_location_id_fkey;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_technician_id_fkey;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_administrator_id_fkey;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_service_variation_id_fkey;

-- Order Line Items
ALTER TABLE order_line_items DROP CONSTRAINT IF EXISTS order_line_items_technician_id_fkey;
ALTER TABLE order_line_items DROP CONSTRAINT IF EXISTS order_line_items_administrator_id_fkey;

-- Payments
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_location_id_fkey;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_administrator_id_fkey;

DO $$ BEGIN
    RAISE NOTICE '✅ Dropped old FK constraints';
END $$;

-- ============================================================================
-- STEP 2: Create mapping tables (Square ID → UUID)
-- ============================================================================

-- Location mapping: square_location_id → id (UUID)
CREATE TEMP TABLE location_id_mapping (
    square_id TEXT,
    uuid_id UUID
);
INSERT INTO location_id_mapping
SELECT 
    square_location_id,
    id
FROM locations;

-- Team Member mapping: square_team_member_id → id (UUID)
CREATE TEMP TABLE team_member_id_mapping (
    square_id TEXT,
    uuid_id UUID
);
INSERT INTO team_member_id_mapping
SELECT 
    square_team_member_id,
    id
FROM team_members;

-- Service Variation mapping: square_variation_id → uuid (UUID PK)
CREATE TEMP TABLE service_variation_id_mapping (
    square_id TEXT,
    uuid_id UUID
);
INSERT INTO service_variation_id_mapping
SELECT 
    square_variation_id,
    uuid
FROM service_variation;

-- Verify mappings
DO $$
DECLARE
    location_count INT;
    team_member_count INT;
    service_variation_count INT;
BEGIN
    SELECT COUNT(*) INTO location_count FROM location_id_mapping;
    SELECT COUNT(*) INTO team_member_count FROM team_member_id_mapping;
    SELECT COUNT(*) INTO service_variation_count FROM service_variation_id_mapping;
    
    RAISE NOTICE '✅ Created mapping tables:';
    RAISE NOTICE '   Locations: %', location_count;
    RAISE NOTICE '   Team Members: %', team_member_count;
    RAISE NOTICE '   Service Variations: %', service_variation_count;
END $$;

-- ============================================================================
-- STEP 3: Add temporary UUID columns
-- ============================================================================

-- Bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS location_id_new UUID;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_variation_id_new UUID;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS technician_id_new UUID;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS administrator_id_new UUID;

-- Order Line Items (order_id already UUID, skip)
ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS technician_id_new UUID;
ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS administrator_id_new UUID;

-- Payments (order_id and booking_id already UUID, skip)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS location_id_new UUID;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS administrator_id_new UUID;

DO $$ BEGIN
    RAISE NOTICE '✅ Added temporary UUID columns';
END $$;

-- ============================================================================
-- STEP 4: Populate temporary UUID columns using mappings
-- ============================================================================

-- Bookings: location_id
UPDATE bookings b
SET location_id_new = m.uuid_id
FROM location_id_mapping m
WHERE b.location_id = m.square_id;

-- Bookings: service_variation_id
UPDATE bookings b
SET service_variation_id_new = m.uuid_id
FROM service_variation_id_mapping m
WHERE b.service_variation_id = m.square_id;

-- Bookings: technician_id
UPDATE bookings b
SET technician_id_new = m.uuid_id
FROM team_member_id_mapping m
WHERE b.technician_id = m.square_id;

-- Bookings: administrator_id
UPDATE bookings b
SET administrator_id_new = m.uuid_id
FROM team_member_id_mapping m
WHERE b.administrator_id = m.square_id;

-- Order Line Items: technician_id
UPDATE order_line_items oli
SET technician_id_new = m.uuid_id
FROM team_member_id_mapping m
WHERE oli.technician_id = m.square_id;

-- Order Line Items: administrator_id
UPDATE order_line_items oli
SET administrator_id_new = m.uuid_id
FROM team_member_id_mapping m
WHERE oli.administrator_id = m.square_id;

-- Payments: location_id
UPDATE payments p
SET location_id_new = m.uuid_id
FROM location_id_mapping m
WHERE p.location_id = m.square_id;

-- Payments: administrator_id
UPDATE payments p
SET administrator_id_new = m.uuid_id
FROM team_member_id_mapping m
WHERE p.administrator_id = m.square_id;

-- Verify updates
DO $$
DECLARE
    bookings_location_count INT;
    bookings_service_count INT;
    bookings_technician_count INT;
    bookings_admin_count INT;
    oli_technician_count INT;
    oli_admin_count INT;
    payments_location_count INT;
    payments_admin_count INT;
BEGIN
    SELECT COUNT(*) INTO bookings_location_count FROM bookings WHERE location_id_new IS NOT NULL;
    SELECT COUNT(*) INTO bookings_service_count FROM bookings WHERE service_variation_id_new IS NOT NULL;
    SELECT COUNT(*) INTO bookings_technician_count FROM bookings WHERE technician_id_new IS NOT NULL;
    SELECT COUNT(*) INTO bookings_admin_count FROM bookings WHERE administrator_id_new IS NOT NULL;
    SELECT COUNT(*) INTO oli_technician_count FROM order_line_items WHERE technician_id_new IS NOT NULL;
    SELECT COUNT(*) INTO oli_admin_count FROM order_line_items WHERE administrator_id_new IS NOT NULL;
    SELECT COUNT(*) INTO payments_location_count FROM payments WHERE location_id_new IS NOT NULL;
    SELECT COUNT(*) INTO payments_admin_count FROM payments WHERE administrator_id_new IS NOT NULL;
    
    RAISE NOTICE '✅ Updated temporary UUID columns:';
    RAISE NOTICE '   Bookings location_id: %', bookings_location_count;
    RAISE NOTICE '   Bookings service_variation_id: %', bookings_service_count;
    RAISE NOTICE '   Bookings technician_id: %', bookings_technician_count;
    RAISE NOTICE '   Bookings administrator_id: %', bookings_admin_count;
    RAISE NOTICE '   Order Line Items technician_id: %', oli_technician_count;
    RAISE NOTICE '   Order Line Items administrator_id: %', oli_admin_count;
    RAISE NOTICE '   Payments location_id: %', payments_location_count;
    RAISE NOTICE '   Payments administrator_id: %', payments_admin_count;
END $$;

-- ============================================================================
-- STEP 5: Check for unmapped values (orphaned references)
-- ============================================================================

DO $$
DECLARE
    unmapped_count INT;
BEGIN
    SELECT 
        (SELECT COUNT(*) FROM bookings WHERE location_id IS NOT NULL AND location_id_new IS NULL) +
        (SELECT COUNT(*) FROM bookings WHERE service_variation_id IS NOT NULL AND service_variation_id_new IS NULL) +
        (SELECT COUNT(*) FROM bookings WHERE technician_id IS NOT NULL AND technician_id_new IS NULL) +
        (SELECT COUNT(*) FROM bookings WHERE administrator_id IS NOT NULL AND administrator_id_new IS NULL) +
        (SELECT COUNT(*) FROM order_line_items WHERE technician_id IS NOT NULL AND technician_id_new IS NULL) +
        (SELECT COUNT(*) FROM order_line_items WHERE administrator_id IS NOT NULL AND administrator_id_new IS NULL) +
        (SELECT COUNT(*) FROM payments WHERE location_id IS NOT NULL AND location_id_new IS NULL) +
        (SELECT COUNT(*) FROM payments WHERE administrator_id IS NOT NULL AND administrator_id_new IS NULL)
    INTO unmapped_count;
    
    IF unmapped_count > 0 THEN
        RAISE WARNING '⚠️ Found % unmapped values (orphaned references). These will be set to NULL.', unmapped_count;
        
        -- Show details
        RAISE NOTICE 'Unmapped bookings.location_id: %', (SELECT COUNT(*) FROM bookings WHERE location_id IS NOT NULL AND location_id_new IS NULL);
        RAISE NOTICE 'Unmapped bookings.service_variation_id: %', (SELECT COUNT(*) FROM bookings WHERE service_variation_id IS NOT NULL AND service_variation_id_new IS NULL);
        RAISE NOTICE 'Unmapped bookings.technician_id: %', (SELECT COUNT(*) FROM bookings WHERE technician_id IS NOT NULL AND technician_id_new IS NULL);
        RAISE NOTICE 'Unmapped bookings.administrator_id: %', (SELECT COUNT(*) FROM bookings WHERE administrator_id IS NOT NULL AND administrator_id_new IS NULL);
        RAISE NOTICE 'Unmapped order_line_items.technician_id: %', (SELECT COUNT(*) FROM order_line_items WHERE technician_id IS NOT NULL AND technician_id_new IS NULL);
        RAISE NOTICE 'Unmapped order_line_items.administrator_id: %', (SELECT COUNT(*) FROM order_line_items WHERE administrator_id IS NOT NULL AND administrator_id_new IS NULL);
        RAISE NOTICE 'Unmapped payments.location_id: %', (SELECT COUNT(*) FROM payments WHERE location_id IS NOT NULL AND location_id_new IS NULL);
        RAISE NOTICE 'Unmapped payments.administrator_id: %', (SELECT COUNT(*) FROM payments WHERE administrator_id IS NOT NULL AND administrator_id_new IS NULL);
    ELSE
        RAISE NOTICE '✅ All values mapped successfully (0 unmapped)';
    END IF;
END $$;

-- ============================================================================
-- STEP 6: Drop old TEXT columns and rename new UUID columns
-- ============================================================================

-- Bookings
ALTER TABLE bookings DROP COLUMN IF EXISTS location_id;
ALTER TABLE bookings RENAME COLUMN location_id_new TO location_id;

ALTER TABLE bookings DROP COLUMN IF EXISTS service_variation_id;
ALTER TABLE bookings RENAME COLUMN service_variation_id_new TO service_variation_id;

ALTER TABLE bookings DROP COLUMN IF EXISTS technician_id;
ALTER TABLE bookings RENAME COLUMN technician_id_new TO technician_id;

ALTER TABLE bookings DROP COLUMN IF EXISTS administrator_id;
ALTER TABLE bookings RENAME COLUMN administrator_id_new TO administrator_id;

-- Order Line Items
ALTER TABLE order_line_items DROP COLUMN IF EXISTS technician_id;
ALTER TABLE order_line_items RENAME COLUMN technician_id_new TO technician_id;

ALTER TABLE order_line_items DROP COLUMN IF EXISTS administrator_id;
ALTER TABLE order_line_items RENAME COLUMN administrator_id_new TO administrator_id;

-- Payments
ALTER TABLE payments DROP COLUMN IF EXISTS location_id;
ALTER TABLE payments RENAME COLUMN location_id_new TO location_id;

ALTER TABLE payments DROP COLUMN IF EXISTS administrator_id;
ALTER TABLE payments RENAME COLUMN administrator_id_new TO administrator_id;

DO $$ BEGIN
    RAISE NOTICE '✅ Replaced TEXT columns with UUID columns';
END $$;

-- ============================================================================
-- STEP 7: Set NOT NULL constraints where needed
-- ============================================================================

-- Bookings.location_id is NOT NULL in schema
ALTER TABLE bookings ALTER COLUMN location_id SET NOT NULL;

-- Payments.location_id is NOT NULL in schema
ALTER TABLE payments ALTER COLUMN location_id SET NOT NULL;

DO $$ BEGIN
    RAISE NOTICE '✅ Set NOT NULL constraints';
END $$;

-- ============================================================================
-- STEP 8: Add new FK constraints referencing internal UUID PKs
-- ============================================================================

-- Bookings
ALTER TABLE bookings 
    ADD CONSTRAINT bookings_location_id_fkey 
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT;

ALTER TABLE bookings 
    ADD CONSTRAINT bookings_service_variation_id_fkey 
    FOREIGN KEY (service_variation_id) REFERENCES service_variation(uuid) ON DELETE RESTRICT;

ALTER TABLE bookings 
    ADD CONSTRAINT bookings_technician_id_fkey 
    FOREIGN KEY (technician_id) REFERENCES team_members(id) ON DELETE RESTRICT;

ALTER TABLE bookings 
    ADD CONSTRAINT bookings_administrator_id_fkey 
    FOREIGN KEY (administrator_id) REFERENCES team_members(id) ON DELETE RESTRICT;

-- Order Line Items
ALTER TABLE order_line_items 
    ADD CONSTRAINT order_line_items_technician_id_fkey 
    FOREIGN KEY (technician_id) REFERENCES team_members(id) ON DELETE RESTRICT;

ALTER TABLE order_line_items 
    ADD CONSTRAINT order_line_items_administrator_id_fkey 
    FOREIGN KEY (administrator_id) REFERENCES team_members(id) ON DELETE RESTRICT;

-- Payments
ALTER TABLE payments 
    ADD CONSTRAINT payments_location_id_fkey 
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT;

ALTER TABLE payments 
    ADD CONSTRAINT payments_administrator_id_fkey 
    FOREIGN KEY (administrator_id) REFERENCES team_members(id) ON DELETE RESTRICT;

DO $$ BEGIN
    RAISE NOTICE '✅ Added new FK constraints referencing internal UUID PKs';
END $$;

COMMIT;

-- ============================================================================
-- Verification queries
-- ============================================================================

-- Check column types
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE (table_name = 'bookings' AND column_name IN ('location_id', 'service_variation_id', 'technician_id', 'administrator_id'))
   OR (table_name = 'order_line_items' AND column_name IN ('order_id', 'technician_id', 'administrator_id'))
   OR (table_name = 'payments' AND column_name IN ('location_id', 'order_id', 'booking_id', 'administrator_id'))
ORDER BY table_name, column_name;

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
AND (
    (tc.table_name = 'bookings' AND kcu.column_name IN ('location_id', 'service_variation_id', 'technician_id', 'administrator_id'))
    OR (tc.table_name = 'order_line_items' AND kcu.column_name IN ('order_id', 'technician_id', 'administrator_id'))
    OR (tc.table_name = 'payments' AND kcu.column_name IN ('location_id', 'order_id', 'booking_id', 'administrator_id'))
)
ORDER BY tc.table_name, kcu.column_name;

