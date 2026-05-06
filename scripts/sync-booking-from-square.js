#!/usr/bin/env node
/**
 * Pull canonical booking fields from Square retrieveBooking and update `bookings`
 * (and active segments' booking_start_at). Fixes stale start_at / raw_json vs Square.
 *
 * Usage:
 *   node scripts/sync-booking-from-square.js <square_booking_id> [more_ids...]
 *   node scripts/sync-booking-from-square.js --dry-run <id>
 *
 * Implementation note: this script delegates the actual upsert to
 * lib/sync/apply-square-booking.js so the same logic powers bulk monthly sync.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const axios = require('axios')
const prisma = require('../lib/prisma-client')
const { applySquareBookingToDb } = require('../lib/sync/apply-square-booking')

const SQUARE_TOKEN = (process.env.SQUARE_ACCESS_TOKEN || '').replace(/^Bearer /, '').trim()
const SQUARE_BASE_URL =
  process.env.SQUARE_ENV === 'sandbox' || process.env.SQUARE_ENVIRONMENT === 'sandbox'
    ? 'https://connect.squareupsandbox.com/v2'
    : 'https://connect.squareup.com/v2'

function parseArgs() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const ids = argv.filter((a) => a !== '--dry-run')
  return { dryRun, ids }
}

async function fetchSquareBooking(squareBookingId) {
  const res = await axios.get(`${SQUARE_BASE_URL}/bookings/${squareBookingId}`, {
    headers: {
      Authorization: `Bearer ${SQUARE_TOKEN}`,
      'Square-Version': '2025-02-20',
      Accept: 'application/json',
    },
  })
  return res.data?.booking || null
}

async function syncOne(squareBookingId, dryRun) {
  // Resolve organization for this booking — find any local row that references it
  const candidates = await prisma.booking.findMany({
    where: {
      OR: [
        { booking_id: squareBookingId },
        { booking_id: { startsWith: `${squareBookingId}-` } },
      ],
    },
    orderBy: [{ version: 'desc' }, { updated_at: 'desc' }],
    select: { id: true, organization_id: true, booking_id: true },
  })
  const local = candidates[0] || null

  if (!local) {
    console.error(`❌ No row in bookings for booking_id=${squareBookingId} (or ${squareBookingId}-*)`)
    return { ok: false, reason: 'not_found' }
  }

  let booking
  try {
    booking = await fetchSquareBooking(squareBookingId)
  } catch (err) {
    console.error(`❌ Square API error for ${squareBookingId}: ${err.message}`)
    return { ok: false, reason: 'square_api_error' }
  }

  if (!booking) {
    console.error(`❌ Square returned no booking for ${squareBookingId}`)
    return { ok: false, reason: 'square_empty' }
  }

  const result = await applySquareBookingToDb(booking, {
    organizationId: local.organization_id,
    dryRun,
  })

  console.log(`\n${squareBookingId}`)
  if (result.before) {
    console.log('  before:', result.before)
  } else {
    console.log('  before: (no local row — would insert)')
  }
  console.log('  after: ', result.after)
  console.log(`  action: ${result.action}${result.reason ? ` (${result.reason})` : ''}`)
  if (dryRun) {
    console.log('  (dry-run, no DB write)')
  } else if (result.action !== 'noop' && result.action !== 'skipped') {
    console.log('  ✅ updated bookings + active segments booking_start_at')
  }

  return { ok: result.action !== 'skipped', action: result.action }
}

async function main() {
  const { dryRun, ids } = parseArgs()
  if (ids.length === 0) {
    console.error('Usage: node scripts/sync-booking-from-square.js [--dry-run] <booking_id> [...]')
    process.exit(1)
  }

  let failed = 0
  for (const id of ids) {
    try {
      const r = await syncOne(id.trim(), dryRun)
      if (!r.ok) failed++
    } catch (e) {
      console.error(`❌ ${id}: ${e.message}`)
      failed++
    }
  }

  if (failed) process.exit(1)
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}

module.exports = { syncOne, fetchSquareBooking }
