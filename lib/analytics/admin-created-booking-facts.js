/**
 * Admin Created Booking Facts - New vs Rebook classification
 *
 * Refreshes admin_created_booking_facts with prior-paid logic.
 * Snapshot fields (administrator_*, creator_*, timestamps) are IMMUTABLE - only set on INSERT.
 * Classification fields are Mutable in correction window (last N days).
 *
 * @see docs/ADMIN_CREATED_BOOKINGS_NEW_REBOOK_CONTRACT.md
 */

const CORRECTION_WINDOW_DAYS = 35

/**
 * Created-by-admin filter (same as created_agg in refresh-admin).
 * Requires source = FIRST_PARTY_MERCHANT (Square: created by seller from Square Appointments)
 * or source IS NULL (legacy data). Excludes FIRST_PARTY_BUYER, THIRD_PARTY_BUYER, API, etc.
 */
const CREATED_BY_ADMIN_WHERE = `
  (b.creator_type = 'TEAM_MEMBER' 
   OR b.raw_json->'creator_details'->>'creator_type' = 'TEAM_MEMBER'
   OR EXISTS (
     SELECT 1 FROM team_members tm 
     WHERE tm.square_team_member_id = b.raw_json->'creator_details'->>'team_member_id'
       AND tm.organization_id = b.organization_id
   ))
  AND (COALESCE(b.source, b.raw_json->>'source') IS NULL
       OR COALESCE(b.source, b.raw_json->>'source') = 'FIRST_PARTY_MERCHANT')
`

/**
 * Refresh admin_created_booking_facts for bookings in date range.
 * - New records: INSERT with full snapshot
 * - Existing records in correction window: UPDATE only mutable fields (classification, prior_paid_exists)
 * - Existing records outside correction window: skip (immutable)
 *
 * @param {object} db - Prisma client
 * @param {string} dateFrom - SQL expression e.g. "NOW() - interval '35 days'" or "'2026-01-01 00:00:00'"
 * @param {string} dateTo - SQL expression
 * @returns {{ inserted: number, updated: number, skipped: number }}
 */
async function refreshAdminCreatedBookingFacts(db, dateFrom, dateTo) {
  // Step 0: Remove facts for inactive team members and non-FIRST_PARTY_MERCHANT source
  const deletedSource = await db.$executeRawUnsafe(`
    DELETE FROM admin_created_booking_facts f
    USING bookings b
    WHERE f.booking_id = b.id
      AND COALESCE(b.source, b.raw_json->>'source') IS NOT NULL
      AND COALESCE(b.source, b.raw_json->>'source') <> 'FIRST_PARTY_MERCHANT'
  `)
  const deletedInactive = await db.$executeRawUnsafe(`
    DELETE FROM admin_created_booking_facts
    WHERE administrator_id_snapshot IN (SELECT id FROM team_members WHERE status = 'INACTIVE')
  `)
  const deleted = (Number(deletedSource) || 0) + (Number(deletedInactive) || 0)

  // Step 1: Compute all created-by-admin bookings with prior_paid and classification
  const computeSQL = `
    WITH date_range AS (
      SELECT (${dateFrom})::timestamptz as start_limit, (${dateTo})::timestamptz as end_limit
    ),
    created_by_admin AS (
      SELECT
        b.id as booking_uuid,
        b.booking_id as square_booking_id,
        b.organization_id,
        b.location_id,
        b.customer_id,
        COALESCE(b.administrator_id, tm_sys.id) as administrator_id,
        CONCAT(tm.given_name, ' ', tm.family_name) as administrator_name,
        COALESCE(b.creator_type, b.raw_json->'creator_details'->>'creator_type', 'TEAM_MEMBER') as creator_type,
        CASE 
          WHEN b.creator_type = 'TEAM_MEMBER' THEN 'creator_type'
          WHEN b.raw_json->'creator_details'->>'creator_type' = 'TEAM_MEMBER' THEN 'raw_json'
          ELSE 'team_member_match'
        END as creator_resolution_source,
        b.created_at as created_at_utc,
        b.start_at as start_at_utc,
        DATE(b.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') as created_day_pacific,
        DATE(b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') as visit_day_pacific,
        DATE_TRUNC('month', (b.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::timestamptz)::date as created_month_pacific,
        DATE_TRUNC('month', (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::timestamptz)::date as visit_month_pacific
      FROM bookings b
      CROSS JOIN date_range dr
      LEFT JOIN team_members tm_sys ON tm_sys.organization_id = b.organization_id AND tm_sys.is_system = true
      LEFT JOIN team_members tm ON tm.id = COALESCE(b.administrator_id, tm_sys.id)
      WHERE b.created_at >= dr.start_limit AND b.created_at < dr.end_limit
        AND b.customer_id IS NOT NULL
        AND ${CREATED_BY_ADMIN_WHERE.replace(/\n\s+/g, ' ').trim()}
        AND COALESCE(b.administrator_id, tm_sys.id) NOT IN (SELECT id FROM team_members WHERE status = 'INACTIVE')
    ),
    with_prior_paid AS (
      SELECT
        c.*,
        EXISTS (
          SELECT 1 FROM payments p
          INNER JOIN bookings b_prior ON p.booking_id = b_prior.id
          WHERE b_prior.organization_id = c.organization_id
            AND b_prior.customer_id = c.customer_id
            AND p.status = 'COMPLETED'
            AND (b_prior.start_at, b_prior.created_at, COALESCE(b_prior.booking_id, '')) < (c.start_at_utc, c.created_at_utc, COALESCE(c.square_booking_id, ''))
        ) as prior_paid_exists
      FROM created_by_admin c
    ),
    classified AS (
      SELECT
        *,
        CASE WHEN prior_paid_exists THEN 'REBOOKING' ELSE 'NEW_CLIENT' END as classification_snapshot,
        CASE WHEN prior_paid_exists THEN 'HAS_PRIOR_PAID' ELSE 'NO_PRIOR_PAID' END as classification_reason_snapshot,
        (visit_month_pacific = created_month_pacific) as is_same_month,
        (visit_month_pacific > created_month_pacific) as is_future_month,
        (visit_month_pacific < created_month_pacific) as is_past_month
      FROM with_prior_paid
    )
    SELECT * FROM classified
  `

  const rows = await db.$queryRawUnsafe(computeSQL)

  if (!rows || rows.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0, deleted: Number(deleted) || 0 }
  }

  let inserted = 0
  let updated = 0
  let skipped = 0

  const now = new Date()

  for (const row of rows) {
    const existing = await db.adminCreatedBookingFact.findUnique({
      where: { booking_id: row.booking_uuid }
    })

    if (!existing) {
      await db.adminCreatedBookingFact.create({
        data: {
          booking_id: row.booking_uuid,
          organization_id: row.organization_id,
          location_id: row.location_id,
          customer_id: row.customer_id,
          administrator_id_snapshot: row.administrator_id,
          administrator_name_snapshot: row.administrator_name,
          creator_type_snapshot: row.creator_type,
          creator_resolution_source: row.creator_resolution_source,
          created_at_utc: row.created_at_utc,
          start_at_utc: row.start_at_utc,
          created_day_pacific: row.created_day_pacific,
          visit_day_pacific: row.visit_day_pacific,
          created_month_pacific: row.created_month_pacific,
          visit_month_pacific: row.visit_month_pacific,
          classification_snapshot: row.classification_snapshot,
          classification_reason_snapshot: row.classification_reason_snapshot,
          prior_paid_exists: row.prior_paid_exists,
          is_same_month: row.is_same_month,
          is_future_month: row.is_future_month,
          is_past_month: row.is_past_month,
          snapshot_calculated_at: now
        }
      })
      inserted++
    } else {
      const inCorrectionWindow = new Date(row.created_at_utc) >= new Date(Date.now() - CORRECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000)
      if (inCorrectionWindow) {
        await db.adminCreatedBookingFact.update({
          where: { booking_id: row.booking_uuid },
          data: {
            classification_snapshot: row.classification_snapshot,
            classification_reason_snapshot: row.classification_reason_snapshot,
            prior_paid_exists: row.prior_paid_exists,
            snapshot_calculated_at: now
          }
        })
        updated++
      } else {
        skipped++
      }
    }
  }

  return { inserted, updated, skipped, deleted: Number(deleted) || 0 }
}

/**
 * Build date range SQL expressions (same as refresh-admin)
 */
function buildDateRange(params = {}) {
  const { from, to, days = 35 } = params
  if (from && to) {
    return {
      dateFrom: `'${from} 00:00:00'`,
      dateTo: `'${to} 23:59:59'`
    }
  }
  return {
    dateFrom: `NOW() - interval '${days} days'`,
    dateTo: `NOW() + interval '1 day'`
  }
}

module.exports = {
  refreshAdminCreatedBookingFacts,
  buildDateRange,
  CORRECTION_WINDOW_DAYS
}
