#!/usr/bin/env node
/**
 * Pull canonical booking fields from Square retrieveBooking and update `bookings`
 * (and active segments' booking_start_at). Fixes stale start_at / raw_json vs Square.
 *
 * Usage:
 *   node scripts/sync-booking-from-square.js <square_booking_id> [more_ids...]
 *   node scripts/sync-booking-from-square.js --dry-run <id>
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const axios = require('axios')
const prisma = require('../lib/prisma-client')

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

function bookingToJson(booking) {
  return JSON.parse(
    JSON.stringify(booking, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  )
}

async function resolveLocationUuid(squareLocationId, organizationId) {
  const loc = await prisma.location.findFirst({
    where: { square_location_id: squareLocationId, organization_id: organizationId },
    select: { id: true },
  })
  return loc?.id ?? null
}

async function resolveTeamMemberUuid(squareTeamMemberId, organizationId) {
  if (!squareTeamMemberId) return null
  const tm = await prisma.teamMember.findFirst({
    where: { square_team_member_id: squareTeamMemberId, organization_id: organizationId },
    select: { id: true },
  })
  return tm?.id ?? null
}

async function resolveServiceVariationUuid(squareVariationId, organizationId) {
  if (!squareVariationId) return null
  const sv = await prisma.serviceVariation.findFirst({
    where: { square_variation_id: squareVariationId, organization_id: organizationId },
    select: { uuid: true },
  })
  return sv?.uuid ?? null
}

function apiStr(b, camel, snake) {
  return b[camel] ?? b[snake] ?? null
}

async function syncOne(squareBookingId, dryRun) {
  const candidates = await prisma.booking.findMany({
    where: {
      OR: [
        { booking_id: squareBookingId },
        { booking_id: { startsWith: `${squareBookingId}-` } },
      ],
    },
    orderBy: [{ version: 'desc' }, { updated_at: 'desc' }],
    select: {
      id: true,
      organization_id: true,
      booking_id: true,
      start_at: true,
      status: true,
      version: true,
      segments: { where: { is_active: true }, select: { id: true }, take: 1 },
    },
  })
  const local =
    candidates.find((c) => c.segments.length > 0) || candidates[0] || null

  if (!local) {
    console.error(`❌ No row in bookings for booking_id=${squareBookingId} (or ${squareBookingId}-*)`)
    return { ok: false, reason: 'not_found' }
  }

  const org = await prisma.organization.findUnique({
    where: { id: local.organization_id },
    select: { square_merchant_id: true },
  })

  const res = await axios.get(`${SQUARE_BASE_URL}/bookings/${squareBookingId}`, {
    headers: {
      Authorization: `Bearer ${SQUARE_TOKEN}`,
      'Square-Version': '2025-02-20',
      Accept: 'application/json',
    },
  })
  const b = res.data?.booking

  if (!b) {
    console.error(`❌ Square returned no booking for ${squareBookingId}`)
    return { ok: false, reason: 'square_empty' }
  }

  const merchantId = apiStr(b, 'merchantId', 'merchant_id')
  if (org?.square_merchant_id && merchantId && org.square_merchant_id !== merchantId) {
    console.warn(
      `⚠️  Merchant mismatch: DB org ${org.square_merchant_id} vs booking ${merchantId} (continuing)`
    )
  }

  const segments = b.appointmentSegments || b.appointment_segments
  const seg = segments?.[0]
  const squareLocId = apiStr(b, 'locationId', 'location_id')
  const locationUuid = await resolveLocationUuid(squareLocId, local.organization_id)
  if (!locationUuid) {
    console.error(`❌ Unknown Square location ${squareLocId} for org ${local.organization_id}`)
    return { ok: false, reason: 'bad_location' }
  }

  const rawJson = bookingToJson(b)
  const startIso = apiStr(b, 'startAt', 'start_at')
  const startAt = new Date(startIso)
  if (Number.isNaN(startAt.getTime())) {
    console.error(`❌ Invalid start_at from Square for ${squareBookingId}`)
    return { ok: false, reason: 'bad_start' }
  }
  const addr = b.address || {}

  const creator = b.creatorDetails || b.creator_details || {}

  const data = {
    start_at: startAt,
    status: b.status,
    version: b.version ?? 0,
    customer_id: apiStr(b, 'customerId', 'customer_id'),
    location_id: locationUuid,
    all_day: b.allDay ?? b.all_day ?? false,
    source: b.source ?? null,
    location_type: apiStr(b, 'locationType', 'location_type'),
    transition_time_minutes: b.transitionTimeMinutes ?? b.transition_time_minutes ?? 0,
    customer_note: apiStr(b, 'customerNote', 'customer_note'),
    seller_note: apiStr(b, 'sellerNote', 'seller_note'),
    created_at: new Date(apiStr(b, 'createdAt', 'created_at')),
    updated_at: new Date(apiStr(b, 'updatedAt', 'updated_at')),
    raw_json: rawJson,
    merchant_id: merchantId,
    address_line_1: addr.addressLine1 ?? addr.address_line_1 ?? null,
    locality: addr.locality ?? null,
    administrative_district_level_1:
      addr.administrativeDistrictLevel1 ?? addr.administrative_district_level_1 ?? null,
    postal_code: addr.postalCode ?? addr.postal_code ?? null,
    creator_type: creator.creatorType ?? creator.creator_type ?? null,
    creator_customer_id: creator.customerId ?? creator.customer_id ?? null,
  }

  if (seg) {
    const tmId = seg.teamMemberId ?? seg.team_member_id
    const svId = seg.serviceVariationId ?? seg.service_variation_id
    const svVer = seg.serviceVariationVersion ?? seg.service_variation_version
    const dur = seg.durationMinutes ?? seg.duration_minutes
    data.technician_id = await resolveTeamMemberUuid(tmId, local.organization_id)
    data.service_variation_id = await resolveServiceVariationUuid(svId, local.organization_id)
    if (dur != null) data.duration_minutes = dur
    if (svVer != null) {
      data.service_variation_version = BigInt(svVer)
    }
  }

  const before = {
    start_at: local.start_at.toISOString(),
    status: local.status,
    version: local.version,
  }
  const after = {
    start_at: data.start_at.toISOString(),
    status: data.status,
    version: data.version,
  }

  console.log(`\n${squareBookingId}`)
  console.log('  before:', before)
  console.log('  after: ', after)

  if (dryRun) {
    console.log('  (dry-run, no DB write)')
    return { ok: true, dryRun: true }
  }

  await prisma.booking.update({
    where: { id: local.id },
    data,
  })

  await prisma.bookingSegment.updateMany({
    where: { booking_id: local.id, is_active: true },
    data: { booking_start_at: startAt },
  })

  console.log('  ✅ updated bookings + active segments booking_start_at')
  return { ok: true }
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

module.exports = { syncOne }
