// Public kiosk endpoint: looks up customer by phone or email and returns their bookings for today
// with technician info, so admin form can auto-fill customer name and master name.

import db from '../../../../lib/prisma-client'

export const dynamic = 'force-dynamic'

function normalizePhone(raw) {
  if (!raw) return ''
  return String(raw).replace(/\D/g, '').slice(-10)
}

function normalizeEmail(raw) {
  if (!raw) return ''
  return String(raw).toLowerCase().trim()
}

function joinName(given, family) {
  return [given, family].filter(Boolean).join(' ') || null
}

export async function GET(request) {
  try {
    const orgId = process.env.ZORINA_ORG_ID
    if (!orgId) {
      return Response.json({ error: 'ZORINA_ORG_ID not configured' }, { status: 500 })
    }

    const url = new URL(request.url)
    const phoneParam = url.searchParams.get('phone') || ''
    const emailParam = url.searchParams.get('email') || ''

    if (!phoneParam && !emailParam) {
      return Response.json({ error: 'phone or email parameter required' }, { status: 400 })
    }

    if (phoneParam && emailParam) {
      return Response.json({ error: 'provide either phone or email, not both' }, { status: 400 })
    }

    let client = null

    if (phoneParam) {
      const phone10 = normalizePhone(phoneParam)
      if (phone10.length !== 10) {
        return Response.json({ error: 'phone must contain 10 digits' }, { status: 400 })
      }

      // Step A1: Find customer by phone (search by normalized phone number)
      const allClients = await db.squareExistingClient.findMany({
        where: {
          organization_id: orgId,
        },
        select: {
          square_customer_id: true,
          given_name: true,
          family_name: true,
          phone_number: true,
        },
      })

      client = allClients.find(c => {
        const normalized = String(c.phone_number || '').replace(/\D/g, '').slice(-10)
        return normalized === phone10
      })
    } else if (emailParam) {
      const normalizedEmail = normalizeEmail(emailParam)
      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        return Response.json({ error: 'email must be a valid email address' }, { status: 400 })
      }

      // Step A2: Find customer by email
      const allClients = await db.squareExistingClient.findMany({
        where: {
          organization_id: orgId,
        },
        select: {
          square_customer_id: true,
          given_name: true,
          family_name: true,
          email_address: true,
        },
      })

      client = allClients.find(c => {
        const normalized = normalizeEmail(c.email_address || '')
        return normalized === normalizedEmail
      })
    }

    if (!client) {
      return Response.json({ found: false }, { status: 200 })
    }

  // Step B: Query bookings for today using raw SQL with timezone cast
  const bookingRows = await db.$queryRaw`
    SELECT
      b.id::text AS booking_id,
      b.start_at,
      b.status,
      b.technician_id::text AS booking_tech_id,
      tm_b.given_name AS booking_tech_given,
      tm_b.family_name AS booking_tech_family,
      bs.id::text AS segment_id,
      bs.segment_index,
      bs.technician_id::text AS segment_tech_id,
      tm_s.given_name AS seg_tech_given,
      tm_s.family_name AS seg_tech_family,
      bs.duration_minutes,
      bs.is_active
    FROM bookings b
    LEFT JOIN team_members tm_b ON tm_b.id = b.technician_id
    LEFT JOIN booking_segments bs ON bs.booking_id = b.id AND bs.is_active = true
    LEFT JOIN team_members tm_s ON tm_s.id = bs.technician_id
    WHERE b.organization_id = ${orgId}::uuid
      AND b.customer_id = ${client.square_customer_id}
      AND b.status NOT IN ('CANCELLED_BY_CUSTOMER', 'NO_SHOW')
      AND (b.start_at AT TIME ZONE 'America/Los_Angeles')::date
          = (NOW() AT TIME ZONE 'America/Los_Angeles')::date
    ORDER BY b.start_at ASC, bs.segment_index ASC
  `

  // Step C: Collapse rows into bookings array (group by booking_id, nest segments)
  const bookingMap = new Map()
  for (const row of bookingRows) {
    if (!bookingMap.has(row.booking_id)) {
      bookingMap.set(row.booking_id, {
        booking_id: row.booking_id,
        start_at: row.start_at,
        status: row.status,
        technician_id: row.booking_tech_id,
        technician_name: joinName(row.booking_tech_given, row.booking_tech_family),
        segments: [],
      })
    }
    if (row.segment_id && row.is_active) {
      bookingMap.get(row.booking_id).segments.push({
        segment_id: row.segment_id,
        segment_index: row.segment_index,
        technician_id: row.segment_tech_id,
        technician_name: joinName(row.seg_tech_given, row.seg_tech_family),
        duration_minutes: row.duration_minutes,
      })
    }
  }
  const bookings = [...bookingMap.values()]

    return Response.json({
      found: true,
      customer: {
        square_customer_id: client.square_customer_id,
        given_name: client.given_name,
        family_name: client.family_name,
      },
      bookings,
    }, { status: 200 })
  } catch (err) {
    console.error('Error in booking lookup:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
