-- ============================================================================
-- FIX: timezone bug in analytics views and functions
--
-- Root cause: bookings.start_at, bookings.created_at, orders.created_at,
-- payments.created_at, order_line_items.order_created_at and related columns
-- are stored as `timestamp without time zone` holding UTC values.
--
-- Two bug patterns existed:
--   a) naked `date(col)` — returns UTC date, off by up to a full calendar day
--      for any booking ≥ 5pm Pacific (which becomes next-day in UTC).
--   b) `(col AT TIME ZONE 'America/Los_Angeles')::date` — backwards: Postgres
--      interprets this as "treat stored value as LA local, convert to UTC",
--      shifting dates 7–8 hours in the wrong direction.
--
-- Correct pattern for `timestamp without time zone` columns holding UTC:
--   `(col AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date`
--
-- For `timestamp with time zone` columns (e.g. master_earnings_ledger.created_at),
-- the correct pattern is:
--   `(col AT TIME ZONE 'America/Los_Angeles')::date`
-- This migration preserves the already-correct tz-column clauses and only
-- fixes the no-tz-column clauses.
--
-- Verified impact on 2026-04-08 ZORINA ACCEPTED bookings:
--   naked `date(b.start_at)`              → 59 (over-count)
--   `(b.start_at AT TIME ZONE 'LA')::date` → 36 (under-count)
--   correct double AT TIME ZONE            → 53
--
-- Objects fixed:
--   VIEWS:
--     - public.analytics_master_performance_daily
--     - public.analytics_overview_daily
--     - public.analytics_service_performance_daily
--     - public.v_master_salary_monthly
--   FUNCTIONS:
--     - public.get_master_salary(uuid, text, uuid)
--     - public.get_new_customers_by_location(uuid, date, date)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) analytics_master_performance_daily
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.analytics_master_performance_daily AS
WITH booking_performance AS (
  SELECT
    b.organization_id,
    b.technician_id,
    (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS date,
    count(DISTINCT b.id) AS appointments_count,
    count(DISTINCT b.customer_id) AS unique_customers
  FROM bookings b
  WHERE b.status <> 'CANCELLED'
    AND b.technician_id IS NOT NULL
  GROUP BY
    b.organization_id,
    b.technician_id,
    (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
),
order_performance AS (
  SELECT
    oli.organization_id,
    oli.technician_id,
    (oli.order_created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS date,
    count(DISTINCT oli.id) AS line_items_count,
    sum(COALESCE(oli.total_money_amount, 0)) AS revenue_cents,
    count(DISTINCT oli.customer_id) AS unique_customers
  FROM order_line_items oli
  WHERE oli.order_state = 'COMPLETED'
    AND oli.technician_id IS NOT NULL
    AND oli.order_created_at IS NOT NULL
  GROUP BY
    oli.organization_id,
    oli.technician_id,
    (oli.order_created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
)
SELECT
  COALESCE(bp.organization_id, op.organization_id) AS organization_id,
  COALESCE(bp.technician_id, op.technician_id) AS technician_id,
  COALESCE(tm.given_name || ' ' || COALESCE(tm.family_name, ''), 'Unknown') AS technician_name,
  COALESCE(bp.date, op.date) AS date,
  COALESCE(bp.appointments_count, 0::bigint) AS appointments_count,
  COALESCE(op.line_items_count, 0::bigint) AS line_items_count,
  COALESCE(op.revenue_cents, 0::bigint) AS revenue_cents,
  (COALESCE(op.revenue_cents, 0::bigint)::numeric / 100.0) AS revenue_dollars,
  COALESCE(bp.unique_customers, op.unique_customers, 0::bigint) AS unique_customers
FROM booking_performance bp
FULL JOIN order_performance op
  ON bp.organization_id = op.organization_id
 AND bp.technician_id   = op.technician_id
 AND bp.date             = op.date
JOIN team_members tm
  ON COALESCE(bp.technician_id, op.technician_id) = tm.id
 AND COALESCE(bp.organization_id, op.organization_id) = tm.organization_id;

-- ---------------------------------------------------------------------------
-- 2) analytics_overview_daily
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.analytics_overview_daily AS
WITH revenue_daily AS (
  SELECT
    payments.organization_id,
    (payments.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS date,
    sum(payments.total_money_amount) AS total_revenue_cents
  FROM payments
  WHERE payments.status = 'COMPLETED'
  GROUP BY
    payments.organization_id,
    (payments.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
),
appointments_daily AS (
  SELECT
    bookings.organization_id,
    (bookings.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS date,
    count(DISTINCT bookings.id) AS appointments_count
  FROM bookings
  WHERE bookings.status <> 'CANCELLED'
  GROUP BY
    bookings.organization_id,
    (bookings.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
),
new_customers_daily AS (
  SELECT
    b.organization_id,
    (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS date,
    count(DISTINCT b.customer_id) AS new_customers_count
  FROM bookings b
  WHERE b.status <> 'CANCELLED'
    AND b.customer_id IS NOT NULL
    AND b.start_at = (
      SELECT min(b2.start_at)
      FROM bookings b2
      WHERE b2.customer_id     = b.customer_id
        AND b2.organization_id = b.organization_id
        AND b2.status <> 'CANCELLED'
    )
  GROUP BY
    b.organization_id,
    (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
),
referral_revenue_daily AS (
  SELECT
    p.organization_id,
    (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS date,
    sum(p.total_money_amount) AS referral_revenue_cents
  FROM payments p
  JOIN square_existing_clients c
    ON p.customer_id = c.square_customer_id
   AND p.organization_id = c.organization_id
  WHERE p.status = 'COMPLETED'
    AND c.used_referral_code IS NOT NULL
  GROUP BY
    p.organization_id,
    (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
),
overall_rebooking_rate AS (
  SELECT
    cb.organization_id,
    (count(DISTINCT CASE WHEN cb.booking_count >= 2 THEN cb.customer_id END)::numeric
      / NULLIF(count(DISTINCT cb.customer_id), 0)::numeric) AS rebooking_rate,
    count(DISTINCT cb.customer_id) AS total_customers_with_bookings
  FROM (
    SELECT
      bookings.customer_id,
      bookings.organization_id,
      count(*) AS booking_count
    FROM bookings
    WHERE bookings.status <> 'CANCELLED'
      AND bookings.customer_id IS NOT NULL
    GROUP BY bookings.customer_id, bookings.organization_id
  ) cb
  GROUP BY cb.organization_id
),
rebooking_daily AS (
  SELECT
    b.organization_id,
    (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS date,
    o.rebooking_rate,
    o.total_customers_with_bookings
  FROM bookings b
  JOIN overall_rebooking_rate o ON b.organization_id = o.organization_id
  WHERE b.status <> 'CANCELLED'
    AND b.customer_id IS NOT NULL
  GROUP BY
    b.organization_id,
    (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date,
    o.rebooking_rate,
    o.total_customers_with_bookings
)
SELECT
  COALESCE(r.organization_id, a.organization_id, nc.organization_id, ref.organization_id, reb.organization_id) AS organization_id,
  COALESCE(r.date, a.date, nc.date, ref.date, reb.date) AS date,
  COALESCE(r.total_revenue_cents, 0::bigint) AS total_revenue_cents,
  (COALESCE(r.total_revenue_cents, 0::bigint)::numeric / 100.0) AS total_revenue_dollars,
  COALESCE(a.appointments_count, 0::bigint) AS appointments_count,
  COALESCE(nc.new_customers_count, 0::bigint) AS new_customers_count,
  CASE
    WHEN COALESCE(a.appointments_count, 0::bigint) > 0
      THEN (COALESCE(r.total_revenue_cents, 0::bigint)::numeric / a.appointments_count::numeric) / 100.0
    ELSE NULL
  END AS avg_ticket_dollars,
  COALESCE(ref.referral_revenue_cents, 0::bigint) AS referral_revenue_cents,
  (COALESCE(ref.referral_revenue_cents, 0::bigint)::numeric / 100.0) AS referral_revenue_dollars,
  COALESCE(reb.rebooking_rate, 0::numeric) AS rebooking_rate,
  COALESCE(reb.total_customers_with_bookings, 0::bigint) AS total_customers_with_bookings
FROM revenue_daily r
FULL JOIN appointments_daily a
  ON r.organization_id = a.organization_id
 AND r.date             = a.date
FULL JOIN new_customers_daily nc
  ON COALESCE(r.organization_id, a.organization_id) = nc.organization_id
 AND COALESCE(r.date, a.date)                         = nc.date
FULL JOIN referral_revenue_daily ref
  ON COALESCE(r.organization_id, a.organization_id, nc.organization_id) = ref.organization_id
 AND COALESCE(r.date, a.date, nc.date)                                   = ref.date
FULL JOIN rebooking_daily reb
  ON COALESCE(r.organization_id, a.organization_id, nc.organization_id, ref.organization_id) = reb.organization_id
 AND COALESCE(r.date, a.date, nc.date, ref.date)                                              = reb.date;

-- ---------------------------------------------------------------------------
-- 3) analytics_service_performance_daily
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.analytics_service_performance_daily AS
WITH booking_performance AS (
  SELECT
    b.organization_id,
    sv_1.square_variation_id AS service_variation_id,
    (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS date,
    count(DISTINCT b.id) AS appointments_count,
    count(DISTINCT b.customer_id) AS unique_customers,
    avg(b.duration_minutes) AS avg_duration_minutes
  FROM bookings b
  LEFT JOIN service_variation sv_1
    ON (b.service_variation_id)::text = (sv_1.uuid)::text
  WHERE b.status <> 'CANCELLED'
    AND b.service_variation_id IS NOT NULL
    AND sv_1.square_variation_id IS NOT NULL
  GROUP BY
    b.organization_id,
    sv_1.square_variation_id,
    (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
),
order_performance AS (
  SELECT
    oli.organization_id,
    oli.service_variation_id,
    (oli.order_created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS date,
    count(DISTINCT oli.id) AS line_items_count,
    sum(COALESCE(oli.total_money_amount, 0)) AS revenue_cents,
    count(DISTINCT oli.customer_id) AS unique_customers
  FROM order_line_items oli
  WHERE oli.order_state = 'COMPLETED'
    AND oli.service_variation_id IS NOT NULL
    AND oli.order_created_at IS NOT NULL
  GROUP BY
    oli.organization_id,
    oli.service_variation_id,
    (oli.order_created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
)
SELECT
  COALESCE(bp.organization_id, op.organization_id) AS organization_id,
  COALESCE(bp.service_variation_id, op.service_variation_id) AS service_variation_id,
  COALESCE(sv.service_name, 'Unknown Service') AS service_name,
  COALESCE(bp.date, op.date) AS date,
  COALESCE(bp.appointments_count, 0::bigint) AS appointments_count,
  COALESCE(op.line_items_count, 0::bigint) AS line_items_count,
  COALESCE(op.revenue_cents, 0::bigint) AS revenue_cents,
  (COALESCE(op.revenue_cents, 0::bigint)::numeric / 100.0) AS revenue_dollars,
  COALESCE(bp.unique_customers, op.unique_customers, 0::bigint) AS unique_customers,
  COALESCE(bp.avg_duration_minutes, 0::numeric) AS avg_duration_minutes
FROM booking_performance bp
FULL JOIN order_performance op
  ON bp.organization_id       = op.organization_id
 AND bp.service_variation_id  = op.service_variation_id
 AND bp.date                  = op.date
LEFT JOIN service_variation sv
  ON COALESCE(bp.service_variation_id, op.service_variation_id) = sv.square_variation_id
 AND COALESCE(bp.organization_id, op.organization_id)           = sv.organization_id;

-- ---------------------------------------------------------------------------
-- 4) v_master_salary_monthly
-- NOTE: payments.created_at and bookings.start_at are `timestamp without time
-- zone` → need double AT TIME ZONE. master_earnings_ledger.created_at is
-- `timestamp with time zone` → needs single AT TIME ZONE (already correct).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_master_salary_monthly AS
WITH pay AS (
  SELECT
    p.organization_id,
    COALESCE(b.technician_id, b2.technician_id) AS team_member_id,
    to_char(
      ((p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date)::timestamptz,
      'YYYY-MM'
    ) AS period,
    sum(p.amount_money_amount) AS gross_cents,
    sum(COALESCE(p.tip_money_amount, 0)) AS tips_cents,
    count(DISTINCT p.id)::integer AS sale_count
  FROM payments p
  LEFT JOIN bookings b ON b.id = p.booking_id
  LEFT JOIN orders o ON o.id = p.order_id AND p.booking_id IS NULL
  LEFT JOIN bookings b2 ON b2.id = o.booking_id AND b2.technician_id IS NOT NULL AND p.booking_id IS NULL
  WHERE p.status = 'COMPLETED'
    AND COALESCE(b.technician_id, b2.technician_id) IS NOT NULL
  GROUP BY
    p.organization_id,
    COALESCE(b.technician_id, b2.technician_id),
    to_char(
      ((p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date)::timestamptz,
      'YYYY-MM'
    )
),
earnings AS (
  SELECT
    mel.organization_id,
    mel.team_member_id,
    to_char(
      COALESCE(
        (bk.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date,
        (mel.created_at AT TIME ZONE 'America/Los_Angeles')::date
      )::timestamptz,
      'YYYY-MM'
    ) AS period,
    sum(mel.amount_amount) FILTER (WHERE mel.entry_type = 'SERVICE_COMMISSION'::"MasterEntryType") AS commission_cents,
    sum(mel.amount_amount) FILTER (WHERE mel.entry_type = 'DISCOUNT_ADJUSTMENT'::"MasterEntryType") AS discount_cents,
    sum(mel.amount_amount) FILTER (WHERE mel.entry_type = ANY (ARRAY['FIX_PENALTY'::"MasterEntryType", 'FIX_COMPENSATION'::"MasterEntryType"])) AS fix_cents,
    sum(mel.amount_amount) FILTER (WHERE mel.entry_type = 'MANUAL_ADJUSTMENT'::"MasterEntryType") AS manual_cents,
    sum(mel.amount_amount) FILTER (WHERE mel.entry_type = 'REVERSAL'::"MasterEntryType") AS reversal_cents,
    sum(mel.amount_amount) FILTER (WHERE mel.entry_type = 'DISPUTE_HOLD'::"MasterEntryType") AS dispute_hold_cents,
    sum(mel.amount_amount) FILTER (WHERE mel.entry_type = 'DISPUTE_RELEASE'::"MasterEntryType") AS dispute_release_cents
  FROM master_earnings_ledger mel
  LEFT JOIN bookings bk ON bk.id = mel.booking_id AND bk.organization_id = mel.organization_id
  GROUP BY
    mel.organization_id,
    mel.team_member_id,
    to_char(
      COALESCE(
        (bk.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date,
        (mel.created_at AT TIME ZONE 'America/Los_Angeles')::date
      )::timestamptz,
      'YYYY-MM'
    )
),
bstats AS (
  SELECT
    b.organization_id,
    b.technician_id AS team_member_id,
    to_char(
      ((b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date)::timestamptz,
      'YYYY-MM'
    ) AS period,
    sum(COALESCE(b.duration_minutes, 0))::integer AS booked_minutes,
    count(*) FILTER (WHERE bs_1.is_fix = true)::integer AS fix_count
  FROM bookings b
  LEFT JOIN booking_snapshots bs_1 ON bs_1.booking_id = b.id
  WHERE b.status = 'ACCEPTED'
    AND b.technician_id IS NOT NULL
  GROUP BY
    b.organization_id,
    b.technician_id,
    to_char(
      ((b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date)::timestamptz,
      'YYYY-MM'
    )
),
all_keys AS (
  SELECT organization_id, team_member_id, period FROM pay
  UNION
  SELECT organization_id, team_member_id, period FROM earnings
),
sched AS (
  SELECT
    ws.organization_id,
    ws.team_member_id,
    round((sum(ws.scheduled_minutes)::numeric * 4.33) / 60.0, 1) AS paid_hours_monthly
  FROM master_weekly_schedule ws
  GROUP BY ws.organization_id, ws.team_member_id
)
SELECT
  k.organization_id,
  k.period,
  k.team_member_id AS master_id,
  TRIM(BOTH FROM COALESCE(tm.given_name, '') || ' ' || COALESCE(tm.family_name, '')) AS name,
  COALESCE(ms.category::text, 'UNKNOWN') AS category,
  COALESCE(ms.location_code::text, 'UNKNOWN') AS location,
  COALESCE(ms.commission_rate, 0::double precision) AS commission_rate,
  COALESCE(py.gross_cents, 0::bigint) AS gross_sales_cents,
  COALESCE(py.tips_cents, 0::bigint) AS tips_cents,
  COALESCE(py.sale_count, 0) AS sale_count,
  COALESCE(e.commission_cents, 0::bigint) AS commission_cents,
  COALESCE(e.discount_cents, 0::bigint) AS discount_adjustment_cents,
  COALESCE(e.fix_cents, 0::bigint) AS fix_transfer_cents,
  COALESCE(e.manual_cents, 0::bigint) AS manual_adjustment_cents,
  COALESCE(e.reversal_cents, 0::bigint) AS reversal_cents,
  COALESCE(e.dispute_hold_cents, 0::bigint) AS dispute_hold_cents,
  COALESCE(e.dispute_release_cents, 0::bigint) AS dispute_release_cents,
  (COALESCE(e.discount_cents, 0::bigint) + COALESCE(e.fix_cents, 0::bigint) + COALESCE(e.reversal_cents, 0::bigint) + COALESCE(e.dispute_hold_cents, 0::bigint) + COALESCE(e.dispute_release_cents, 0::bigint) + LEAST(0::bigint, COALESCE(e.manual_cents, 0::bigint))) AS deductions_cents,
  (COALESCE(e.commission_cents, 0::bigint) + COALESCE(e.discount_cents, 0::bigint) + COALESCE(e.fix_cents, 0::bigint) + COALESCE(e.manual_cents, 0::bigint) + COALESCE(e.reversal_cents, 0::bigint) + COALESCE(e.dispute_hold_cents, 0::bigint) + COALESCE(e.dispute_release_cents, 0::bigint)) AS net_salary_cents,
  (COALESCE(e.commission_cents, 0::bigint) + COALESCE(e.discount_cents, 0::bigint) + COALESCE(e.fix_cents, 0::bigint) + COALESCE(e.manual_cents, 0::bigint) + COALESCE(e.reversal_cents, 0::bigint) + COALESCE(e.dispute_hold_cents, 0::bigint) + COALESCE(e.dispute_release_cents, 0::bigint) + COALESCE(py.tips_cents, 0::bigint)) AS total_with_tips_cents,
  COALESCE(sc.paid_hours_monthly, 0::numeric) AS paid_hours,
  CASE
    WHEN COALESCE(sc.paid_hours_monthly, 0::numeric) > 0::numeric
      THEN round(COALESCE(py.gross_cents, 0::bigint)::numeric / sc.paid_hours_monthly)
    ELSE 0::numeric
  END AS sales_per_hour_cents,
  COALESCE(bs.booked_minutes, 0) AS booked_minutes,
  COALESCE(bs.fix_count, 0) AS fix_count,
  CASE
    WHEN COALESCE(sc.paid_hours_monthly, 0::numeric) > 0::numeric
      THEN round(COALESCE(bs.booked_minutes, 0)::numeric / (sc.paid_hours_monthly * 60::numeric), 3)
    ELSE 0::numeric
  END AS utilization_rate
FROM all_keys k
JOIN team_members tm ON tm.id = k.team_member_id
LEFT JOIN pay py ON py.organization_id = k.organization_id AND py.team_member_id = k.team_member_id AND py.period = k.period
LEFT JOIN earnings e ON e.organization_id = k.organization_id AND e.team_member_id = k.team_member_id AND e.period = k.period
LEFT JOIN bstats bs ON bs.organization_id = k.organization_id AND bs.team_member_id = k.team_member_id AND bs.period = k.period
LEFT JOIN sched sc ON sc.organization_id = k.organization_id AND sc.team_member_id = k.team_member_id
LEFT JOIN master_settings ms ON ms.team_member_id = k.team_member_id;

-- ---------------------------------------------------------------------------
-- 5) get_master_salary(uuid, text, uuid)
-- NOTE: b.start_at is `timestamp without time zone` → double AT TIME ZONE.
-- mel.created_at is `timestamp with time zone` → single AT TIME ZONE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_master_salary(org_id uuid, period text, loc_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_start date;
  v_end   date;
  v_result jsonb;
BEGIN
  v_start := (period || '-01')::date;
  v_end   := (v_start + interval '1 month')::date;

  WITH
  earnings AS (
    SELECT
      mel.team_member_id,
      SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'SERVICE_COMMISSION') AS commission_cents,
      SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'TIP') AS tips_cents,
      SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'DISCOUNT_ADJUSTMENT') AS discount_cents,
      SUM(mel.amount_amount) FILTER (WHERE mel.entry_type IN ('FIX_PENALTY', 'FIX_COMPENSATION')) AS fix_cents,
      SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'MANUAL_ADJUSTMENT') AS manual_cents,
      SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'REVERSAL') AS reversal_cents,
      SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'DISPUTE_HOLD') AS dispute_hold_cents,
      SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'DISPUTE_RELEASE') AS dispute_release_cents,
      COUNT(DISTINCT mel.booking_id) FILTER (WHERE mel.entry_type = 'SERVICE_COMMISSION') AS booking_count,
      SUM(mel.amount_amount) AS total_net_cents
    FROM master_earnings_ledger mel
    LEFT JOIN bookings b ON b.id = mel.booking_id AND b.organization_id = mel.organization_id
    WHERE mel.organization_id = org_id
      AND (
        (b.id IS NOT NULL
          AND (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date >= v_start
          AND (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date < v_end)
        OR
        (b.id IS NULL
          AND (mel.created_at AT TIME ZONE 'America/Los_Angeles')::date >= v_start
          AND (mel.created_at AT TIME ZONE 'America/Los_Angeles')::date < v_end)
      )
      AND (loc_id IS NULL OR b.location_id = loc_id)
    GROUP BY mel.team_member_id
  ),
  bstats AS (
    SELECT
      b.technician_id AS team_member_id,
      SUM(COALESCE(bs.price_snapshot_amount, 0))::bigint AS gross_cents,
      SUM(COALESCE(b.duration_minutes, 0))::int AS booked_minutes,
      COUNT(*) FILTER (WHERE bs.is_fix = true)::int AS fix_count
    FROM bookings b
    LEFT JOIN booking_snapshots bs ON bs.booking_id = b.id
    WHERE b.organization_id = org_id
      AND b.status = 'ACCEPTED'
      AND b.technician_id IS NOT NULL
      AND (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date >= v_start
      AND (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date < v_end
      AND (loc_id IS NULL OR b.location_id = loc_id)
    GROUP BY b.technician_id
  ),
  sched AS (
    WITH period_days AS (
      SELECT generate_series(v_start, v_end - interval '1 day', '1 day')::date AS d
    )
    SELECT
      ws.team_member_id,
      SUM(ws.scheduled_minutes) AS total_scheduled_minutes
    FROM master_weekly_schedule ws
    CROSS JOIN period_days pd
    WHERE ws.organization_id = org_id
      AND ws.day_of_week = EXTRACT(DOW FROM pd.d)::int
      AND (loc_id IS NULL OR ws.location_id = loc_id)
    GROUP BY ws.team_member_id
  ),
  all_ids AS (
    SELECT team_member_id FROM earnings
    UNION
    SELECT team_member_id FROM bstats
  ),
  masters AS (
    SELECT
      a.team_member_id AS master_id,
      TRIM(COALESCE(tm.given_name, '') || ' ' || COALESCE(tm.family_name, '')) AS name,
      COALESCE(ms.category::text, 'UNKNOWN') AS category,
      COALESCE(ms.location_code::text, 'UNKNOWN') AS location,
      COALESCE(ms.commission_rate, 0) AS commission_rate,
      COALESCE(bs.gross_cents, 0)::bigint AS gross_sales_cents,
      COALESCE(e.commission_cents, 0)::bigint AS commission_cents,
      COALESCE(e.tips_cents, 0)::bigint AS tips_cents,
      COALESCE(e.discount_cents, 0)::bigint AS discount_adjustment_cents,
      COALESCE(e.fix_cents, 0)::bigint AS fix_transfer_cents,
      COALESCE(e.manual_cents, 0)::bigint AS manual_adjustment_cents,
      COALESCE(e.reversal_cents, 0)::bigint AS reversal_cents,
      COALESCE(e.dispute_hold_cents, 0)::bigint AS dispute_hold_cents,
      COALESCE(e.dispute_release_cents, 0)::bigint AS dispute_release_cents,
      (COALESCE(e.commission_cents,0) + COALESCE(e.discount_cents,0) + COALESCE(e.fix_cents,0)
        + COALESCE(e.manual_cents,0) + COALESCE(e.reversal_cents,0)
        + COALESCE(e.dispute_hold_cents,0) + COALESCE(e.dispute_release_cents,0))::bigint AS net_salary_cents,
      (COALESCE(e.commission_cents,0) + COALESCE(e.discount_cents,0) + COALESCE(e.fix_cents,0)
        + COALESCE(e.manual_cents,0) + COALESCE(e.reversal_cents,0)
        + COALESCE(e.dispute_hold_cents,0) + COALESCE(e.dispute_release_cents,0)
        + COALESCE(e.tips_cents,0))::bigint AS total_with_tips_cents,
      ROUND(COALESCE(sc.total_scheduled_minutes, 0) / 60.0, 1) AS paid_hours,
      CASE WHEN COALESCE(sc.total_scheduled_minutes, 0) > 0
        THEN ROUND(COALESCE(bs.gross_cents, 0) / (sc.total_scheduled_minutes / 60.0))
        ELSE 0 END AS sales_per_hour_cents,
      COALESCE(bs.booked_minutes, 0) AS booked_minutes,
      COALESCE(e.booking_count, 0)::int AS booking_count,
      COALESCE(bs.fix_count, 0)::int AS fix_count,
      CASE WHEN COALESCE(sc.total_scheduled_minutes, 0) > 0
        THEN ROUND(COALESCE(bs.booked_minutes, 0)::numeric / sc.total_scheduled_minutes, 3)
        ELSE 0 END AS utilization_rate,
      (COALESCE(e.discount_cents,0) + COALESCE(e.fix_cents,0) + COALESCE(e.reversal_cents,0)
        + COALESCE(e.dispute_hold_cents,0) + COALESCE(e.dispute_release_cents,0)
        + LEAST(0, COALESCE(e.manual_cents,0)))::bigint AS deductions_cents
    FROM all_ids a
    JOIN team_members tm ON tm.id = a.team_member_id AND tm.status = 'ACTIVE'
    LEFT JOIN earnings e ON e.team_member_id = a.team_member_id
    LEFT JOIN bstats bs ON bs.team_member_id = a.team_member_id
    LEFT JOIN sched sc ON sc.team_member_id = a.team_member_id
    LEFT JOIN master_settings ms ON ms.team_member_id = a.team_member_id
    ORDER BY net_salary_cents DESC
  )
  SELECT jsonb_build_object(
    'period', period,
    'masters', COALESCE(jsonb_agg(to_jsonb(m)), '[]'::jsonb),
    'totals', jsonb_build_object(
      'gross_sales_cents', COALESCE(SUM(m.gross_sales_cents), 0),
      'commission_cents', COALESCE(SUM(m.commission_cents), 0),
      'tips_cents', COALESCE(SUM(m.tips_cents), 0),
      'discount_adjustment_cents', COALESCE(SUM(m.discount_adjustment_cents), 0),
      'fix_transfer_cents', COALESCE(SUM(m.fix_transfer_cents), 0),
      'manual_adjustment_cents', COALESCE(SUM(m.manual_adjustment_cents), 0),
      'reversal_cents', COALESCE(SUM(m.reversal_cents), 0),
      'dispute_hold_cents', COALESCE(SUM(m.dispute_hold_cents), 0),
      'dispute_release_cents', COALESCE(SUM(m.dispute_release_cents), 0),
      'deductions_cents', COALESCE(SUM(m.deductions_cents), 0),
      'net_salary_cents', COALESCE(SUM(m.net_salary_cents), 0),
      'total_with_tips_cents', COALESCE(SUM(m.total_with_tips_cents), 0),
      'total_services', COALESCE(SUM(m.booking_count), 0),
      'total_paid_hours', COALESCE(ROUND(SUM(m.paid_hours), 1), 0),
      'master_count', COUNT(*)
    )
  ) INTO v_result
  FROM masters m;

  RETURN v_result;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6) get_new_customers_by_location(uuid, date, date)
-- NOTE: b.start_at is `timestamp without time zone` → double AT TIME ZONE.
-- ca.first_booking_at is `timestamp with time zone` → single AT TIME ZONE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_new_customers_by_location(
  p_organization_id uuid,
  p_start_date date,
  p_end_date date
)
 RETURNS TABLE(date date, location_id uuid, new_customers_count bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS date,
    b.location_id,
    COUNT(DISTINCT ca.square_customer_id) AS new_customers_count
  FROM public.customer_analytics ca
  JOIN public.bookings b
    ON b.customer_id = ca.square_customer_id
    AND b.organization_id = ca.organization_id
    AND (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
        = (ca.first_booking_at AT TIME ZONE 'America/Los_Angeles')::date
    AND b.status = 'ACCEPTED'
  WHERE ca.organization_id = p_organization_id
    AND (ca.first_booking_at AT TIME ZONE 'America/Los_Angeles')::date >= p_start_date
    AND (ca.first_booking_at AT TIME ZONE 'America/Los_Angeles')::date <= p_end_date
    AND ca.first_booking_at IS NOT NULL
  GROUP BY
    (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date,
    b.location_id
  ORDER BY 1;
$function$;
