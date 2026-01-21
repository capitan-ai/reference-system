#!/usr/bin/env node
/**
 * Check how many customer.created webhooks were received from Square
 * in the last 15 days based on webhook processing logs
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkWebhookCustomers() {
  console.log('🔍 Checking Square Webhook Logs for customer.created Events\n')
  
  // Calculate date 15 days ago
  const fifteenDaysAgo = new Date()
  fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15)
  
  console.log(`📅 Checking webhooks from: ${fifteenDaysAgo.toISOString()} to now\n`)

  try {
    // Check giftcard_runs table for customer.created webhooks
    console.log('1️⃣ Checking giftcard_runs table (webhook processing logs)...')
    
    const customerCreatedRuns = await prisma.giftCardRun.findMany({
      where: {
        OR: [
          { square_event_type: 'customer.created' },
          { trigger_type: 'customer.created' }
        ],
        created_at: {
          gte: fifteenDaysAgo
        }
      },
      orderBy: {
        created_at: 'desc'
      },
      select: {
        id: true,
        correlation_id: true,
        square_event_id: true,
        square_event_type: true,
        trigger_type: true,
        resource_id: true,
        status: true,
        stage: true,
        created_at: true,
        context: true,
        payload: true
      }
    })

    console.log(`   ✅ Found ${customerCreatedRuns.length} customer.created webhook events in last 15 days`)
    
    if (customerCreatedRuns.length > 0) {
      console.log(`\n   📋 Webhook Events:`)
      customerCreatedRuns.forEach((run, idx) => {
        const customerId = run.resource_id || 
                          run.context?.customerId || 
                          run.payload?.id || 
                          run.payload?.customerId || 
                          'Unknown'
        
        console.log(`\n   ${idx + 1}. ${run.created_at.toISOString()}`)
        console.log(`      Event ID: ${run.square_event_id || 'N/A'}`)
        console.log(`      Customer ID: ${customerId}`)
        console.log(`      Status: ${run.status}`)
        console.log(`      Stage: ${run.stage || 'N/A'}`)
        console.log(`      Correlation ID: ${run.correlation_id}`)
      })
    }

    // Check giftcard_jobs table for customer.created jobs
    console.log('\n2️⃣ Checking giftcard_jobs table (queued jobs)...')
    
    const customerCreatedJobs = await prisma.giftCardJob.findMany({
      where: {
        trigger_type: 'customer.created',
        created_at: {
          gte: fifteenDaysAgo
        }
      },
      orderBy: {
        created_at: 'desc'
      },
      select: {
        id: true,
        correlation_id: true,
        trigger_type: true,
        stage: true,
        status: true,
        created_at: true,
        context: true
      }
    })

    console.log(`   ✅ Found ${customerCreatedJobs.length} customer.created jobs in last 15 days`)

    // Also check booking.created webhooks (customers can be added via bookings)
    console.log('\n3️⃣ Checking booking.created webhooks (customers added via bookings)...')
    
    const bookingCreatedRuns = await prisma.giftCardRun.findMany({
      where: {
        OR: [
          { square_event_type: 'booking.created' },
          { trigger_type: 'booking.created' }
        ],
        created_at: {
          gte: fifteenDaysAgo
        }
      },
      orderBy: {
        created_at: 'desc'
      },
      select: {
        id: true,
        square_event_id: true,
        square_event_type: true,
        trigger_type: true,
        resource_id: true,
        status: true,
        created_at: true,
        context: true
      }
    })

    console.log(`   ✅ Found ${bookingCreatedRuns.length} booking.created webhook events in last 15 days`)

    // Note: analytics_events table was removed as it was never populated
    // Check analytics_events table for booking_created events
    console.log('\n4️⃣ Checking analytics_events table (booking_created events)...')
    console.log('   ⚠️  analytics_events table was removed - skipping check')
    
    try {
      const bookingEvents = [] // Table was removed - always returns empty array
      /*
      await prisma.analyticsEvent.findMany({
        where: {
          eventType: 'booking_created',
          createdAt: {
            gte: fifteenDaysAgo
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        select: {
          id: true,
          squareCustomerId: true,
          bookingId: true,
          createdAt: true
        }
      })
      */

      console.log(`   ✅ Found ${bookingEvents.length} booking_created analytics events in last 15 days`)
      
      if (bookingEvents.length > 0) {
        const uniqueCustomers = new Set(bookingEvents.map(e => e.squareCustomerId).filter(Boolean))
        console.log(`   📊 Unique customers from bookings: ${uniqueCustomers.size}`)
      }
    } catch (error) {
      if (error.message.includes('does not exist') || error.code === 'P2021') {
        console.log(`   ⚠️  analytics_events table doesn't exist or not accessible`)
      } else {
        throw error
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('📊 WEBHOOK SUMMARY (Last 15 Days)')
    console.log('='.repeat(60))
    console.log(`\nSquare Webhook Events Received:`)
    console.log(`  - customer.created webhooks: ${customerCreatedRuns.length}`)
    console.log(`  - booking.created webhooks: ${bookingCreatedRuns.length}`)
    console.log(`  - customer.created jobs queued: ${customerCreatedJobs.length}`)
    
    // Extract unique customer IDs from webhooks
    const customerIdsFromWebhooks = new Set()
    customerCreatedRuns.forEach(run => {
      const customerId = run.resource_id || run.context?.customerId || run.payload?.id || run.payload?.customerId
      if (customerId && customerId !== 'Unknown') {
        customerIdsFromWebhooks.add(customerId)
      }
    })
    
    bookingCreatedRuns.forEach(run => {
      const customerId = run.context?.customerId
      if (customerId) {
        customerIdsFromWebhooks.add(customerId)
      }
    })

    console.log(`\n📊 Unique Customer IDs from Webhooks: ${customerIdsFromWebhooks.size}`)
    
    if (customerIdsFromWebhooks.size > 0) {
      console.log(`\n   Customer IDs:`)
      Array.from(customerIdsFromWebhooks).slice(0, 10).forEach((id, idx) => {
        console.log(`      ${idx + 1}. ${id}`)
      })
      if (customerIdsFromWebhooks.size > 10) {
        console.log(`      ... and ${customerIdsFromWebhooks.size - 10} more`)
      }
    }

    console.log(`\n💡 Note:`)
    console.log(`   - Webhooks are tracked in giftcard_runs and giftcard_jobs tables`)
    console.log(`   - Customers can be added via customer.created OR booking.created webhooks`)
    console.log(`   - Some customers may be added directly to database without webhooks`)

  } catch (error) {
    console.error('\n❌ Error querying webhook logs:', error.message)
    console.error('Stack:', error.stack)
    
    // Check if tables exist
    if (error.message.includes('does not exist') || error.code === 'P2021') {
      console.log('\n⚠️  Table might not exist. Check:')
      console.log('   1. Database migrations are up to date: npx prisma migrate deploy')
      console.log('   2. Prisma client is generated: npx prisma generate')
    }
  } finally {
    await prisma.$disconnect()
  }
}

checkWebhookCustomers()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })

