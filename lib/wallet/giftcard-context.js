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

async function resolveGiftCardContext({ gan, prisma, giftCardsApi, organizationId }) {
  if (!gan) {
    throw new Error('Gift card GAN is required')
  }

  let giftCardInfo = null
  let customerInfo = null
  let balanceCents = 0

  // Note: gift_card_cache table was removed as it was never populated
  // Always fetch from Square API directly
  try {
    // If organizationId is not provided, try to find it via gift card lookup
    let resolvedOrganizationId = organizationId
    if (!resolvedOrganizationId) {
      // Try to find organization_id via gift_cards table
      const giftCard = await prisma.giftCard.findFirst({
        where: {
          OR: [
            { gift_card_gan: gan },
            { square_gift_card_id: { contains: gan } }
          ]
        },
        select: { organization_id: true }
      })
      resolvedOrganizationId = giftCard?.organization_id || null
    }

    // Build query with organization_id filter if available
    const customer = resolvedOrganizationId
      ? await prisma.$queryRaw`
          SELECT square_customer_id, given_name, family_name, email_address, gift_card_id, gift_card_gan
          FROM square_existing_clients 
          WHERE organization_id = ${resolvedOrganizationId}::uuid
            AND (
              (gift_card_gan IS NOT NULL AND gift_card_gan = ${gan})
              OR gift_card_id LIKE ${`%${gan}%`}
            )
          ORDER BY 
            CASE 
              WHEN gift_card_gan = ${gan} THEN 0 
              ELSE 1 
            END
          LIMIT 1
        `
      : await prisma.$queryRaw`
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

  // Always use production domain for webServiceURL (not preview deployments)
  // This ensures Apple Wallet can reliably reach the registration endpoint
  // Even if APP_BASE_URL is set to a preview URL, use production domain
  const productionBaseUrl = 'https://www.zorinastudio-referral.com'
  
  // Check if APP_BASE_URL is set to a preview/deployment URL
  const appBaseUrl = process.env.APP_BASE_URL ? process.env.APP_BASE_URL.replace(/\/$/, '') : null
  const isPreviewUrl = appBaseUrl && (appBaseUrl.includes('vercel.app') || appBaseUrl.includes('vercel.sh'))
  
  // Always use production domain for webServiceURL (Apple Wallet needs stable domain)
  // IMPORTANT: Apple appends /v1/devices/... to webServiceURL automatically
  // So webServiceURL should be just the base path without /v1
  const baseUrl = productionBaseUrl
  const webServiceUrl = `${baseUrl}/api/wallet`
  
  console.log(`🔗 webServiceUrl configured: ${webServiceUrl}`)
  if (isPreviewUrl) {
    console.log(`   ⚠️ APP_BASE_URL is set to preview URL: ${appBaseUrl}`)
    console.log(`   ✅ Using production domain instead: ${productionBaseUrl}`)
  } else {
    console.log(`   APP_BASE_URL: ${appBaseUrl || 'NOT SET'}`)
  }

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

