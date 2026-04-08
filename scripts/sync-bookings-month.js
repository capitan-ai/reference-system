#!/usr/bin/env node
/**
 * Month-by-month bulk sync of bookings from Square → local DB.
 *
 * Three phases per run:
 *   A) listBookings from Square for the month → upsert local rows (handles
 *      bookings rescheduled INTO the month).
 *   B) Find local bookings whose start_at is in the month but were NOT touched
 *      by Phase A → fetch each individually from Square. Update if found,
 *      delete if Square returns 404 (orphan).
 *   C) Recompute square_existing_clients.first_visit_at and refresh
 *      customer_analytics for every customer touched by Phase A or B.
 *
 * Usage:
 *   node scripts/sync-bookings-month.js --org <uuid> --year 2026 --month 4 [--dry-run] [--no-delete-orphans]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const fs = require('fs')
const path = require('path')
const axios = require('axios')
const prisma = require('../lib/prisma-client')
// NOTE: Square SDK hangs on require() in some environments — use direct HTTP API
// (same approach as scripts/sync-booking-from-square.js).
const { applySquareBookingToDb } = require('../lib/sync/apply-square-booking')

const SQUARE_TOKEN = (process.env.SQUARE_ACCESS_TOKEN || '').replace(/^Bearer /, '').trim()
const SQUARE_BASE_URL =
  process.env.SQUARE_ENV === 'sandbox' || process.env.SQUARE_ENVIRONMENT === 'sandbox'
    ? 'https://connect.squareupsandbox.com/v2'
    : 'https://connect.squareup.com/v2'

const PAGE_LIMIT = 100
const MAX_RETRIES = 4
const RETRY_BASE_MS = 800
const DEFAULT_RATE_LIMIT_MS = 55

function parseArgs() {
  const argv = process.argv.slice(2)
  const get = (flag) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : null
  }
  const has = (flag) => argv.includes(flag)
  const args = {
    org: get('--org'),
    year: parseInt(get('--year') || '', 10),
    month: parseInt(get('--month') || '', 10),
    dryRun: has('--dry-run'),
    deleteOrphans: !has('--no-delete-orphans'),
    rateLimitMs: parseInt(get('--rate-limit-ms') || String(DEFAULT_RATE_LIMIT_MS), 10),
  }
  if (!args.org || !/^[0-9a-f-]{36}$/i.test(args.org)) {
    console.error('Missing or invalid --org <uuid>')
    process.exit(1)
  }
  if (!Number.isInteger(args.year) || args.year < 2020 || args.year > 2100) {
    console.error('Missing or invalid --year YYYY')
    process.exit(1)
  }
  if (!Number.isInteger(args.month) || args.month < 1 || args.month > 12) {
    console.error('Missing or invalid --month 1-12')
    process.exit(1)
  }
  return args
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Compute UTC ISO range for a calendar month in America/Los_Angeles (Pacific) tz.
 * Returns { startIso, endIso, label } where startIso/endIso are exclusive at end.
 */
function pacificMonthRange(year, month) {
  // Use Intl to find the UTC offset of LA for the first day of the month
  // Approach: build a Date for the first of the month in LA wall clock,
  //   then ask its UTC equivalent
  const firstLaWallStr = `${year}-${String(month).padStart(2, '0')}-01T00:00:00`
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const lastLaWallStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00`

  // Use the formatToParts trick: get the Pacific offset by computing what LA wall clock
  // corresponds to a known UTC instant
  function laWallToUtc(wallStr) {
    // Treat wall as if it were UTC, then determine what offset LA had at that moment
    const fakeUtc = new Date(`${wallStr}Z`)
    const laFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    const parts = Object.fromEntries(laFmt.formatToParts(fakeUtc).map((p) => [p.type, p.value]))
    const laAsIfUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    )
    const offsetMs = fakeUtc.getTime() - laAsIfUtc
    // wall is meant to be LA local; UTC instant = wall + offset
    const wallAsUtc = new Date(`${wallStr}Z`).getTime()
    return new Date(wallAsUtc + offsetMs)
  }

  const startUtc = laWallToUtc(firstLaWallStr)
  const endUtc = laWallToUtc(lastLaWallStr)
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]
  const monthName = monthNames[month - 1]
  return {
    startIso: startUtc.toISOString(),
    endIso: endUtc.toISOString(),
    label: `${monthName} ${year}`,
    startDate: `${year}-${String(month).padStart(2, '0')}-01`,
    endDate: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
  }
}

async function listBookingsPage(params, attempt = 0) {
  const { limit, cursor, startAtMin, startAtMax } = params
  try {
    const queryParams = {
      limit,
      start_at_min: startAtMin,
      start_at_max: startAtMax,
    }
    if (cursor) queryParams.cursor = cursor
    const res = await axios.get(`${SQUARE_BASE_URL}/bookings`, {
      headers: {
        Authorization: `Bearer ${SQUARE_TOKEN}`,
        'Square-Version': '2025-02-20',
        Accept: 'application/json',
      },
      params: queryParams,
      validateStatus: () => true,
    })
    if (res.status !== 200) {
      throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.data?.errors || res.data)}`)
    }
    const errors = res.data?.errors
    if (errors?.length) {
      const msg = errors.map((e) => e.detail || e.code).join('; ')
      throw new Error(`Square API errors: ${msg}`)
    }
    return {
      bookings: res.data?.bookings ?? [],
      cursor: res.data?.cursor ?? null,
    }
  } catch (e) {
    if (attempt < MAX_RETRIES) {
      const wait = RETRY_BASE_MS * 2 ** attempt
      console.warn(`   ⚠️ Retry ${attempt + 1}/${MAX_RETRIES} after ${wait}ms: ${e.message}`)
      await sleep(wait)
      return listBookingsPage(params, attempt + 1)
    }
    throw e
  }
}

async function fetchAllBookingsForRange(startIso, endIso, rateLimitMs) {
  const all = []
  let cursor
  let page = 0
  do {
    page += 1
    const { bookings, cursor: next } = await listBookingsPage({
      limit: PAGE_LIMIT,
      cursor: cursor || undefined,
      startAtMin: startIso,
      startAtMax: endIso,
    })
    all.push(...bookings)
    process.stdout.write(`\r   Page ${page}: +${bookings.length} (total ${all.length})  `)
    cursor = next
    if (rateLimitMs > 0) await sleep(rateLimitMs)
  } while (cursor)
  process.stdout.write('\n')
  return all
}

/**
 * Fetch a single booking by ID via direct HTTP. Returns:
 *   { found: true, booking } | { found: false, status: 404 } | { error }
 */
async function fetchSingleBooking(bookingId, rateLimitMs) {
  if (rateLimitMs > 0) await sleep(rateLimitMs)
  try {
    const res = await axios.get(`${SQUARE_BASE_URL}/bookings/${bookingId}`, {
      headers: {
        Authorization: `Bearer ${SQUARE_TOKEN}`,
        'Square-Version': '2025-02-20',
        Accept: 'application/json',
      },
      validateStatus: () => true,
    })
    if (res.status === 200 && res.data?.booking) {
      return { found: true, booking: res.data.booking }
    }
    if (res.status === 404) return { found: false, status: 404 }
    return { error: `HTTP ${res.status}: ${JSON.stringify(res.data?.errors || {})}` }
  } catch (err) {
    return { error: err.message }
  }
}

async function phaseA({ args, range, customersTouched, bookingsTouched }) {
  console.log(`\n=== Phase A — listBookings from Square (${range.label}) ===`)
  const startTime = Date.now()
  const squareBookings = await fetchAllBookingsForRange(
    range.startIso,
    range.endIso,
    args.rateLimitMs
  )
  console.log(`   Total bookings from Square: ${squareBookings.length}`)

  let inserted = 0
  let updated = 0
  let noop = 0
  let skipped = 0
  let errors = 0

  for (let i = 0; i < squareBookings.length; i++) {
    const sb = squareBookings[i]
    try {
      const result = await applySquareBookingToDb(sb, {
        organizationId: args.org,
        dryRun: args.dryRun,
      })
      if (result.action === 'inserted') inserted++
      else if (result.action === 'updated') updated++
      else if (result.action === 'noop') noop++
      else if (result.action === 'skipped') {
        skipped++
        console.warn(`   ⚠️ Skipped ${result.bookingId}: ${result.reason}`)
      }
      bookingsTouched.add(sb.id)
      if (result.customerId) customersTouched.add(result.customerId)
    } catch (err) {
      errors++
      console.error(`   ❌ Error applying booking ${sb.id}: ${err.message}`)
    }
    if ((i + 1) % 100 === 0) {
      process.stdout.write(`\r   Processed ${i + 1}/${squareBookings.length}  `)
    }
  }
  process.stdout.write('\n')
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`   inserted=${inserted} updated=${updated} noop=${noop} skipped=${skipped} errors=${errors}  (${elapsed}s)`)
  return { inserted, updated, noop, skipped, errors }
}

async function phaseB({ args, range, customersTouched, bookingsTouched }) {
  console.log(`\n=== Phase B — Local bookings rescheduled OUT or orphaned (${range.label}) ===`)

  // Find local bookings whose local start_at falls in the month, NOT touched by Phase A
  const touchedArr = Array.from(bookingsTouched)
  const localCandidates = await prisma.$queryRaw`
    SELECT id, booking_id, customer_id, start_at::text as start_at, status
    FROM bookings
    WHERE organization_id = ${args.org}::uuid
      AND DATE(start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')
          BETWEEN ${range.startDate}::date AND (${range.endDate}::date - INTERVAL '1 day')
      AND NOT (booking_id = ANY(${touchedArr}::text[]))
      AND NOT (
        EXISTS (
          SELECT 1 FROM unnest(${touchedArr}::text[]) AS t(id)
          WHERE booking_id LIKE t.id || '-%'
        )
      )
  `
  console.log(`   Local candidates not touched by Phase A: ${localCandidates.length}`)

  let updated = 0
  let deleted = 0
  let stillThere = 0
  let errors = 0
  const orphans = []

  for (const local of localCandidates) {
    // Strip versioned suffix to get canonical Square id (e.g. xxx-SUFFIX → xxx)
    const canonicalId = local.booking_id.replace(/-[A-Z0-9]{20,}$/, '')
    const result = await fetchSingleBooking(canonicalId, args.rateLimitMs)

    if (result.error) {
      errors++
      console.warn(`   ⚠️ ${local.booking_id}: API error → ${result.error}`)
      continue
    }

    if (result.found) {
      // Apply the (potentially rescheduled) data
      try {
        const applied = await applySquareBookingToDb(result.booking, {
          organizationId: args.org,
          dryRun: args.dryRun,
        })
        if (applied.action === 'updated') updated++
        else if (applied.action === 'noop') stillThere++
        else if (applied.action === 'inserted') {
          // shouldn't happen but possible if id mismatch
          console.warn(`   ⚠️ Unexpected insert for ${local.booking_id}`)
        }
        if (applied.customerId) customersTouched.add(applied.customerId)
      } catch (err) {
        errors++
        console.error(`   ❌ Failed to apply ${local.booking_id}: ${err.message}`)
      }
      continue
    }

    // 404 — orphan
    orphans.push({
      id: local.id,
      booking_id: local.booking_id,
      customer_id: local.customer_id,
      start_at: local.start_at,
      status: local.status,
    })
    if (local.customer_id) customersTouched.add(local.customer_id)
  }

  // Handle orphans
  if (orphans.length > 0) {
    const logFile = path.join(__dirname, `.sync-orphans-${range.startDate.slice(0, 7)}.log`)
    const lines = orphans.map((o) => JSON.stringify(o)).join('\n') + '\n'
    fs.appendFileSync(logFile, lines)
    console.log(`   Orphans logged to ${logFile}: ${orphans.length}`)

    if (args.deleteOrphans && !args.dryRun) {
      const ids = orphans.map((o) => o.id)
      // Delete booking_segments first (cascade should handle but be explicit)
      await prisma.$executeRaw`DELETE FROM booking_segments WHERE booking_id = ANY(${ids}::uuid[])`
      const result = await prisma.$executeRaw`DELETE FROM bookings WHERE id = ANY(${ids}::uuid[])`
      deleted = Number(result)
      console.log(`   ✅ Deleted ${deleted} orphan bookings from local DB`)
    } else if (args.dryRun) {
      console.log(`   (dry-run: would delete ${orphans.length} orphan bookings)`)
    } else {
      console.log(`   (--no-delete-orphans: orphans logged but not deleted)`)
    }
  }

  console.log(`   updated=${updated} stillThere=${stillThere} deleted=${deleted} errors=${errors}`)
  return { localCandidates: localCandidates.length, updated, stillThere, deleted, errors }
}

async function phaseC({ args, customersTouched }) {
  console.log(`\n=== Phase C — Recompute first_visit_at + customer_analytics ===`)
  console.log(`   Affected customers: ${customersTouched.size}`)

  if (customersTouched.size === 0) {
    return { secUpdated: 0, caRefreshed: 0, errors: 0 }
  }
  if (args.dryRun) {
    console.log('   (dry-run: skipping refresh)')
    return { secUpdated: 0, caRefreshed: 0, errors: 0 }
  }

  // Step 1: Bulk-update square_existing_clients.first_visit_at for all touched customers
  // (single SQL — 1000x faster than per-customer iteration)
  console.log('   Step 1: Bulk-recompute square_existing_clients.first_visit_at...')
  const stepOneStart = Date.now()
  const customerIdsArr = Array.from(customersTouched)
  const secResult = await prisma.$executeRaw`
    UPDATE square_existing_clients sec
    SET first_visit_at = sub.first_at,
        updated_at = NOW()
    FROM (
      SELECT b.organization_id, b.customer_id, MIN(b.start_at) AS first_at
      FROM bookings b
      WHERE b.organization_id = ${args.org}::uuid
        AND b.customer_id IS NOT NULL
        AND b.customer_id = ANY(${customerIdsArr}::text[])
        AND b.status IN ('ACCEPTED','COMPLETED')
      GROUP BY b.organization_id, b.customer_id
    ) sub
    WHERE sec.organization_id = sub.organization_id
      AND sec.square_customer_id = sub.customer_id
      AND sec.first_visit_at IS DISTINCT FROM sub.first_at
  `
  const secUpdated = Number(secResult)
  // Also clear first_visit_at for customers whose only ACCEPTED bookings were deleted
  const secClearedResult = await prisma.$executeRaw`
    UPDATE square_existing_clients sec
    SET first_visit_at = NULL,
        updated_at = NOW()
    WHERE sec.organization_id = ${args.org}::uuid
      AND sec.square_customer_id = ANY(${customerIdsArr}::text[])
      AND sec.first_visit_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.customer_id = sec.square_customer_id
          AND b.organization_id = sec.organization_id
          AND b.status IN ('ACCEPTED','COMPLETED')
      )
  `
  const secCleared = Number(secClearedResult)
  console.log(`   ✅ square_existing_clients: ${secUpdated} updated, ${secCleared} cleared (${((Date.now() - stepOneStart) / 1000).toFixed(1)}s)`)

  // Step 2: Run the full refresh-customer-analytics script (it does the whole table in one big SQL)
  // This is much faster than calling refreshCustomerAnalyticsForSingleCustomer per customer.
  // The full refresh handles canonical phone/email merging which is the canonical refresh logic.
  console.log('   Step 2: Run full customer_analytics refresh...')
  const stepTwoStart = Date.now()
  let caRefreshed = 0
  let errors = 0
  try {
    const { execSync } = require('child_process')
    execSync('node scripts/refresh-customer-analytics.js full', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
    })
    // Count how many rows were touched in the last few seconds
    const r = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS cnt FROM customer_analytics
      WHERE organization_id = ${args.org}::uuid
        AND updated_at > NOW() - INTERVAL '2 minutes'
    `
    caRefreshed = Number(r[0]?.cnt || 0)
  } catch (err) {
    errors++
    console.warn(`   ⚠️ Full refresh failed: ${err.message}`)
  }
  console.log(`   ✅ customer_analytics: ${caRefreshed} refreshed (${((Date.now() - stepTwoStart) / 1000).toFixed(1)}s)`)

  return { secUpdated: secUpdated + secCleared, caRefreshed, errors }
}

async function main() {
  const args = parseArgs()
  const range = pacificMonthRange(args.year, args.month)

  console.log('='.repeat(70))
  console.log(`Sync bookings: ${range.label}`)
  console.log(`Org:           ${args.org}`)
  console.log(`Range (UTC):   ${range.startIso} → ${range.endIso}`)
  console.log(`Range (PDT):   ${range.startDate} → ${range.endDate} (exclusive)`)
  console.log(`Dry run:       ${args.dryRun}`)
  console.log(`Delete orphans:${args.deleteOrphans && !args.dryRun}`)
  console.log(`Rate limit:    ${args.rateLimitMs}ms`)
  console.log('='.repeat(70))

  const customersTouched = new Set()
  const bookingsTouched = new Set()
  const overallStart = Date.now()

  const a = await phaseA({ args, range, customersTouched, bookingsTouched })
  const b = await phaseB({ args, range, customersTouched, bookingsTouched })
  const c = await phaseC({ args, customersTouched })

  const elapsed = ((Date.now() - overallStart) / 1000).toFixed(1)
  console.log('\n' + '='.repeat(70))
  console.log(`✅ Done in ${elapsed}s`)
  console.log(`   Phase A: ins=${a.inserted} upd=${a.updated} noop=${a.noop} skip=${a.skipped} err=${a.errors}`)
  console.log(`   Phase B: candidates=${b.localCandidates} upd=${b.updated} stillThere=${b.stillThere} del=${b.deleted} err=${b.errors}`)
  console.log(`   Phase C: secUpdated=${c.secUpdated} caRefreshed=${c.caRefreshed} err=${c.errors}`)
  console.log(`   Touched: ${bookingsTouched.size} bookings, ${customersTouched.size} customers`)
  console.log('='.repeat(70))
}

main()
  .catch((e) => {
    console.error('❌ Fatal:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
