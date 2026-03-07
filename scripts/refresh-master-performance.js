const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Aggregates data from master_earnings_ledger and bookings 
 * into the master_performance_daily table.
 */
async function refreshMasterPerformance(organizationId) {
  console.log(`[REFRESH-MASTER-PERFORMANCE] Starting for org: ${organizationId}`);

  try {
    const refreshSQL = `
INSERT INTO master_performance_daily (
  date, master_id, organization_id, location_id,
  gross_generated, net_master_income, margin_contribution, tips_total,
  booked_minutes, available_minutes, utilization_rate, booking_count, fix_count, composite_score, updated_at
)
WITH 
ledger_agg AS (
  SELECT 
    (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date as date,
    team_member_id as master_id,
    organization_id,
    SUM(amount_amount) FILTER (WHERE entry_type = 'SERVICE_COMMISSION') as commission_cents,
    SUM(amount_amount) FILTER (WHERE entry_type = 'TIP') as tips_cents
  FROM master_earnings_ledger
  WHERE organization_id = $1::uuid
  GROUP BY 1, 2, 3
),
booking_agg AS (
  SELECT 
    (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date as date,
    technician_id as master_id,
    organization_id,
    MAX(location_id::text)::uuid AS location_id,
    COUNT(*) as b_count,
    COUNT(*) FILTER (WHERE service_variation_id IN (SELECT uuid FROM service_variation WHERE name ~* 'fix')) as f_count,
    SUM(duration_minutes) as total_minutes,
    SUM(COALESCE((SELECT price_snapshot_amount FROM booking_snapshots WHERE booking_id = bookings.id), 0)) as total_gross
  FROM bookings
  WHERE organization_id = $1::uuid
    AND status = 'ACCEPTED'
    AND location_id IS NOT NULL
    AND technician_id IS NOT NULL
  GROUP BY 1, 2, 3
)
SELECT 
  ba.date,
  ba.master_id,
  ba.organization_id,
  ba.location_id,
  COALESCE(ba.total_gross, 0) as gross_generated,
  COALESCE(la.commission_cents, 0) as net_master_income,
  (COALESCE(ba.total_gross, 0) - COALESCE(la.commission_cents, 0)) as margin_contribution,
  COALESCE(la.tips_cents, 0) as tips_total,
  COALESCE(ba.total_minutes, 0) as booked_minutes,
  0 as available_minutes,
  0 as utilization_rate,
  ba.b_count as booking_count,
  ba.f_count as fix_count,
  0 as composite_score,
  NOW() as updated_at
FROM booking_agg ba
LEFT JOIN ledger_agg la ON ba.date = la.date AND ba.master_id = la.master_id
ON CONFLICT (date, master_id) DO UPDATE SET
  gross_generated = EXCLUDED.gross_generated,
  net_master_income = EXCLUDED.net_master_income,
  margin_contribution = EXCLUDED.margin_contribution,
  tips_total = EXCLUDED.tips_total,
  booking_count = EXCLUDED.booking_count,
  fix_count = EXCLUDED.fix_count,
  booked_minutes = EXCLUDED.booked_minutes,
  updated_at = NOW();
    `;

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

