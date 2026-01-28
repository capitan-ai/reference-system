-- ============================================================================
-- Create First Super Admin
-- ============================================================================
-- Run this script after creating a user in Supabase Auth
-- Replace <SUPABASE_USER_ID> with actual user ID from Supabase Auth
-- ============================================================================
--
-- To get user ID:
-- 1. Go to Supabase Dashboard > Authentication > Users
-- 2. Find your user and copy the UUID
-- 3. Replace <SUPABASE_USER_ID> below
--
-- ============================================================================

-- Example usage:
-- INSERT INTO organization_users (user_id, organization_id, role, is_primary)
-- VALUES ('<SUPABASE_USER_ID>', NULL, 'super_admin', false);

-- Or use this query to find user by email first:
-- SELECT id, email FROM auth.users WHERE email = 'your-email@example.com';

-- Then insert:
-- INSERT INTO organization_users (user_id, organization_id, role, is_primary)
-- VALUES (
--   (SELECT id FROM auth.users WHERE email = 'your-email@example.com'),
--   NULL,
--   'super_admin',
--   false
-- );

-- ============================================================================
-- Verification
-- ============================================================================

-- Check super admins
SELECT 
    ou.id,
    ou.user_id,
    u.email,
    ou.role,
    ou.created_at
FROM organization_users ou
LEFT JOIN auth.users u ON ou.user_id = u.id
WHERE ou.role = 'super_admin';



