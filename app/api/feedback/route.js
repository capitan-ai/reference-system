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

const QUALITY_VALUES = new Set(['very', 'satisfied', 'better'])
const CARED_VALUES = new Set(['yes', 'mostly', 'no'])
const AWARENESS_VALUES = new Set(['yes', 'no'])
const SOURCE_VALUES = new Set(['google', 'instagram', 'influencer', 'friend', 'walkin', 'tiktok'])
const ISSUE_VALUES = new Set(['quality', 'cleanliness', 'atmosphere', 'comfort', 'nothing'])

function pickEnum(value, allowed) {
  return value && allowed.has(value) ? value : null
}

export async function POST(request) {
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

  const customer = body.customer || {}
  const customerName = String(customer.customerName || '').trim()
  const customerPhone = normalizePhone(customer.customerPhone)
  const masterName = String(customer.masterName || '').trim()
  const serviceDateRaw = customer.serviceDate

  if (!customerName) return Response.json({ error: 'customer.customerName required' }, { status: 400 })
  if (customerPhone.length !== 10) return Response.json({ error: 'customer.customerPhone must contain 10 digits' }, { status: 400 })
  if (!masterName) return Response.json({ error: 'customer.masterName required' }, { status: 400 })
  if (!serviceDateRaw) return Response.json({ error: 'customer.serviceDate required' }, { status: 400 })

  const serviceDate = new Date(serviceDateRaw)
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

  const matchedClient = await db.squareExistingClient.findFirst({
    where: {
      organization_id: orgId,
      phone_number: { endsWith: customerPhone }
    },
    select: { square_customer_id: true }
  })

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
  const masterId = masterMatches.length === 1 ? masterMatches[0].id : null

  const created = await db.customerFeedback.create({
    data: {
      organization_id: orgId,
      customer_name: customerName,
      customer_phone: customerPhone,
      square_customer_id: matchedClient?.square_customer_id || null,
      master_name: masterName,
      master_id: masterId,
      service_date: serviceDate,
      rating,
      quality: pickEnum(body.quality, QUALITY_VALUES),
      cared: pickEnum(body.cared, CARED_VALUES),
      source: pickEnum(body.source, SOURCE_VALUES),
      improve_text: body.improve ? String(body.improve).trim() || null : null,
      concern_detail: body.concern_detail ? String(body.concern_detail).trim() || null : null,
      issues,
      awareness: pickEnum(body.awareness, AWARENESS_VALUES),
      raw_payload: body
    },
    select: { id: true }
  })

  return Response.json({ success: true, id: created.id }, { status: 201 })
}
