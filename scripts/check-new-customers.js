#!/usr/bin/env node
/**
 * Check if new customers are being added to database
 * and count how many were added in the last 15 days
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkNewCustomers() {
  console.log('🔍 Checking New Customer Tracking Status\n')

  // Calculate date 15 days ago
  const fifteenDaysAgo = new Date()
  fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15)
  
  console.log(`📅 Checking data from: ${fifteenDaysAgo.toISOString()} to now\n`)

  try {
    // Note: referral_events table was removed as it was never populated
    // Check referral_events table for NEW_CUSTOMER events
    console.log('1️⃣ Checking referral_events table (NEW_CUSTOMER events)...')
    console.log('   ⚠️  referral_events table was removed - skipping check')
    
    const newCustomerEvents = [] // Table was removed - always returns empty array
    /* 
    await prisma.referralEvent.findMany({
      where: {
        eventType: 'NEW_CUSTOMER',
        occurredAt: {
          gte: fifteenDaysAgo
        }
      },
      orderBy: {
        occurredAt: 'desc'
      },
      select: {
        id: true,
        occurredAt: true,
        friendCustomerId: true,
        referrerCustomerId: true,
        metadata: true
      }
    })
    */

    console.log(`   ✅ Found ${newCustomerEvents.length} NEW_CUSTOMER events in last 15 days`)
    
    if (newCustomerEvents.length > 0) {
      console.log(`   📋 Recent events:`)
      newCustomerEvents.slice(0, 5).forEach((event, idx) => {
        console.log(`      ${idx + 1}. ${event.occurredAt.toISOString()} - Customer: ${event.friendCustomerId || 'N/A'}`)
      })
      if (newCustomerEvents.length > 5) {
        console.log(`      ... and ${newCustomerEvents.length - 5} more`)
      }
    }

    // Check square_existing_clients table (always populated regardless of analytics)
    console.log('\n2️⃣ Checking square_existing_clients table (all customers)...')
    
    const allCustomers = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::bigint AS total_count,
        COUNT(*) FILTER (WHERE created_at >= ${fifteenDaysAgo})::bigint AS last_15_days
      FROM square_existing_clients
    `
    
    const totalCustomers = Number(allCustomers[0].total_count)
    const customersLast15Days = Number(allCustomers[0].last_15_days)
    
    console.log(`   ✅ Total customers in database: ${totalCustomers}`)
    console.log(`   ✅ Customers added in last 15 days: ${customersLast15Days}`)

    // Get recent customers from square_existing_clients
    const recentCustomers = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        created_at,
        got_signup_bonus,
        activated_as_referrer
      FROM square_existing_clients
      WHERE created_at >= ${fifteenDaysAgo}
      ORDER BY created_at DESC
      LIMIT 10
    `

    if (recentCustomers.length > 0) {
      console.log(`\n   📋 Recent customers (last 10):`)
      recentCustomers.forEach((customer, idx) => {
        const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
        console.log(`      ${idx + 1}. ${customer.created_at.toISOString()} - ${name} (${customer.square_customer_id})`)
        console.log(`         Email: ${customer.email_address || 'N/A'}`)
        console.log(`         Signup bonus: ${customer.got_signup_bonus ? 'Yes' : 'No'}, Referrer: ${customer.activated_as_referrer ? 'Yes' : 'No'}`)
      })
    }

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('📊 SUMMARY')
    console.log('='.repeat(60))
    console.log(`\nNew Customers (last 15 days):`)
    console.log(`  - In referral_events table: ${newCustomerEvents.length}`)
    console.log(`  - In square_existing_clients table: ${customersLast15Days} ✅ (always tracked)`)
    console.log(`\nTotal customers in database: ${totalCustomers}`)

  } catch (error) {
    console.error('\n❌ Error querying database:', error.message)
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

checkNewCustomers()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })

