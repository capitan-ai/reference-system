-- ============================================================================
-- Fix PK column types: locations.id and team_members.id from TEXT to UUID
-- ============================================================================
-- These tables already have UUID values, just need to change the column type
-- ============================================================================

BEGIN;

-- Locations: Change id from TEXT to UUID
ALTER TABLE locations ALTER COLUMN id TYPE UUID USING id::uuid;

-- Team Members: Change id from TEXT to UUID
ALTER TABLE team_members ALTER COLUMN id TYPE UUID USING id::uuid;

COMMIT;

-- Verification
SELECT 
    table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE (table_name = 'locations' AND column_name = 'id')
   OR (table_name = 'team_members' AND column_name = 'id');

