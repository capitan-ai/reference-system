async function findSquareGiftCardId(lookupValue, prisma) {
  if (!lookupValue) return null
  const trimmed = lookupValue.toString().trim()

  if (trimmed.toLowerCase().startsWith('gftc:')) {
    return trimmed
  }

  // Note: gift_card_cache table was removed as it was never populated
  // Check legacy square_existing_clients table instead
  const legacyMatch = await prisma.$queryRaw`
    SELECT gift_card_id
    FROM square_existing_clients
    WHERE gift_card_id LIKE ${`%${trimmed}%`}
    LIMIT 1
  `

  if (legacyMatch && legacyMatch.length > 0) {
    return legacyMatch[0].gift_card_id
  }

  return null
}

async function normalizeGiftCardNumber({ rawValue, prisma, giftCardsApi }) {
  if (!rawValue) return null
  const trimmed = rawValue.toString().trim()

  if (/^\d+$/.test(trimmed)) {
    return trimmed
  }

  let targetGiftCardId = null
  if (trimmed.toLowerCase().startsWith('gftc:')) {
    targetGiftCardId = trimmed
  } else {
    targetGiftCardId = await findSquareGiftCardId(trimmed, prisma)
  }

  if (!targetGiftCardId || !giftCardsApi) {
    return trimmed
  }

  try {
    const squareGiftCard = await giftCardsApi.retrieveGiftCard(targetGiftCardId)
    const resolvedGan = squareGiftCard.result?.giftCard?.gan
    return resolvedGan || trimmed
  } catch (error) {
    console.warn(`⚠️ Could not resolve customer-facing number for ${rawValue}: ${error.message}`)
    return trimmed
  }
}

module.exports = {
  normalizeGiftCardNumber,
  findSquareGiftCardId
}

