/**
 * Diagnostic script to check why orders and order_line_items are not updating
 * since Jan 16-18 from webhooks
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function diagnoseOrderWebhookIssues() {
  console.log('🔍 Diagnosing Order Webhook Issues\n')
  console.log('=' .repeat(60))

  try {
    // 1. Check recent orders in database
    console.log('\n1. Checking recent orders in database...')
    const recentOrders = await prisma.$queryRaw`
      SELECT 
        order_id,
        organization_id,
        location_id,
        customer_id,
        state,
        created_at,
        updated_at
      FROM orders
      WHERE created_at >= '2026-01-16'
      ORDER BY created_at DESC
      LIMIT 10
    `
    console.log(`   Found ${recentOrders.length} orders since Jan 16`)
    if (recentOrders.length > 0) {
      console.log('   Recent orders:')
      recentOrders.forEach(order => {
        console.log(`   - ${order.order_id} (org: ${order.organization_id?.substring(0, 8)}..., created: ${order.created_at})`)
      })
    } else {
      console.log('   ⚠️ No orders found since Jan 16 - this confirms the issue!')
    }

    // 2. Check recent order_line_items
    console.log('\n2. Checking recent order_line_items in database...')
    const recentLineItems = await prisma.$queryRaw`
      SELECT 
        uid,
        order_id,
        organization_id,
        service_variation_id,
        name,
        created_at
      FROM order_line_items
      WHERE created_at >= '2026-01-16'
      ORDER BY created_at DESC
      LIMIT 10
    `
    console.log(`   Found ${recentLineItems.length} line items since Jan 16`)
    if (recentLineItems.length > 0) {
      console.log('   Recent line items:')
      recentLineItems.forEach(item => {
        console.log(`   - ${item.uid || 'no-uid'} (order: ${item.order_id?.substring(0, 8)}..., created: ${item.created_at})`)
      })
    } else {
      console.log('   ⚠️ No line items found since Jan 16 - this confirms the issue!')
    }

    // 3. Check organizations table
    console.log('\n3. Checking organizations...')
    const orgs = await prisma.$queryRaw`
      SELECT 
        id,
        square_merchant_id,
        name,
        is_active
      FROM organizations
      ORDER BY created_at DESC
    `
    console.log(`   Found ${orgs.length} organizations:`)
    orgs.forEach(org => {
      console.log(`   - ${org.name || 'Unnamed'} (merchant_id: ${org.square_merchant_id?.substring(0, 16)}..., active: ${org.is_active})`)
    })

    if (orgs.length === 0) {
      console.log('   ❌ No organizations found! This is likely the root cause.')
    }

    // 4. Check locations table
    console.log('\n4. Checking locations...')
    const locations = await prisma.$queryRaw`
      SELECT 
        id,
        organization_id,
        square_location_id,
        name
      FROM locations
      ORDER BY created_at DESC
      LIMIT 10
    `
    console.log(`   Found ${locations.length} locations (showing last 10):`)
    locations.forEach(loc => {
      console.log(`   - ${loc.name} (square_id: ${loc.square_location_id?.substring(0, 16)}..., org: ${loc.organization_id?.substring(0, 8)}...)`)
    })

    // 5. Check for orders that might have failed due to missing organization_id
    console.log('\n5. Checking for potential issues...')
    
    // Check if there are any orders without organization_id (shouldn't be possible due to NOT NULL, but check anyway)
    const ordersWithoutOrg = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM orders
      WHERE organization_id IS NULL
    `
    console.log(`   Orders without organization_id: ${ordersWithoutOrg[0]?.count || 0}`)

    // Check if there are any line items without organization_id
    const lineItemsWithoutOrg = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM order_line_items
      WHERE organization_id IS NULL
    `
    console.log(`   Line items without organization_id: ${lineItemsWithoutOrg[0]?.count || 0}`)

    // 6. Check environment variables
    console.log('\n6. Checking environment variables...')
    const squareAccessToken = process.env.SQUARE_ACCESS_TOKEN
    const squareWebhookSecret = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
    console.log(`   SQUARE_ACCESS_TOKEN: ${squareAccessToken ? '✅ Set' : '❌ Missing'}`)
    console.log(`   SQUARE_WEBHOOK_SIGNATURE_KEY: ${squareWebhookSecret ? '✅ Set' : '❌ Missing'}`)

    // 7. Recommendations
    console.log('\n' + '='.repeat(60))
    console.log('\n📋 Recommendations:')
    
    if (orgs.length === 0) {
      console.log('   1. ❌ CRITICAL: No organizations found in database')
      console.log('      → Create at least one organization with square_merchant_id')
    }
    
    if (recentOrders.length === 0) {
      console.log('   2. ⚠️ No orders found since Jan 16')
      console.log('      → Check webhook logs for errors')
      console.log('      → Verify webhook endpoint is receiving order.created/order.updated events')
      console.log('      → Check if organization_id resolution is failing')
    }
    
    if (recentLineItems.length === 0) {
      console.log('   3. ⚠️ No line items found since Jan 16')
      console.log('      → This is likely because orders are not being saved')
    }

    console.log('\n✅ Diagnosis complete\n')

  } catch (error) {
    console.error('❌ Error during diagnosis:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run diagnosis
diagnoseOrderWebhookIssues()
  .then(() => {
    console.log('Script completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Script failed:', error)
    process.exit(1)
  })



