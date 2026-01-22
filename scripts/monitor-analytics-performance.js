#!/usr/bin/env node
/**
 * Analytics Performance Monitoring Script
 * Checks query performance and suggests optimizations
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function monitorPerformance() {
  console.log('📊 Monitoring Analytics Views Performance\n')
  console.log('='.repeat(60))

  try {
    // Get a sample organization
    const org = await prisma.$queryRaw`
      SELECT id, name, square_merchant_id
      FROM organizations
      LIMIT 1
    `

    if (!org || org.length === 0) {
      console.log('⚠️  No organizations found')
      return
    }

    const orgId = org[0].id
    console.log(`\nTesting with organization: ${org[0].name || org[0].square_merchant_id}`)
    console.log(`Organization ID: ${orgId}\n`)

    const views = [
      {
        name: 'analytics_overview_daily',
        query: `
          SELECT * FROM analytics_overview_daily
          WHERE organization_id = $1
            AND date >= CURRENT_DATE - INTERVAL '30 days'
          ORDER BY date DESC
        `
      },
      {
        name: 'analytics_revenue_by_location_daily',
        query: `
          SELECT * FROM analytics_revenue_by_location_daily
          WHERE organization_id = $1
            AND date >= CURRENT_DATE - INTERVAL '30 days'
          ORDER BY date DESC
        `
      },
      {
        name: 'analytics_appointments_by_location_daily',
        query: `
          SELECT * FROM analytics_appointments_by_location_daily
          WHERE organization_id = $1
            AND date >= CURRENT_DATE - INTERVAL '30 days'
          ORDER BY date DESC
        `
      },
      {
        name: 'analytics_master_performance_daily',
        query: `
          SELECT * FROM analytics_master_performance_daily
          WHERE organization_id = $1
            AND date >= CURRENT_DATE - INTERVAL '30 days'
          ORDER BY date DESC
        `
      },
      {
        name: 'analytics_service_performance_daily',
        query: `
          SELECT * FROM analytics_service_performance_daily
          WHERE organization_id = $1
            AND date >= CURRENT_DATE - INTERVAL '30 days'
          ORDER BY date DESC
        `
      }
    ]

    const results = []

    for (const view of views) {
      console.log(`Testing: ${view.name}`)
      
      const startTime = Date.now()
      
      try {
        // Use EXPLAIN ANALYZE to get execution plan
        const explainResult = await prisma.$queryRaw`
          EXPLAIN ANALYZE ${prisma.Prisma.raw(view.query.replace('$1', `'${orgId}'`))}
        `
        
        const endTime = Date.now()
        const duration = endTime - startTime

        // Extract execution time from EXPLAIN output
        const explainText = JSON.stringify(explainResult)
        const executionTimeMatch = explainText.match(/Execution Time: ([\d.]+) ms/)
        const executionTime = executionTimeMatch ? parseFloat(executionTimeMatch[1]) : duration

        results.push({
          view: view.name,
          duration: executionTime,
          status: executionTime < 1000 ? '✅ Fast' : executionTime < 2000 ? '⚠️  Slow' : '❌ Very Slow'
        })

        console.log(`   ${results[results.length - 1].status} - ${executionTime.toFixed(2)}ms`)
      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`)
        results.push({
          view: view.name,
          duration: null,
          status: '❌ Error'
        })
      }
    }

    // Check indexes
    console.log('\n' + '='.repeat(60))
    console.log('Checking Indexes')
    console.log('='.repeat(60))

    const indexes = [
      'idx_payments_org_status_created',
      'idx_bookings_org_status_start',
      'idx_customers_org_used_code',
      'idx_order_line_items_org_state_created',
      'idx_order_line_items_org_technician_created',
      'idx_order_line_items_org_service_created'
    ]

    for (const indexName of indexes) {
      try {
        const indexInfo = await prisma.$queryRaw`
          SELECT 
            schemaname,
            tablename,
            indexname
          FROM pg_indexes
          WHERE indexname = ${indexName}
        `
        
        if (indexInfo && indexInfo.length > 0) {
          console.log(`   ✅ ${indexName} exists`)
        } else {
          console.log(`   ⚠️  ${indexName} missing`)
        }
      } catch (error) {
        console.log(`   ❌ Error checking ${indexName}: ${error.message}`)
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('Performance Summary')
    console.log('='.repeat(60))

    const fastViews = results.filter(r => r.duration && r.duration < 1000)
    const slowViews = results.filter(r => r.duration && r.duration >= 1000 && r.duration < 2000)
    const verySlowViews = results.filter(r => r.duration && r.duration >= 2000)

    console.log(`\n✅ Fast views (< 1s): ${fastViews.length}`)
    console.log(`⚠️  Slow views (1-2s): ${slowViews.length}`)
    console.log(`❌ Very slow views (> 2s): ${verySlowViews.length}`)

    if (verySlowViews.length > 0) {
      console.log('\n⚠️  RECOMMENDATION: Consider materialized views for:')
      verySlowViews.forEach(v => {
        console.log(`   - ${v.view} (${v.duration.toFixed(2)}ms)`)
      })
    }

    if (slowViews.length > 0) {
      console.log('\n💡 Consider optimizing:')
      slowViews.forEach(v => {
        console.log(`   - ${v.view} (${v.duration.toFixed(2)}ms)`)
      })
    }

    // Check data volume
    console.log('\n' + '='.repeat(60))
    console.log('Data Volume Check')
    console.log('='.repeat(60))

    const dataStats = await prisma.$queryRaw`
      SELECT 
        (SELECT COUNT(*) FROM payments WHERE organization_id = ${orgId}) as payments_count,
        (SELECT COUNT(*) FROM bookings WHERE organization_id = ${orgId}) as bookings_count,
        (SELECT COUNT(*) FROM order_line_items WHERE organization_id = ${orgId}) as line_items_count
    `

    if (dataStats && dataStats.length > 0) {
      const stats = dataStats[0]
      console.log(`\n   Payments: ${stats.payments_count || 0}`)
      console.log(`   Bookings: ${stats.bookings_count || 0}`)
      console.log(`   Line Items: ${stats.line_items_count || 0}`)

      const totalRecords = (stats.payments_count || 0) + (stats.bookings_count || 0) + (stats.line_items_count || 0)
      
      if (totalRecords > 100000) {
        console.log('\n   ⚠️  Large dataset detected. Consider materialized views.')
      } else {
        console.log('\n   ✅ Dataset size is reasonable for views.')
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('✅ Performance monitoring completed!')
    console.log('='.repeat(60))

  } catch (error) {
    console.error('\n❌ Monitoring failed:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

monitorPerformance()

