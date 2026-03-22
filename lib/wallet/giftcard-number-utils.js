async function findSquareGiftCardId(lookupValue, prisma, organizationId = null) {
  if (!lookupValue) return null
  const trimmed = lookupValue.toString().trim()

  if (trimmed.toLowerCase().startsWith('gftc:')) {
    return trimmed
  }

  // Note: gift_card_cache table was removed as it was never populated
  // Check legacy square_existing_clients table instead
  // If organizationId is provided, filter by it for multi-tenant isolation
  const legacyMatch = organizationId
    ? await prisma.$queryRaw`
        SELECT gift_card_id
        FROM square_existing_clients
        WHERE organization_id = ${organizationId}::uuid
          AND gift_card_id LIKE ${`%${trimmed}%`}
        LIMIT 1
      `
    : await prisma.$queryRaw`
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

async function normalizeGiftCardNumber({ rawValue, prisma, giftCardsApi, organizationId = null }) {
  if (!rawValue) return null
  const trimmed = rawValue.toString().trim()

  if (/^\d+$/.test(trimmed)) {
    return trimmed
  }

  let targetGiftCardId = null
  if (trimmed.toLowerCase().startsWith('gftc:')) {
    targetGiftCardId = trimmed
  } else {
    targetGiftCardId = await findSquareGiftCardId(trimmed, prisma, organizationId)
  }

  if (!targetGiftCardId || !giftCardsApi) {
    return trimmed
  }

  try {
    const squareGiftCard = await giftCardsApi.retrieveGiftCard(targetGiftCardId)
    const resolvedGan = squareGiftCard.result?.giftCard?.gan
    
    // Audit the GAN resolution to keep square_gift_card_gan_audit live
    if (resolvedGan && prisma) {
      try {
        const customerId = squareGiftCard.result?.giftCard?.customerId || null
        const rawPayload = JSON.stringify(squareGiftCard.result || {})
        
        await prisma.$executeRaw`
          INSERT INTO "square_gift_card_gan_audit" (
            "gift_card_id", 
            "square_customer_id", 
            "resolved_gan", 
            "verified_at", 
            "raw_payload"
          ) VALUES (
            ${targetGiftCardId}, 
            ${customerId}, 
            ${resolvedGan}, 
            NOW(), 
            ${rawPayload}::jsonb
          )
          ON CONFLICT ("gift_card_id") DO UPDATE SET
            "resolved_gan" = EXCLUDED."resolved_gan",
            "square_customer_id" = EXCLUDED."square_customer_id",
            "verified_at" = NOW(),
            "raw_payload" = EXCLUDED."raw_payload"
        `
      } catch (auditError) {
        console.warn(`⚠️ Failed to save GAN audit for ${targetGiftCardId}:`, auditError.message)
      }
    }

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

