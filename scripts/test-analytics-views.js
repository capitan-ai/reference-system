#!/usr/bin/env node
/**
 * Test script for analytics views
 * Verifies that all analytics views work correctly and return expected data
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function testAnalyticsViews() {
  console.log('🧪 Testing Analytics Views\n')
  console.log('='.repeat(60))

  try {
    // Get a sample organization to test with
    const org = await prisma.$queryRaw`
      SELECT id, name, square_merchant_id
      FROM organizations
      LIMIT 1
    `

    if (!org || org.length === 0) {
      console.log('⚠️  No organizations found in database')
      console.log('   Please ensure you have at least one organization')
      return
    }

    const orgId = org[0].id
    console.log(`\n📊 Testing with organization: ${org[0].name || org[0].square_merchant_id}`)
    console.log(`   Organization ID: ${orgId}\n`)

    // Test 1: analytics_overview_daily
    console.log('1️⃣  Testing analytics_overview_daily...')
    try {
      const overview = await prisma.$queryRaw`
        SELECT 
          organization_id,
          date,
          total_revenue_dollars,
          appointments_count,
          new_customers_count,
          avg_ticket_dollars,
          referral_revenue_dollars,
          rebooking_rate,
          total_customers_with_bookings
        FROM analytics_overview_daily
        WHERE organization_id = ${orgId}
        ORDER BY date DESC
        LIMIT 10
      `
      console.log(`   ✅ View works! Found ${overview.length} daily records`)
      if (overview.length > 0) {
        console.log(`   📈 Sample record:`)
        console.log(`      Date: ${overview[0].date}`)
        console.log(`      Revenue: $${overview[0].total_revenue_dollars || 0}`)
        console.log(`      Appointments: ${overview[0].appointments_count || 0}`)
        console.log(`      New Customers: ${overview[0].new_customers_count || 0}`)
      }
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`)
    }

    // Test 2: analytics_revenue_by_location_daily
    console.log('\n2️⃣  Testing analytics_revenue_by_location_daily...')
    try {
      const revenueByLocation = await prisma.$queryRaw`
        SELECT 
          organization_id,
          location_name,
          date,
          revenue_dollars,
          payment_count,
          unique_customers
        FROM analytics_revenue_by_location_daily
        WHERE organization_id = ${orgId}
        ORDER BY date DESC
        LIMIT 10
      `
      console.log(`   ✅ View works! Found ${revenueByLocation.length} records`)
      if (revenueByLocation.length > 0) {
        console.log(`   📈 Sample record:`)
        console.log(`      Location: ${revenueByLocation[0].location_name}`)
        console.log(`      Date: ${revenueByLocation[0].date}`)
        console.log(`      Revenue: $${revenueByLocation[0].revenue_dollars || 0}`)
      }
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`)
    }

    // Test 3: analytics_appointments_by_location_daily
    console.log('\n3️⃣  Testing analytics_appointments_by_location_daily...')
    try {
      const appointmentsByLocation = await prisma.$queryRaw`
        SELECT 
          organization_id,
          location_name,
          date,
          appointments_count,
          unique_customers,
          new_customers_count
        FROM analytics_appointments_by_location_daily
        WHERE organization_id = ${orgId}
        ORDER BY date DESC
        LIMIT 10
      `
      console.log(`   ✅ View works! Found ${appointmentsByLocation.length} records`)
      if (appointmentsByLocation.length > 0) {
        console.log(`   📈 Sample record:`)
        console.log(`      Location: ${appointmentsByLocation[0].location_name}`)
        console.log(`      Appointments: ${appointmentsByLocation[0].appointments_count || 0}`)
      }
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`)
    }

    // Test 4: analytics_master_performance_daily
    console.log('\n4️⃣  Testing analytics_master_performance_daily...')
    try {
      const masterPerformance = await prisma.$queryRaw`
        SELECT 
          organization_id,
          technician_name,
          date,
          appointments_count,
          revenue_dollars,
          unique_customers
        FROM analytics_master_performance_daily
        WHERE organization_id = ${orgId}
        ORDER BY date DESC
        LIMIT 10
      `
      console.log(`   ✅ View works! Found ${masterPerformance.length} records`)
      if (masterPerformance.length > 0) {
        console.log(`   📈 Sample record:`)
        console.log(`      Technician: ${masterPerformance[0].technician_name}`)
        console.log(`      Revenue: $${masterPerformance[0].revenue_dollars || 0}`)
      }
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`)
    }

    // Test 5: analytics_service_performance_daily
    console.log('\n5️⃣  Testing analytics_service_performance_daily...')
    try {
      const servicePerformance = await prisma.$queryRaw`
        SELECT 
          organization_id,
          service_name,
          date,
          appointments_count,
          revenue_dollars,
          unique_customers
        FROM analytics_service_performance_daily
        WHERE organization_id = ${orgId}
        ORDER BY date DESC
        LIMIT 10
      `
      console.log(`   ✅ View works! Found ${servicePerformance.length} records`)
      if (servicePerformance.length > 0) {
        console.log(`   📈 Sample record:`)
        console.log(`      Service: ${servicePerformance[0].service_name}`)
        console.log(`      Revenue: $${servicePerformance[0].revenue_dollars || 0}`)
      }
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`)
    }

    // Test 6: Verify all views exist
    console.log('\n6️⃣  Verifying all views exist in database...')
    try {
      const views = await prisma.$queryRaw`
        SELECT table_name
        FROM information_schema.views
        WHERE table_schema = 'public'
          AND table_name LIKE 'analytics_%'
        ORDER BY table_name
      `
      const expectedViews = [
        'analytics_overview_daily',
        'analytics_revenue_by_location_daily',
        'analytics_appointments_by_location_daily',
        'analytics_master_performance_daily',
        'analytics_service_performance_daily'
      ]
      
      const foundViews = views.map(v => v.table_name)
      const missingViews = expectedViews.filter(v => !foundViews.includes(v))
      
      if (missingViews.length === 0) {
        console.log(`   ✅ All ${expectedViews.length} views exist`)
      } else {
        console.log(`   ⚠️  Missing views: ${missingViews.join(', ')}`)
      }
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`)
    }

    console.log('\n' + '='.repeat(60))
    console.log('✅ Analytics views test completed!')
    console.log('='.repeat(60))

  } catch (error) {
    console.error('\n❌ Test failed:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

testAnalyticsViews()

