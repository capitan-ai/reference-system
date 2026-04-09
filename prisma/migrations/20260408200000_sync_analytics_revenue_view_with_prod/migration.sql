-- ============================================================================
-- Sync `analytics_revenue_by_location_daily` view file with production
--
-- The previous migration file at
--   prisma/migrations/20260122000000_fix_analytics_revenue_include_payments_via_orders/migration.sql
-- had drifted from the actual definition deployed in Supabase. The live view
-- was edited directly (likely via the Supabase SQL editor) without a
-- corresponding migration file, accumulating the following improvements over
-- the old file:
--
--   1. Date now uses Pacific timezone:
--        date(((payment_date AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles'))
--      previously: naked DATE(p.created_at) — would have had the timezone bug
--      from 20260408120000_fix_analytics_timezone_bug, but was fixed in
--      production directly.
--
--   2. Date column source is `COALESCE(p.square_created_at, p.created_at)`
--      instead of just `p.created_at`. Prefers Square's authoritative
--      timestamp when available.
--
--   3. Sums `p.amount_money_amount` (not `p.total_money_amount`).
--      `amount_money_amount` is the captured charge; `total_money_amount`
--      includes tip. The dashboard displays captured revenue.
--
--   4. Excludes orders in OPEN state via `o.state <> 'OPEN'`. The first UNION
--      branch now does a LEFT JOIN to orders for this filter; previously it
--      didn't join at all.
--
--   5. `unique_customers` filtered with `WHERE customer_id IS NOT NULL` so
--      anonymous payments don't inflate the distinct count.
--
-- This migration is idempotent (CREATE OR REPLACE). When applied to a
-- database that already matches production, it is a no-op. When applied to a
-- fresh database, it installs the corrected definition that matches what is
-- live in Supabase as of 2026-04-08.
--
-- Verified: re-running scripts/check-revenue-view.js after this migration
-- shows all (date, location) deltas at $0.00 — the view exactly matches
-- itself, confirming no logic change.
-- ============================================================================

CREATE OR REPLACE VIEW analytics_revenue_by_location_daily AS
WITH payment_locations AS (
  -- Branch 1: payments with direct location_id, excluding OPEN orders
  SELECT
    p.id AS payment_id,
    p.organization_id,
    p.location_id,
    COALESCE(p.square_created_at, p.created_at) AS payment_date,
    p.amount_money_amount,
    p.customer_id,
    p.status
  FROM payments p
  LEFT JOIN orders o ON o.id = p.order_id
  WHERE p.status = 'COMPLETED'
    AND p.location_id IS NOT NULL
    AND (o.state IS NULL OR o.state <> 'OPEN')

  UNION ALL

  -- Branch 2: payments without location_id, fall back to order's location
  SELECT
    p.id AS payment_id,
    p.organization_id,
    o.location_id,
    COALESCE(p.square_created_at, p.created_at) AS payment_date,
    p.amount_money_amount,
    p.customer_id,
    p.status
  FROM payments p
  INNER JOIN orders o ON p.order_id = o.id
  WHERE p.status = 'COMPLETED'
    AND p.location_id IS NULL
    AND p.order_id IS NOT NULL
    AND o.location_id IS NOT NULL
    AND o.state <> 'OPEN'
)
SELECT
  pl.organization_id,
  pl.location_id,
  l.name AS location_name,
  date(((pl.payment_date AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles')) AS date,
  SUM(pl.amount_money_amount) AS revenue_cents,
  (SUM(pl.amount_money_amount))::numeric / 100.0 AS revenue_dollars,
  COUNT(DISTINCT pl.payment_id) AS payment_count,
  COUNT(DISTINCT pl.customer_id) FILTER (WHERE pl.customer_id IS NOT NULL) AS unique_customers
FROM payment_locations pl
INNER JOIN locations l
  ON pl.location_id = l.id
  AND pl.organization_id = l.organization_id
GROUP BY
  pl.organization_id,
  pl.location_id,
  l.name,
  date(((pl.payment_date AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles'));
