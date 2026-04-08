-- ============================================================================
-- analytics_appointments_by_location_daily — count by staff slots
--
-- Square represents multi-staff appointments inconsistently:
--   • Antoinette Catteani: 4 separate booking_ids, each with 1 staff
--   • Sabina Yuen / Julia Hudea: 1 booking_id with 2 segments, each with a
--     different team_member_id
-- Both render in Square Dashboard as multiple rows. Counting booking_ids
-- (the previous behavior) collapses Sabina/Julia into 1 row, undercounting.
--
-- New formula: COUNT(DISTINCT (booking_id, team_member_id)) per booking →
-- each (booking, staff) pair = 1 dashboard row. This matches Square Dashboard.
--
-- Verified for April 8 2026:
--   Union ACCEPTED: 23 booking_ids → 25 staff slots (Sabina, Julia each have 2)
--   Pacific ACCEPTED: 24 booking_ids → 26 staff slots (Deja, Elettra each have 2)
-- ============================================================================

DROP VIEW IF EXISTS analytics_appointments_by_location_daily CASCADE;

CREATE VIEW analytics_appointments_by_location_daily AS
WITH canonical_bookings AS (
  -- Dedup: one canonical row per (org, location_id, base_id), keep raw_json
  -- so we can read appointment_segments downstream.
  SELECT DISTINCT ON (b.organization_id, b.location_id,
    CASE
      WHEN b.booking_id ~ '^[a-z0-9]+-[A-Z0-9]{20,}$' THEN split_part(b.booking_id, '-', 1)
      ELSE b.booking_id
    END
  )
    b.id,
    b.organization_id,
    b.location_id,
    b.customer_id,
    b.status,
    b.raw_json,
    DATE(b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') AS booking_date
  FROM bookings b
  WHERE b.location_id IS NOT NULL
  ORDER BY
    b.organization_id,
    b.location_id,
    CASE
      WHEN b.booking_id ~ '^[a-z0-9]+-[A-Z0-9]{20,}$' THEN split_part(b.booking_id, '-', 1)
      ELSE b.booking_id
    END,
    b.version DESC,
    b.updated_at DESC
),
booking_staff_slots AS (
  -- For each canonical booking, count distinct team_member_ids in its segments.
  -- Fall back to 1 if no segments or no team_member_id (shouldn't happen, but safe).
  SELECT cb.id,
    GREATEST(1, COALESCE((
      SELECT COUNT(DISTINCT seg->>'team_member_id')::int
      FROM jsonb_array_elements(
        COALESCE(cb.raw_json->'appointment_segments', cb.raw_json->'appointmentSegments', '[]'::jsonb)
      ) seg
      WHERE seg->>'team_member_id' IS NOT NULL AND seg->>'team_member_id' != ''
    ), 0)) AS staff_slots
  FROM canonical_bookings cb
),
first_visits AS (
  -- First ACCEPTED visit per customer (from canonical bookings, not raw)
  SELECT organization_id, customer_id,
    MIN(booking_date) AS first_visit_date
  FROM canonical_bookings
  WHERE status = 'ACCEPTED' AND customer_id IS NOT NULL
  GROUP BY organization_id, customer_id
)
SELECT
  cb.organization_id,
  cb.location_id,
  l.name AS location_name,
  cb.booking_date AS date,
  -- Sum staff slots per status (each multi-staff booking contributes N rows)
  SUM(CASE WHEN cb.status = 'ACCEPTED' THEN bss.staff_slots ELSE 0 END)::bigint AS appointments_count,
  SUM(CASE WHEN cb.status = 'ACCEPTED' THEN bss.staff_slots ELSE 0 END)::bigint AS accepted_appointments,
  SUM(CASE WHEN cb.status = 'CANCELLED_BY_CUSTOMER' THEN bss.staff_slots ELSE 0 END)::bigint AS cancelled_by_customer,
  SUM(CASE WHEN cb.status = 'CANCELLED_BY_SELLER' THEN bss.staff_slots ELSE 0 END)::bigint AS cancelled_by_seller,
  SUM(CASE WHEN cb.status IN ('CANCELLED_BY_CUSTOMER','CANCELLED_BY_SELLER') THEN bss.staff_slots ELSE 0 END)::bigint AS cancelled_appointments,
  SUM(CASE WHEN cb.status = 'NO_SHOW' THEN bss.staff_slots ELSE 0 END)::bigint AS no_show_appointments,
  -- Customer counts stay by distinct customer_id (not staff slots)
  COUNT(DISTINCT cb.customer_id) FILTER (WHERE cb.customer_id IS NOT NULL AND cb.status = 'ACCEPTED') AS unique_customers,
  COUNT(DISTINCT cb.customer_id) FILTER (
    WHERE cb.customer_id IS NOT NULL
      AND cb.status = 'ACCEPTED'
      AND fv.first_visit_date = cb.booking_date
  ) AS new_customers
FROM canonical_bookings cb
JOIN locations l ON l.id = cb.location_id AND l.organization_id = cb.organization_id
JOIN booking_staff_slots bss ON bss.id = cb.id
LEFT JOIN first_visits fv ON fv.customer_id = cb.customer_id AND fv.organization_id = cb.organization_id
GROUP BY cb.organization_id, cb.location_id, l.name, cb.booking_date;
