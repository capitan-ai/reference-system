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
 * Created-by-admin OR Online Booking filter (same as created_agg in refresh-admin).
 * Staff: creator_type = TEAM_MEMBER, source = FIRST_PARTY_MERCHANT.
 * Online Booking: administrator_id IS NULL, source IN ('FIRST_PARTY_BUYER', 'THIRD_PARTY_BUYER').
 */
const CREATED_BY_ADMIN_OR_ONLINE_WHERE = `
  (
    (b.creator_type = 'TEAM_MEMBER' 
     OR b.raw_json->'creator_details'->>'creator_type' = 'TEAM_MEMBER'
     OR EXISTS (
       SELECT 1 FROM team_members tm 
       WHERE tm.square_team_member_id = b.raw_json->'creator_details'->>'team_member_id'
         AND tm.organization_id = b.organization_id
     ))
    AND (COALESCE(b.source, b.raw_json->>'source') IS NULL
         OR COALESCE(b.source, b.raw_json->>'source') = 'FIRST_PARTY_MERCHANT')
  )
  OR
  (
    b.administrator_id IS NULL
    AND COALESCE(b.source, b.raw_json->>'source') IN ('FIRST_PARTY_BUYER', 'THIRD_PARTY_BUYER')
  )
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
  // Step 0: Remove facts for inactive team members and excluded sources (keep FIRST_PARTY_MERCHANT, FIRST_PARTY_BUYER, THIRD_PARTY_BUYER)
  const deletedSource = await db.$executeRawUnsafe(`
    DELETE FROM admin_created_booking_facts f
    USING bookings b
    WHERE f.booking_id = b.id
      AND COALESCE(b.source, b.raw_json->>'source') IS NOT NULL
      AND COALESCE(b.source, b.raw_json->>'source') NOT IN ('FIRST_PARTY_MERCHANT', 'FIRST_PARTY_BUYER', 'THIRD_PARTY_BUYER')
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
        COALESCE(b.creator_type, b.raw_json->'creator_details'->>'creator_type',
          CASE WHEN b.administrator_id IS NULL AND COALESCE(b.source, b.raw_json->>'source') IN ('FIRST_PARTY_BUYER', 'THIRD_PARTY_BUYER') THEN 'CUSTOMER' ELSE 'TEAM_MEMBER' END
        ) as creator_type,
        CASE 
          WHEN b.administrator_id IS NULL AND COALESCE(b.source, b.raw_json->>'source') IN ('FIRST_PARTY_BUYER', 'THIRD_PARTY_BUYER') THEN 'online_booking'
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
        AND (${CREATED_BY_ADMIN_OR_ONLINE_WHERE.replace(/\n\s+/g, ' ').trim()})
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

  // Step 2: Count existing before upsert (for reporting)
  const countResult = await db.$queryRawUnsafe(`
    WITH date_range AS (
      SELECT (${dateFrom})::timestamptz as start_limit, (${dateTo})::timestamptz as end_limit
    ),
    ids AS (
      SELECT b.id as bid
      FROM bookings b
      CROSS JOIN date_range dr
      LEFT JOIN team_members tm_sys ON tm_sys.organization_id = b.organization_id AND tm_sys.is_system = true
      WHERE b.created_at >= dr.start_limit AND b.created_at < dr.end_limit
        AND b.customer_id IS NOT NULL
        AND (${CREATED_BY_ADMIN_OR_ONLINE_WHERE.replace(/\n\s+/g, ' ').trim()})
        AND COALESCE(b.administrator_id, tm_sys.id) NOT IN (SELECT id FROM team_members WHERE status = 'INACTIVE')
    )
    SELECT
      (SELECT COUNT(*) FROM ids) as total,
      (SELECT COUNT(*) FROM admin_created_booking_facts f WHERE f.booking_id IN (SELECT bid FROM ids)) as existed_before
  `)
  const total = Number(countResult?.[0]?.total ?? 0)
  const existedBefore = Number(countResult?.[0]?.existed_before ?? 0)

  if (total === 0) {
    return { inserted: 0, updated: 0, skipped: 0, deleted: Number(deleted) || 0 }
  }

  // Step 3: Bulk upsert in a single query (much faster than per-row)
  const now = new Date().toISOString()
  const upsertSQL = `
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
        COALESCE(b.creator_type, b.raw_json->'creator_details'->>'creator_type',
          CASE WHEN b.administrator_id IS NULL AND COALESCE(b.source, b.raw_json->>'source') IN ('FIRST_PARTY_BUYER', 'THIRD_PARTY_BUYER') THEN 'CUSTOMER' ELSE 'TEAM_MEMBER' END
        ) as creator_type,
        CASE 
          WHEN b.administrator_id IS NULL AND COALESCE(b.source, b.raw_json->>'source') IN ('FIRST_PARTY_BUYER', 'THIRD_PARTY_BUYER') THEN 'online_booking'
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
        AND (${CREATED_BY_ADMIN_OR_ONLINE_WHERE.replace(/\n\s+/g, ' ').trim()})
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
    INSERT INTO admin_created_booking_facts (
      booking_id, organization_id, location_id, customer_id,
      administrator_id_snapshot, administrator_name_snapshot, creator_type_snapshot, creator_resolution_source,
      created_at_utc, start_at_utc, created_day_pacific, visit_day_pacific, created_month_pacific, visit_month_pacific,
      classification_snapshot, classification_reason_snapshot, prior_paid_exists,
      is_same_month, is_future_month, is_past_month, snapshot_calculated_at, inserted_at, updated_at
    )
    SELECT
      booking_uuid, organization_id, location_id, customer_id,
      administrator_id, administrator_name, creator_type, creator_resolution_source,
      created_at_utc, start_at_utc, created_day_pacific, visit_day_pacific, created_month_pacific, visit_month_pacific,
      classification_snapshot, classification_reason_snapshot, prior_paid_exists,
      is_same_month, is_future_month, is_past_month, '${now}'::timestamptz, NOW(), NOW()
    FROM classified
    ON CONFLICT (booking_id) DO UPDATE SET
      classification_snapshot = EXCLUDED.classification_snapshot,
      classification_reason_snapshot = EXCLUDED.classification_reason_snapshot,
      prior_paid_exists = EXCLUDED.prior_paid_exists,
      snapshot_calculated_at = EXCLUDED.snapshot_calculated_at,
      updated_at = NOW()
    WHERE admin_created_booking_facts.created_at_utc >= (NOW() - interval '${CORRECTION_WINDOW_DAYS} days')::timestamptz
  `

  const affected = await db.$executeRawUnsafe(upsertSQL)
  const affectedCount = Number(affected) || 0

  const inserted = Math.max(0, total - existedBefore)
  const updated = Math.min(existedBefore, affectedCount)
  const skipped = Math.max(0, existedBefore - updated)

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
