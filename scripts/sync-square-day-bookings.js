#!/usr/bin/env node
/**
 * List Square bookings for each org location for a Pacific calendar day,
 * then run sync-booking-from-square for each id (fixes wrong start_at / raw_json).
 *
 * Usage:
 *   node scripts/sync-square-day-bookings.js --date 2026-03-20 [--org <uuid>] [--dry-run]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const axios = require('axios')
const prisma = require('../lib/prisma-client')
const { syncOne } = require('./sync-booking-from-square')

const DEFAULT_ORG = 'd0e24178-2f94-4033-bc91-41f22df58278'

function parseArgs() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const di = argv.indexOf('--date')
  const date = di >= 0 ? argv[di + 1] : null
  const oi = argv.indexOf('--org')
  const org = oi >= 0 ? argv[oi + 1] : DEFAULT_ORG
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('Usage: node scripts/sync-square-day-bookings.js --date YYYY-MM-DD [--org uuid] [--dry-run]')
    process.exit(1)
  }
  return { dryRun, date, org }
}

function startIso(b) {
  return b.startAt || b.start_at
}

function pacificYmd(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

async function pacificDayUtcBounds(ymd) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      (timestamp '${ymd} 00:00:00' AT TIME ZONE 'America/Los_Angeles') AS tmin,
      ((timestamp '${ymd} 00:00:00' AT TIME ZONE 'America/Los_Angeles') + interval '1 day') AS tmax
  `)
  const r = rows[0]
  return { startMin: r.tmin.toISOString(), startMax: r.tmax.toISOString() }
}

async function fetchLocationDay(squareLocationId, startMin, startMax, token, baseUrl) {
  const all = []
  let cursor
  for (let p = 0; p < 80; p++) {
    const { data } = await axios.get(`${baseUrl}/bookings`, {
      params: {
        limit: 100,
        cursor: cursor || undefined,
        location_id: squareLocationId,
        start_at_min: startMin,
        start_at_max: startMax,
      },
      headers: {
        Authorization: `Bearer ${token}`,
        'Square-Version': '2025-02-20',
        Accept: 'application/json',
      },
    })
    all.push(...(data.bookings || []))
    cursor = data.cursor
    if (!cursor) break
  }
  return all
}

async function main() {
  const { dryRun, date, org } = parseArgs()

  let token = process.env.SQUARE_ACCESS_TOKEN?.trim()
  if (token?.startsWith('Bearer ')) token = token.slice(7)
  const baseUrl =
    process.env.SQUARE_ENVIRONMENT === 'sandbox' || process.env.SQUARE_ENV === 'sandbox'
      ? 'https://connect.squareupsandbox.com/v2'
      : 'https://connect.squareup.com/v2'

  const { startMin, startMax } = await pacificDayUtcBounds(date)
  console.log(`Pacific day ${date} → Square window ${startMin} .. ${startMax}`)

  const locs = await prisma.location.findMany({
    where: { organization_id: org },
    select: { name: true, square_location_id: true },
    orderBy: { name: 'asc' },
  })

  const allIds = new Set()
  for (const loc of locs) {
    const raw = await fetchLocationDay(loc.square_location_id, startMin, startMax, token, baseUrl)
    const onDay = raw.filter((b) => pacificYmd(startIso(b)) === date)
    console.log(`\n${loc.name} (${loc.square_location_id}): ${onDay.length} bookings on ${date}`)
    onDay.forEach((b) => allIds.add(b.id))
  }

  const ids = [...allIds].sort()
  console.log(`\n→ ${ids.length} unique booking ids to sync${dryRun ? ' (dry-run)' : ''}\n`)

  let failed = 0
  for (const id of ids) {
    try {
      const r = await syncOne(id, dryRun)
      if (!r.ok) failed++
    } catch (e) {
      console.error(`❌ ${id}: ${e.message}`)
      failed++
    }
  }

  console.log(`\nDone. Failed: ${failed}`)
  if (failed) process.exit(1)
}

main()
  .catch((e) => {
    console.error(e.response?.data || e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
