-- ============================================================================
-- analytics_revenue_by_location_daily — align with Square Net Sales semantics
--
-- Two changes to bring the dashboard within ~0.14% of Square's "Net Sales"
-- in the Sales Summary report:
--
--   1. Exclude gift card sales. Square treats gift card purchases as
--      "Deferred sales" (revenue recognized when redeemed, not when bought)
--      and they're not included in Net Sales. We detect them by checking the
--      order's line items for any with itemType='GIFT_CARD'.
--      Impact (1-8 April): −$450 across 4 payments.
--
--   2. Subtract refunded amounts. Square's Net Sales = Gross − Returns. We
--      use payments.raw_json.refunded_money.amount as the source of truth
--      (Square populates this field on the Payment object when refund(s)
--      have been issued). LEAST() guards against over-subtraction in the
--      case where a refund includes the tip portion: refunded_money is the
--      total refunded, while amount_money_amount is just the service portion,
--      so we cap the deduction at amount_money_amount.
--      Impact (1-8 April): −$120 across 1 payment.
--
-- Verified 1-8 April 2026 against Square Sales Summary:
--   Square Net Sales: $48,617.35 (371 orders)
--   This view:        $48,686.85 (372 payments — 1 extra is split tender)
--   Residual gap:     $69.50 (0.14%) — accumulated Square accounting nuances
--                     (gross items $49,445 in our DB vs $49,365 in Square,
--                     discounts $638.15 vs $627.65) that we cannot model
--                     without Square-side category rules.
--
-- This is a logic-only change to the public view definition. The columns,
-- types, and groupings are unchanged, so the dependent materialized view
-- (if installed) only needs a REFRESH, not a recreate.
-- ============================================================================

CREATE OR REPLACE VIEW analytics_revenue_by_location_daily AS
WITH payment_locations AS (
  -- Branch 1: payments with direct location_id, excluding OPEN orders and
  -- gift card sales
  SELECT
    p.id AS payment_id,
    p.organization_id,
    p.location_id,
    COALESCE(p.square_created_at, p.created_at) AS payment_date,
    p.amount_money_amount,
    LEAST(
      COALESCE((p.raw_json->'refunded_money'->>'amount')::int, 0),
      p.amount_money_amount
    ) AS refunded_cents,
    p.customer_id,
    p.status
  FROM payments p
  LEFT JOIN orders o ON o.id = p.order_id
  WHERE p.status = 'COMPLETED'
    AND p.location_id IS NOT NULL
    AND (o.state IS NULL OR o.state <> 'OPEN')
    AND NOT COALESCE(o.raw_json->'lineItems' @> '[{"itemType": "GIFT_CARD"}]'::jsonb, FALSE)

  UNION ALL

  -- Branch 2: payments without location_id, fall back to order's location
  SELECT
    p.id AS payment_id,
    p.organization_id,
    o.location_id,
    COALESCE(p.square_created_at, p.created_at) AS payment_date,
    p.amount_money_amount,
    LEAST(
      COALESCE((p.raw_json->'refunded_money'->>'amount')::int, 0),
      p.amount_money_amount
    ) AS refunded_cents,
    p.customer_id,
    p.status
  FROM payments p
  INNER JOIN orders o ON p.order_id = o.id
  WHERE p.status = 'COMPLETED'
    AND p.location_id IS NULL
    AND p.order_id IS NOT NULL
    AND o.location_id IS NOT NULL
    AND o.state <> 'OPEN'
    AND NOT (o.raw_json->'lineItems' @> '[{"itemType": "GIFT_CARD"}]'::jsonb)
)
SELECT
  pl.organization_id,
  pl.location_id,
  l.name AS location_name,
  date(((pl.payment_date AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles')) AS date,
  SUM(pl.amount_money_amount - pl.refunded_cents) AS revenue_cents,
  (SUM(pl.amount_money_amount - pl.refunded_cents))::numeric / 100.0 AS revenue_dollars,
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

-- ---------------------------------------------------------------------------
-- Refresh the materialized view wrapper if it exists.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_matviews
    WHERE schemaname = 'public'
      AND matviewname = 'analytics_revenue_by_location_daily_mv'
  ) THEN
    REFRESH MATERIALIZED VIEW analytics_revenue_by_location_daily_mv;
  END IF;
END $$;
