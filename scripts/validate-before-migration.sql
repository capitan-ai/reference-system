-- ============================================================================
-- VALIDATION QUERIES: Run BEFORE migration
-- ============================================================================
-- Use these to verify current state before running migration
-- ============================================================================

-- 1. Check current PK types
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name IN ('bookings', 'orders', 'payments')
AND (
    (table_name = 'bookings' AND column_name = 'booking_id') OR
    (table_name IN ('orders', 'payments') AND column_name = 'id')
)
ORDER BY table_name, column_name;

-- 2. Count rows in each table
SELECT 
    'bookings' AS table_name,
    COUNT(*) AS row_count,
    COUNT(DISTINCT booking_id) AS unique_ids
FROM bookings
UNION ALL
SELECT 
    'orders',
    COUNT(*),
    COUNT(DISTINCT id)
FROM orders
UNION ALL
SELECT 
    'payments',
    COUNT(*),
    COUNT(DISTINCT id)
FROM payments;

-- 3. Check FK relationships
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
AND (
    ccu.table_name IN ('bookings', 'orders', 'payments')
    OR (tc.table_name = 'payments' AND kcu.column_name = 'booking_id')
    OR (tc.table_name = 'order_line_items' AND kcu.column_name = 'order_id')
    OR (tc.table_name = 'payment_tenders' AND kcu.column_name = 'payment_id')
)
ORDER BY tc.table_name, kcu.column_name;

-- 4. Check for NULL values in PK columns (should be 0)
SELECT 
    'bookings.booking_id NULLs' AS check_name,
    COUNT(*) FILTER (WHERE booking_id IS NULL) AS null_count
FROM bookings
UNION ALL
SELECT 
    'orders.id NULLs',
    COUNT(*) FILTER (WHERE id IS NULL)
FROM orders
UNION ALL
SELECT 
    'payments.id NULLs',
    COUNT(*) FILTER (WHERE id IS NULL)
FROM payments;

