function normalizeCents(value, { fallback = 0 } = {}) {
  if (value === null || value === undefined) return fallback

  if (typeof value === 'bigint') {
    return Number(value)
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  if (typeof value === 'object') {
    if (typeof value.toNumber === 'function') {
      try {
        return Number(value.toNumber())
      } catch (error) {
        console.warn('⚠️ Failed to convert Decimal to number:', error.message)
        return fallback
      }
    }
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

async function resolveGiftCardContext({ gan, prisma, giftCardsApi }) {
  if (!gan) {
    throw new Error('Gift card GAN is required')
  }

  let giftCardInfo = null
  let customerInfo = null
  let balanceCents = 0

  // Note: gift_card_cache table was removed as it was never populated
  // Always fetch from Square API directly
  try {
    const customer = await prisma.$queryRaw`
        SELECT square_customer_id, given_name, family_name, email_address, gift_card_id, gift_card_gan
        FROM square_existing_clients 
        WHERE 
          (gift_card_gan IS NOT NULL AND gift_card_gan = ${gan})
          OR gift_card_id LIKE ${`%${gan}%`}
        ORDER BY 
          CASE 
            WHEN gift_card_gan = ${gan} THEN 0 
            ELSE 1 
          END
        LIMIT 1
      `

      if (customer && customer.length > 0) {
        const cust = customer[0]
        customerInfo = {
          squareCustomerId: cust.square_customer_id,
          firstName: cust.given_name,
          lastName: cust.family_name,
          fullName: `${cust.given_name || ''} ${cust.family_name || ''}`.trim(),
          email: cust.email_address
        }

        if (cust.gift_card_id) {
          try {
            const squareGiftCard = await giftCardsApi.retrieveGiftCard(cust.gift_card_id)
            if (squareGiftCard.result?.giftCard) {
              giftCardInfo = squareGiftCard.result.giftCard
              balanceCents = normalizeCents(giftCardInfo.balanceMoney?.amount)
            }
          } catch (squareError) {
            console.warn(`⚠️ Could not fetch gift card from Square: ${squareError.message}`)
          }
        }
      }
  } catch (dbError) {
    console.error(`⚠️ Database lookup error: ${dbError.message}`)
  }

  if (balanceCents === 0 && !giftCardInfo) {
    console.log(`⚠️ Could not find gift card info, using default balance of $10`)
    balanceCents = 1000
  }

  const customerName = customerInfo?.fullName ||
    customerInfo?.firstName ||
    (customerInfo?.firstName && customerInfo?.lastName
      ? `${customerInfo.firstName} ${customerInfo.lastName}`
      : 'Guest')

  // Use environment variable if available, otherwise fallback to hardcoded
  const baseUrl = process.env.APP_BASE_URL 
    ? process.env.APP_BASE_URL.replace(/\/$/, '')
    : 'https://www.zorinastudio-referral.com'
  
  const webServiceUrl = `${baseUrl}/api/wallet/v1`
  
  console.log(`🔗 webServiceUrl configured: ${webServiceUrl}`)
  console.log(`   APP_BASE_URL: ${process.env.APP_BASE_URL || 'NOT SET'}`)

  const displayGan = giftCardInfo?.gan || gan
  const serialNumber = displayGan

  return {
    giftCardGan: displayGan,
    originalLookupValue: gan,
    balanceCents,
    customerName,
    serialNumber,
    squareGiftCardId: giftCardInfo?.id || null,
    webServiceUrl
  }
}

module.exports = {
  resolveGiftCardContext
}

