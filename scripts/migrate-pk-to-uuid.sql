-- ============================================================================
-- MIGRATION: Square IDs → UUID Primary Keys + Add organization_id
-- ============================================================================
-- This migration:
-- 1. Migrates bookings.booking_id (Square ID) → bookings.id (UUID)
-- 2. Migrates orders.id (Square ID) → orders.id (UUID)
-- 3. Migrates payments.id (Square ID) → payments.id (UUID)
-- 4. Adds organization_id (nullable) to all tenant tables
--
-- IMPORTANT: Run validation queries before and after migration!
-- ============================================================================

BEGIN;

-- ============================================================================
-- PHASE 1: Migrate bookings.booking_id (Square ID) → bookings.id (UUID)
-- ============================================================================

-- Step 1.1: Add booking_id column and SAVE current booking_id
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_id_new TEXT;

-- Verify current state
DO $$
DECLARE
    total_count INT;
BEGIN
    SELECT COUNT(*) INTO total_count FROM bookings;
    RAISE NOTICE 'Total bookings: %', total_count;
END $$;

-- Copy: Save current booking_id to booking_id_new
UPDATE bookings 
SET booking_id_new = booking_id 
WHERE booking_id_new IS NULL;

-- Step 1.2: Create new UUID id column
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS id UUID;

-- Generate UUIDs
UPDATE bookings SET id = gen_random_uuid() WHERE id IS NULL;

-- Step 1.3: Create mapping table
CREATE TEMP TABLE booking_id_mapping AS
SELECT 
    booking_id AS old_square_id,
    id AS new_uuid_id,
    booking_id_new
FROM bookings;

-- Step 1.4: Update payments.booking_id (FK reference)
-- Drop FK constraint temporarily
DO $$
DECLARE
    fk_constraint TEXT;
BEGIN
    SELECT constraint_name INTO fk_constraint
    FROM information_schema.table_constraints
    WHERE table_name = 'payments'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name LIKE '%booking_id%';
    
    IF fk_constraint IS NOT NULL THEN
        RAISE NOTICE 'Dropping FK: %', fk_constraint;
        EXECUTE format('ALTER TABLE payments DROP CONSTRAINT IF EXISTS %I', fk_constraint);
    END IF;
END $$;

-- Add temp UUID column
ALTER TABLE payments ADD COLUMN IF NOT EXISTS booking_id_new UUID;

-- Update: Map Square booking_id → UUID id
UPDATE payments p
SET booking_id_new = bm.new_uuid_id
FROM booking_id_mapping bm
WHERE p.booking_id = bm.old_square_id;

-- Replace column
ALTER TABLE payments DROP COLUMN IF EXISTS booking_id;
ALTER TABLE payments RENAME COLUMN booking_id_new TO booking_id;

-- Step 1.5: Change PK and rename old column
-- First drop the old PK constraint
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_pkey;

-- Set new UUID id as PK
ALTER TABLE bookings ADD PRIMARY KEY (id);

-- Now safe to drop old booking_id column (was PK)
ALTER TABLE bookings DROP COLUMN IF EXISTS booking_id;

-- Rename: booking_id_new → booking_id (now this is Square booking ID, not PK)
ALTER TABLE bookings RENAME COLUMN booking_id_new TO booking_id;

-- Make booking_id NOT NULL (now this is Square ID, not PK)
ALTER TABLE bookings ALTER COLUMN booking_id SET NOT NULL;

-- Step 1.6: Clean up
DROP TABLE IF EXISTS booking_id_mapping;

-- ============================================================================
-- PHASE 2: Migrate orders.id (Square ID) → orders.id (UUID)
-- ============================================================================

-- Step 2.1: Add order_id column and SAVE current id
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_id_new TEXT;

UPDATE orders 
SET order_id_new = id 
WHERE order_id_new IS NULL;

-- Step 2.2: Create new UUID id column
ALTER TABLE orders ADD COLUMN IF NOT EXISTS id_new UUID;

UPDATE orders SET id_new = gen_random_uuid() WHERE id_new IS NULL;

-- Step 2.3: Create mapping
CREATE TEMP TABLE order_id_mapping AS
SELECT 
    id AS old_square_id,
    id_new AS new_uuid_id,
    order_id_new
FROM orders;

-- Step 2.4: Update order_line_items.order_id
DO $$
DECLARE
    fk_constraint TEXT;
BEGIN
    SELECT constraint_name INTO fk_constraint
    FROM information_schema.table_constraints
    WHERE table_name = 'order_line_items'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name LIKE '%order_id%';
    
    IF fk_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE order_line_items DROP CONSTRAINT IF EXISTS %I', fk_constraint);
    END IF;
END $$;

ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS order_id_new UUID;

UPDATE order_line_items oli
SET order_id_new = om.new_uuid_id
FROM order_id_mapping om
WHERE oli.order_id = om.old_square_id;

ALTER TABLE order_line_items DROP COLUMN IF EXISTS order_id;
ALTER TABLE order_line_items RENAME COLUMN order_id_new TO order_id;

-- Step 2.5: Update payments.order_id
DO $$
DECLARE
    fk_constraint TEXT;
BEGIN
    SELECT constraint_name INTO fk_constraint
    FROM information_schema.table_constraints
    WHERE table_name = 'payments'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name LIKE '%order_id%';
    
    IF fk_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE payments DROP CONSTRAINT IF EXISTS %I', fk_constraint);
    END IF;
END $$;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS order_id_new UUID;

UPDATE payments p
SET order_id_new = om.new_uuid_id
FROM order_id_mapping om
WHERE p.order_id = om.old_square_id;

ALTER TABLE payments DROP COLUMN IF EXISTS order_id;
ALTER TABLE payments RENAME COLUMN order_id_new TO order_id;

DROP TABLE IF EXISTS order_id_mapping;

-- Step 2.6: Change PK
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_pkey;

-- Drop old id column (was Square ID PK)
ALTER TABLE orders DROP COLUMN IF EXISTS id;

-- Rename id_new → id (now UUID)
ALTER TABLE orders RENAME COLUMN id_new TO id;
ALTER TABLE orders ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE orders ADD PRIMARY KEY (id);

-- Rename order_id_new → order_id (Square order ID)
ALTER TABLE orders RENAME COLUMN order_id_new TO order_id;
ALTER TABLE orders ALTER COLUMN order_id SET NOT NULL;

-- ============================================================================
-- PHASE 3: Migrate payments.id (Square ID) → payments.id (UUID)
-- ============================================================================

-- Step 3.1: Add payment_id column and SAVE current id
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_id_new TEXT;

UPDATE payments 
SET payment_id_new = id 
WHERE payment_id_new IS NULL;

-- Step 3.2: Create new UUID id column
ALTER TABLE payments ADD COLUMN IF NOT EXISTS id_new UUID;
UPDATE payments SET id_new = gen_random_uuid() WHERE id_new IS NULL;

-- Step 3.3: Create mapping
CREATE TEMP TABLE payment_id_mapping AS
SELECT 
    id AS old_square_id,
    id_new AS new_uuid_id,
    payment_id_new
FROM payments;

-- Step 3.4: Update payment_tenders.payment_id
DO $$
DECLARE
    fk_constraint TEXT;
BEGIN
    SELECT constraint_name INTO fk_constraint
    FROM information_schema.table_constraints
    WHERE table_name = 'payment_tenders'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name LIKE '%payment_id%';
    
    IF fk_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE payment_tenders DROP CONSTRAINT IF EXISTS %I', fk_constraint);
    END IF;
END $$;

ALTER TABLE payment_tenders ADD COLUMN IF NOT EXISTS payment_id_new UUID;

UPDATE payment_tenders pt
SET payment_id_new = pm.new_uuid_id
FROM payment_id_mapping pm
WHERE pt.payment_id = pm.old_square_id;

ALTER TABLE payment_tenders DROP COLUMN IF EXISTS payment_id;
ALTER TABLE payment_tenders RENAME COLUMN payment_id_new TO payment_id;

DROP TABLE IF EXISTS payment_id_mapping;

-- Step 3.5: Change PK
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_pkey;

-- Drop old id column (was Square ID PK)
ALTER TABLE payments DROP COLUMN IF EXISTS id;

-- Rename id_new → id (now UUID)
ALTER TABLE payments RENAME COLUMN id_new TO id;
ALTER TABLE payments ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE payments ADD PRIMARY KEY (id);

-- Rename payment_id_new → payment_id (Square payment ID)
ALTER TABLE payments RENAME COLUMN payment_id_new TO payment_id;
ALTER TABLE payments ALTER COLUMN payment_id SET NOT NULL;

-- ============================================================================
-- PHASE 4: Add organization_id (nullable) to all tenant tables
-- ============================================================================

-- Core reference tables
ALTER TABLE locations ADD COLUMN IF NOT EXISTS organization_id UUID;
-- Note: customers table may not exist (deprecated)
-- ALTER TABLE customers ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE square_existing_clients ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS organization_id UUID;
-- Note: service_variations table may not exist
-- ALTER TABLE service_variations ADD COLUMN IF NOT EXISTS organization_id UUID;

-- Business entity tables (now with UUID PKs)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE payment_tenders ADD COLUMN IF NOT EXISTS organization_id UUID;

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES (run after migration)
-- ============================================================================

-- 1. Verify all PKs are now UUID
SELECT 
    table_name,
    column_name,
    data_type,
    column_default
FROM information_schema.columns
WHERE table_name IN ('bookings', 'orders', 'payments')
AND column_name = 'id'
ORDER BY table_name;

-- 2. Verify Square IDs are saved with correct names
SELECT 
    'bookings' AS table_name,
    COUNT(*) AS total,
    COUNT(booking_id) AS has_booking_id
FROM bookings
UNION ALL
SELECT 
    'orders',
    COUNT(*),
    COUNT(order_id)
FROM orders
UNION ALL
SELECT 
    'payments',
    COUNT(*),
    COUNT(payment_id)
FROM payments;

-- 3. Verify organization_id columns exist (all nullable)
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE column_name = 'organization_id'
AND table_schema = 'public'
ORDER BY table_name;

