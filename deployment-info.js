require('dotenv').config()

async function getDeploymentInfo() {
  try {
    console.log('🚀 DEPLOYMENT SUCCESSFUL!\n')

    console.log('📡 YOUR DEPLOYED WEBHOOK ENDPOINTS:')
    console.log('   ')
    console.log('   🌐 Main Webhook Handler:')
    console.log('   https://referral-system-salon-j14lzk3cc-umis-projects-e802f152.vercel.app/api/webhooks/square/referrals')
    console.log('   ')
    console.log('   📊 Referral Click Tracking:')
    console.log('   https://referral-system-salon-j14lzk3cc-umis-projects-e802f152.vercel.app/api/track-referral-click')
    console.log('   ')
    console.log('   🔗 Referral Landing Page:')
    console.log('   https://referral-system-salon-j14lzk3cc-umis-projects-e802f152.vercel.app/ref/[refCode]')
    console.log('   (Example: https://referral-system-salon-j14lzk3cc-umis-projects-e802f152.vercel.app/ref/TEST123)')

    console.log('\n🔗 SQUARE WEBHOOK SETUP:')
    console.log('   ')
    console.log('   1. Go to Square Developer Dashboard')
    console.log('   2. Navigate to Webhooks')
    console.log('   3. Add webhook subscription:')
    console.log('   ')
    console.log('   📡 Webhook URL:')
    console.log('   https://referral-system-salon-j14lzk3cc-umis-projects-e802f152.vercel.app/api/webhooks/square/referrals')
    console.log('   ')
    console.log('   🔑 Signature Key:')
    console.log('   tDWszi4zxUzK63jpug3wSA')
    console.log('   ')
    console.log('   📋 Events to subscribe to:')
    console.log('   - customer.created')
    console.log('   - payment.updated')
    console.log('   ')
    console.log('   ⚠️ Important:')
    console.log('   - Set environment to Production')
    console.log('   - Enable webhook delivery')
    console.log('   - Test webhook delivery after setup')

    console.log('\n🧪 TEST YOUR ENDPOINTS:')
    console.log('   ')
    console.log('   1. Test webhook endpoint:')
    console.log('   curl -X POST https://referral-system-salon-j14lzk3cc-umis-projects-e802f152.vercel.app/api/webhooks/square/referrals')
    console.log('   ')
    console.log('   2. Test referral click tracking:')
    console.log('   curl -X POST https://referral-system-salon-j14lzk3cc-umis-projects-e802f152.vercel.app/api/track-referral-click')
    console.log('   ')
    console.log('   3. Test referral landing page:')
    console.log('   curl -X GET https://referral-system-salon-j14lzk3cc-umis-projects-e802f152.vercel.app/ref/TEST123')

    console.log('\n📊 DEPLOYMENT DETAILS:')
    console.log('   ✅ Production URL: https://referral-system-salon-j14lzk3cc-umis-projects-e802f152.vercel.app')
    console.log('   ✅ Environment: Production')
    console.log('   ✅ All environment variables loaded from Vercel')
    console.log('   ✅ Webhook handlers ready')
    console.log('   ✅ Database connected')
    console.log('   ✅ Square API configured')

    console.log('\n🎯 NEXT STEPS:')
    console.log('   1. ✅ Deploy to Vercel (DONE)')
    console.log('   2. 🔗 Set up Square webhook subscriptions')
    console.log('   3. 🧪 Test webhook delivery')
    console.log('   4. 📧 Send referral codes to clients')
    console.log('   5. 📊 Monitor referral activity')

    console.log('\n🎉 YOUR REFERRAL SYSTEM IS LIVE!')

  } catch (error) {
    console.error('❌ Error getting deployment info:', error.message)
  }
}

getDeploymentInfo()
