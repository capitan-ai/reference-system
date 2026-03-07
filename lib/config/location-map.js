const { LOCATION_FILTER_IDS } = require('../constants/locations')

function normalizeFriendlyLocationId(value) {
  if (!value) return null
  const normalized = String(value).trim().toLowerCase()
  return LOCATION_FILTER_IDS.includes(normalized) ? normalized : null
}

function parseLocationMap(raw) {
  if (!raw || typeof raw !== 'string') {
    return { friendlyToSquare: {}, squareToFriendly: {} }
  }

  const friendlyToSquare = {}
  const squareToFriendly = {}

  raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const [friendlyRaw, squareIdsRaw] = entry.split('=')
      const friendly = normalizeFriendlyLocationId(friendlyRaw)
      if (!friendly || !squareIdsRaw) {
        return
      }

      const squareIds = squareIdsRaw
        .split('|')
        .map((id) => id.trim())
        .filter(Boolean)

      if (!squareIds.length) {
        return
      }

      friendlyToSquare[friendly] = squareIds
      squareIds.forEach((squareId) => {
        squareToFriendly[squareId] = friendly
      })
    })

  return { friendlyToSquare, squareToFriendly }
}

const RAW_LOCATION_MAP = process.env.REFERRAL_LOCATION_MAP?.trim()
const { friendlyToSquare, squareToFriendly } = parseLocationMap(RAW_LOCATION_MAP)
const defaultFriendlyLocationId = normalizeFriendlyLocationId(
  process.env.DEFAULT_ANALYTICS_LOCATION_ID
)

function getFriendlyLocationIdFromSquareId(squareLocationId) {
  if (!squareLocationId) return null
  const trimmed = squareLocationId.toString().trim()
  return squareToFriendly[trimmed] || null
}

function getFriendlyLocationIdFromBooking(booking = {}) {
  if (!booking || typeof booking !== 'object') return null
  const bookingLocation =
    booking.locationId ||
    booking.location_id ||
    booking.location?.id ||
    booking.extendedProperties?.locationId

  return (
    getFriendlyLocationIdFromSquareId(bookingLocation) ||
    normalizeFriendlyLocationId(booking.metadata?.locationId)
  )
}

function getFriendlyLocationIdFromPayment(payment = {}) {
  if (!payment || typeof payment !== 'object') return null
  const paymentLocation =
    payment.locationId ||
    payment.location_id ||
    payment.location?.id ||
    payment.orderLocationId ||
    payment.processingLocationId

  return (
    getFriendlyLocationIdFromSquareId(paymentLocation) ||
    normalizeFriendlyLocationId(payment.metadata?.locationId)
  )
}

function resolveLocationId({
  paymentData,
  bookingData,
  metadataLocationId,
  fallbackSquareLocationId
} = {}) {
  return (
    getFriendlyLocationIdFromPayment(paymentData) ||
    getFriendlyLocationIdFromBooking(bookingData) ||
    normalizeFriendlyLocationId(metadataLocationId) ||
    getFriendlyLocationIdFromSquareId(fallbackSquareLocationId) ||
    defaultFriendlyLocationId ||
    null
  )
}

function addLocationMetadata(metadata, locationId) {
  const normalized = normalizeFriendlyLocationId(locationId)
  if (!normalized) {
    return metadata
  }
  return {
    ...(metadata || {}),
    locationId: normalized
  }
}

module.exports = {
  normalizeFriendlyLocationId,
  getFriendlyLocationIdFromSquareId,
  getFriendlyLocationIdFromBooking,
  getFriendlyLocationIdFromPayment,
  resolveLocationId,
  addLocationMetadata,
  LOCATION_FILTER_IDS: [...LOCATION_FILTER_IDS]
}


