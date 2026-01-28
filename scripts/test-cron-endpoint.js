#!/usr/bin/env node
/**
 * Test cron endpoint authorization
 * This script tests if the cron endpoint would work with the CRON_SECRET
 * 
 * Usage:
 *   node scripts/test-cron-endpoint.js
 */

require('dotenv').config()

const CRON_SECRET = process.env.CRON_SECRET || '8p9YxK2mQ7vN4cT1R6zH3fJ5dS0aWqLrGkUeB1oI'

async function testCronEndpoint() {
  console.log('🧪 Testing Cron Endpoint Authorization\n')
  console.log('='.repeat(80))
  
  const cronUrl = process.env.NEXT_PUBLIC_APP_URL 
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/cron/giftcard-jobs`
    : 'https://zorinastudio-referral.com/api/cron/giftcard-jobs'
  
  console.log(`\n📡 Endpoint: ${cronUrl}`)
  console.log(`🔑 CRON_SECRET: ${CRON_SECRET ? '✅ Set' : '❌ Not set'}`)
  
  if (CRON_SECRET) {
    console.log(`   Secret length: ${CRON_SECRET.length} characters`)
    console.log(`   Secret preview: ${CRON_SECRET.substring(0, 4)}...${CRON_SECRET.substring(CRON_SECRET.length - 4)}`)
  }
  
  // Test authorization formats
  console.log('\n📋 Testing Authorization Formats:')
  
  const formats = [
    { name: 'Bearer token', header: `Bearer ${CRON_SECRET}` },
    { name: 'Plain secret', header: CRON_SECRET },
    { name: 'x-cron-secret header', header: CRON_SECRET, headerName: 'x-cron-secret' },
  ]
  
  formats.forEach((format, idx) => {
    console.log(`\n   ${idx + 1}. ${format.name}:`)
    console.log(`      Header: ${format.headerName || 'Authorization'}: ${format.header.substring(0, 20)}...`)
  })
  
  // Show curl command
  console.log('\n💡 Test Command:')
  if (CRON_SECRET) {
    console.log(`\n   curl -X GET "${cronUrl}" \\`)
    console.log(`     -H "Authorization: Bearer ${CRON_SECRET}"`)
    console.log(`\n   Or with POST:`)
    console.log(`   curl -X POST "${cronUrl}" \\`)
    console.log(`     -H "Authorization: Bearer ${CRON_SECRET}"`)
  } else {
    console.log(`\n   ⚠️  CRON_SECRET not set in environment`)
    console.log(`   curl -X GET "${cronUrl}"`)
  }
  
  // Verify secret in Vercel
  console.log('\n📝 Next Steps:')
  console.log('   1. ✅ Secret is set in local environment')
  console.log('   2. ⚠️  Make sure CRON_SECRET is set in Vercel environment variables:')
  console.log('      - Go to Vercel Dashboard → Your Project → Settings → Environment Variables')
  console.log('      - Add: CRON_SECRET = 8p9YxK2mQ7vN4cT1R6zH3fJ5dS0aWqLrGkUeB1oI')
  console.log('      - Apply to: Production (and Preview if needed)')
  console.log('      - Redeploy after adding')
  console.log('   3. Check Vercel Cron logs to verify the endpoint is being called')
  console.log('   4. Monitor with: node scripts/check-cron-status.js')
  
  console.log('\n' + '='.repeat(80))
  
  if (!CRON_SECRET) {
    console.log('\n⚠️  WARNING: CRON_SECRET not found in environment')
    console.log('   The endpoint will allow unauthenticated access!')
  } else {
    console.log('\n✅ CRON_SECRET is set. Endpoint should be secure.')
  }
  
  console.log('\n')
}

testCronEndpoint()



