-- ============================================================================
-- MIGRATION: Fix orders_location_id_fkey Foreign Key Constraint
-- ============================================================================
-- This migration fixes the foreign key constraint that incorrectly points to
-- locations.square_location_id instead of locations.id
--
-- Problem:
--   - Current: orders.location_id → locations.square_location_id (WRONG)
--   - Should be: orders.location_id → locations.id (CORRECT)
--
-- This causes FK violations because:
--   - orders.location_id stores UUIDs (from locations.id)
--   - But constraint checks against locations.square_location_id (Square IDs)
--   - UUIDs don't match Square IDs, causing P2003 errors
--
-- IMPORTANT: Run validation queries before and after migration!
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Verify current constraint state
-- ============================================================================

DO $$
DECLARE
    current_ref_table TEXT;
    current_ref_column TEXT;
BEGIN
    SELECT 
        ccu.table_name,
        ccu.column_name
    INTO 
        current_ref_table,
        current_ref_column
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.constraint_name = 'orders_location_id_fkey';
    
    IF current_ref_table IS NULL THEN
        RAISE EXCEPTION 'Constraint orders_location_id_fkey not found!';
    END IF;
    
    RAISE NOTICE 'Current FK constraint:';
    RAISE NOTICE '  orders.location_id → %.%', current_ref_table, current_ref_column;
    
    IF current_ref_table = 'locations' AND current_ref_column = 'id' THEN
        RAISE NOTICE '✅ Constraint is already correct! No migration needed.';
        RAISE NOTICE 'Rolling back transaction...';
        ROLLBACK;
        RETURN;
    END IF;
    
    IF current_ref_table != 'locations' OR current_ref_column != 'square_location_id' THEN
        RAISE WARNING 'Unexpected constraint target: %.%', current_ref_table, current_ref_column;
        RAISE WARNING 'Expected: locations.square_location_id';
    END IF;
END $$;

-- ============================================================================
-- STEP 2: Check for orphaned records (orders with location_id not in locations.id)
-- ============================================================================

DO $$
DECLARE
    orphaned_count INT;
BEGIN
    SELECT COUNT(*)
    INTO orphaned_count
    FROM orders o
    WHERE o.location_id IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM locations l WHERE l.id = o.location_id
        );
    
    IF orphaned_count > 0 THEN
        RAISE WARNING '⚠️  Found % orphaned orders with location_id not in locations.id', orphaned_count;
        RAISE NOTICE 'These records will cause FK violations after migration.';
        RAISE NOTICE 'Consider fixing these records before proceeding.';
    ELSE
        RAISE NOTICE '✅ No orphaned records found. All orders.location_id values exist in locations.id';
    END IF;
END $$;

-- ============================================================================
-- STEP 3: Drop the incorrect constraint
-- ============================================================================

ALTER TABLE orders 
    DROP CONSTRAINT IF EXISTS orders_location_id_fkey;

DO $$ BEGIN
    RAISE NOTICE '✅ Dropped incorrect FK constraint: orders_location_id_fkey';
END $$;

-- ============================================================================
-- STEP 4: Create the correct constraint pointing to locations.id
-- ============================================================================

ALTER TABLE orders 
    ADD CONSTRAINT orders_location_id_fkey 
    FOREIGN KEY (location_id) 
    REFERENCES locations(id) 
    ON DELETE RESTRICT;

DO $$ BEGIN
    RAISE NOTICE '✅ Created correct FK constraint: orders.location_id → locations.id';
END $$;

-- ============================================================================
-- STEP 5: Verify the new constraint
-- ============================================================================

DO $$
DECLARE
    new_ref_table TEXT;
    new_ref_column TEXT;
BEGIN
    SELECT 
        ccu.table_name,
        ccu.column_name
    INTO 
        new_ref_table,
        new_ref_column
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.constraint_name = 'orders_location_id_fkey';
    
    IF new_ref_table IS NULL THEN
        RAISE EXCEPTION 'Failed to verify new constraint!';
    END IF;
    
    IF new_ref_table = 'locations' AND new_ref_column = 'id' THEN
        RAISE NOTICE '✅ Verification successful:';
        RAISE NOTICE '  orders.location_id → %.%', new_ref_table, new_ref_column;
    ELSE
        RAISE EXCEPTION 'Verification failed! Constraint points to %.% instead of locations.id', 
            new_ref_table, new_ref_column;
    END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verification queries (run after migration)
-- ============================================================================

-- Verify constraint points to correct table/column
SELECT
    tc.constraint_name,
    tc.table_name AS source_table,
    kcu.column_name AS source_column,
    ccu.table_name AS referenced_table,
    ccu.column_name AS referenced_column
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.constraint_name = 'orders_location_id_fkey';

-- Check for any FK violations (should return 0 rows)
SELECT COUNT(*) as orphaned_orders
FROM orders o
WHERE o.location_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM locations l WHERE l.id = o.location_id
    );

