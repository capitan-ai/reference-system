-- scripts/expand-organizations-table.sql
-- Расширить таблицу organizations: добавить name, slug, settings, is_active

-- Добавить новые колонки в organizations
ALTER TABLE organizations 
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Создать уникальный индекс для slug
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug_unique 
  ON organizations(slug) 
  WHERE slug IS NOT NULL;

-- Создать индекс для slug
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug) WHERE slug IS NOT NULL;

-- Обновить существующие организации (если нужно)
UPDATE organizations 
SET 
  name = COALESCE(name, square_merchant_id),
  slug = COALESCE(slug, LOWER(REPLACE(REPLACE(square_merchant_id, '-', '_'), ' ', '_'))),
  is_active = COALESCE(is_active, true)
WHERE name IS NULL OR slug IS NULL;



