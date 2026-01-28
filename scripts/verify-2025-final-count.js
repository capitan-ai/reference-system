#!/usr/bin/env node
/**
 * Verify final count of 2025 orders
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function verifyCount() {
  console.log('🔍 Verifying Final 2025 Order Count\n')
  console.log('='.repeat(60))

  try {
    // Method 1: All orders with order_id in database
    const allOrderIds = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT order_id)::int as count
      FROM orders
      WHERE order_id IS NOT NULL
    `
    console.log(`\n📊 Total unique order_ids in database: ${allOrderIds[0].count.toLocaleString()}`)

    // Method 2: 2025 orders by checking raw_json
    const orders2025RawJson = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT order_id)::int as count
      FROM orders
      WHERE raw_json->>'created_at' >= '2025-01-01'
        AND raw_json->>'created_at' < '2026-01-01'
    `
    console.log(`📅 2025 orders (by raw_json.created_at): ${orders2025RawJson[0].count.toLocaleString()}`)

    // Method 3: 2025 orders with line items
    const ordersWithLineItems = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT o.order_id)::int as count
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at >= '2025-01-01'
        AND oli.order_created_at < '2026-01-01'
    `
    console.log(`📦 2025 orders with line items: ${ordersWithLineItems[0].count.toLocaleString()}`)

    // Method 4: 2025 orders without line items
    const ordersWithoutLineItems = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT o.order_id)::int as count
      FROM orders o
      LEFT JOIN order_line_items oli ON o.id = oli.order_id
      WHERE (o.raw_json->>'created_at' >= '2025-01-01' AND o.raw_json->>'created_at' < '2026-01-01')
        AND oli.id IS NULL
    `
    console.log(`⚠️  2025 orders WITHOUT line items: ${ordersWithoutLineItems[0].count.toLocaleString()}`)

    // Method 5: All 2025 orders (with or without line items)
    const all2025Orders = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT order_id)::int as count
      FROM orders
      WHERE (raw_json->>'created_at' >= '2025-01-01' AND raw_json->>'created_at' < '2026-01-01')
         OR id IN (
           SELECT DISTINCT order_id
           FROM order_line_items
           WHERE order_created_at >= '2025-01-01'
             AND order_created_at < '2026-01-01'
         )
    `
    console.log(`📊 All 2025 orders (combined): ${all2025Orders[0].count.toLocaleString()}`)

    // Expected from Square
    const squareCount = 17324
    console.log(`\n📡 Expected from Square API: ${squareCount.toLocaleString()}`)
    
    const difference = squareCount - all2025Orders[0].count
    console.log(`📉 Difference: ${difference.toLocaleString()} orders`)

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('\n📊 SUMMARY:\n')
    console.log(`   Square API: ${squareCount.toLocaleString()} orders`)
    console.log(`   Database (all methods): ${all2025Orders[0].count.toLocaleString()} orders`)
    console.log(`   - With line items: ${ordersWithLineItems[0].count.toLocaleString()}`)
    console.log(`   - Without line items: ${ordersWithoutLineItems[0].count.toLocaleString()}`)
    
    if (difference === 0) {
      console.log(`\n✅ All orders are in the database!`)
    } else if (difference > 0) {
      console.log(`\n⚠️  ${difference.toLocaleString()} orders are missing`)
    } else {
      console.log(`\n⚠️  Database has ${Math.abs(difference).toLocaleString()} more orders than Square (possible duplicates or data issues)`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

verifyCount()
  .then(() => {
    console.log('\n✅ Verification complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Verification failed:', error)
    process.exit(1)
  })



