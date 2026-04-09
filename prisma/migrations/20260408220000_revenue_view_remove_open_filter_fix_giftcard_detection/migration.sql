-- ============================================================================
-- analytics_revenue_by_location_daily — close the year-to-date gap to Square
--
-- Year-to-date sanity check (1 Jan 2026 – 8 Apr 2026) found a $5,640.40 gap
-- between the dashboard view and Square's Sales Summary "Net Sales". The gap
-- decomposed exactly into three independent issues:
--
--   1. The view excluded all payments belonging to OPEN-state orders via
--      `o.state <> 'OPEN'`. We checked all 34 stuck orders against the live
--      Square API: every single one is genuinely OPEN in Square (open tabs,
--      layaway, prepaid balances awaiting follow-up service). Square still
--      counts these payments in Gross/Net Sales because the items were
--      sold and the payment was captured. Our filter was wrong.
--      Impact (year): −$10,933.40 silently dropped from the dashboard.
--
--   2. The gift-card detection only matched camelCase line items
--      (`lineItems[].itemType = 'GIFT_CARD'`), catching 15 of 48 sales.
--      Older orders (33 of them, $4,030) use snake_case `line_items[].item_type`
--      and were not detected, so the view counted them as regular revenue
--      instead of excluding them as deferred sales.
--      Impact (year): +$4,030 incorrectly counted in revenue.
--
--   3. The refund subtraction relied on `payments.raw_json.refunded_money`
--      which was NULL for 12 of 13 refund-flagged payments — the field is
--      populated only when the payment was re-fetched after the refund
--      occurred, and our webhook flow doesn't currently do that. The 12
--      stale payments were re-fetched from Square API as part of this fix
--      (one-shot backfill, not in this migration), and the existing
--      LEAST(refunded_money, amount_money) formula in the view now
--      correctly subtracts each.
--      Impact (year): +$1,263 reverted to a correct subtraction (only
--      issue 3 was a data bug; the formula itself is unchanged here).
--
-- Verified math (1 Jan – 8 Apr):
--   Square Net Sales:     $554,785.79  (4,267 orders)
--   = our raw amount_money $562,368.79
--     − gift card sales    $6,200.00
--     − Square Returns     $1,383.00
-- After this migration, the view should land within ~$200 of Square Net
-- Sales, residual coming from Square's exact "Returns" vs "Refunds by
-- amount" classification which we cannot distinguish without inspecting
-- each refund individually (Square's reporting splits them in a way the
-- public Refunds API does not expose cleanly).
--
-- This is a logic-only change. Column structure is unchanged.
-- ============================================================================

CREATE OR REPLACE VIEW analytics_revenue_by_location_daily AS
WITH payment_locations AS (
  -- Branch 1: payments with direct location_id
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
    -- Exclude gift card sales (deferred sales in Square — recognized when
    -- redeemed, not when sold). Match BOTH camelCase (newer orders) and
    -- snake_case (older orders) line item structures.
    AND NOT COALESCE(
      o.raw_json->'lineItems' @> '[{"itemType": "GIFT_CARD"}]'::jsonb,
      FALSE
    )
    AND NOT COALESCE(
      o.raw_json->'line_items' @> '[{"item_type": "GIFT_CARD"}]'::jsonb,
      FALSE
    )

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
    AND NOT (o.raw_json->'lineItems' @> '[{"itemType": "GIFT_CARD"}]'::jsonb)
    AND NOT (o.raw_json->'line_items' @> '[{"item_type": "GIFT_CARD"}]'::jsonb)
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
