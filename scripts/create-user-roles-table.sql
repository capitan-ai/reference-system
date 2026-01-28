-- scripts/create-user-roles-table.sql
-- Создать таблицу user_roles для детальных ролей с привязкой к локациям

-- Создать enum для ролей
DO $$ BEGIN
  CREATE TYPE user_role_type AS ENUM ('super_admin', 'owner', 'manager', 'staff');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Создать таблицу user_roles
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role user_role_type NOT NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT user_roles_super_admin_org_null 
    CHECK ((role = 'super_admin' AND organization_id IS NULL) OR (role != 'super_admin' AND organization_id IS NOT NULL)),
  CONSTRAINT user_roles_manager_staff_location 
    CHECK ((role IN ('manager', 'staff') AND location_id IS NOT NULL) OR (role NOT IN ('manager', 'staff')))
);

-- Создать уникальный индекс для user_id + organization_id (кроме super_admin)
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_org_unique 
  ON user_roles(user_id, organization_id) 
  WHERE organization_id IS NOT NULL;

-- Создать уникальный индекс для super_admin (один super_admin на пользователя)
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_super_admin_unique 
  ON user_roles(user_id) 
  WHERE role = 'super_admin';

-- Создать индексы
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_organization_id ON user_roles(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_roles_location_id ON user_roles(location_id) WHERE location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);

-- Включить RLS
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Политика: пользователь видит свои роли
DROP POLICY IF EXISTS "Users can view own roles" ON user_roles;
CREATE POLICY "Users can view own roles"
  ON user_roles FOR SELECT
  USING (auth.uid() = user_id);

-- Политика: super_admin видит все роли
DROP POLICY IF EXISTS "Super admin can view all roles" ON user_roles;
CREATE POLICY "Super admin can view all roles"
  ON user_roles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() 
      AND ur.role = 'super_admin'
    )
  );



