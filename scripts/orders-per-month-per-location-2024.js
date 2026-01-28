#!/usr/bin/env node
/**
 * Calculate orders per month per location for 2024
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function getOrdersPerMonthPerLocation() {
  console.log('📊 Orders Per Month Per Location (2024)\n')
  console.log('='.repeat(60))

  try {
    // Get orders grouped by month and location
    const ordersByMonthLocation = await prisma.$queryRaw`
      SELECT 
        TO_CHAR(oli.order_created_at, 'YYYY-MM') as month,
        oli.location_id,
        l.name as location_name,
        COUNT(DISTINCT o.id)::int as order_count
      FROM order_line_items oli
      INNER JOIN orders o ON oli.order_id = o.id
      LEFT JOIN locations l ON oli.location_id = l.square_location_id
      WHERE oli.order_created_at >= '2024-01-01'
        AND oli.order_created_at < '2025-01-01'
      GROUP BY TO_CHAR(oli.order_created_at, 'YYYY-MM'), oli.location_id, l.name
      ORDER BY month, location_id
    `

    // Get summary statistics
    const summary = await prisma.$queryRaw`
      SELECT 
        TO_CHAR(oli.order_created_at, 'YYYY-MM') as month,
        COUNT(DISTINCT oli.location_id)::int as location_count,
        COUNT(DISTINCT o.id)::int as total_orders,
        ROUND(COUNT(DISTINCT o.id)::numeric / NULLIF(COUNT(DISTINCT oli.location_id), 0), 2) as avg_orders_per_location
      FROM order_line_items oli
      INNER JOIN orders o ON oli.order_id = o.id
      WHERE oli.order_created_at >= '2024-01-01'
        AND oli.order_created_at < '2025-01-01'
      GROUP BY TO_CHAR(oli.order_created_at, 'YYYY-MM')
      ORDER BY month
    `

    // Get location names
    const locations = await prisma.$queryRaw`
      SELECT DISTINCT 
        oli.location_id,
        l.name as location_name
      FROM order_line_items oli
      LEFT JOIN locations l ON oli.location_id = l.square_location_id
      WHERE oli.order_created_at >= '2024-01-01'
        AND oli.order_created_at < '2025-01-01'
        AND oli.location_id IS NOT NULL
      ORDER BY l.name, oli.location_id
    `

    console.log('\n📅 Monthly Summary:\n')
    summary.forEach(row => {
      console.log(`   ${row.month}:`)
      console.log(`     Total orders: ${row.total_orders.toLocaleString()}`)
      console.log(`     Locations: ${row.location_count}`)
      console.log(`     Avg orders per location: ${row.avg_orders_per_location}`)
    })

    // Group by location for detailed view
    console.log('\n' + '='.repeat(60))
    console.log('\n📍 Orders Per Location Per Month:\n')

    const locationMap = new Map()
    locations.forEach(loc => {
      locationMap.set(loc.location_id, loc.location_name || loc.location_id)
    })

    // Organize data by location
    const byLocation = new Map()
    ordersByMonthLocation.forEach(row => {
      const locId = row.location_id || 'Unknown'
      const locName = row.location_name || locId
      const key = `${locName} (${locId})`
      
      if (!byLocation.has(key)) {
        byLocation.set(key, new Map())
      }
      byLocation.get(key).set(row.month, row.order_count)
    })

    // Display by location
    const sortedLocations = Array.from(byLocation.entries()).sort()
    
    sortedLocations.forEach(([location, months]) => {
      console.log(`\n${location}:`)
      const monthArray = Array.from(months.entries()).sort()
      let total = 0
      monthArray.forEach(([month, count]) => {
        console.log(`   ${month}: ${count.toLocaleString()} orders`)
        total += count
      })
      console.log(`   Total 2024: ${total.toLocaleString()} orders`)
      console.log(`   Average per month: ${(total / monthArray.length).toFixed(1)}`)
    })

    // Overall statistics
    console.log('\n' + '='.repeat(60))
    console.log('\n📊 Overall Statistics (2024):\n')

    const overall = await prisma.$queryRaw`
      SELECT 
        COUNT(DISTINCT o.id)::int as total_orders,
        COUNT(DISTINCT oli.location_id)::int as total_locations,
        ROUND(COUNT(DISTINCT o.id)::numeric / NULLIF(COUNT(DISTINCT oli.location_id), 0), 2) as avg_orders_per_location
      FROM order_line_items oli
      INNER JOIN orders o ON oli.order_id = o.id
      WHERE oli.order_created_at >= '2024-01-01'
        AND oli.order_created_at < '2025-01-01'
    `

    console.log(`   Total orders: ${overall[0].total_orders.toLocaleString()}`)
    console.log(`   Total locations: ${overall[0].total_locations}`)
    console.log(`   Average orders per location: ${overall[0].avg_orders_per_location}`)

    // Monthly averages
    const monthlyAvg = await prisma.$queryRaw`
      SELECT 
        TO_CHAR(oli.order_created_at, 'YYYY-MM') as month,
        COUNT(DISTINCT o.id)::int as orders,
        COUNT(DISTINCT oli.location_id)::int as locations,
        ROUND(COUNT(DISTINCT o.id)::numeric / NULLIF(COUNT(DISTINCT oli.location_id), 0), 1) as avg_per_location
      FROM order_line_items oli
      INNER JOIN orders o ON oli.order_id = o.id
      WHERE oli.order_created_at >= '2024-01-01'
        AND oli.order_created_at < '2025-01-01'
      GROUP BY TO_CHAR(oli.order_created_at, 'YYYY-MM')
      ORDER BY month
    `

    console.log(`\n📈 Monthly Averages:\n`)
    monthlyAvg.forEach(row => {
      console.log(`   ${row.month}: ${row.avg_per_location} orders/location (${row.orders} orders across ${row.locations} locations)`)
    })

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

getOrdersPerMonthPerLocation()
  .then(() => {
    console.log('\n✅ Analysis complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Analysis failed:', error)
    process.exit(1)
  })



