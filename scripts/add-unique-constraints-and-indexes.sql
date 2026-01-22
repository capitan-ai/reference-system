-- ============================================================================
-- Add UNIQUE constraints and indexes for multi-tenant architecture
-- ============================================================================

BEGIN;

-- ============================================================================
-- UNIQUE CONSTRAINTS: organization_id + square_*_id
-- ============================================================================

-- Locations: UNIQUE (organization_id, square_location_id)
ALTER TABLE locations 
    ADD CONSTRAINT locations_organization_square_location_unique 
    UNIQUE (organization_id, square_location_id);

-- Square Existing Clients: UNIQUE (organization_id, square_customer_id)
ALTER TABLE square_existing_clients 
    ADD CONSTRAINT square_existing_clients_organization_square_customer_unique 
    UNIQUE (organization_id, square_customer_id);

-- Team Members: UNIQUE (organization_id, square_team_member_id)
ALTER TABLE team_members 
    ADD CONSTRAINT team_members_organization_square_team_member_unique 
    UNIQUE (organization_id, square_team_member_id);

-- Service Variations: UNIQUE (organization_id, id)
-- Note: service_variation uses 'id' as Square service variation ID (check schema)
-- First check if there's a square_id column, if not use id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'service_variation' AND column_name = 'square_id'
    ) THEN
        ALTER TABLE service_variation 
            ADD CONSTRAINT service_variation_organization_square_id_unique 
            UNIQUE (organization_id, square_id);
    ELSE
        -- If no square_id, the id column might be the Square ID
        -- Skip UNIQUE constraint for now - need to verify schema
        RAISE NOTICE 'service_variation: No square_id column found, skipping UNIQUE constraint';
    END IF;
END $$;

-- Bookings: UNIQUE (organization_id, booking_id)
-- Note: booking_id is now Square booking ID (not PK)
ALTER TABLE bookings 
    ADD CONSTRAINT bookings_organization_booking_id_unique 
    UNIQUE (organization_id, booking_id);

-- Orders: UNIQUE (organization_id, order_id)
-- Note: order_id is now Square order ID (not PK)
ALTER TABLE orders 
    ADD CONSTRAINT orders_organization_order_id_unique 
    UNIQUE (organization_id, order_id);

-- Order Line Items: UNIQUE (organization_id, uid) where uid IS NOT NULL
-- Drop old global unique if exists
ALTER TABLE order_line_items 
    DROP CONSTRAINT IF EXISTS order_line_items_uid_key;

-- Add organization-scoped unique (NULLs excluded)
CREATE UNIQUE INDEX order_line_items_organization_uid_unique 
    ON order_line_items (organization_id, uid) 
    WHERE uid IS NOT NULL;

-- Payments: UNIQUE (organization_id, payment_id)
-- Note: payment_id is now Square payment ID (not PK)
ALTER TABLE payments 
    ADD CONSTRAINT payments_organization_payment_id_unique 
    UNIQUE (organization_id, payment_id);

-- ============================================================================
-- PERFORMANCE INDEXES
-- ============================================================================

-- Organization_id indexes (critical for RLS and multi-tenant queries)
CREATE INDEX IF NOT EXISTS idx_locations_organization_id ON locations(organization_id);
CREATE INDEX IF NOT EXISTS idx_square_existing_clients_organization_id ON square_existing_clients(organization_id);
CREATE INDEX IF NOT EXISTS idx_team_members_organization_id ON team_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_service_variation_organization_id ON service_variation(organization_id);
CREATE INDEX IF NOT EXISTS idx_bookings_organization_id ON bookings(organization_id);
CREATE INDEX IF NOT EXISTS idx_orders_organization_id ON orders(organization_id);
CREATE INDEX IF NOT EXISTS idx_order_line_items_organization_id ON order_line_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_payments_organization_id ON payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_payment_tenders_organization_id ON payment_tenders(organization_id);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_bookings_organization_location ON bookings(organization_id, location_id);
CREATE INDEX IF NOT EXISTS idx_orders_organization_location ON orders(organization_id, location_id);
CREATE INDEX IF NOT EXISTS idx_payments_organization_location ON payments(organization_id, location_id);
CREATE INDEX IF NOT EXISTS idx_payments_organization_order ON payments(organization_id, order_id);

-- Square ID lookup indexes (for external ID → internal ID lookups)
CREATE INDEX IF NOT EXISTS idx_bookings_booking_id ON bookings(booking_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_id ON payments(payment_id);

COMMIT;

-- ============================================================================
-- Verification
-- ============================================================================

-- 1. Verify UNIQUE constraints
SELECT 
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.constraint_name LIKE '%organization%unique%'
AND tc.constraint_type = 'UNIQUE'
ORDER BY tc.table_name;

-- 2. Verify indexes
SELECT 
    schemaname,
    tablename,
    indexname
FROM pg_indexes
WHERE indexname LIKE 'idx_%organization%'
   OR indexname LIKE '%organization%unique%'
ORDER BY tablename, indexname;

-- 3. Verify UNIQUE constraint on order_line_items (partial index)
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE indexname = 'order_line_items_organization_uid_unique';

