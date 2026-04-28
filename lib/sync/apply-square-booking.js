/**
 * Apply a Square booking object (from listBookings or retrieveBooking) to the local
 * `bookings` table via upsert. Also updates `booking_segments` from appointment_segments.
 *
 * Returns:
 *   {
 *     action: 'inserted' | 'updated' | 'noop' | 'skipped',
 *     reason?: string,           // for 'skipped'
 *     customerId: string | null,
 *     bookingId: string,
 *     before?: { start_at, status, version },
 *     after?:  { start_at, status, version },
 *   }
 *
 * Used by:
 *   - scripts/sync-booking-from-square.js  (single booking, called from CLI)
 *   - scripts/sync-bookings-month.js       (bulk month sync)
 */

const prisma = require('../prisma-client')

function apiStr(b, camel, snake) {
  return b[camel] ?? b[snake] ?? null
}

function bookingToJson(booking) {
  return JSON.parse(
    JSON.stringify(booking, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  )
}

async function resolveLocationUuid(squareLocationId, organizationId) {
  if (!squareLocationId) return null
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

/**
 * Replace booking_segments for a booking with what's in the Square payload.
 * Marks any older-version segments as inactive, then upserts segments at current version.
 */
async function upsertBookingSegments(bookingUuid, squareBooking) {
  const segments = squareBooking.appointmentSegments || squareBooking.appointment_segments || []
  if (!Array.isArray(segments) || segments.length === 0) return

  const bookingVersion = Number.isFinite(squareBooking.version) ? squareBooking.version : 0
  const organizationId = await prisma.booking
    .findUnique({ where: { id: bookingUuid }, select: { organization_id: true } })
    .then((r) => r?.organization_id)

  // Deactivate older-version segments for this booking
  await prisma.$executeRaw`
    UPDATE booking_segments
    SET is_active = false,
        deleted_at = NOW(),
        updated_at = NOW()
    WHERE booking_id = ${bookingUuid}::uuid
      AND booking_version < ${bookingVersion}
  `

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    const squareVariationId = segment.serviceVariationId || segment.service_variation_id
    const teamMemberId = segment.teamMemberId || segment.team_member_id
    const durationMinutes = segment.durationMinutes ?? segment.duration_minutes
    const intermissionMinutes = segment.intermissionMinutes ?? segment.intermission_minutes ?? 0
    const anyTeamMember = segment.anyTeamMember ?? segment.any_team_member ?? false

    const technicianUuid = await resolveTeamMemberUuid(teamMemberId, organizationId)
    const variationUuid = await resolveServiceVariationUuid(squareVariationId, organizationId)
    const startAtIso = apiStr(squareBooking, 'startAt', 'start_at')
    const startAt = startAtIso ? new Date(startAtIso) : null

    await prisma.$executeRaw`
      INSERT INTO booking_segments (
        id, booking_id, segment_index, square_service_variation_id, service_variation_id,
        square_team_member_id, technician_id, duration_minutes, intermission_minutes,
        any_team_member, booking_version, is_active, booking_start_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), ${bookingUuid}::uuid, ${i},
        ${squareVariationId || null},
        ${variationUuid}::uuid,
        ${teamMemberId || null},
        ${technicianUuid}::uuid,
        ${durationMinutes ?? null},
        ${intermissionMinutes},
        ${anyTeamMember},
        ${bookingVersion},
        true,
        ${startAt},
        NOW(),
        NOW()
      )
      ON CONFLICT (booking_id, segment_index, booking_version) DO UPDATE SET
        square_service_variation_id = EXCLUDED.square_service_variation_id,
        service_variation_id = EXCLUDED.service_variation_id,
        square_team_member_id = EXCLUDED.square_team_member_id,
        technician_id = EXCLUDED.technician_id,
        duration_minutes = EXCLUDED.duration_minutes,
        intermission_minutes = EXCLUDED.intermission_minutes,
        any_team_member = EXCLUDED.any_team_member,
        is_active = true,
        booking_start_at = EXCLUDED.booking_start_at,
        updated_at = NOW()
    `
  }

  // Also update booking_start_at on any active segments (in case they pre-existed at this version)
  if (segments.length > 0) {
    const startAtIso = apiStr(squareBooking, 'startAt', 'start_at')
    if (startAtIso) {
      await prisma.$executeRaw`
        UPDATE booking_segments
        SET booking_start_at = ${new Date(startAtIso)}
        WHERE booking_id = ${bookingUuid}::uuid
          AND is_active = true
      `
    }
  }
}

/**
 * Apply one Square booking to the local DB (insert or update). Idempotent.
 *
 * @param {object} squareBooking - booking object from Square API (camelCase or snake_case)
 * @param {object} options
 * @param {string} options.organizationId - org UUID
 * @param {boolean} [options.dryRun=false] - if true, return what would change but write nothing
 * @returns {Promise<object>} { action, customerId, bookingId, before, after }
 */
async function applySquareBookingToDb(squareBooking, { organizationId, dryRun = false } = {}) {
  if (!squareBooking || !squareBooking.id) {
    return { action: 'skipped', reason: 'no_booking_id', customerId: null, bookingId: null }
  }
  if (!organizationId) {
    throw new Error('applySquareBookingToDb: organizationId is required')
  }

  const bookingId = squareBooking.id
  const customerId = apiStr(squareBooking, 'customerId', 'customer_id')
  const squareLocId = apiStr(squareBooking, 'locationId', 'location_id')
  const startAtIso = apiStr(squareBooking, 'startAt', 'start_at')
  const status = squareBooking.status || 'ACCEPTED'
  const versionRaw = squareBooking.version
  const version =
    typeof versionRaw === 'bigint' ? Number(versionRaw) : Number(versionRaw ?? 0)
  const createdAtIso = apiStr(squareBooking, 'createdAt', 'created_at')
  const updatedAtIso = apiStr(squareBooking, 'updatedAt', 'updated_at')

  if (!startAtIso) {
    return { action: 'skipped', reason: 'no_start_at', customerId, bookingId }
  }
  const startAt = new Date(startAtIso)
  if (Number.isNaN(startAt.getTime())) {
    return { action: 'skipped', reason: 'invalid_start_at', customerId, bookingId }
  }

  const locationUuid = await resolveLocationUuid(squareLocId, organizationId)
  if (!locationUuid) {
    return { action: 'skipped', reason: 'unknown_location', customerId, bookingId }
  }

  // Look up existing row (handle versioned booking_ids: 'xxxx' or 'xxxx-SUFFIX')
  // Square's listBookings returns the canonical id; we match exact OR with our suffix.
  const existingCandidates = await prisma.booking.findMany({
    where: {
      organization_id: organizationId,
      OR: [{ booking_id: bookingId }, { booking_id: { startsWith: `${bookingId}-` } }],
    },
    orderBy: [{ version: 'desc' }, { updated_at: 'desc' }],
    select: {
      id: true,
      booking_id: true,
      start_at: true,
      status: true,
      version: true,
      customer_id: true,
    },
  })
  const existing = existingCandidates[0] || null

  // Detect noop: existing matches the Square version exactly
  let action
  if (!existing) {
    action = 'inserted'
  } else {
    const startAtMatches = existing.start_at.getTime() === startAt.getTime()
    const statusMatches = existing.status === status
    const versionMatches = (existing.version ?? 0) === version
    const customerMatches = (existing.customer_id ?? null) === (customerId ?? null)
    if (startAtMatches && statusMatches && versionMatches && customerMatches) {
      action = 'noop'
    } else {
      action = 'updated'
    }
  }

  const before = existing
    ? {
        start_at: existing.start_at.toISOString(),
        status: existing.status,
        version: existing.version,
      }
    : null
  const after = {
    start_at: startAt.toISOString(),
    status,
    version,
  }

  if (dryRun || action === 'noop') {
    return { action, customerId, bookingId, before, after }
  }

  // Resolve technician/service from first segment (matches existing single-booking sync)
  const segments = squareBooking.appointmentSegments || squareBooking.appointment_segments || []
  const seg = segments[0] || null
  const technicianUuid = seg
    ? await resolveTeamMemberUuid(seg.teamMemberId || seg.team_member_id, organizationId)
    : null
  const serviceVariationUuid = seg
    ? await resolveServiceVariationUuid(
        seg.serviceVariationId || seg.service_variation_id,
        organizationId
      )
    : null
  const durationMinutes = seg ? seg.durationMinutes ?? seg.duration_minutes ?? null : null
  const serviceVariationVersionRaw = seg
    ? seg.serviceVariationVersion ?? seg.service_variation_version
    : null
  const serviceVariationVersion =
    serviceVariationVersionRaw != null ? BigInt(serviceVariationVersionRaw) : null

  const merchantId = apiStr(squareBooking, 'merchantId', 'merchant_id')
  const addr = squareBooking.address || {}
  const creator = squareBooking.creatorDetails || squareBooking.creator_details || {}

  const data = {
    organization_id: organizationId,
    booking_id: bookingId,
    location_id: locationUuid,
    customer_id: customerId,
    start_at: startAt,
    status,
    version,
    all_day: squareBooking.allDay ?? squareBooking.all_day ?? false,
    source: squareBooking.source ?? null,
    location_type: apiStr(squareBooking, 'locationType', 'location_type'),
    transition_time_minutes:
      squareBooking.transitionTimeMinutes ?? squareBooking.transition_time_minutes ?? 0,
    customer_note: apiStr(squareBooking, 'customerNote', 'customer_note'),
    seller_note: apiStr(squareBooking, 'sellerNote', 'seller_note'),
    created_at: createdAtIso ? new Date(createdAtIso) : new Date(),
    updated_at: updatedAtIso ? new Date(updatedAtIso) : new Date(),
    raw_json: bookingToJson(squareBooking),
    merchant_id: merchantId,
    address_line_1: addr.addressLine1 ?? addr.address_line_1 ?? null,
    locality: addr.locality ?? null,
    administrative_district_level_1:
      addr.administrativeDistrictLevel1 ?? addr.administrative_district_level_1 ?? null,
    postal_code: addr.postalCode ?? addr.postal_code ?? null,
    creator_type: creator.creatorType ?? creator.creator_type ?? null,
    creator_customer_id: creator.customerId ?? creator.customer_id ?? null,
    technician_id: technicianUuid,
    service_variation_id: serviceVariationUuid,
    duration_minutes: durationMinutes,
    service_variation_version: serviceVariationVersion,
  }

  let bookingUuid
  if (existing) {
    // Update existing row (preserve its UUID)
    await prisma.booking.update({ where: { id: existing.id }, data })
    bookingUuid = existing.id
  } else {
    // Insert new row
    const created = await prisma.booking.create({ data })
    bookingUuid = created.id
  }

  // Sync booking_segments
  await upsertBookingSegments(bookingUuid, squareBooking)

  // Append client_notes rows for any non-empty customer/seller note on this booking.
  // Idempotent — re-running sync over the same booking is a no-op.
  if (customerId) {
    try {
      const { captureClientNote } = require('./capture-client-note')
      const customerNoteText = apiStr(squareBooking, 'customerNote', 'customer_note')
      const sellerNoteText = apiStr(squareBooking, 'sellerNote', 'seller_note')
      const segmentServiceNames = []
      if (segments.length > 0) {
        const squareIds = segments
          .map((s) => s.serviceVariationId || s.service_variation_id)
          .filter(Boolean)
        if (squareIds.length > 0) {
          const svs = await prisma.serviceVariation.findMany({
            where: { organization_id: organizationId, square_variation_id: { in: squareIds } },
            select: { square_variation_id: true, name: true, service_name: true },
          })
          const nameById = new Map(svs.map((sv) => [sv.square_variation_id, sv.name || sv.service_name || null]))
          for (const id of squareIds) {
            const n = nameById.get(id)
            if (n) segmentServiceNames.push(n)
          }
        }
      }
      const baseNote = {
        organizationId,
        squareCustomerId: customerId,
        sourceId: bookingId,
        occurredAt: startAt,
        status,
        amountCents: null,
        serviceNames: segmentServiceNames,
        staffMemberId: seg?.teamMemberId || seg?.team_member_id || null,
        locationId: squareLocId,
        rawContext: squareBooking,
        squareUpdatedAt: updatedAtIso || null,
      }
      if (customerNoteText) {
        await captureClientNote({ ...baseNote, source: 'booking_customer_note', text: customerNoteText })
      }
      if (sellerNoteText) {
        await captureClientNote({ ...baseNote, source: 'booking_seller_note', text: sellerNoteText })
      }
    } catch (noteError) {
      console.warn(`[apply-square-booking] capture-client-note failed for ${bookingId}:`, noteError.message)
    }
  }

  return { action, customerId, bookingId, before, after }
}

module.exports = {
  applySquareBookingToDb,
  // Exports for tests / other scripts
  resolveLocationUuid,
  resolveTeamMemberUuid,
  resolveServiceVariationUuid,
  bookingToJson,
}
