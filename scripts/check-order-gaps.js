/**
 * Check for gaps in order processing and identify potential issues
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function checkOrderGaps() {
  console.log('🔍 Checking for Order Processing Gaps\n')
  console.log('='.repeat(60))

  try {
    // 1. Check orders by date to find gaps
    console.log('\n1. Orders by date (last 30 days)...')
    const ordersByDate = await prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `
    console.log('   Date       | Count')
    console.log('   ' + '-'.repeat(30))
    ordersByDate.forEach(row => {
      const date = row.date.toISOString().split('T')[0]
      const count = row.count
      const indicator = count > 0 ? '✅' : '❌'
      console.log(`   ${date} | ${indicator} ${count}`)
    })

    // 2. Check order_line_items by date
    console.log('\n2. Order Line Items by date (last 30 days)...')
    const lineItemsByDate = await prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM order_line_items
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `
    console.log('   Date       | Count')
    console.log('   ' + '-'.repeat(30))
    lineItemsByDate.forEach(row => {
      const date = row.date.toISOString().split('T')[0]
      const count = row.count
      const indicator = count > 0 ? '✅' : '❌'
      console.log(`   ${date} | ${indicator} ${count}`)
    })

    // 3. Check most recent orders
    console.log('\n3. Most recent orders (last 5)...')
    const recentOrders = await prisma.$queryRaw`
      SELECT 
        order_id,
        organization_id,
        state,
        created_at,
        updated_at
      FROM orders
      ORDER BY created_at DESC
      LIMIT 5
    `
    recentOrders.forEach((order, idx) => {
      const daysAgo = Math.floor((Date.now() - new Date(order.created_at)) / (1000 * 60 * 60 * 24))
      console.log(`   ${idx + 1}. ${order.order_id.substring(0, 20)}... (${daysAgo} days ago, state: ${order.state})`)
    })

    // 4. Check if there are orders without line items (potential issue)
    console.log('\n4. Orders without line items (potential issue)...')
    const ordersWithoutLineItems = await prisma.$queryRaw`
      SELECT 
        o.order_id,
        o.created_at,
        o.state
      FROM orders o
      LEFT JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.id IS NULL
        AND o.created_at >= '2026-01-16'
      ORDER BY o.created_at DESC
      LIMIT 10
    `
    if (ordersWithoutLineItems.length > 0) {
      console.log(`   ⚠️ Found ${ordersWithoutLineItems.length} orders without line items:`)
      ordersWithoutLineItems.forEach(order => {
        console.log(`   - ${order.order_id} (created: ${order.created_at}, state: ${order.state})`)
      })
    } else {
      console.log('   ✅ All orders have line items')
    }

    // 5. Check for potential webhook processing failures
    console.log('\n5. Checking for potential webhook issues...')
    
    // Check if there are orders that were created but never updated (might indicate webhook not processing updates)
    const staleOrders = await prisma.$queryRaw`
      SELECT 
        order_id,
        state,
        created_at,
        updated_at,
        EXTRACT(EPOCH FROM (updated_at - created_at)) as seconds_between
      FROM orders
      WHERE created_at >= '2026-01-16'
        AND created_at = updated_at
        AND state != 'OPEN'
      ORDER BY created_at DESC
      LIMIT 10
    `
    if (staleOrders.length > 0) {
      console.log(`   ⚠️ Found ${staleOrders.length} orders that were never updated (might indicate order.updated webhook not working):`)
      staleOrders.forEach(order => {
        console.log(`   - ${order.order_id} (state: ${order.state}, created: ${order.created_at})`)
      })
    } else {
      console.log('   ✅ Orders appear to be updating properly')
    }

    // 6. Check payments vs orders (to see if payments are coming but orders aren't)
    console.log('\n6. Comparing payments vs orders (last 7 days)...')
    const paymentsCount = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM payments
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `
    const ordersCount = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `
    const paymentsNum = Number(paymentsCount[0]?.count || 0)
    const ordersNum = Number(ordersCount[0]?.count || 0)
    console.log(`   Payments (last 7 days): ${paymentsNum}`)
    console.log(`   Orders (last 7 days): ${ordersNum}`)
    
    if (paymentsNum > ordersNum * 1.5 && ordersNum > 0) {
      console.log('   ⚠️ Significantly more payments than orders - might indicate order webhooks not processing')
    } else if (ordersNum === 0 && paymentsNum > 0) {
      console.log('   ⚠️ Payments exist but no orders - order webhooks likely not processing')
    } else {
      console.log('   ✅ Payment/order ratio looks normal')
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n✅ Gap analysis complete\n')

  } catch (error) {
    console.error('❌ Error during gap analysis:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

checkOrderGaps()
  .then(() => {
    console.log('Script completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Script failed:', error)
    process.exit(1)
  })

