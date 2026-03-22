/**
 * Full Square bookings export via official Node SDK into square_booking_sdk_snapshot.
 * - Time range: Nov 1 2023 UTC → now (override with FROM_ISO / TO_ISO).
 * - 31-day windows (Square listBookings aligns with ~31d default semantics).
 * - Full cursor pagination per window.
 * - Upsert by square_booking_id (re-runs update rows).
 *
 * Optional env:
 *   SQUARE_LOCATION_ID — Square location id filter (omit for all locations token can see)
 *   FROM_ISO — e.g. 2023-11-01T00:00:00.000Z
 *   TO_ISO   — default now
 *   DRY_RUN=1 — fetch only, no DB writes
 *   PAGE_DELAY_MS — throttle between pages (default 0)
 *
 * Usage: node scripts/sync-square-bookings-sdk-snapshot.js
 *        node scripts/sync-square-bookings-sdk-snapshot.js --compare
 *
 * Database: run `npx prisma db push` or apply
 *   prisma/migrations/20260320120000_add_square_booking_sdk_snapshot/migration.sql
 *   (Supabase SQL editor if push fails on permissions).
 */

require('dotenv').config()

const crypto = require('crypto')
const prisma = require('../lib/prisma-client')
const { getBookingsApi } = require('../lib/utils/square-client')

const DEFAULT_FROM = '2023-11-01T00:00:00.000Z'
const WINDOW_DAYS = 31
const PAGE_LIMIT = 100
const MAX_RETRIES = 4
const RETRY_BASE_MS = 800

function addDaysUtc(date, days) {
  const d = new Date(date.getTime())
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function parseArg(flag) {
  const i = process.argv.indexOf(flag)
  if (i === -1) return null
  return process.argv[i + 1] || null
}

function jsonSafeForPrisma(obj) {
  return JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  )
}

function* iterateWindows(fromDate, toDate) {
  let start = new Date(fromDate.getTime())
  while (start < toDate) {
    const end = addDaysUtc(start, WINDOW_DAYS)
    const sliceEnd = end > toDate ? toDate : end
    yield { windowStart: new Date(start), windowEnd: new Date(sliceEnd) }
    start = sliceEnd
  }
}

function parseSquareDate(s) {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function bookingToRow(booking, syncBatchId, windowStart, windowEnd) {
  const version = booking.version
  let squareVersion = null
  if (version != null) {
    const n = typeof version === 'bigint' ? Number(version) : Number(version)
    squareVersion = Number.isFinite(n) ? n : null
  }
  return {
    square_booking_id: booking.id,
    square_location_id: booking.locationId ?? null,
    square_customer_id: booking.customerId ?? null,
    start_at: parseSquareDate(booking.startAt),
    status: booking.status ?? null,
    square_version: squareVersion,
    square_updated_at: parseSquareDate(booking.updatedAt),
    raw_json: jsonSafeForPrisma(booking),
    sync_batch_id: syncBatchId,
    window_start: windowStart,
    window_end: windowEnd,
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function listBookingsPage(bookingsApi, params, attempt = 0) {
  const { limit, cursor, locationId, startAtMin, startAtMax } = params
  try {
    const response = await bookingsApi.listBookings(
      limit,
      cursor,
      undefined,
      undefined,
      locationId,
      startAtMin,
      startAtMax
    )
    const errors = response.result?.errors
    if (errors?.length) {
      const msg = errors.map((e) => e.detail || e.code).join('; ')
      throw new Error(`Square API errors: ${msg}`)
    }
    return {
      bookings: response.result?.bookings ?? [],
      cursor: response.result?.cursor ?? null,
    }
  } catch (e) {
    if (attempt < MAX_RETRIES) {
      const wait = RETRY_BASE_MS * 2 ** attempt
      console.warn(`   ⚠️ Retry ${attempt + 1}/${MAX_RETRIES} after ${wait}ms: ${e.message}`)
      await sleep(wait)
      return listBookingsPage(bookingsApi, params, attempt + 1)
    }
    throw e
  }
}

async function fetchWindow(bookingsApi, windowStart, windowEnd, locationId, pageDelayMs) {
  const startAtMin = windowStart.toISOString()
  const startAtMax = windowEnd.toISOString()
  const all = []
  let cursor
  let page = 0
  do {
    page += 1
    const { bookings, cursor: next } = await listBookingsPage(bookingsApi, {
      limit: PAGE_LIMIT,
      cursor: cursor || undefined,
      locationId: locationId || undefined,
      startAtMin,
      startAtMax,
    })
    all.push(...bookings)
    cursor = next
    if (pageDelayMs > 0) await sleep(pageDelayMs)
  } while (cursor)
  return all
}

async function upsertBatch(rows) {
  if (rows.length === 0) return
  await prisma.$transaction(
    rows.map((data) =>
      prisma.squareBookingSdkSnapshot.upsert({
        where: { square_booking_id: data.square_booking_id },
        create: data,
        update: {
          square_location_id: data.square_location_id,
          square_customer_id: data.square_customer_id,
          start_at: data.start_at,
          status: data.status,
          square_version: data.square_version,
          square_updated_at: data.square_updated_at,
          raw_json: data.raw_json,
          sync_batch_id: data.sync_batch_id,
          window_start: data.window_start,
          window_end: data.window_end,
          fetched_at: new Date(),
        },
      })
    )
  )
}

async function runCompare() {
  const snapRows = await prisma.squareBookingSdkSnapshot.findMany({
    select: { square_booking_id: true },
  })
  const snapSet = new Set(snapRows.map((r) => r.square_booking_id))

  const dbRows = await prisma.booking.findMany({
    select: { booking_id: true },
  })
  const dbSet = new Set(dbRows.map((b) => b.booking_id))

  let inBoth = 0
  let onlySnap = 0
  for (const id of snapSet) {
    if (dbSet.has(id)) inBoth += 1
    else onlySnap += 1
  }

  let onlyDb = 0
  for (const id of dbSet) {
    if (!snapSet.has(id)) onlyDb += 1
  }

  console.log('\n--- Compare: square_booking_sdk_snapshot vs bookings.booking_id ---')
  console.log(`Unique Square booking ids in snapshot table: ${snapSet.size}`)
  console.log(`Unique booking_id in bookings table: ${dbSet.size}`)
  console.log(`In both: ${inBoth}`)
  console.log(`In snapshot only (Square has it, we do not): ${onlySnap}`)
  console.log(`In bookings only (DB row, not in snapshot): ${onlyDb}`)
}

async function main() {
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'
  const pageDelayMs = Number(process.env.PAGE_DELAY_MS || 0)
  const locationId = process.env.SQUARE_LOCATION_ID?.trim() || null
  const fromIso = process.env.FROM_ISO || parseArg('--from') || DEFAULT_FROM
  const toIso = process.env.TO_ISO || parseArg('--to') || new Date().toISOString()
  const doCompare = process.argv.includes('--compare')

  const fromDate = new Date(fromIso)
  const toDate = new Date(toIso)
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    console.error('Invalid FROM_ISO / TO_ISO')
    process.exit(1)
  }
  if (fromDate >= toDate) {
    console.error('FROM must be before TO')
    process.exit(1)
  }

  const syncBatchId = crypto.randomUUID()
  console.log(`Sync batch: ${syncBatchId}`)
  console.log(`Range: ${fromDate.toISOString()} → ${toDate.toISOString()} (${WINDOW_DAYS}-day windows)`)
  console.log(`Location filter: ${locationId || '(none — all)'}`)
  console.log(`Dry run: ${dryRun}`)

  const bookingsApi = getBookingsApi()
  let totalFetched = 0
  let totalWritten = 0
  const windows = [...iterateWindows(fromDate, toDate)]

  for (let i = 0; i < windows.length; i++) {
    const { windowStart, windowEnd } = windows[i]
    console.log(
      `\n[${i + 1}/${windows.length}] Window ${windowStart.toISOString()} → ${windowEnd.toISOString()}`
    )
    const bookings = await fetchWindow(bookingsApi, windowStart, windowEnd, locationId, pageDelayMs)
    totalFetched += bookings.length
    console.log(`   Fetched ${bookings.length} booking(s), pages complete`)

    if (dryRun) continue

    const rows = bookings.map((b) => bookingToRow(b, syncBatchId, windowStart, windowEnd))
    const chunk = 25
    for (let j = 0; j < rows.length; j += chunk) {
      const slice = rows.slice(j, j + chunk)
      await upsertBatch(slice)
      totalWritten += slice.length
    }
  }

  console.log(`\nDone. Total fetched: ${totalFetched}`)
  if (!dryRun) {
    console.log(`Rows upserted (with overlap across windows): ${totalWritten}`)
    const distinct = await prisma.squareBookingSdkSnapshot.count()
    console.log(`Total rows in square_booking_sdk_snapshot: ${distinct}`)
  }

  if (doCompare && !dryRun) {
    await runCompare()
  }

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
