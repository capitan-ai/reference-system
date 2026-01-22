#!/usr/bin/env node
/**
 * Check Payment Processing After Jan 15
 * Investigates why payments stopped being saved
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'

async function checkPaymentProcessing() {
  console.log('🔍 Checking Payment Processing After January 15, 2026\n')
  console.log('='.repeat(80))

  try {
    // 1. Check giftcard_runs for payment events
    console.log('1️⃣ Checking giftcard_runs for payment events after Jan 15...')
    const paymentRuns = await prisma.$queryRaw`
      SELECT 
        square_event_type,
        trigger_type,
        status,
        COUNT(*) as count,
        MAX(created_at) as latest_event
      FROM giftcard_runs
      WHERE square_event_type LIKE '%payment%'
         OR trigger_type LIKE '%payment%'
      AND created_at > '2026-01-15'
      GROUP BY square_event_type, trigger_type, status
      ORDER BY latest_event DESC
    `
    
    if (paymentRuns && paymentRuns.length > 0) {
      console.log(`   Found payment-related events:`)
      paymentRuns.forEach(r => {
        console.log(`      ${r.square_event_type || r.trigger_type}: ${r.count} events, status: ${r.status}, latest: ${r.latest_event}`)
      })
    } else {
      console.log(`   ⚠️  No payment-related events in giftcard_runs after Jan 15`)
    }

    // 2. Check giftcard_jobs for payment processing
    console.log('\n2️⃣ Checking giftcard_jobs for payment processing...')
    const paymentJobs = await prisma.$queryRaw`
      SELECT 
        trigger_type,
        stage,
        status,
        COUNT(*) as count,
        MAX(created_at) as latest_job
      FROM giftcard_jobs
      WHERE trigger_type LIKE '%payment%'
        AND created_at > '2026-01-15'
      GROUP BY trigger_type, stage, status
      ORDER BY latest_job DESC
      LIMIT 20
    `
    
    if (paymentJobs && paymentJobs.length > 0) {
      console.log(`   Found payment-related jobs:`)
      paymentJobs.forEach(j => {
        console.log(`      ${j.trigger_type} - ${j.stage}: ${j.count} jobs, status: ${j.status}, latest: ${j.latest_job}`)
      })
    } else {
      console.log(`   ⚠️  No payment-related jobs after Jan 15`)
    }

    // 3. Check for any webhook events after Jan 15
    console.log('\n3️⃣ Checking all webhook events after Jan 15...')
    const allEvents = await prisma.$queryRaw`
      SELECT 
        square_event_type,
        trigger_type,
        COUNT(*) as count,
        MAX(created_at) as latest_event,
        MIN(created_at) as earliest_event
      FROM giftcard_runs
      WHERE created_at > '2026-01-15'
      GROUP BY square_event_type, trigger_type
      ORDER BY latest_event DESC
      LIMIT 20
    `
    
    if (allEvents && allEvents.length > 0) {
      console.log(`   Found webhook events after Jan 15:`)
      allEvents.forEach(e => {
        console.log(`      ${e.square_event_type || e.trigger_type}: ${e.count} events, latest: ${e.latest_event}`)
      })
    } else {
      console.log(`   ⚠️  No webhook events received after Jan 15`)
    }

    // 4. Check if payments table has any records being created but failing
    console.log('\n4️⃣ Checking payment creation patterns...')
    const paymentPattern = await prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as payment_count,
        COUNT(DISTINCT status) as status_count,
        array_agg(DISTINCT status) as statuses
      FROM payments
      WHERE organization_id = ${ORG_ID}::uuid
        AND created_at >= '2026-01-01'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 20
    `
    
    console.log(`   Payment creation pattern in January 2026:`)
    paymentPattern.forEach(p => {
      console.log(`      ${p.date}: ${p.payment_count} payments, statuses: ${p.statuses.join(', ')}`)
    })

    // 5. Check for errors in giftcard_runs
    console.log('\n5️⃣ Checking for errors in payment processing...')
    const errors = await prisma.$queryRaw`
      SELECT 
        square_event_type,
        trigger_type,
        stage,
        last_error,
        COUNT(*) as error_count,
        MAX(created_at) as latest_error
      FROM giftcard_runs
      WHERE status = 'error'
        AND (square_event_type LIKE '%payment%' OR trigger_type LIKE '%payment%')
        AND created_at > '2026-01-15'
      GROUP BY square_event_type, trigger_type, stage, last_error
      ORDER BY latest_error DESC
      LIMIT 10
    `
    
    if (errors && errors.length > 0) {
      console.log(`   ⚠️  Found payment processing errors:`)
      errors.forEach(e => {
        console.log(`      ${e.square_event_type || e.trigger_type} - ${e.stage}: ${e.error_count} errors`)
        console.log(`         Latest: ${e.latest_error}`)
        console.log(`         Error: ${e.last_error?.substring(0, 100)}...`)
      })
    } else {
      console.log(`   ✅ No payment processing errors found`)
    }

    // 6. Check if Square webhooks are being received
    console.log('\n6️⃣ Summary...')
    const summary = await prisma.$queryRaw`
      SELECT 
        COUNT(*) FILTER (WHERE created_at > '2026-01-15') as events_after_jan15,
        COUNT(*) FILTER (WHERE created_at > '2026-01-15' AND square_event_type LIKE '%payment%') as payment_events_after_jan15,
        MAX(created_at) as latest_webhook_event
      FROM giftcard_runs
    `
    
    console.log(`   Total webhook events after Jan 15: ${summary[0].events_after_jan15}`)
    console.log(`   Payment webhook events after Jan 15: ${summary[0].payment_events_after_jan15}`)
    console.log(`   Latest webhook event (any type): ${summary[0].latest_webhook_event}`)

    console.log('\n' + '='.repeat(80))
    console.log('✅ Investigation completed!')
    console.log('='.repeat(80))
    console.log('\n💡 Possible causes:')
    console.log('   1. Square webhooks stopped being received')
    console.log('   2. Payment webhook endpoint is not processing correctly')
    console.log('   3. Payments are being created but not saved to database')
    console.log('   4. Business actually has no payments (unlikely for 4 weeks)')

  } catch (error) {
    console.error('\n❌ Error:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

checkPaymentProcessing()

