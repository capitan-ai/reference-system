-- Supabase RPC function for Lovable dashboard
-- Call: supabase.rpc('get_master_salary', { org_id: '...', period: '2026-03', loc_id: null })
--
-- Gross Sales & Tips: from PAYMENTS table (matches Square exactly)
-- Commission & Deductions: from master_earnings_ledger (our business logic)
-- Technician: payments → bookings.technician_id (with order fallback for orphans)

CREATE OR REPLACE FUNCTION get_master_salary(
  org_id uuid,
  period text,           -- 'YYYY-MM'
  loc_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_start date;
  v_end   date;
  v_result jsonb;
BEGIN
  v_start := (period || '-01')::date;
  v_end   := (v_start + interval '1 month')::date;

  WITH
  -- PAYMENTS aggregated by technician — SOURCE OF TRUTH for gross/tips (matches Square)
  pay AS (
    SELECT
      COALESCE(p.technician_id, b.technician_id, b2.technician_id) AS team_member_id,
      SUM(p.amount_money_amount)::bigint AS gross_cents,
      SUM(COALESCE(p.tip_money_amount, 0))::bigint AS tips_cents,
      COUNT(DISTINCT p.id)::int AS sale_count
    FROM payments p
    LEFT JOIN bookings b ON b.id = p.booking_id
    LEFT JOIN orders o ON o.id = p.order_id AND p.booking_id IS NULL
    LEFT JOIN bookings b2 ON b2.id = o.booking_id AND b2.technician_id IS NOT NULL AND p.booking_id IS NULL
    WHERE p.organization_id = org_id
      AND p.status = 'COMPLETED'
      AND cardinality(p.refund_ids) = 0
      AND COALESCE(p.technician_id, b.technician_id, b2.technician_id) IS NOT NULL
      AND (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date >= v_start
      AND (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date < v_end
      AND (loc_id IS NULL OR COALESCE(b.location_id, b2.location_id) = loc_id)
    GROUP BY 1
  ),
  -- Ledger aggregation (commission & deductions)
  earnings AS (
    SELECT
      mel.team_member_id,
      SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'SERVICE_COMMISSION') AS commission_cents,
      SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'DISCOUNT_ADJUSTMENT') AS discount_cents,
      SUM(mel.amount_amount) FILTER (WHERE mel.entry_type IN ('FIX_PENALTY', 'FIX_COMPENSATION')) AS fix_cents,
      SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'MANUAL_ADJUSTMENT') AS manual_cents,
      SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'REVERSAL') AS reversal_cents,
      SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'DISPUTE_HOLD') AS dispute_hold_cents,
      SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'DISPUTE_RELEASE') AS dispute_release_cents,
      COUNT(DISTINCT mel.booking_id) FILTER (WHERE mel.entry_type = 'SERVICE_COMMISSION') AS booking_count
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
  -- Booking stats (booked minutes, fix count)
  bstats AS (
    SELECT
      b.technician_id AS team_member_id,
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
  -- Paid hours from schedule
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
  -- All master IDs (union of payments + ledger)
  all_ids AS (
    SELECT team_member_id FROM pay
    UNION
    SELECT team_member_id FROM earnings
  ),
  -- Build per-master rows
  masters AS (
    SELECT
      a.team_member_id AS master_id,
      TRIM(COALESCE(tm.given_name, '') || ' ' || COALESCE(tm.family_name, '')) AS name,
      COALESCE(ms.category::text, 'UNKNOWN') AS category,
      COALESCE(ms.location_code::text, 'UNKNOWN') AS location,
      COALESCE(ms.commission_rate, 0) AS commission_rate,

      -- Revenue (from PAYMENTS — matches Square)
      COALESCE(py.gross_cents, 0)::bigint AS gross_sales_cents,
      COALESCE(py.tips_cents, 0)::bigint AS tips_cents,
      COALESCE(py.sale_count, 0)::int AS sale_count,

      -- Commission (from LEDGER)
      COALESCE(e.commission_cents, 0)::bigint AS commission_cents,

      -- Deduction components (from LEDGER)
      COALESCE(e.discount_cents, 0)::bigint AS discount_adjustment_cents,
      COALESCE(e.fix_cents, 0)::bigint AS fix_transfer_cents,
      COALESCE(e.manual_cents, 0)::bigint AS manual_adjustment_cents,
      COALESCE(e.reversal_cents, 0)::bigint AS reversal_cents,
      COALESCE(e.dispute_hold_cents, 0)::bigint AS dispute_hold_cents,
      COALESCE(e.dispute_release_cents, 0)::bigint AS dispute_release_cents,

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
      ROUND(COALESCE(sc.total_scheduled_minutes, 0) / 60.0, 1) AS paid_hours,
      CASE WHEN COALESCE(sc.total_scheduled_minutes, 0) > 0
        THEN ROUND(COALESCE(py.gross_cents, 0) / (sc.total_scheduled_minutes / 60.0))
        ELSE 0 END AS sales_per_hour_cents,
      COALESCE(bs.booked_minutes, 0) AS booked_minutes,
      COALESCE(e.booking_count, 0)::int AS booking_count,
      COALESCE(bs.fix_count, 0)::int AS fix_count,
      CASE WHEN COALESCE(sc.total_scheduled_minutes, 0) > 0
        THEN ROUND(COALESCE(bs.booked_minutes, 0)::numeric / sc.total_scheduled_minutes, 3)
        ELSE 0 END AS utilization_rate,

      -- Deductions total
      (COALESCE(e.discount_cents,0) + COALESCE(e.fix_cents,0) + COALESCE(e.reversal_cents,0)
        + COALESCE(e.dispute_hold_cents,0) + COALESCE(e.dispute_release_cents,0)
        + LEAST(0, COALESCE(e.manual_cents,0)))::bigint AS deductions_cents
    FROM all_ids a
    JOIN team_members tm ON tm.id = a.team_member_id AND tm.status = 'ACTIVE'
    LEFT JOIN pay py ON py.team_member_id = a.team_member_id
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
$$;
