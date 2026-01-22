-- scripts/add-rls-policies.sql
-- Добавить RLS политики для всех таблиц

-- ===== BOOKINGS =====
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view bookings in their organization" ON bookings;
CREATE POLICY "Users can view bookings in their organization"
  ON bookings FOR SELECT
  USING (
    has_org_access(auth.uid(), organization_id, ARRAY['owner', 'admin', 'viewer']::TEXT[])
  );

DROP POLICY IF EXISTS "Users can view bookings in their location" ON bookings;
CREATE POLICY "Users can view bookings in their location"
  ON bookings FOR SELECT
  USING (
    has_location_access(auth.uid(), location_id, ARRAY['manager', 'staff']::TEXT[])
  );

-- ===== PAYMENTS =====
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view payments in their organization" ON payments;
CREATE POLICY "Users can view payments in their organization"
  ON payments FOR SELECT
  USING (
    has_org_access(auth.uid(), organization_id, ARRAY['owner', 'admin', 'viewer']::TEXT[])
  );

DROP POLICY IF EXISTS "Users can view payments in their location" ON payments;
CREATE POLICY "Users can view payments in their location"
  ON payments FOR SELECT
  USING (
    has_location_access(auth.uid(), location_id, ARRAY['manager', 'staff']::TEXT[])
  );

-- ===== ORDERS =====
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view orders in their organization" ON orders;
CREATE POLICY "Users can view orders in their organization"
  ON orders FOR SELECT
  USING (
    has_org_access(auth.uid(), organization_id, ARRAY['owner', 'admin', 'viewer']::TEXT[])
  );

-- ===== ORDER_LINE_ITEMS =====
ALTER TABLE order_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view order line items in their organization" ON order_line_items;
CREATE POLICY "Users can view order line items in their organization"
  ON order_line_items FOR SELECT
  USING (
    has_org_access(auth.uid(), organization_id, ARRAY['owner', 'admin', 'viewer']::TEXT[])
  );

-- ===== SQUARE_EXISTING_CLIENTS =====
ALTER TABLE square_existing_clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view clients in their organization" ON square_existing_clients;
CREATE POLICY "Users can view clients in their organization"
  ON square_existing_clients FOR SELECT
  USING (
    has_org_access(auth.uid(), organization_id, ARRAY['owner', 'admin', 'viewer']::TEXT[])
  );

-- ===== LOCATIONS =====
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view locations in their organization" ON locations;
CREATE POLICY "Users can view locations in their organization"
  ON locations FOR SELECT
  USING (
    has_org_access(auth.uid(), organization_id, ARRAY['owner', 'admin', 'viewer', 'manager', 'staff']::TEXT[])
  );

-- ===== TEAM_MEMBERS =====
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view team members in their organization" ON team_members;
CREATE POLICY "Users can view team members in their organization"
  ON team_members FOR SELECT
  USING (
    has_org_access(auth.uid(), organization_id, ARRAY['owner', 'admin', 'viewer', 'manager', 'staff']::TEXT[])
  );

-- ===== SERVICE_VARIATIONS =====
ALTER TABLE service_variation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view service variations in their organization" ON service_variation;
CREATE POLICY "Users can view service variations in their organization"
  ON service_variation FOR SELECT
  USING (
    has_org_access(auth.uid(), organization_id, ARRAY['owner', 'admin', 'viewer', 'manager', 'staff']::TEXT[])
  );

-- ===== GIFT_CARDS =====
ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view gift cards in their organization" ON gift_cards;
CREATE POLICY "Users can view gift cards in their organization"
  ON gift_cards FOR SELECT
  USING (
    has_org_access(auth.uid(), organization_id, ARRAY['owner', 'admin', 'viewer']::TEXT[])
  );

-- ===== REFERRAL_PROFILES =====
ALTER TABLE referral_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view referral profiles in their organization" ON referral_profiles;
CREATE POLICY "Users can view referral profiles in their organization"
  ON referral_profiles FOR SELECT
  USING (
    has_org_access(auth.uid(), organization_id, ARRAY['owner', 'admin', 'viewer']::TEXT[])
  );

-- ===== REFERRAL_REWARDS =====
ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view referral rewards in their organization" ON referral_rewards;
CREATE POLICY "Users can view referral rewards in their organization"
  ON referral_rewards FOR SELECT
  USING (
    has_org_access(auth.uid(), organization_id, ARRAY['owner', 'admin', 'viewer']::TEXT[])
  );

-- ===== ORGANIZATIONS =====
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their organizations" ON organizations;
CREATE POLICY "Users can view their organizations"
  ON organizations FOR SELECT
  USING (
    is_super_admin(auth.uid()) OR
    EXISTS (
      SELECT 1 FROM organization_users
      WHERE organization_users.user_id = auth.uid()
      AND organization_users.organization_id = organizations.id
    )
  );

