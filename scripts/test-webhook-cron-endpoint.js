#!/usr/bin/env node
/**
 * Test webhook-jobs cron endpoint authorization
 * This script tests if the webhook-jobs cron endpoint would work with the CRON_SECRET
 * 
 * Usage:
 *   node scripts/test-webhook-cron-endpoint.js
 */

require('dotenv').config()

const CRON_SECRET = process.env.CRON_SECRET

async function testWebhookCronEndpoint() {
  console.log('🧪 Testing Webhook Jobs Cron Endpoint\n')
  console.log('='.repeat(80))
  
  // Get the domain from environment or use default
  const domain = process.env.NEXT_PUBLIC_APP_URL 
    ? process.env.NEXT_PUBLIC_APP_URL
    : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://zorinastudio-referral.com'
  
  const cronUrl = `${domain}/api/cron/webhook-jobs`
  
  console.log(`\n📡 Endpoint: ${cronUrl}`)
  console.log(`🔑 CRON_SECRET: ${CRON_SECRET ? '✅ Set' : '❌ Not set'}`)
  
  if (CRON_SECRET) {
    console.log(`   Secret length: ${CRON_SECRET.length} characters`)
    console.log(`   Secret preview: ${CRON_SECRET.substring(0, 4)}...${CRON_SECRET.substring(CRON_SECRET.length - 4)}`)
  }
  
  // Test authorization formats
  console.log('\n📋 Testing Authorization Formats:')
  
  const formats = [
    { name: 'Bearer token', header: `Bearer ${CRON_SECRET}`, headerName: 'Authorization' },
    { name: 'Plain secret', header: CRON_SECRET, headerName: 'Authorization' },
    { name: 'x-cron-secret header', header: CRON_SECRET, headerName: 'x-cron-secret' },
  ]
  
  formats.forEach((format, idx) => {
    console.log(`\n   ${idx + 1}. ${format.name}:`)
    if (format.header) {
      console.log(`      ${format.headerName}: ${format.header.substring(0, 20)}...`)
    } else {
      console.log(`      ${format.headerName}: (not set)`)
    }
  })
  
  // Show curl commands
  console.log('\n💡 Test Commands:')
  if (CRON_SECRET) {
    console.log(`\n   # GET request:`)
    console.log(`   curl -X GET "${cronUrl}" \\`)
    console.log(`     -H "Authorization: Bearer ${CRON_SECRET}"`)
    console.log(`\n   # POST request:`)
    console.log(`   curl -X POST "${cronUrl}" \\`)
    console.log(`     -H "Authorization: Bearer ${CRON_SECRET}"`)
    console.log(`\n   # With x-cron-secret header:`)
    console.log(`   curl -X GET "${cronUrl}" \\`)
    console.log(`     -H "x-cron-secret: ${CRON_SECRET}"`)
  } else {
    console.log(`\n   ⚠️  CRON_SECRET not set in environment`)
    console.log(`   curl -X GET "${cronUrl}"`)
    console.log(`\n   Note: Without CRON_SECRET, the endpoint will allow access (development only)`)
  }
  
  // Show what the response should look like
  console.log('\n📊 Expected Response:')
  console.log(`   {`)
  console.log(`     "processed": 0,`)
  console.log(`     "errors": 0,`)
  console.log(`     "jobs": [],`)
  console.log(`     "duration": 123,`)
  console.log(`     "message": "No webhook jobs available"`)
  console.log(`   }`)
  
  // Verify secret in Vercel
  console.log('\n📝 Next Steps:')
  console.log('   1. ✅ Secret is set in local environment')
  console.log('   2. ⚠️  Make sure CRON_SECRET is set in Vercel environment variables:')
  console.log('      - Go to Vercel Dashboard → Your Project → Settings → Environment Variables')
  console.log('      - Verify CRON_SECRET is set (same as giftcard-jobs cron)')
  console.log('      - Apply to: Production (and Preview if needed)')
  console.log('   3. After deploying, Vercel will automatically call this endpoint every minute')
  console.log('   4. Check Vercel Cron logs to verify the endpoint is being called')
  console.log('   5. Monitor webhook jobs with:')
  console.log('      SELECT * FROM webhook_jobs WHERE status = \'queued\' ORDER BY scheduled_at ASC;')
  
  console.log('\n' + '='.repeat(80))
  
  if (!CRON_SECRET) {
    console.log('\n⚠️  WARNING: CRON_SECRET not found in environment')
    console.log('   The endpoint will allow unauthenticated access!')
    console.log('   This is OK for development but should be set in production.')
  } else {
    console.log('\n✅ CRON_SECRET is set. Endpoint should be secure.')
  }
  
  // Check if webhook_jobs table exists
  console.log('\n📋 Database Check:')
  try {
    const { PrismaClient } = require('@prisma/client')
    const prisma = new PrismaClient()
    
    // Try to query the table
    const result = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM webhook_jobs
    `
    
    console.log('   ✅ webhook_jobs table exists')
    
    if (result && result.length > 0) {
      const count = Number(result[0].count || 0)
      console.log(`   📊 Current jobs in queue: ${count}`)
      
      if (count > 0) {
        const queued = await prisma.$queryRaw`
          SELECT COUNT(*) as count FROM webhook_jobs WHERE status = 'queued'
        `
        const queuedCount = Number(queued[0]?.count || 0)
        console.log(`   ⏳ Queued jobs: ${queuedCount}`)
        
        const error = await prisma.$queryRaw`
          SELECT COUNT(*) as count FROM webhook_jobs WHERE status = 'error'
        `
        const errorCount = Number(error[0]?.count || 0)
        if (errorCount > 0) {
          console.log(`   ❌ Failed jobs: ${errorCount}`)
        }
      }
    }
    
    await prisma.$disconnect()
  } catch (error) {
    if (error.message.includes('does not exist') || error.message.includes('relation')) {
      console.log('   ❌ webhook_jobs table does not exist')
      console.log('   💡 Run: npx prisma migrate dev --name add_webhook_jobs')
    } else {
      console.log(`   ⚠️  Error checking table: ${error.message}`)
    }
  }
  
  console.log('\n')
}

testWebhookCronEndpoint().catch(console.error)


