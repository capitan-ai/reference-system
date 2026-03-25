const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Aggregates data from master_earnings_ledger and bookings
 * into the master_performance_daily table.
 *
 * - available_minutes: from master_weekly_schedule (real hours per day-of-week), fallback to MasterSettings
 * - utilization_rate: booked_minutes / available_minutes
 * - composite_score: revenue percentile (0.5) + utilization (0.5)
 * - location_id: one row per (date, master_id, location_id)
 */
async function refreshMasterPerformance(organizationId) {
  console.log(`[REFRESH-MASTER-PERFORMANCE] Starting for org: ${organizationId}`);

  try {
    // Clear stale rows before refresh (prevents zombie data from old PK/logic)
    await prisma.$executeRawUnsafe(
      `DELETE FROM master_performance_daily WHERE organization_id = $1::uuid`,
      organizationId
    )

    const refreshSQL = `
INSERT INTO master_performance_daily (
  date, master_id, organization_id, location_id,
  gross_generated, net_master_income, margin_contribution, tips_total,
  booked_minutes, available_minutes, utilization_rate, booking_count, fix_count, composite_score, updated_at
)
WITH
-- Ledger aggregated by (date, master_id, location_id) via booking
-- Date = service date (start_at), NOT processing date (created_at)
ledger_agg AS (
  SELECT
    (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS date,
    mel.team_member_id AS master_id,
    mel.organization_id,
    b.location_id,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'SERVICE_COMMISSION') AS commission_cents,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'TIP') AS tips_cents,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'DISCOUNT_ADJUSTMENT') AS discount_cents,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type IN ('FIX_PENALTY', 'FIX_COMPENSATION')) AS fix_transfer_cents,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'MANUAL_ADJUSTMENT') AS manual_cents,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'REVERSAL') AS reversal_cents
  FROM master_earnings_ledger mel
  INNER JOIN bookings b ON b.id = mel.booking_id AND b.organization_id = mel.organization_id
  WHERE mel.organization_id = $1::uuid
    AND b.location_id IS NOT NULL
  GROUP BY 1, 2, 3, 4
),
-- Ledger entries without location (booking_id null) - use created_at, attribute to org's first location
ledger_no_loc AS (
  SELECT
    (mel.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS date,
    mel.team_member_id AS master_id,
    mel.organization_id,
    (SELECT id FROM locations WHERE organization_id = mel.organization_id LIMIT 1) AS location_id,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'SERVICE_COMMISSION') AS commission_cents,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'TIP') AS tips_cents,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'DISCOUNT_ADJUSTMENT') AS discount_cents,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type IN ('FIX_PENALTY', 'FIX_COMPENSATION')) AS fix_transfer_cents,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'MANUAL_ADJUSTMENT') AS manual_cents,
    SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'REVERSAL') AS reversal_cents
  FROM master_earnings_ledger mel
  WHERE mel.organization_id = $1::uuid
    AND mel.booking_id IS NULL
  GROUP BY 1, 2, 3
),
ledger_unified AS (
  SELECT * FROM ledger_agg
  UNION ALL
  SELECT * FROM ledger_no_loc WHERE location_id IS NOT NULL
),
-- Bookings aggregated by (date, master_id, location_id)
booking_agg AS (
  SELECT
    (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date AS date,
    technician_id AS master_id,
    organization_id,
    location_id,
    COUNT(*) AS b_count,
    COUNT(*) FILTER (WHERE service_variation_id IN (SELECT uuid FROM service_variation WHERE name ~* 'fix')
      OR id IN (SELECT booking_id FROM booking_snapshots WHERE is_fix = true AND booking_id IS NOT NULL)) AS f_count,
    SUM(duration_minutes) AS total_minutes,
    SUM(COALESCE((SELECT price_snapshot_amount FROM booking_snapshots WHERE booking_id = bookings.id), 0)) AS total_gross
  FROM bookings
  WHERE organization_id = $1::uuid
    AND status = 'ACCEPTED'
    AND location_id IS NOT NULL
    AND technician_id IS NOT NULL
  GROUP BY 1, 2, 3, 4
),
-- Keys: union of all (date, master_id, location_id) from both sources
keys AS (
  SELECT date, master_id, organization_id, location_id FROM booking_agg
  UNION
  SELECT date, master_id, organization_id, location_id FROM ledger_unified
),
-- Base metrics with available_minutes from real weekly schedule
base AS (
  SELECT
    k.date,
    k.master_id,
    k.organization_id,
    k.location_id,
    COALESCE(ba.total_gross, 0)::bigint AS gross_generated,
    (COALESCE(lu.commission_cents, 0) + COALESCE(lu.discount_cents, 0) + COALESCE(lu.fix_transfer_cents, 0) + COALESCE(lu.manual_cents, 0) + COALESCE(lu.reversal_cents, 0))::bigint AS net_master_income,
    (COALESCE(ba.total_gross, 0) - (COALESCE(lu.commission_cents, 0) + COALESCE(lu.discount_cents, 0) + COALESCE(lu.fix_transfer_cents, 0) + COALESCE(lu.manual_cents, 0) + COALESCE(lu.reversal_cents, 0)))::bigint AS margin_contribution,
    COALESCE(lu.tips_cents, 0)::bigint AS tips_total,
    COALESCE(ba.total_minutes, 0) AS booked_minutes,
    COALESCE(
      ws.scheduled_minutes,
      ms.default_working_minutes_per_day,
      0
    ) AS available_minutes,
    COALESCE(ba.b_count, 0) AS booking_count,
    COALESCE(ba.f_count, 0) AS fix_count
  FROM keys k
  LEFT JOIN booking_agg ba
    ON ba.date = k.date AND ba.master_id = k.master_id AND ba.location_id = k.location_id
  LEFT JOIN ledger_unified lu
    ON lu.date = k.date AND lu.master_id = k.master_id AND lu.location_id = k.location_id
  LEFT JOIN master_settings ms ON ms.team_member_id = k.master_id
  LEFT JOIN master_weekly_schedule ws
    ON ws.team_member_id = k.master_id
    AND ws.location_id = k.location_id
    AND ws.day_of_week = EXTRACT(DOW FROM k.date)
),
-- Add utilization_rate and composite_score (percentile within org+date)
with_scores AS (
  SELECT
    b.*,
    CASE
      WHEN b.available_minutes > 0
      THEN LEAST(1.0, b.booked_minutes::float / b.available_minutes)
      ELSE 0
    END AS utilization_rate,
    (
      (PERCENT_RANK() OVER (PARTITION BY b.organization_id, b.date ORDER BY b.net_master_income) * 100 * 0.5)
      + (CASE WHEN b.available_minutes > 0 THEN LEAST(1.0, b.booked_minutes::float / b.available_minutes) ELSE 0 END * 100 * 0.5)
    ) AS composite_score
  FROM base b
)
SELECT
  date,
  master_id,
  organization_id,
  location_id,
  gross_generated,
  net_master_income,
  margin_contribution,
  tips_total,
  booked_minutes,
  available_minutes,
  utilization_rate,
  booking_count,
  fix_count,
  composite_score,
  NOW() AS updated_at
FROM with_scores;
    `;
    // Plain INSERT after DELETE — no ON CONFLICT (42P10 if DB PK ≠ (date, master_id, location_id))

    await prisma.$executeRawUnsafe(refreshSQL, organizationId);
    console.log(`[REFRESH-MASTER-PERFORMANCE] ✅ Success for org: ${organizationId}`);

  } catch (error) {
    console.error(`[REFRESH-MASTER-PERFORMANCE] ❌ Error:`, error.message);
  }
}

// If running directly
if (require.main === module) {
  const orgId = process.argv[2] || 'd0e24178-2f94-4033-bc91-41f22df58278';
  refreshMasterPerformance(orgId).finally(() => prisma.$disconnect());
}

module.exports = { refreshMasterPerformance };
