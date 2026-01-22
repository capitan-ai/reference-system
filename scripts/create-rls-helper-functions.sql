-- scripts/create-rls-helper-functions.sql
-- Создать helper функции для проверки доступа в RLS политиках

-- Функция: проверка, является ли пользователь super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin(check_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = check_user_id
    AND user_roles.role = 'super_admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Функция: проверка доступа к организации
CREATE OR REPLACE FUNCTION public.has_org_access(
  check_user_id UUID,
  check_org_id UUID,
  required_roles TEXT[] DEFAULT ARRAY['owner', 'admin', 'viewer']::TEXT[]
)
RETURNS BOOLEAN AS $$
BEGIN
  -- Super admin имеет доступ ко всем организациям
  IF is_super_admin(check_user_id) THEN
    RETURN true;
  END IF;

  -- Проверка через organization_users
  RETURN EXISTS (
    SELECT 1 FROM organization_users
    WHERE organization_users.user_id = check_user_id
    AND organization_users.organization_id = check_org_id
    AND organization_users.role::TEXT = ANY(required_roles)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Функция: проверка доступа к локации
CREATE OR REPLACE FUNCTION public.has_location_access(
  check_user_id UUID,
  check_loc_id UUID,
  required_roles TEXT[] DEFAULT ARRAY['owner', 'admin', 'manager', 'staff']::TEXT[]
)
RETURNS BOOLEAN AS $$
DECLARE
  loc_org_id UUID;
BEGIN
  -- Super admin имеет доступ ко всем локациям
  IF is_super_admin(check_user_id) THEN
    RETURN true;
  END IF;

  -- Получить organization_id из локации
  SELECT organization_id INTO loc_org_id
  FROM locations
  WHERE id = check_loc_id;

  IF loc_org_id IS NULL THEN
    RETURN false;
  END IF;

  -- Проверка через user_roles (для manager/staff)
  IF EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = check_user_id
    AND user_roles.location_id = check_loc_id
    AND user_roles.role::TEXT = ANY(required_roles)
  ) THEN
    RETURN true;
  END IF;

  -- Проверка через organization_users (для owner/admin)
  RETURN EXISTS (
    SELECT 1 FROM organization_users
    WHERE organization_users.user_id = check_user_id
    AND organization_users.organization_id = loc_org_id
    AND organization_users.role::TEXT = ANY(required_roles)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

