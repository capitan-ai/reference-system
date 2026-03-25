-- View: v_master_salary_monthly
-- Lovable: supabase.from('v_master_salary_monthly').select('*').eq('organization_id', orgId).eq('period', '2026-03')
--
-- Gross Sales & Tips: from PAYMENTS table (matches Square exactly)
-- Commission & Deductions: from master_earnings_ledger (our business logic)
-- Technician resolution chain:
--   1. payments.technician_id (set by webhook + backfill)
--   2. payments.booking_id → bookings.technician_id
--   3. payments.order_id → orders.booking_id → bookings.technician_id (orphan fallback)

DROP VIEW IF EXISTS v_master_salary_monthly;

CREATE VIEW v_master_salary_monthly AS
WITH
-- PAYMENTS aggregated by (technician, month) — SOURCE OF TRUTH for gross/tips
pay AS (
  SELECT
    p.organization_id,
    COALESCE(p.technician_id, b.technician_id, b2.technician_id) AS team_member_id,
    to_char((p.created_at AT TIME ZONE 'America/Los_Angeles')::date, 'YYYY-MM') AS period,
    SUM(p.amount_money_amount)::bigint AS gross_cents,
    SUM(COALESCE(p.tip_money_amount, 0))::bigint AS tips_cents,
    COUNT(DISTINCT p.id)::int AS sale_count
  FROM payments p
  -- Primary: payment → booking → technician
  LEFT JOIN bookings b ON b.id = p.booking_id
  -- Fallback for orphan payments: payment → order → order.booking_id → booking → technician
  LEFT JOIN orders o ON o.id = p.order_id AND p.booking_id IS NULL
  LEFT JOIN bookings b2 ON b2.id = o.booking_id AND b2.technician_id IS NOT NULL AND p.booking_id IS NULL
  WHERE p.status = 'COMPLETED'
    AND cardinality(p.refund_ids) = 0
    AND COALESCE(p.technician_id, b.technician_id, b2.technician_id) IS NOT NULL
  GROUP BY 1, 2, 3
),
-- LEDGER for commission/deductions (our calculated values)
earnings AS (
  SELECT
    mel.organization_id,
    mel.team_member_id,
    to_char(
      COALESCE(
        (bk.start_at AT TIME ZONE 'America/Los_Angeles')::date,
        (mel.created_at AT TIME ZONE 'America/Los_Angeles')::date
      ), 'YYYY-MM'
    ) AS period,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'SERVICE_COMMISSION') AS commission_cents,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'DISCOUNT_ADJUSTMENT') AS discount_cents,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type IN ('FIX_PENALTY', 'FIX_COMPENSATION')) AS fix_cents,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'MANUAL_ADJUSTMENT') AS manual_cents,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'REVERSAL') AS reversal_cents,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'DISPUTE_HOLD') AS dispute_hold_cents,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'DISPUTE_RELEASE') AS dispute_release_cents
  FROM master_earnings_ledger mel
  LEFT JOIN bookings bk ON bk.id = mel.booking_id AND bk.organization_id = mel.organization_id
  GROUP BY mel.organization_id, mel.team_member_id,
    to_char(COALESCE(
      (bk.start_at AT TIME ZONE 'America/Los_Angeles')::date,
      (mel.created_at AT TIME ZONE 'America/Los_Angeles')::date
    ), 'YYYY-MM')
),
-- BOOKING stats (booked minutes, fix count)
bstats AS (
  SELECT
    b.organization_id,
    b.technician_id AS team_member_id,
    to_char((b.start_at AT TIME ZONE 'America/Los_Angeles')::date, 'YYYY-MM') AS period,
    SUM(COALESCE(b.duration_minutes, 0))::int AS booked_minutes,
    COUNT(*) FILTER (WHERE bs.is_fix = true)::int AS fix_count
  FROM bookings b
  LEFT JOIN booking_snapshots bs ON bs.booking_id = b.id
  WHERE b.status = 'ACCEPTED'
    AND b.technician_id IS NOT NULL
  GROUP BY b.organization_id, b.technician_id,
    to_char((b.start_at AT TIME ZONE 'America/Los_Angeles')::date, 'YYYY-MM')
),
-- All master/period keys (union of payments + ledger)
all_keys AS (
  SELECT organization_id, team_member_id, period FROM pay
  UNION
  SELECT organization_id, team_member_id, period FROM earnings
),
-- Schedule: avg monthly hours per master (weekly sum × 4.33 weeks)
sched AS (
  SELECT
    ws.organization_id,
    ws.team_member_id,
    ROUND(SUM(ws.scheduled_minutes) * 4.33 / 60.0, 1) AS paid_hours_monthly
  FROM master_weekly_schedule ws
  GROUP BY ws.organization_id, ws.team_member_id
)
SELECT
  k.organization_id,
  k.period,
  k.team_member_id AS master_id,
  TRIM(COALESCE(tm.given_name, '') || ' ' || COALESCE(tm.family_name, '')) AS name,
  COALESCE(ms.category::text, 'UNKNOWN') AS category,
  COALESCE(ms.location_code::text, 'UNKNOWN') AS location,
  COALESCE(ms.commission_rate, 0) AS commission_rate,

  -- Revenue (from PAYMENTS — matches Square)
  COALESCE(py.gross_cents, 0)::bigint AS gross_sales_cents,
  COALESCE(py.tips_cents, 0)::bigint AS tips_cents,
  COALESCE(py.sale_count, 0)::int AS sale_count,

  -- Commission (from LEDGER — our calculated value)
  COALESCE(e.commission_cents, 0)::bigint AS commission_cents,

  -- Deduction components (from LEDGER)
  COALESCE(e.discount_cents, 0)::bigint AS discount_adjustment_cents,
  COALESCE(e.fix_cents, 0)::bigint AS fix_transfer_cents,
  COALESCE(e.manual_cents, 0)::bigint AS manual_adjustment_cents,
  COALESCE(e.reversal_cents, 0)::bigint AS reversal_cents,
  COALESCE(e.dispute_hold_cents, 0)::bigint AS dispute_hold_cents,
  COALESCE(e.dispute_release_cents, 0)::bigint AS dispute_release_cents,

  -- Deductions total
  (COALESCE(e.discount_cents,0) + COALESCE(e.fix_cents,0) + COALESCE(e.reversal_cents,0)
    + COALESCE(e.dispute_hold_cents,0) + COALESCE(e.dispute_release_cents,0)
    + LEAST(0, COALESCE(e.manual_cents,0)))::bigint AS deductions_cents,

  -- Net salary (commission + all adjustments, excluding tips)
  (COALESCE(e.commission_cents,0) + COALESCE(e.discount_cents,0) + COALESCE(e.fix_cents,0)
    + COALESCE(e.manual_cents,0) + COALESCE(e.reversal_cents,0)
    + COALESCE(e.dispute_hold_cents,0) + COALESCE(e.dispute_release_cents,0))::bigint AS net_salary_cents,

  -- Total payout (net + tips from payments)
  (COALESCE(e.commission_cents,0) + COALESCE(e.discount_cents,0) + COALESCE(e.fix_cents,0)
    + COALESCE(e.manual_cents,0) + COALESCE(e.reversal_cents,0)
    + COALESCE(e.dispute_hold_cents,0) + COALESCE(e.dispute_release_cents,0)
    + COALESCE(py.tips_cents,0))::bigint AS total_with_tips_cents,

  -- Productivity
  COALESCE(sc.paid_hours_monthly, 0) AS paid_hours,
  CASE WHEN COALESCE(sc.paid_hours_monthly, 0) > 0
    THEN ROUND(COALESCE(py.gross_cents, 0) / sc.paid_hours_monthly)
    ELSE 0 END AS sales_per_hour_cents,
  COALESCE(bs.booked_minutes, 0) AS booked_minutes,
  COALESCE(bs.fix_count, 0)::int AS fix_count,
  CASE WHEN COALESCE(sc.paid_hours_monthly, 0) > 0
    THEN ROUND(COALESCE(bs.booked_minutes, 0)::numeric / (sc.paid_hours_monthly * 60), 3)
    ELSE 0 END AS utilization_rate

FROM all_keys k
JOIN team_members tm ON tm.id = k.team_member_id
LEFT JOIN pay py ON py.organization_id = k.organization_id AND py.team_member_id = k.team_member_id AND py.period = k.period
LEFT JOIN earnings e ON e.organization_id = k.organization_id AND e.team_member_id = k.team_member_id AND e.period = k.period
LEFT JOIN bstats bs ON bs.organization_id = k.organization_id AND bs.team_member_id = k.team_member_id AND bs.period = k.period
LEFT JOIN sched sc ON sc.organization_id = k.organization_id AND sc.team_member_id = k.team_member_id
LEFT JOIN master_settings ms ON ms.team_member_id = k.team_member_id;
