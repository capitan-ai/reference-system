-- ============================================================================
-- Пошаговая инструкция: Создание первого Super Admin
-- ============================================================================

-- ШАГ 1: Найдите User ID в Supabase Auth
-- Вариант A: Через Supabase Dashboard
--   1. Откройте https://app.supabase.com
--   2. Выберите проект
--   3. Authentication > Users
--   4. Найдите пользователя и скопируйте UUID

-- Вариант B: Через SQL (если есть доступ к auth.users)
-- SELECT id, email FROM auth.users WHERE email = 'your-email@example.com';

-- ШАГ 2: Вставьте запись super admin
-- Замените '<YOUR_USER_ID>' на реальный UUID из шага 1

INSERT INTO organization_users (user_id, organization_id, role, is_primary)
VALUES (
  '<YOUR_USER_ID>',  -- Замените на реальный UUID из Supabase Auth
  NULL,              -- Super admin не привязан к организации
  'super_admin',
  false
);

-- ШАГ 3: Проверьте, что super admin создан
SELECT 
    ou.id,
    ou.user_id,
    u.email,
    ou.role,
    ou.organization_id,
    ou.created_at
FROM organization_users ou
LEFT JOIN auth.users u ON ou.user_id = u.id
WHERE ou.role = 'super_admin';

-- Если вы видите вашу запись - super admin создан успешно! ✅



