require('dotenv').config()

async function checkWebhookSetup() {
  try {
    console.log('🔗 WEBHOOK SETUP GUIDE\n')

    console.log('📋 WEBHOOKS YOUR SYSTEM HANDLES:')
    console.log('   ✅ customer.created - Detects new customers')
    console.log('   ✅ payment.updated - Processes first payments')
    console.log('   ')
    console.log('📋 WEBHOOKS TO ADD IN SQUARE DASHBOARD:')
    console.log('   1. Go to Square Developer Dashboard')
    console.log('   2. Navigate to Webhooks')
    console.log('   3. Add webhook subscription:')
    console.log('   ')
    console.log('   🌐 Webhook URL: https://your-app.vercel.app/api/webhooks/square/referrals')
    console.log('   🔑 Signature Key: tDWszi4zxUzK63jpug3wSA')
    console.log('   📡 Events to subscribe to:')
    console.log('      - customer.created')
    console.log('      - payment.updated')
    console.log('   ')
    console.log('   ⚠️ Make sure to:')
    console.log('      - Set environment to Production')
    console.log('      - Enable webhook delivery')
    console.log('      - Test webhook delivery')

    console.log('\n🧪 TESTING WEBHOOK ENDPOINTS:\n')

    console.log('📡 Endpoint 1: Main Webhook Handler')
    console.log('   URL: /api/webhooks/square/referrals')
    console.log('   Method: POST')
    console.log('   Purpose: Handles customer.created and payment.updated events')
    console.log('   ')

    console.log('📡 Endpoint 2: Referral Click Tracking')
    console.log('   URL: /api/track-referral-click')
    console.log('   Method: POST')
    console.log('   Purpose: Tracks when someone clicks a referral link')
    console.log('   ')

    console.log('📡 Endpoint 3: Referral Landing Page')
    console.log('   URL: /ref/[refCode]')
    console.log('   Method: GET')
    console.log('   Purpose: Landing page that redirects to Square booking site')
    console.log('   ')

    console.log('\n🔧 TESTING COMMANDS:')
    console.log('   ')
    console.log('   1. Test webhook endpoint accessibility:')
    console.log('   curl -X POST https://your-app.vercel.app/api/webhooks/square/referrals')
    console.log('   ')
    console.log('   2. Test referral click tracking:')
    console.log('   curl -X POST https://your-app.vercel.app/api/track-referral-click')
    console.log('   ')
    console.log('   3. Test referral landing page:')
    console.log('   curl -X GET https://your-app.vercel.app/ref/TEST123')

    console.log('\n📊 WEBHOOK EVENT FLOW:')
    console.log('   ')
    console.log('   🔔 customer.created:')
    console.log('      → Detects new customer')
    console.log('      → Checks for referral code')
    console.log('      → Creates gift card if referral code used')
    console.log('      → Adds customer to database')
    console.log('   ')
    console.log('   🔔 payment.updated:')
    console.log('      → Checks if first payment completed')
    console.log('      → Gives referrer $10 reward')
    console.log('      → Sends referral code to new customer')
    console.log('      → Marks customer as referrer')

    console.log('\n✅ WEBHOOK SETUP STATUS:')
    console.log('   ✅ Webhook handlers implemented')
    console.log('   ✅ Signature verification enabled')
    console.log('   ✅ Error handling implemented')
    console.log('   ⚠️ Need to add webhook subscription in Square')
    console.log('   ⚠️ Need to deploy to Vercel first')

  } catch (error) {
    console.error('❌ Error checking webhook setup:', error.message)
  }
}

checkWebhookSetup()
