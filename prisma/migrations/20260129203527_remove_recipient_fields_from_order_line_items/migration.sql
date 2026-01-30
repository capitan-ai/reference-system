-- Remove recipient, shipping, and fulfillment fields from order_line_items
-- These fields were removed from the Prisma schema and are no longer needed

-- Drop columns if they exist (safe for production)
ALTER TABLE order_line_items
  DROP COLUMN IF EXISTS recipient_name,
  DROP COLUMN IF EXISTS recipient_email,
  DROP COLUMN IF EXISTS recipient_phone,
  DROP COLUMN IF EXISTS shipping_address_line_1,
  DROP COLUMN IF EXISTS shipping_address_line_2,
  DROP COLUMN IF EXISTS shipping_locality,
  DROP COLUMN IF EXISTS shipping_administrative_district_level_1,
  DROP COLUMN IF EXISTS shipping_postal_code,
  DROP COLUMN IF EXISTS shipping_country,
  DROP COLUMN IF EXISTS fulfillment_type,
  DROP COLUMN IF EXISTS fulfillment_state;

