#!/usr/bin/env node
/**
 * Backfill admin_created_booking_facts table.
 * Idempotent: INSERT for new records, UPDATE only mutable fields for existing (in correction window).
 *
 * Usage:
 *   node scripts/backfill-admin-created-booking-facts.js [--dry-run] [--days=35] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
 *
 * @see docs/ADMIN_CREATED_BOOKINGS_NEW_REBOOK_CONTRACT.md
 */

const db = require('../lib/prisma-client')
const { refreshAdminCreatedBookingFacts, buildDateRange } = require('../lib/analytics/admin-created-booking-facts')

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const daysParam = process.argv.find(arg => arg.startsWith('--days='))?.split('=')[1] || '35'
  const fromParam = process.argv.find(arg => arg.startsWith('--from='))?.split('=')[1]
  const toParam = process.argv.find(arg => arg.startsWith('--to='))?.split('=')[1]

  const { dateFrom, dateTo } = buildDateRange({
    from: fromParam,
    to: toParam,
    days: parseInt(daysParam, 10)
  })

  console.log('\n--- Backfill admin_created_booking_facts ---')
  console.log(`Date range: ${dateFrom} to ${dateTo}`)
  if (dryRun) {
    console.log('DRY RUN - no changes will be made')
  }
  console.log('')

  try {
    if (dryRun) {
      const computeSQL = `
        WITH date_range AS (
          SELECT (${dateFrom})::timestamptz as start_limit, (${dateTo})::timestamptz as end_limit
        ),
        created_by_admin AS (
          SELECT b.id as booking_uuid
          FROM bookings b
          CROSS JOIN date_range dr
          LEFT JOIN team_members tm_sys ON tm_sys.organization_id = b.organization_id AND tm_sys.is_system = true
          WHERE b.created_at >= dr.start_limit AND b.created_at < dr.end_limit
            AND b.customer_id IS NOT NULL
            AND (
              ((b.creator_type = 'TEAM_MEMBER' OR b.raw_json->'creator_details'->>'creator_type' = 'TEAM_MEMBER'
                OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.square_team_member_id = b.raw_json->'creator_details'->>'team_member_id' AND tm.organization_id = b.organization_id))
               AND (COALESCE(b.source, b.raw_json->>'source') IS NULL OR COALESCE(b.source, b.raw_json->>'source') = 'FIRST_PARTY_MERCHANT'))
              OR
              (b.administrator_id IS NULL AND COALESCE(b.source, b.raw_json->>'source') IN ('FIRST_PARTY_BUYER', 'THIRD_PARTY_BUYER'))
            )
            AND COALESCE(b.administrator_id, tm_sys.id) NOT IN (SELECT id FROM team_members WHERE status = 'INACTIVE')
        )
        SELECT COUNT(*)::int as cnt FROM created_by_admin
      `
      const rows = await db.$queryRawUnsafe(computeSQL)
      const cnt = rows[0]?.cnt ?? 0
      console.log(`Would process ${cnt} created-by-admin bookings`)
      console.log('Dry run complete.')
      return
    }

    const result = await refreshAdminCreatedBookingFacts(db, dateFrom, dateTo)
    console.log(`Deleted (customer-source): ${result.deleted ?? 0}`)
    console.log(`Inserted: ${result.inserted}`)
    console.log(`Updated (correction window): ${result.updated}`)
    console.log(`Skipped (outside correction window): ${result.skipped}`)
    console.log('\nBackfill complete.')
  } catch (err) {
    console.error('Error:', err.message)
    process.exit(1)
  } finally {
    await db.$disconnect()
  }
}

main()
