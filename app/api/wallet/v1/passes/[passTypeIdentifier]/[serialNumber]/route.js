// Apple Wallet Web Service API
// GET /v1/passes/{passTypeIdentifier}/{serialNumber}
// Returns the latest version of a pass

import { Client, Environment } from 'square'
import { createRequire } from 'module'
import prisma from '../../../../../../../lib/prisma-client'

const require = createRequire(import.meta.url)
const { generateGiftCardPass, generateAuthToken } = require('../../../../../../../lib/wallet/pass-generator.js')

function getGiftCardsApi() {
  const squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
    environment: Environment.Production,
  })
  return squareClient.giftCardsApi
}

// Verify authentication token
function verifyAuthToken(request, serialNumber) {
  const authToken = request.headers.get('authorization')?.replace('ApplePass ', '')
  if (!authToken) {
    return false
  }
  
  const expectedToken = generateAuthToken(serialNumber)
  return authToken === expectedToken
}

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  try {
    const { passTypeIdentifier, serialNumber } = params
    const giftCardsApi = getGiftCardsApi()

    // Verify pass type identifier matches
    if (passTypeIdentifier !== process.env.APPLE_PASS_TYPE_ID) {
      return new Response('Invalid pass type identifier', { status: 401 })
    }

    // Verify authentication token
    if (!verifyAuthToken(request, serialNumber)) {
      return new Response('Unauthorized', { status: 401 })
    }

    console.log(`📱 Getting latest pass version for serial: ${serialNumber}`)

    // Use serialNumber as GAN (Gift Account Number)
    const gan = serialNumber

    // Get current gift card info
    let customerInfo = null
    let balanceCents = 0

    try {
      // Note: gift_card_cache table was removed as it was never populated
      // Always fetch from Square API directly
      // First, try to find organization_id via gift_cards table for multi-tenant isolation
      const giftCard = await prisma.giftCard.findFirst({
        where: {
          OR: [
            { gift_card_gan: gan },
            { square_gift_card_id: { contains: gan } }
          ]
        },
        select: { organization_id: true }
      })

      if (!giftCard?.organization_id) {
        console.warn(`⚠️ Could not find gift card with GAN ${gan} in gift_cards table`)
      }

      // Try square_existing_clients table with organization_id filter if available
      const customer = giftCard?.organization_id
        ? await prisma.$queryRaw`
            SELECT square_customer_id, given_name, family_name, email_address, gift_card_id
            FROM square_existing_clients 
            WHERE organization_id = ${giftCard.organization_id}::uuid
              AND gift_card_id LIKE ${`%${gan}%`}
            LIMIT 1
          `
        : await prisma.$queryRaw`
            SELECT square_customer_id, given_name, family_name, email_address, gift_card_id
            FROM square_existing_clients 
            WHERE gift_card_id LIKE ${`%${gan}%`}
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
                balanceCents = squareGiftCard.result.giftCard.balanceMoney?.amount || 0
              }
            } catch (squareError) {
              console.warn(`⚠️ Could not fetch gift card from Square: ${squareError.message}`)
            }
          }
        }
    } catch (dbError) {
      console.error(`⚠️ Database lookup error: ${dbError.message}`)
    }

    if (balanceCents === 0) {
      console.log(`⚠️ Could not find gift card info, using default balance`)
      balanceCents = 1000 // Default to $10
    }

    const customerName = customerInfo?.fullName ||
                        customerInfo?.firstName ||
                        (customerInfo?.firstName && customerInfo?.lastName
                          ? `${customerInfo.firstName} ${customerInfo.lastName}`
                          : 'Guest')

    const baseUrl = process.env.APP_BASE_URL ? process.env.APP_BASE_URL.replace(/\/$/, '') : null
    // IMPORTANT: Apple appends /v1/devices/... to webServiceURL automatically
    // So webServiceURL should be just the base path without /v1
    const webServiceUrl = baseUrl ? `${baseUrl}/api/wallet` : null

    // Generate updated pass
    const passBuffer = await generateGiftCardPass({
      giftCardGan: gan,
      balanceCents: balanceCents,
      customerName: customerName,
      serialNumber: gan,
      webServiceUrl: webServiceUrl
    })

    console.log(`✅ Generated updated pass for ${gan}`)

    return new Response(passBuffer, {
      headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': `attachment; filename="zorina-gift-card-${gan}.pkpass"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })
  } catch (error) {
    console.error('❌ Error getting pass update:', error)
    return new Response('Internal Server Error', { status: 500 })
  }
}

