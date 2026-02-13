-- ============================================================================
-- Verify organization_id column types in database
-- This script checks if organization_id columns are UUID type (as they should be)
-- ============================================================================

SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable,
    CASE 
        WHEN data_type = 'uuid' THEN '✅ CORRECT'
        WHEN data_type = 'text' THEN '❌ WRONG - Should be UUID'
        ELSE '⚠️ UNEXPECTED TYPE'
    END as status
FROM information_schema.columns
WHERE column_name = 'organization_id'
  AND table_schema = 'public'
ORDER BY 
    CASE 
        WHEN data_type = 'uuid' THEN 1
        WHEN data_type = 'text' THEN 2
        ELSE 3
    END,
    table_name;

-- Summary
SELECT 
    data_type,
    COUNT(*) as count,
    STRING_AGG(table_name, ', ' ORDER BY table_name) as tables
FROM information_schema.columns
WHERE column_name = 'organization_id'
  AND table_schema = 'public'
GROUP BY data_type
ORDER BY data_type;

