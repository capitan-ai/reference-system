-- ============================================================================
-- FIX: analytics_appointments_by_location_daily view
-- Issue: Redistribution formula + has_active_segment filter caused undercounting
--
-- Changes:
-- 1. Remove has_active_segment filter from ACCEPTED count (was excluding valid bookings)
-- 2. Remove redistribution formula (Pacific = total - Union) — each location counts itself
-- 3. Simplify canonical dedup: DISTINCT ON instead of row_number, remove tiebreaker
-- 4. Compute first_visits from canonical_bookings, not raw bookings
--
-- Result: Each booking counted once, exact location attribution, correct new customer logic
-- ============================================================================

DROP VIEW IF EXISTS analytics_appointments_by_location_daily CASCADE;

CREATE VIEW analytics_appointments_by_location_daily AS
WITH canonical_bookings AS (
  -- Dedup: one canonical row per (org, location_id, base_id)
  -- This ensures each location keeps its own bookings, no cross-location merging
  -- base_id extracted from booking_id: "prefix-SUFFIX" → "prefix"
  -- Order by version DESC, then updated_at DESC (no has_active_segment_rank tiebreaker)
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
first_visits AS (
  -- First ACCEPTED visit per customer (from canonical bookings, not raw)
  -- This avoids date shifts caused by duplicate base_ids with different start_at
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
  COUNT(*) FILTER (WHERE cb.status = 'ACCEPTED')                                        AS appointments_count,
  COUNT(*) FILTER (WHERE cb.status = 'ACCEPTED')                                        AS accepted_appointments,
  COUNT(*) FILTER (WHERE cb.status = 'CANCELLED_BY_CUSTOMER')                           AS cancelled_by_customer,
  COUNT(*) FILTER (WHERE cb.status = 'CANCELLED_BY_SELLER')                             AS cancelled_by_seller,
  COUNT(*) FILTER (WHERE cb.status IN ('CANCELLED_BY_CUSTOMER','CANCELLED_BY_SELLER'))  AS cancelled_appointments,
  COUNT(*) FILTER (WHERE cb.status = 'NO_SHOW')                                         AS no_show_appointments,
  COUNT(DISTINCT cb.customer_id) FILTER (WHERE cb.customer_id IS NOT NULL AND cb.status = 'ACCEPTED') AS unique_customers,
  COUNT(DISTINCT cb.customer_id) FILTER (
    WHERE cb.customer_id IS NOT NULL
      AND cb.status = 'ACCEPTED'
      AND fv.first_visit_date = cb.booking_date
  ) AS new_customers
FROM canonical_bookings cb
JOIN locations l ON l.id = cb.location_id AND l.organization_id = cb.organization_id
LEFT JOIN first_visits fv ON fv.customer_id = cb.customer_id AND fv.organization_id = cb.organization_id
GROUP BY cb.organization_id, cb.location_id, l.name, cb.booking_date;
