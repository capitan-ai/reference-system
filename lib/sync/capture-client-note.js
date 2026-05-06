const crypto = require('crypto')
const prisma = require('../prisma-client')

const VALID_SOURCES = new Set([
  'booking_customer_note',
  'booking_seller_note',
  'order_note',
  'order_line_item_note',
  'payment_note',
  'customer_card_note',
])

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

function safeJson(value) {
  return JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  )
}

/**
 * Append a client note row if the text is new for this (org, customer, source, sourceId, lineItemUid) tuple.
 * Empty/whitespace text is a no-op (we never delete history).
 * Re-delivered identical webhooks are no-ops via the unique index.
 */
async function captureClientNote({
  organizationId,
  squareCustomerId,
  source,
  sourceId,
  sourceLineItemUid = null,
  text,
  occurredAt,
  status = null,
  amountCents = null,
  serviceNames = [],
  staffMemberId = null,
  locationId = null,
  rawContext,
  squareUpdatedAt = null,
}) {
  if (text == null) return { written: false, reason: 'no_text' }
  const trimmed = String(text).trim()
  if (!trimmed) return { written: false, reason: 'empty_text' }

  if (!organizationId) return { written: false, reason: 'no_organization' }
  if (!squareCustomerId) return { written: false, reason: 'no_customer' }
  if (!sourceId) return { written: false, reason: 'no_source_id' }
  if (!VALID_SOURCES.has(source)) {
    throw new Error(`captureClientNote: invalid source "${source}"`)
  }

  const occurredAtIso =
    occurredAt instanceof Date ? occurredAt.toISOString() : (occurredAt || new Date().toISOString())
  const squareUpdatedAtIso =
    squareUpdatedAt instanceof Date ? squareUpdatedAt.toISOString() : (squareUpdatedAt || null)

  const textHash = sha256(trimmed)
  const rawJson = JSON.stringify(safeJson(rawContext ?? {}))
  const services = Array.isArray(serviceNames) ? serviceNames.filter(Boolean) : []

  const result = await prisma.$executeRaw`
    INSERT INTO client_notes (
      organization_id, square_customer_id,
      source, source_id, source_line_item_uid,
      text, text_hash,
      occurred_at, status, amount_cents,
      service_names, staff_member_id, location_id,
      raw_context, square_updated_at
    ) VALUES (
      ${organizationId}::uuid,
      ${squareCustomerId},
      ${source},
      ${sourceId},
      ${sourceLineItemUid},
      ${trimmed},
      ${textHash},
      ${occurredAtIso}::timestamptz,
      ${status},
      ${amountCents},
      ${services}::text[],
      ${staffMemberId},
      ${locationId},
      ${rawJson}::jsonb,
      ${squareUpdatedAtIso}::timestamptz
    )
    ON CONFLICT (
      organization_id, square_customer_id, source, source_id,
      COALESCE(source_line_item_uid, ''), text_hash
    ) DO NOTHING
  `

  return { written: result > 0, reason: result > 0 ? 'inserted' : 'duplicate' }
}

module.exports = {
  captureClientNote,
  VALID_SOURCES,
}
