// Test script for Apple Wallet pass generation
// Usage: node scripts/test-apple-wallet-pass.js [GAN] [balanceCents] [customerName]

require('dotenv').config()
const { generateGiftCardPass } = require('../lib/wallet/pass-generator')
const fs = require('fs')
const path = require('path')

async function testPassGeneration() {
  const gan = process.argv[2] || 'TEST1234567890'
  const balanceCents = parseInt(process.argv[3]) || 1000 // $10.00
  const customerName = process.argv[4] || 'Test Customer'

  console.log('🧪 Testing Apple Wallet Pass Generation')
  console.log(`   GAN: ${gan}`)
  console.log(`   Balance: $${(balanceCents / 100).toFixed(2)}`)
  console.log(`   Customer: ${customerName}`)
  console.log('')

  try {
    // Check if certificates exist
    const certPath = path.resolve(process.cwd(), process.env.APPLE_PASS_CERTIFICATE_PATH || './certs/Certificates.p12')
    const wwdrPath = path.resolve(process.cwd(), process.env.APPLE_WWDR_CERTIFICATE_PATH || './certs/wwdr.pem')

    console.log('📋 Checking certificates...')
    console.log(`   Certificate: ${certPath} - ${fs.existsSync(certPath) ? '✅ Found' : '❌ Not found'}`)
    console.log(`   WWDR: ${wwdrPath} - ${fs.existsSync(wwdrPath) ? '✅ Found' : '❌ Not found'}`)
    console.log('')

    if (!fs.existsSync(certPath) || !fs.existsSync(wwdrPath)) {
      console.error('❌ Certificate files not found!')
      console.error('   Please ensure:')
      console.error(`   - ${certPath} exists`)
      console.error(`   - ${wwdrPath} exists`)
      process.exit(1)
    }

    // Generate pass
    console.log('🎫 Generating pass...')
    const passBuffer = await generateGiftCardPass({
      giftCardGan: gan,
      balanceCents: balanceCents,
      customerName: customerName,
      serialNumber: gan,
      webServiceUrl: null // No web service for testing
    })

    // Save to file
    const outputPath = path.join(process.cwd(), 'test-pass.pkpass')
    fs.writeFileSync(outputPath, passBuffer)

    console.log('✅ Pass generated successfully!')
    console.log(`   Saved to: ${outputPath}`)
    console.log('')
    console.log('📱 To test:')
    console.log('   1. Open the .pkpass file on your Mac')
    console.log('   2. It should open in Wallet app')
    console.log('   3. Or email it to yourself and open on iPhone')
    console.log('')

  } catch (error) {
    console.error('❌ Error generating pass:', error.message)
    console.error('')
    console.error('Stack trace:')
    console.error(error.stack)
    process.exit(1)
  }
}

testPassGeneration()

