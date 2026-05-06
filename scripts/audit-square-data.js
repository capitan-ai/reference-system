/**
 * Comprehensive Square Data Audit & Sync
 *
 * Fetches ALL bookings, customers, payments, and orders from Square APIs,
 * compares against the local database, reports discrepancies, and optionally
 * backfills missing data.
 *
 * Usage:
 *   node scripts/audit-square-data.js --entity all
 *   node scripts/audit-square-data.js --entity bookings
 *   node scripts/audit-square-data.js --entity bookings --fix
 *   node scripts/audit-square-data.js --entity all --start-date 2025-01-01
 */

require('dotenv').config()

const prisma = require('../lib/prisma-client')
const {
  getBookingsApi,
  getCustomersApi,
  getPaymentsApi,
  getOrdersApi,
  getLocationsApi,
} = require('../lib/utils/square-client')

// ─── Constants ───────────────────────────────────────────────────────────────

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'
const DEFAULT_FROM = '2023-11-01T00:00:00.000Z'
const WINDOW_DAYS = 31
const PAGE_LIMIT = 100
const MAX_RETRIES = 4
const RETRY_BASE_MS = 800
const RATE_LIMIT_DELAY_MS = 55

// ─── Utility helpers ─────────────────────────────────────────────────────────

function parseArg(flag) {
  const i = process.argv.indexOf(flag)
  if (i === -1) return null
  return process.argv[i + 1] || null
}

function hasFlag(flag) {
  return process.argv.includes(flag)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function jsonSafe(obj) {
  return JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  )
}

function toBigIntSafeNumber(val) {
  if (val == null) return null
  const n = typeof val === 'bigint' ? Number(val) : Number(val)
  return Number.isFinite(n) ? n : null
}

function val(obj, camelCase, snake_case) {
  if (!obj) return null
  return obj[camelCase] ?? obj[snake_case] ?? null
}

function addDaysUtc(date, days) {
  const d = new Date(date.getTime())
  d.setUTCDate(d.getUTCDate() + days)
  return d
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

function isoNorm(d) {
  if (!d) return null
  const dt = d instanceof Date ? d : new Date(d)
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString()
}

function moneyVal(moneyObj) {
  if (!moneyObj) return 0
  return toBigIntSafeNumber(moneyObj.amount) || 0
}

let lastRequestTime = 0
async function rateLimited(fn) {
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < RATE_LIMIT_DELAY_MS) {
    await sleep(RATE_LIMIT_DELAY_MS - elapsed)
  }
  lastRequestTime = Date.now()
  return withRetry(fn)
}

async function withRetry(fn, attempt = 0) {
  try {
    return await fn()
  } catch (e) {
    if (attempt < MAX_RETRIES) {
      const wait = RETRY_BASE_MS * 2 ** attempt
      const detail = e.result ? JSON.stringify(e.result) : e.body ? JSON.stringify(e.body) : ''
      console.warn(`   ⚠️ Retry ${attempt + 1}/${MAX_RETRIES} after ${wait}ms: ${e.message} ${detail}`)
      await sleep(wait)
      return withRetry(fn, attempt + 1)
    }
    if (e.result) console.error('API error detail:', JSON.stringify(e.result, null, 2))
    throw e
  }
}

// ─── Location cache ──────────────────────────────────────────────────────────

const locationCache = new Map() // squareLocationId → { dbUuid, name }

async function buildLocationCache() {
  const locationsApi = getLocationsApi()
  const resp = await locationsApi.list()
  const squareLocations = resp.locations || []

  const dbLocations = await prisma.location.findMany({
    where: { organization_id: ORG_ID },
    select: { id: true, square_location_id: true, name: true },
  })
  const dbMap = new Map(dbLocations.map((l) => [l.square_location_id, l]))

  for (const sq of squareLocations) {
    const sqId = sq.id
    const db = dbMap.get(sqId)
    locationCache.set(sqId, {
      dbUuid: db?.id || null,
      name: db?.name || sq.name || sqId,
    })
  }

  console.log(`Locations: ${locationCache.size} from Square, ${dbLocations.length} in DB`)
  for (const [sqId, info] of locationCache) {
    console.log(`  ${sqId} → ${info.dbUuid || 'NOT IN DB'} (${info.name})`)
  }

  return [...locationCache.keys()]
}

function resolveLocationUuid(squareLocationId) {
  return locationCache.get(squareLocationId)?.dbUuid || null
}

// ─── Team member & service variation cache ───────────────────────────────────

const teamMemberCache = new Map()
const serviceVariationCache = new Map()

async function buildResolverCaches() {
  const teamMembers = await prisma.teamMember.findMany({
    where: { organization_id: ORG_ID },
    select: { id: true, square_team_member_id: true },
  })
  for (const tm of teamMembers) {
    if (tm.square_team_member_id) {
      teamMemberCache.set(tm.square_team_member_id, tm.id)
    }
  }

  const variations = await prisma.serviceVariation.findMany({
    where: { organization_id: ORG_ID },
    select: { uuid: true, square_variation_id: true },
  })
  for (const sv of variations) {
    if (sv.square_variation_id) {
      serviceVariationCache.set(sv.square_variation_id, sv.uuid)
    }
  }

  console.log(`Team members cached: ${teamMemberCache.size}, Service variations cached: ${serviceVariationCache.size}`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// FETCHERS — Pull data from Square APIs
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchAllBookings(squareLocationIds, fromDate, toDate) {
  const bookingsApi = getBookingsApi()
  const all = new Map()

  for (const locationId of squareLocationIds) {
    const locName = locationCache.get(locationId)?.name || locationId
    const windows = [...iterateWindows(fromDate, toDate)]

    for (let i = 0; i < windows.length; i++) {
      const { windowStart, windowEnd } = windows[i]
      let cursor
      let page = 0

      do {
        page++
        const { bookings, cursor: next } = await rateLimited(async () => {
          const resp = await bookingsApi.list({
            limit: PAGE_LIMIT,
            cursor: cursor || undefined,
            locationId,
            startAtMin: windowStart.toISOString(),
            startAtMax: windowEnd.toISOString(),
          })
          return {
            bookings: resp.data ?? [],
            cursor: resp.response?.cursor ?? null,
          }
        })

        for (const b of bookings) {
          all.set(b.id, b)
        }
        cursor = next
      } while (cursor)
    }
    console.log(`  [${locName}] ${all.size} bookings so far`)
  }

  return all
}

async function fetchAllCustomers() {
  const customersApi = getCustomersApi()
  const all = new Map()
  let cursor = null
  let pages = 0

  do {
    pages++
    const result = await rateLimited(async () => {
      const resp = await customersApi.list({
        cursor: cursor || undefined,
        limit: PAGE_LIMIT,
      })
      return {
        customers: resp.data ?? [],
        cursor: resp.response?.cursor ?? null,
      }
    })

    for (const c of result.customers) {
      all.set(c.id, c)
    }
    cursor = result.cursor
    if (pages % 10 === 0) console.log(`  ${all.size} customers fetched (${pages} pages)...`)
  } while (cursor)

  return all
}

async function fetchAllPayments(squareLocationIds, fromDate, toDate) {
  const paymentsApi = getPaymentsApi()
  const all = new Map()

  for (const locationId of squareLocationIds) {
    const locName = locationCache.get(locationId)?.name || locationId
    let cursor = null
    let pages = 0

    do {
      pages++
      const result = await rateLimited(async () => {
        const resp = await paymentsApi.list({
          beginTime: fromDate.toISOString(),
          endTime: toDate.toISOString(),
          locationId,
          limit: PAGE_LIMIT,
          cursor: cursor || undefined,
        })
        return {
          payments: resp.data ?? [],
          cursor: resp.response?.cursor ?? null,
        }
      })

      for (const p of result.payments) {
        all.set(p.id, p)
      }
      cursor = result.cursor
    } while (cursor)

    console.log(`  [${locName}] ${all.size} payments so far`)
  }

  return all
}

async function fetchAllOrders(squareLocationIds, fromDate, toDate) {
  const ordersApi = getOrdersApi()
  const all = new Map()

  for (const locationId of squareLocationIds) {
    const locName = locationCache.get(locationId)?.name || locationId
    let cursor = null
    let pages = 0

    do {
      pages++
      const result = await rateLimited(async () => {
        const resp = await ordersApi.search({
          locationIds: [locationId],
          query: {
            filter: {
              dateTimeFilter: {
                createdAt: {
                  startAt: fromDate.toISOString(),
                  endAt: toDate.toISOString(),
                },
              },
            },
            sort: { sortField: 'CREATED_AT', sortOrder: 'ASC' },
          },
          cursor: cursor || undefined,
          limit: PAGE_LIMIT,
        })
        return {
          orders: resp.orders ?? [],
          cursor: resp.cursor ?? null,
        }
      })

      for (const o of result.orders) {
        all.set(o.id, o)
      }
      cursor = result.cursor
    } while (cursor)

    console.log(`  [${locName}] ${all.size} orders so far`)
  }

  return all
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPARATORS — Compare Square data against DB
// ═══════════════════════════════════════════════════════════════════════════════

async function compareBookings(squareBookings) {
  // Use raw SQL to avoid Prisma bind variable limits with large datasets
  const dbRows = await prisma.$queryRaw`
    SELECT booking_id, customer_id, status, start_at, version,
           location_id::text as location_id, creator_type, source,
           duration_minutes, customer_note, seller_note
    FROM bookings
    WHERE organization_id = ${ORG_ID}::uuid
  `

  // Get active segment counts per booking via raw SQL
  const segmentCounts = await prisma.$queryRaw`
    SELECT b.booking_id, COUNT(bs.id)::int as segment_count
    FROM bookings b
    LEFT JOIN booking_segments bs ON bs.booking_id = b.id AND bs.is_active = true
    WHERE b.organization_id = ${ORG_ID}::uuid
    GROUP BY b.booking_id
  `
  const segCountMap = new Map(segmentCounts.map((r) => [r.booking_id, r.segment_count]))

  // Attach segment counts to rows
  for (const row of dbRows) {
    row.segment_count = segCountMap.get(row.booking_id) || 0
  }

  const dbMap = new Map(dbRows.map((r) => [r.booking_id, r]))

  const missingFromDb = []
  const missingFromSquare = []
  const fieldMismatches = []

  for (const [sqId, sq] of squareBookings) {
    const db = dbMap.get(sqId)
    if (!db) {
      missingFromDb.push({
        id: sqId,
        status: sq.status,
        start_at: sq.startAt,
        customer_id: sq.customerId,
      })
      continue
    }

    // Compare fields
    if (sq.status && db.status !== sq.status) {
      fieldMismatches.push({ id: sqId, field: 'status', square: sq.status, db: db.status })
    }
    // Compare start_at — Square is source of truth, update DB to match
    const sqStart = isoNorm(sq.startAt)
    const dbStart = isoNorm(db.start_at)
    if (sqStart && dbStart && sqStart !== dbStart) {
      fieldMismatches.push({ id: sqId, field: 'start_at', square: sqStart, db: dbStart })
    }
    if (sq.customerId && db.customer_id !== sq.customerId) {
      fieldMismatches.push({ id: sqId, field: 'customer_id', square: sq.customerId, db: db.customer_id })
    }
    const sqVersion = toBigIntSafeNumber(sq.version)
    if (sqVersion != null && db.version !== sqVersion) {
      fieldMismatches.push({ id: sqId, field: 'version', square: sqVersion, db: db.version })
    }

    // Segment count
    const sqSegments = sq.appointmentSegments || sq.appointment_segments || []
    const dbSegmentCount = db.segment_count || 0
    if (sqSegments.length !== dbSegmentCount) {
      fieldMismatches.push({ id: sqId, field: 'segments_count', square: sqSegments.length, db: dbSegmentCount })
    }
  }

  // Check for orphans in DB not in Square
  for (const [dbId] of dbMap) {
    if (!squareBookings.has(dbId)) {
      missingFromSquare.push(dbId)
    }
  }

  return {
    entity: 'bookings',
    squareTotal: squareBookings.size,
    dbTotal: dbRows.length,
    missingFromDb,
    missingFromSquare,
    fieldMismatches,
  }
}

async function compareCustomers(squareCustomers) {
  const dbRows = await prisma.$queryRaw`
    SELECT square_customer_id, given_name, family_name, email_address, phone_number
    FROM square_existing_clients
    WHERE organization_id = ${ORG_ID}::uuid
  `
  const dbMap = new Map(dbRows.map((r) => [r.square_customer_id, r]))

  const missingFromDb = []
  const missingFromSquare = []
  const fieldMismatches = []

  for (const [sqId, sq] of squareCustomers) {
    const db = dbMap.get(sqId)
    if (!db) {
      missingFromDb.push({
        id: sqId,
        name: `${sq.givenName || ''} ${sq.familyName || ''}`.trim(),
        email: sq.emailAddress,
        phone: sq.phoneNumber,
      })
      continue
    }

    const sqGiven = (sq.givenName || sq.given_name || '').trim() || null
    const sqFamily = (sq.familyName || sq.family_name || '').trim() || null
    const sqEmail = (sq.emailAddress || sq.email_address || '').trim() || null
    const sqPhone = (sq.phoneNumber || sq.phone_number || '').trim() || null

    if (sqGiven && db.given_name !== sqGiven) {
      fieldMismatches.push({ id: sqId, field: 'given_name', square: sqGiven, db: db.given_name })
    }
    if (sqFamily && db.family_name !== sqFamily) {
      fieldMismatches.push({ id: sqId, field: 'family_name', square: sqFamily, db: db.family_name })
    }
    if (sqEmail && db.email_address !== sqEmail) {
      fieldMismatches.push({ id: sqId, field: 'email_address', square: sqEmail, db: db.email_address })
    }
    if (sqPhone && db.phone_number !== sqPhone) {
      fieldMismatches.push({ id: sqId, field: 'phone_number', square: sqPhone, db: db.phone_number })
    }
  }

  for (const [dbId] of dbMap) {
    if (!squareCustomers.has(dbId)) {
      missingFromSquare.push(dbId)
    }
  }

  return {
    entity: 'customers',
    squareTotal: squareCustomers.size,
    dbTotal: dbRows.length,
    missingFromDb,
    missingFromSquare,
    fieldMismatches,
  }
}

async function comparePayments(squarePayments) {
  const dbRows = await prisma.$queryRaw`
    SELECT payment_id, customer_id, amount_money_amount, tip_money_amount,
           total_money_amount, status, source_type
    FROM payments
    WHERE organization_id = ${ORG_ID}::uuid
  `
  const dbMap = new Map(dbRows.map((r) => [r.payment_id, r]))

  const missingFromDb = []
  const missingFromSquare = []
  const fieldMismatches = []

  for (const [sqId, sq] of squarePayments) {
    const db = dbMap.get(sqId)
    if (!db) {
      const amt = moneyVal(sq.amountMoney || sq.amount_money)
      missingFromDb.push({
        id: sqId,
        status: sq.status,
        amount_cents: amt,
        customer_id: sq.customerId || sq.customer_id,
      })
      continue
    }

    if (sq.status && db.status !== sq.status) {
      fieldMismatches.push({ id: sqId, field: 'status', square: sq.status, db: db.status })
    }
    const sqAmount = moneyVal(sq.amountMoney || sq.amount_money)
    if (sqAmount && db.amount_money_amount !== sqAmount) {
      fieldMismatches.push({ id: sqId, field: 'amount_money_amount', square: sqAmount, db: db.amount_money_amount })
    }
    const sqTip = moneyVal(sq.tipMoney || sq.tip_money)
    const dbTip = db.tip_money_amount || 0
    if (sqTip !== dbTip) {
      fieldMismatches.push({ id: sqId, field: 'tip_money_amount', square: sqTip, db: dbTip })
    }
    const sqTotal = moneyVal(sq.totalMoney || sq.total_money)
    if (sqTotal && db.total_money_amount !== sqTotal) {
      fieldMismatches.push({ id: sqId, field: 'total_money_amount', square: sqTotal, db: db.total_money_amount })
    }
    const sqCustomer = sq.customerId || sq.customer_id || null
    if (sqCustomer && db.customer_id !== sqCustomer) {
      fieldMismatches.push({ id: sqId, field: 'customer_id', square: sqCustomer, db: db.customer_id })
    }
  }

  for (const [dbId] of dbMap) {
    if (!squarePayments.has(dbId)) {
      missingFromSquare.push(dbId)
    }
  }

  return {
    entity: 'payments',
    squareTotal: squarePayments.size,
    dbTotal: dbRows.length,
    missingFromDb,
    missingFromSquare,
    fieldMismatches,
  }
}

async function compareOrders(squareOrders) {
  const dbRows = await prisma.$queryRaw`
    SELECT order_id, customer_id, state, version, total_money_amount,
           total_tip_money_amount
    FROM orders
    WHERE organization_id = ${ORG_ID}::uuid
  `
  const dbMap = new Map(dbRows.map((r) => [r.order_id, r]))

  // Also get line item counts per order
  const lineItemCounts = await prisma.$queryRaw`
    SELECT o.order_id, COUNT(oli.id)::int as line_item_count
    FROM orders o
    LEFT JOIN order_line_items oli ON oli.order_id = o.id
    WHERE o.organization_id = ${ORG_ID}::uuid
    GROUP BY o.order_id
  `
  const liCountMap = new Map(lineItemCounts.map((r) => [r.order_id, r.line_item_count]))

  const missingFromDb = []
  const missingFromSquare = []
  const fieldMismatches = []

  for (const [sqId, sq] of squareOrders) {
    const db = dbMap.get(sqId)
    if (!db) {
      const sqLineItems = sq.lineItems || sq.line_items || []
      missingFromDb.push({
        id: sqId,
        state: sq.state,
        line_items: sqLineItems.length,
        customer_id: sq.customerId || sq.customer_id,
      })
      continue
    }

    const sqState = sq.state
    if (sqState && db.state !== sqState) {
      fieldMismatches.push({ id: sqId, field: 'state', square: sqState, db: db.state })
    }

    const sqTotal = moneyVal(sq.totalMoney || sq.total_money)
    if (sqTotal && db.total_money_amount != null && db.total_money_amount !== sqTotal) {
      fieldMismatches.push({ id: sqId, field: 'total_money_amount', square: sqTotal, db: db.total_money_amount })
    }

    const sqTip = moneyVal(sq.totalTipMoney || sq.total_tip_money)
    const dbTip = db.total_tip_money_amount || 0
    if (sqTip !== dbTip) {
      fieldMismatches.push({ id: sqId, field: 'total_tip_money_amount', square: sqTip, db: dbTip })
    }

    // Line items count
    const sqLineItems = sq.lineItems || sq.line_items || []
    const dbLiCount = liCountMap.get(sqId) || 0
    if (sqLineItems.length !== dbLiCount) {
      fieldMismatches.push({ id: sqId, field: 'line_items_count', square: sqLineItems.length, db: dbLiCount })
    }
  }

  for (const [dbId] of dbMap) {
    if (!squareOrders.has(dbId)) {
      missingFromSquare.push(dbId)
    }
  }

  return {
    entity: 'orders',
    squareTotal: squareOrders.size,
    dbTotal: dbRows.length,
    missingFromDb,
    missingFromSquare,
    fieldMismatches,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIX FUNCTIONS — Backfill missing data (--fix mode)
// ═══════════════════════════════════════════════════════════════════════════════

async function fixBookings(report, squareBookings) {
  let fixed = 0
  let failed = 0

  for (const missing of report.missingFromDb) {
    const sq = squareBookings.get(missing.id)
    if (!sq) continue

    try {
      const locationUuid = resolveLocationUuid(sq.locationId || sq.location_id)
      if (!locationUuid) {
        console.warn(`  Skip booking ${missing.id}: location not resolved`)
        failed++
        continue
      }

      const segments = sq.appointmentSegments || sq.appointment_segments || []
      const firstSegment = segments[0] || {}

      const sqTeamMemberId = firstSegment.team_member_id || firstSegment.teamMemberId
      const sqVariationId = firstSegment.service_variation_id || firstSegment.serviceVariationId
      const technicianUuid = sqTeamMemberId ? (teamMemberCache.get(sqTeamMemberId) || null) : null
      const serviceVariationUuid = sqVariationId ? (serviceVariationCache.get(sqVariationId) || null) : null

      const version = toBigIntSafeNumber(sq.version) || 0
      const durationMinutes = firstSegment.duration_minutes || firstSegment.durationMinutes || null
      const creatorDetails = sq.creatorDetails || sq.creator_details || {}
      const creatorType = creatorDetails.creator_type || creatorDetails.creatorType || null
      const creatorCustomerId = creatorDetails.customer_id || creatorDetails.customerId || null
      const address = sq.address || {}

      // Creator team member resolution
      let administratorUuid = null
      const creatorTeamMemberId = creatorDetails.team_member_id || creatorDetails.teamMemberId
      if (creatorType === 'TEAM_MEMBER' && creatorTeamMemberId) {
        administratorUuid = teamMemberCache.get(creatorTeamMemberId) || null
      }

      await prisma.$executeRawUnsafe(`
        INSERT INTO bookings (
          id, organization_id, booking_id, version, customer_id, location_id, location_type, source,
          start_at, status, all_day, transition_time_minutes,
          creator_type, creator_customer_id, administrator_id,
          address_line_1, locality, administrative_district_level_1, postal_code,
          service_variation_id, duration_minutes, technician_id, any_team_member,
          customer_note, seller_note, created_at, updated_at, raw_json
        ) VALUES (
          gen_random_uuid(), $1::uuid, $2, $3, $4, $5::uuid, $6, $7,
          $8::timestamptz, $9, $10, $11,
          $12, $13, $14::uuid,
          $15, $16, $17, $18,
          $19::uuid, $20, $21::uuid, $22,
          $23, $24, $25::timestamptz, $26::timestamptz, $27::jsonb
        )
        ON CONFLICT (organization_id, booking_id) DO NOTHING
      `,
        ORG_ID,
        sq.id,
        version,
        sq.customerId || sq.customer_id || null,
        locationUuid,
        sq.locationType || sq.location_type || null,
        sq.source || null,
        sq.startAt || sq.start_at ? new Date(sq.startAt || sq.start_at).toISOString() : new Date().toISOString(),
        sq.status || 'UNKNOWN',
        sq.allDay ?? sq.all_day ?? false,
        sq.transitionTimeMinutes ?? sq.transition_time_minutes ?? 0,
        creatorType,
        creatorCustomerId,
        administratorUuid,
        address.addressLine1 || address.address_line_1 || null,
        address.locality || null,
        address.administrativeDistrictLevel1 || address.administrative_district_level_1 || null,
        address.postalCode || address.postal_code || null,
        serviceVariationUuid,
        durationMinutes,
        technicianUuid,
        firstSegment.anyTeamMember ?? firstSegment.any_team_member ?? false,
        sq.customerNote || sq.customer_note || null,
        sq.sellerNote || sq.seller_note || null,
        sq.createdAt || sq.created_at ? new Date(sq.createdAt || sq.created_at).toISOString() : new Date().toISOString(),
        sq.updatedAt || sq.updated_at ? new Date(sq.updatedAt || sq.updated_at).toISOString() : new Date().toISOString(),
        JSON.stringify(jsonSafe(sq))
      )

      // Upsert segments
      if (segments.length > 0) {
        const bookingRecord = await prisma.$queryRawUnsafe(
          `SELECT id FROM bookings WHERE booking_id = $1 AND organization_id = $2::uuid LIMIT 1`,
          sq.id, ORG_ID
        )
        const bookingUuid = bookingRecord?.[0]?.id
        if (bookingUuid) {
          for (let i = 0; i < segments.length; i++) {
            const seg = segments[i]
            const segVariationId = seg.service_variation_id || seg.serviceVariationId
            const segTeamMemberId = seg.team_member_id || seg.teamMemberId
            const segTechUuid = segTeamMemberId ? (teamMemberCache.get(segTeamMemberId) || null) : null
            const segVarUuid = segVariationId ? (serviceVariationCache.get(segVariationId) || null) : null
            const segDuration = seg.duration_minutes || seg.durationMinutes || null

            await prisma.$executeRawUnsafe(`
              INSERT INTO booking_segments (
                id, booking_id, segment_index, square_service_variation_id, service_variation_id,
                square_team_member_id, technician_id, duration_minutes, booking_version,
                is_active, created_at, updated_at
              ) VALUES (
                gen_random_uuid(), $1::uuid, $2, $3, $4::uuid,
                $5, $6::uuid, $7, $8,
                true, NOW(), NOW()
              )
              ON CONFLICT (booking_id, segment_index, booking_version) DO NOTHING
            `,
              bookingUuid, i, segVariationId || null, segVarUuid,
              segTeamMemberId || null, segTechUuid, segDuration, version
            )
          }
        }
      }

      fixed++
    } catch (err) {
      if (!err.message.includes('Unique constraint')) {
        console.error(`  ❌ Booking ${missing.id}: ${err.message}`)
      }
      failed++
    }
  }

  // Fix field mismatches (update status, start_at, version)
  let updated = 0
  const mismatchesByBooking = new Map()
  for (const m of report.fieldMismatches) {
    if (!mismatchesByBooking.has(m.id)) mismatchesByBooking.set(m.id, {})
    mismatchesByBooking.get(m.id)[m.field] = m.square
  }

  for (const [bookingId, fields] of mismatchesByBooking) {
    // Skip if only segments_count mismatch (can't update via simple field update)
    const updatableFields = ['status', 'start_at', 'version', 'customer_id']
    const hasUpdatable = updatableFields.some((f) => fields[f] != null)
    if (!hasUpdatable) continue

    try {
      const sq = squareBookings.get(bookingId)
      const rawJson = sq ? JSON.stringify(jsonSafe(sq)) : null

      // Use raw SQL to update all fields atomically
      await prisma.$executeRawUnsafe(`
        UPDATE bookings SET
          status = COALESCE($3, status),
          start_at = COALESCE($4::timestamptz, start_at),
          version = COALESCE($5, version),
          customer_id = COALESCE($6, customer_id),
          raw_json = COALESCE($7::jsonb, raw_json),
          updated_at = NOW()
        WHERE organization_id = $1::uuid AND booking_id = $2
      `,
        ORG_ID,
        bookingId,
        fields.status || null,
        fields.start_at || null,
        fields.version != null ? fields.version : null,
        fields.customer_id || null,
        rawJson
      )
      updated++
    } catch (err) {
      console.error(`  ❌ Update booking ${bookingId}: ${err.message}`)
    }
  }

  console.log(`  Fix results: ${fixed} inserted, ${updated} updated, ${failed} failed`)
}

async function fixCustomers(report, squareCustomers) {
  let fixed = 0
  let failed = 0

  for (const missing of report.missingFromDb) {
    const sq = squareCustomers.get(missing.id)
    if (!sq) continue

    try {
      await prisma.squareExistingClient.create({
        data: {
          organization_id: ORG_ID,
          square_customer_id: sq.id,
          given_name: (sq.givenName || sq.given_name || '').trim() || null,
          family_name: (sq.familyName || sq.family_name || '').trim() || null,
          email_address: (sq.emailAddress || sq.email_address || '').trim() || null,
          phone_number: (sq.phoneNumber || sq.phone_number || '').trim() || null,
          raw_json: jsonSafe(sq),
        },
      })
      fixed++
    } catch (err) {
      if (!err.message.includes('Unique constraint') && err.code !== 'P2002') {
        console.error(`  ❌ Customer ${missing.id}: ${err.message}`)
      }
      failed++
    }
  }

  // Fix field mismatches
  let updated = 0
  const mismatchesByCustomer = new Map()
  for (const m of report.fieldMismatches) {
    if (!mismatchesByCustomer.has(m.id)) mismatchesByCustomer.set(m.id, {})
    mismatchesByCustomer.get(m.id)[m.field] = m.square
  }

  for (const [customerId, fields] of mismatchesByCustomer) {
    try {
      const sq = squareCustomers.get(customerId)
      const updateData = { ...fields }
      if (sq) updateData.raw_json = jsonSafe(sq)

      await prisma.squareExistingClient.updateMany({
        where: { organization_id: ORG_ID, square_customer_id: customerId },
        data: updateData,
      })
      updated++
    } catch (err) {
      console.error(`  ❌ Update customer ${customerId}: ${err.message}`)
    }
  }

  console.log(`  Fix results: ${fixed} inserted, ${updated} updated, ${failed} failed`)
}

async function fixPayments(report, squarePayments) {
  let fixed = 0
  let failed = 0

  for (const missing of report.missingFromDb) {
    const sq = squarePayments.get(missing.id)
    if (!sq) continue

    try {
      const sqLocationId = sq.locationId || sq.location_id
      const locationUuid = resolveLocationUuid(sqLocationId)
      if (!locationUuid) {
        console.warn(`  Skip payment ${missing.id}: location ${sqLocationId} not resolved`)
        failed++
        continue
      }

      // Resolve order UUID
      const sqOrderId = sq.orderId || sq.order_id || null
      let orderUuid = null
      if (sqOrderId) {
        const orderRecord = await prisma.$queryRawUnsafe(
          `SELECT id FROM orders WHERE order_id = $1 AND organization_id = $2::uuid LIMIT 1`,
          sqOrderId, ORG_ID
        )
        orderUuid = orderRecord?.[0]?.id || null
      }

      const amountMoney = sq.amountMoney || sq.amount_money || {}
      const tipMoney = sq.tipMoney || sq.tip_money || {}
      const totalMoney = sq.totalMoney || sq.total_money || {}

      await prisma.$executeRawUnsafe(`
        INSERT INTO payments (
          organization_id, payment_id, event_type, location_id,
          customer_id, order_id,
          amount_money_amount, amount_money_currency,
          tip_money_amount, tip_money_currency,
          total_money_amount, total_money_currency,
          status, source_type,
          created_at, updated_at, raw_json
        ) VALUES (
          $1::uuid, $2, 'payment.created', $3::uuid,
          $4, $5::uuid,
          $6, 'USD',
          $7, 'USD',
          $8, 'USD',
          $9, $10,
          $11::timestamptz, $12::timestamptz, $13::jsonb
        )
        ON CONFLICT (organization_id, payment_id) DO NOTHING
      `,
        ORG_ID,
        sq.id,
        locationUuid,
        sq.customerId || sq.customer_id || null,
        orderUuid,
        moneyVal(amountMoney),
        moneyVal(tipMoney),
        moneyVal(totalMoney),
        sq.status || 'UNKNOWN',
        sq.sourceType || sq.source_type || null,
        new Date(sq.createdAt || sq.created_at || Date.now()).toISOString(),
        new Date(sq.updatedAt || sq.updated_at || Date.now()).toISOString(),
        JSON.stringify(jsonSafe(sq))
      )
      fixed++
    } catch (err) {
      if (!err.message.includes('Unique constraint')) {
        console.error(`  ❌ Payment ${missing.id}: ${err.message}`)
      }
      failed++
    }
  }

  console.log(`  Fix results: ${fixed} inserted, ${failed} failed`)
}

async function fixOrders(report, squareOrders) {
  let fixed = 0
  let failed = 0

  for (const missing of report.missingFromDb) {
    const sq = squareOrders.get(missing.id)
    if (!sq) continue

    try {
      const sqLocationId = sq.locationId || sq.location_id
      const locationUuid = resolveLocationUuid(sqLocationId)
      if (!locationUuid) {
        console.warn(`  Skip order ${missing.id}: location ${sqLocationId} not resolved`)
        failed++
        continue
      }

      const versionValue = toBigIntSafeNumber(sq.version) || null
      const createdAt = new Date(sq.createdAt || sq.created_at || Date.now())
      const updatedAt = new Date(sq.updatedAt || sq.updated_at || Date.now())

      // Upsert order
      const upsertResult = await prisma.$queryRawUnsafe(`
        INSERT INTO orders (
          organization_id, order_id, location_id, customer_id,
          state, version, reference_id, source_name,
          created_at, updated_at, raw_json
        ) VALUES (
          $1::uuid, $2, $3::uuid, $4,
          $5, $6, $7, $8,
          $9::timestamptz, $10::timestamptz, $11::jsonb
        )
        ON CONFLICT (organization_id, order_id) DO NOTHING
        RETURNING id
      `,
        ORG_ID,
        sq.id,
        locationUuid,
        sq.customerId || sq.customer_id || null,
        sq.state || null,
        versionValue,
        sq.referenceId || sq.reference_id || null,
        sq.source?.name || null,
        createdAt.toISOString(),
        updatedAt.toISOString(),
        JSON.stringify(jsonSafe(sq))
      )

      // Insert line items
      const orderUuid = upsertResult?.[0]?.id
      const lineItems = sq.lineItems || sq.line_items || []
      if (orderUuid && lineItems.length > 0) {
        for (const li of lineItems) {
          try {
            const basePriceMoney = li.basePriceMoney || li.base_price_money || {}
            const totalMoney = li.totalMoney || li.total_money || {}
            const grossSalesMoney = li.grossSalesMoney || li.gross_sales_money || {}

            await prisma.$executeRawUnsafe(`
              INSERT INTO order_line_items (
                id, organization_id, order_id, uid,
                service_variation_id, name, variation_name, item_type,
                quantity,
                base_price_money_amount, gross_sales_money_amount,
                total_money_amount,
                created_at, updated_at, raw_json
              ) VALUES (
                gen_random_uuid(), $1::uuid, $2::uuid, $3,
                $4, $5, $6, $7,
                $8,
                $9, $10,
                $11,
                NOW(), NOW(), $12::jsonb
              )
              ON CONFLICT DO NOTHING
            `,
              ORG_ID,
              orderUuid,
              li.uid || null,
              li.catalogObjectId || li.catalog_object_id || null,
              li.name || null,
              li.variationName || li.variation_name || null,
              li.itemType || li.item_type || null,
              li.quantity || '1',
              moneyVal(basePriceMoney),
              moneyVal(grossSalesMoney),
              moneyVal(totalMoney),
              JSON.stringify(jsonSafe(li))
            )
          } catch (liErr) {
            // Ignore duplicate line items
          }
        }
      }

      fixed++
    } catch (err) {
      if (!err.message.includes('Unique constraint')) {
        console.error(`  ❌ Order ${missing.id}: ${err.message}`)
      }
      failed++
    }
  }

  // Fix state mismatches
  let updated = 0
  const stateMismatches = report.fieldMismatches.filter((m) => m.field === 'state')
  for (const m of stateMismatches) {
    try {
      const sq = squareOrders.get(m.id)
      await prisma.order.updateMany({
        where: { organization_id: ORG_ID, order_id: m.id },
        data: {
          state: m.square,
          raw_json: sq ? jsonSafe(sq) : undefined,
          updated_at: new Date(),
        },
      })
      updated++
    } catch (err) {
      console.error(`  ❌ Update order ${m.id}: ${err.message}`)
    }
  }

  console.log(`  Fix results: ${fixed} inserted, ${updated} updated, ${failed} failed`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTING
// ═══════════════════════════════════════════════════════════════════════════════

function printReport(report) {
  const sep = '='.repeat(70)
  console.log(`\n${sep}`)
  console.log(`  ${report.entity.toUpperCase()} AUDIT`)
  console.log(sep)
  console.log(`  Square total:        ${report.squareTotal.toLocaleString()}`)
  console.log(`  DB total:            ${report.dbTotal.toLocaleString()}`)
  console.log(`  Missing from DB:     ${report.missingFromDb.length}`)
  console.log(`  Orphaned in DB:      ${report.missingFromSquare.length}`)
  console.log(`  Field mismatches:    ${report.fieldMismatches.length}`)

  if (report.missingFromDb.length > 0) {
    console.log(`\n  --- Missing from DB (${report.missingFromDb.length}) ---`)
    const show = report.missingFromDb.slice(0, 50)
    for (const m of show) {
      const details = Object.entries(m)
        .filter(([k]) => k !== 'id')
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')
      console.log(`    ${m.id}  (${details})`)
    }
    if (report.missingFromDb.length > 50) {
      console.log(`    ... and ${report.missingFromDb.length - 50} more`)
    }
  }

  if (report.fieldMismatches.length > 0) {
    console.log(`\n  --- Field Mismatches (${report.fieldMismatches.length}) ---`)
    // Group by field
    const byField = {}
    for (const m of report.fieldMismatches) {
      byField[m.field] = (byField[m.field] || 0) + 1
    }
    for (const [field, count] of Object.entries(byField)) {
      console.log(`    ${field}: ${count} mismatches`)
    }
    // Show first 20 details
    const show = report.fieldMismatches.slice(0, 20)
    console.log('')
    for (const m of show) {
      console.log(`    ${m.id}: ${m.field} Square=${m.square} DB=${m.db}`)
    }
    if (report.fieldMismatches.length > 20) {
      console.log(`    ... and ${report.fieldMismatches.length - 20} more`)
    }
  }

  if (report.missingFromSquare.length > 0) {
    console.log(`\n  --- Orphaned in DB (${report.missingFromSquare.length}) ---`)
    const show = report.missingFromSquare.slice(0, 20)
    for (const id of show) {
      console.log(`    ${id}`)
    }
    if (report.missingFromSquare.length > 20) {
      console.log(`    ... and ${report.missingFromSquare.length - 20} more`)
    }
  }

  console.log('')
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const entity = parseArg('--entity') || 'all'
  const startDateStr = parseArg('--start-date') || DEFAULT_FROM
  const endDateStr = parseArg('--end-date') || new Date().toISOString()
  const doFix = hasFlag('--fix')

  const fromDate = new Date(startDateStr)
  const toDate = new Date(endDateStr)

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    console.error('Invalid date. Use ISO format: --start-date 2025-01-01')
    process.exit(1)
  }
  if (fromDate >= toDate) {
    console.error('Start date must be before end date')
    process.exit(1)
  }

  const validEntities = ['all', 'bookings', 'customers', 'payments', 'orders']
  if (!validEntities.includes(entity)) {
    console.error(`Invalid entity: ${entity}. Use: ${validEntities.join(', ')}`)
    process.exit(1)
  }

  console.log('\n══════════════════════════════════════════════════════════════════════')
  console.log('  SQUARE DATA AUDIT')
  console.log('══════════════════════════════════════════════════════════════════════')
  console.log(`  Entity:     ${entity}`)
  console.log(`  Date range: ${fromDate.toISOString()} → ${toDate.toISOString()}`)
  console.log(`  Mode:       ${doFix ? 'FIX (will write to DB)' : 'DRY RUN (report only)'}`)
  console.log('')

  // Verify org exists
  const org = await prisma.organization.findUnique({ where: { id: ORG_ID } })
  if (!org) {
    console.error(`Organization ${ORG_ID} not found`)
    process.exit(1)
  }

  // Build caches
  const squareLocationIds = await buildLocationCache()
  await buildResolverCaches()

  const shouldAudit = (e) => entity === 'all' || entity === e
  const reports = []

  // ── Bookings ─────────────────────────────────────────────────────────────
  if (shouldAudit('bookings')) {
    console.log('\nFetching bookings from Square...')
    try {
      const squareBookings = await fetchAllBookings(squareLocationIds, fromDate, toDate)
      console.log(`Total bookings from Square: ${squareBookings.size}`)

      console.log('Comparing bookings...')
      const report = await compareBookings(squareBookings)
      reports.push(report)
      printReport(report)

      if (doFix && (report.missingFromDb.length > 0 || report.fieldMismatches.length > 0)) {
        console.log('  Fixing bookings...')
        await fixBookings(report, squareBookings)
      }
    } catch (err) {
      console.error(`Bookings audit failed: ${err.message}`)
    }
  }

  // ── Customers ────────────────────────────────────────────────────────────
  if (shouldAudit('customers')) {
    console.log('\nFetching customers from Square...')
    try {
      const squareCustomers = await fetchAllCustomers()
      console.log(`Total customers from Square: ${squareCustomers.size}`)

      console.log('Comparing customers...')
      const report = await compareCustomers(squareCustomers)
      reports.push(report)
      printReport(report)

      if (doFix && (report.missingFromDb.length > 0 || report.fieldMismatches.length > 0)) {
        console.log('  Fixing customers...')
        await fixCustomers(report, squareCustomers)
      }
    } catch (err) {
      console.error(`Customers audit failed: ${err.message}`)
    }
  }

  // ── Payments ─────────────────────────────────────────────────────────────
  if (shouldAudit('payments')) {
    console.log('\nFetching payments from Square...')
    try {
      const squarePayments = await fetchAllPayments(squareLocationIds, fromDate, toDate)
      console.log(`Total payments from Square: ${squarePayments.size}`)

      console.log('Comparing payments...')
      const report = await comparePayments(squarePayments)
      reports.push(report)
      printReport(report)

      if (doFix && (report.missingFromDb.length > 0 || report.fieldMismatches.length > 0)) {
        console.log('  Fixing payments...')
        await fixPayments(report, squarePayments)
      }
    } catch (err) {
      console.error(`Payments audit failed: ${err.message}`)
    }
  }

  // ── Orders ───────────────────────────────────────────────────────────────
  if (shouldAudit('orders')) {
    console.log('\nFetching orders from Square...')
    try {
      const squareOrders = await fetchAllOrders(squareLocationIds, fromDate, toDate)
      console.log(`Total orders from Square: ${squareOrders.size}`)

      console.log('Comparing orders...')
      const report = await compareOrders(squareOrders)
      reports.push(report)
      printReport(report)

      if (doFix && (report.missingFromDb.length > 0 || report.fieldMismatches.length > 0)) {
        console.log('  Fixing orders...')
        await fixOrders(report, squareOrders)
      }
    } catch (err) {
      console.error(`Orders audit failed: ${err.message}`)
    }
  }

  // ── Overall Summary ──────────────────────────────────────────────────────
  if (reports.length > 1) {
    console.log('\n══════════════════════════════════════════════════════════════════════')
    console.log('  OVERALL AUDIT SUMMARY')
    console.log('══════════════════════════════════════════════════════════════════════')
    let totalIssues = 0
    for (const r of reports) {
      const issues = r.missingFromDb.length + r.fieldMismatches.length
      totalIssues += issues
      console.log(
        `  ${r.entity.padEnd(12)} ${r.missingFromDb.length} missing, ` +
          `${r.fieldMismatches.length} mismatches, ` +
          `${r.missingFromSquare.length} orphaned`
      )
    }
    console.log(`\n  Total issues: ${totalIssues}`)
    console.log('══════════════════════════════════════════════════════════════════════\n')
  }
}

main()
  .catch(async (e) => {
    console.error('Fatal error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
