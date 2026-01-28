// Test script to verify pass generation includes webServiceURL
require('dotenv').config({ path: '.env.local' })
require('dotenv').config()

const { getPrisma, getGiftCardsApi } = require('../lib/wallet/clients.js')
const { resolveGiftCardContext } = require('../lib/wallet/giftcard-context.js')

async function testPassGeneration() {
  try {
    const prisma = getPrisma()
    const giftCardsApi = getGiftCardsApi()
    const gan = '7783328144194860'
    
    console.log('🔍 Testing pass generation for GAN:', gan)
    console.log('APP_BASE_URL:', process.env.APP_BASE_URL || 'NOT SET')
    
    const context = await resolveGiftCardContext({ gan, prisma, giftCardsApi })
    
    console.log('\n✅ Context resolved:')
    console.log('  webServiceUrl:', context.webServiceUrl || '❌ NULL')
    console.log('  serialNumber:', context.serialNumber)
    console.log('  giftCardGan:', context.giftCardGan)
    console.log('  customerName:', context.customerName)
    
    if (!context.webServiceUrl) {
      console.log('\n❌ PROBLEM: webServiceUrl is NULL!')
      console.log('   Passes will NOT register with Apple Wallet')
      process.exit(1)
    }
    
    console.log('\n✅ webServiceUrl is set correctly:', context.webServiceUrl)
    console.log('   Expected registration URL:', 
      `${context.webServiceUrl}/devices/{deviceId}/registrations/${process.env.APPLE_PASS_TYPE_ID || 'pass.com.zorinastudio.giftcard'}/${context.serialNumber}`)
    
    process.exit(0)
  } catch(e) {
    console.error('\n❌ Error:', e.message)
    console.error(e.stack)
    process.exit(1)
  }
}

testPassGeneration()



