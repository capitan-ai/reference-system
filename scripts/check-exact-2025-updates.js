#!/usr/bin/env node
/**
 * Check exact number of 2025 orders updated/inserted
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkExactUpdates() {
  console.log('🔍 Checking Exact 2025 Updates\n')
  console.log('='.repeat(60))

  try {
    // Total 2025 orders in database
    const total2025 = await prisma.$queryRaw`
      SELECT 
        COUNT(DISTINCT o.id)::int as total
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at >= '2025-01-01'
        AND oli.order_created_at < '2026-01-01'
    `

    console.log(`\n📊 Total 2025 orders in database: ${total2025[0].total.toLocaleString()}`)

    // Expected from Square API
    const squareTotal = 17324
    console.log(`📡 Expected from Square API: ${squareTotal.toLocaleString()}`)
    console.log(`📉 Difference: ${(squareTotal - total2025[0].total).toLocaleString()} orders`)

    // Check cancelled orders
    const cancelled = await prisma.$queryRaw`
      SELECT 
        COUNT(DISTINCT o.id)::int as total
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at >= '2025-01-01'
        AND oli.order_created_at < '2026-01-01'
        AND (o.state = 'CANCELED' OR oli.order_state = 'CANCELED')
    `

    console.log(`\n❌ Cancelled orders in database: ${cancelled[0].total.toLocaleString()}`)
    console.log(`📡 Expected cancelled from Square: 310`)
    console.log(`📉 Missing cancelled: ${(310 - cancelled[0].total).toLocaleString()}`)

    // Check orders by state
    const byState = await prisma.$queryRaw`
      SELECT 
        o.state,
        COUNT(DISTINCT o.id)::int as count
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at >= '2025-01-01'
        AND oli.order_created_at < '2026-01-01'
      GROUP BY o.state
      ORDER BY o.state
    `

    console.log(`\n📊 Orders by state:`)
    byState.forEach(s => {
      console.log(`   ${s.state || 'NULL'}: ${s.count.toLocaleString()}`)
    })

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('\n📊 SUMMARY:\n')
    console.log(`   Database has: ${total2025[0].total.toLocaleString()} orders`)
    console.log(`   Square API has: ${squareTotal.toLocaleString()} orders`)
    console.log(`   Missing: ${(squareTotal - total2025[0].total).toLocaleString()} orders`)
    console.log(`\n   Cancelled in DB: ${cancelled[0].total.toLocaleString()}`)
    console.log(`   Cancelled in Square: 310`)
    console.log(`   Missing cancelled: ${(310 - cancelled[0].total).toLocaleString()}`)

    if (total2025[0].total < squareTotal) {
      console.log(`\n⚠️  ${(squareTotal - total2025[0].total).toLocaleString()} orders from Square are not in the database`)
      console.log(`   This could mean:`)
      console.log(`   - Some orders failed to save (check logs)`)
      console.log(`   - Some orders don't have line items`)
      console.log(`   - Some orders were filtered out`)
    } else {
      console.log(`\n✅ All orders are in the database!`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

checkExactUpdates()
  .then(() => {
    console.log('\n✅ Check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Check failed:', error)
    process.exit(1)
  })



