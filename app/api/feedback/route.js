// Public kiosk endpoint: captures customer feedback submitted from
// public/kiosk/feedback.html. No auth — best-effort link to existing
// customer (by phone) and master (by name); accept the row regardless.
//
// Required env: ZORINA_ORG_ID — UUID of the single org these submissions
// belong to. The kiosk is single-tenant in practice.

import db from '../../../lib/prisma-client'

export const dynamic = 'force-dynamic'

const RATE_WINDOW_MS = 5 * 60 * 1000
const RATE_MAX = 30
const ipHits = new Map()

function checkRateLimit(ip) {
  const now = Date.now()
  const hits = (ipHits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS)
  if (hits.length >= RATE_MAX) return false
  hits.push(now)
  ipHits.set(ip, hits)
  return true
}

function normalizePhone(raw) {
  if (!raw) return ''
  return String(raw).replace(/\D/g, '').slice(-10)
}

const AWARENESS_VALUES = new Set(['yes', 'no'])
const SOURCE_VALUES = new Set(['google', 'instagram', 'influencer', 'friend', 'walkin', 'yelp', 'tiktok', 'other'])
const ISSUE_VALUES = new Set(['quality', 'cleanliness', 'atmosphere', 'comfort', 'nothing'])

function pickEnum(value, allowed) {
  return value && allowed.has(value) ? value : null
}

export async function POST(request) {
  try {
    const orgId = process.env.ZORINA_ORG_ID
    if (!orgId) {
      return Response.json({ error: 'ZORINA_ORG_ID not configured' }, { status: 500 })
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
      || request.headers.get('x-real-ip')
      || 'unknown'
    if (!checkRateLimit(ip)) {
      return Response.json({ error: 'Too many submissions, try again later' }, { status: 429 })
    }

    let body
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    // Admin data (Page 1)
    const adminId = body.admin_id ? String(body.admin_id) : null
    const adminName = body.admin_name ? String(body.admin_name).trim() : null

    // Customer data (Page 1)
    const customer = body.customer || {}
    const customerName = String(customer.customerName || '').trim()
    const customerPhone = normalizePhone(customer.customerPhone)
    const masterName = String(customer.masterName || '').trim()
    const serviceDateRaw = customer.serviceDate

    // Technician data (Page 1)
    let masterId = body.master_id ? String(body.master_id) : null

    // Service data (Page 1)
    const bookingId = body.booking_id ? String(body.booking_id) : null
    const locationId = body.location_id ? String(body.location_id) : null
    const squareCustomerId = body.square_customer_id ? String(body.square_customer_id) : null

    if (!customerName) return Response.json({ error: 'customer.customerName required' }, { status: 400 })
    if (customerPhone.length !== 10) return Response.json({ error: 'customer.customerPhone must contain 10 digits' }, { status: 400 })
    if (!masterName) return Response.json({ error: 'customer.masterName required' }, { status: 400 })
    if (!serviceDateRaw) return Response.json({ error: 'customer.serviceDate required' }, { status: 400 })

    // Parse date string as Pacific timezone, not UTC
    // If form sends "05/18/2026", treat it as 05/18/2026 00:00:00 Pacific, not UTC
    let serviceDate
    if (typeof serviceDateRaw === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(serviceDateRaw)) {
      // MM/DD/YYYY format - parse as Pacific midnight
      const [month, day, year] = serviceDateRaw.split('/')
      const dateStr = `${year}-${month}-${day}T00:00:00`
      const tempDate = new Date(dateStr)
      // Create a UTC date, then adjust for Pacific offset
      const pstOffset = -7 * 60 * 60 * 1000 // PDT is UTC-7
      serviceDate = new Date(tempDate.getTime() - pstOffset)
    } else {
      serviceDate = new Date(serviceDateRaw)
    }

    if (Number.isNaN(serviceDate.getTime())) {
      return Response.json({ error: 'customer.serviceDate is not a valid date' }, { status: 400 })
    }

    let rating = null
    if (body.rating !== null && body.rating !== undefined && body.rating !== '') {
      const r = Number(body.rating)
      if (!Number.isInteger(r) || r < 1 || r > 5) {
        return Response.json({ error: 'rating must be an integer 1..5' }, { status: 400 })
      }
      rating = r
    }

    const issuesIn = Array.isArray(body.issues) ? body.issues : []
    const issues = issuesIn.filter(v => ISSUE_VALUES.has(v))

    const sourceOtherDetail = body.source === 'other' && body.source_other_detail
      ? String(body.source_other_detail).trim() || null
      : null

    // Lookup booking to extract customer_id, technician_id, and location_id
    let bookingData = null
    if (bookingId) {
      bookingData = await db.booking.findUnique({
        where: { id: bookingId },
        select: {
          customer_id: true,
          technician_id: true,
          location_id: true,
          location: {
            select: { name: true }
          }
        }
      })
    }

    // Use booking data as source of truth when available
    const finalSquareCustomerId = squareCustomerId || bookingData?.customer_id
    const finalMasterId = masterId || bookingData?.technician_id
    const finalLocationId = locationId || bookingData?.location_id
    const finalLocationName = bookingData?.location?.name || null

    // Lookup customer by phone if not provided anywhere else
    let matchedClient = null
    if (!finalSquareCustomerId) {
      matchedClient = await db.squareExistingClient.findFirst({
        where: {
          organization_id: orgId,
          phone_number: { endsWith: customerPhone }
        },
        select: { square_customer_id: true }
      })
    }

    // Lookup master by name only if masterId not provided (fallback for manual entries)
    if (!finalMasterId && masterName) {
      const masterMatches = await db.teamMember.findMany({
        where: {
          organization_id: orgId,
          OR: [
            { given_name: { contains: masterName, mode: 'insensitive' } },
            { family_name: { contains: masterName, mode: 'insensitive' } }
          ]
        },
        select: { id: true },
        take: 2
      })
      if (masterMatches.length === 1) {
        masterId = masterMatches[0].id
      }
    }

    const created = await db.customerFeedback.create({
      data: {
        organization_id: orgId,

        // Admin/Staff data
        admin_id: adminId,
        admin_name: adminName,

        // Customer data
        customer_name: customerName,
        customer_phone: customerPhone,
        square_customer_id: finalSquareCustomerId || matchedClient?.square_customer_id || null,

        // Technician data
        master_id: finalMasterId,
        master_name: masterName,

        // Service data
        booking_id: bookingId,
        location_id: finalLocationId,
        location_name: finalLocationName,
        service_date: serviceDate,

        // Feedback data
        rating,
        source: pickEnum(body.source, SOURCE_VALUES),
        source_other_detail: sourceOtherDetail,
        improve_text: body.improve ? String(body.improve).trim() || null : null,
        issues,
        awareness: pickEnum(body.awareness, AWARENESS_VALUES),

        // Metadata
        raw_payload: body
      },
      select: { id: true }
    })

    return Response.json({ success: true, id: created.id }, { status: 201 })
  } catch (err) {
    console.error('Error saving feedback:', err.message)
    return Response.json({ error: err.message || 'Failed to save feedback' }, { status: 500 })
  }
}
