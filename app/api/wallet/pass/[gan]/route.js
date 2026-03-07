// API endpoint to generate and serve Apple Wallet passes
// GET /api/wallet/pass/[gan]

import { createRequire } from 'module'

const require = createRequire(import.meta.url)

function loadWithDiagnostics(label, loader) {
  console.log(`🧩 Loading ${label}...`)
  try {
    const result = loader()
    console.log(`✅ Loaded ${label}`)
    return result
  } catch (error) {
    console.error(`💥 Failed while loading ${label}:`, error)
    throw error
  }
}

const { generateGiftCardPass } = loadWithDiagnostics(
  'lib/wallet/pass-generator',
  () => require('../../../../../lib/wallet/pass-generator.js')
)
const { getPrisma, getGiftCardsApi } = loadWithDiagnostics(
  'lib/wallet/clients',
  () => require('../../../../../lib/wallet/clients.js')
)
const { resolveGiftCardContext } = loadWithDiagnostics(
  'lib/wallet/giftcard-context',
  () => require('../../../../../lib/wallet/giftcard-context.js')
)

const prisma = loadWithDiagnostics('Prisma client', () => getPrisma())

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  try {
    const giftCardsApi = getGiftCardsApi()
    const { gan } = params

    if (!gan) {
      return new Response(
        JSON.stringify({ error: 'Gift card GAN is required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    console.log(`🎫 Generating Apple Wallet pass for GAN: ${gan}`)

    const {
      giftCardGan,
      originalLookupValue,
      balanceCents,
      customerName,
      serialNumber,
      webServiceUrl
    } = await resolveGiftCardContext({ gan, prisma, giftCardsApi })
    
    console.log('🔗 Setting webServiceURL in pass:', webServiceUrl)
    if (originalLookupValue !== giftCardGan) {
      console.log(`   Normalized gift card number ${originalLookupValue} → ${giftCardGan}`)
    }

    const passBuffer = await generateGiftCardPass({
      giftCardGan,
      balanceCents,
      customerName,
      serialNumber,
      webServiceUrl
    })

    console.log(`✅ Generated Apple Wallet pass for ${gan}`)

    return new Response(passBuffer, {
      headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
        // Remove Content-Disposition entirely - iOS will handle it automatically
        // When Content-Type is application/vnd.apple.pkpass, iOS Safari opens Wallet directly
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })
  } catch (error) {
    console.error('❌ Error generating Apple Wallet pass:', error)
    
    // Return user-friendly error
    return new Response(
      JSON.stringify({ 
        error: 'Failed to generate pass',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}

