#!/usr/bin/env node
/**
 * Test reconciliation system with 2025 orders and payments
 * Checks for database issues, SQL errors, and data consistency
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function test2025Reconciliation() {
  console.log('🧪 Testing Reconciliation System with 2025 Orders and Payments\n')
  console.log('='.repeat(80))
  
  const startDate = new Date('2025-01-01T00:00:00Z')
  const endDate = new Date('2025-12-31T23:59:59Z')
  
  console.log(`Date Range: ${startDate.toISOString()} to ${endDate.toISOString()}\n`)
  
  try {
    // Get sample orders from 2025
    const orders = await prisma.$queryRaw`
      SELECT 
        o.order_id,
        o.id,
        o.organization_id,
        o.customer_id,
        o.location_id,
        o.booking_id,
        o.created_at,
        COUNT(DISTINCT oli.id) as line_item_count,
        COUNT(DISTINCT p.id) as payment_count
      FROM orders o
      LEFT JOIN order_line_items oli ON oli.order_id = o.id
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE o.created_at >= ${startDate}::timestamp
        AND o.created_at <= ${endDate}::timestamp
        AND o.customer_id IS NOT NULL
        AND o.location_id IS NOT NULL
      GROUP BY o.order_id, o.id, o.organization_id, o.customer_id, o.location_id, o.booking_id, o.created_at
      ORDER BY o.created_at DESC
      LIMIT 20
    `
    
    console.log(`Found ${orders.length} orders from 2025 with customer and location\n`)
    
    if (orders.length === 0) {
      console.log('⚠️  No orders found from 2025. Checking if any orders exist...')
      const totalOrders = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM orders
      `
      console.log(`Total orders in database: ${Number(totalOrders[0].count)}`)
      
      // Check date range
      const dateRange = await prisma.$queryRaw`
        SELECT 
          MIN(created_at) as min_date,
          MAX(created_at) as max_date
        FROM orders
      `
      if (dateRange && dateRange.length > 0) {
        console.log(`Order date range: ${dateRange[0].min_date} to ${dateRange[0].max_date}`)
      }
      
      await prisma.$disconnect()
      return
    }
    
    let successCount = 0
    let errorCount = 0
    let noMatchCount = 0
    const errors = []
    
    for (const order of orders) {
      console.log(`\n${'='.repeat(80)}`)
      console.log(`Testing Order: ${order.order_id}`)
      console.log(`  UUID: ${order.id}`)
      console.log(`  Customer: ${order.customer_id}`)
      console.log(`  Location: ${order.location_id}`)
      console.log(`  Created: ${order.created_at}`)
      console.log(`  Current booking_id: ${order.booking_id || 'NULL'}`)
      console.log(`  Line items: ${Number(order.line_item_count)}`)
      console.log(`  Payments: ${Number(order.payment_count)}`)
      
      try {
        // Test reconciliation function logic
        const orderUuid = order.id
        const customerId = order.customer_id
        const locationId = order.location_id
        const orderCreatedAt = new Date(order.created_at)
        
        // Check location type
        let squareLocationId = null
        let locationUuid = null
        if (locationId && locationId.length < 36) {
          squareLocationId = locationId
          const loc = await prisma.$queryRaw`
            SELECT id FROM locations 
            WHERE square_location_id = ${locationId}
              AND organization_id = ${order.organization_id}::uuid
            LIMIT 1
          `
          if (loc && loc.length > 0) {
            locationUuid = loc[0].id
          }
        } else {
          locationUuid = locationId
          const loc = await prisma.$queryRaw`
            SELECT square_location_id FROM locations 
            WHERE id = ${locationId}::uuid
            LIMIT 1
          `
          if (loc && loc.length > 0) {
            squareLocationId = loc[0].square_location_id
          }
        }
        
        console.log(`  Location Type: ${squareLocationId ? 'Square ID' : 'UUID'}`)
        console.log(`  Square Location ID: ${squareLocationId || 'NULL'}`)
        console.log(`  Location UUID: ${locationUuid || 'NULL'}`)
        
        // Get payments for this order
        const payments = await prisma.$queryRaw`
          SELECT id, booking_id
          FROM payments
          WHERE order_id = ${orderUuid}::uuid
          LIMIT 5
        `
        
        console.log(`  Payments with booking_id: ${payments.filter(p => p.booking_id).length}`)
        
        // Get line items
        const lineItems = await prisma.$queryRaw`
          SELECT DISTINCT service_variation_id
          FROM order_line_items
          WHERE order_id = ${orderUuid}::uuid
            AND service_variation_id IS NOT NULL
          LIMIT 5
        `
        
        console.log(`  Service variations: ${lineItems.length}`)
        
        // Test Method 2: Service Variation Matching
        if (lineItems.length > 0 && customerId && (locationUuid || squareLocationId)) {
          const startWindow = new Date(orderCreatedAt.getTime() - 7 * 24 * 60 * 60 * 1000)
          const endWindow = new Date(orderCreatedAt.getTime() + 1 * 24 * 60 * 60 * 1000)
          
          let foundMatch = false
          for (const li of lineItems) {
            let matchingBookings = null
            
            try {
              if (squareLocationId) {
                matchingBookings = await prisma.$queryRaw`
                  SELECT b.id, b.booking_id, b.start_at
                  FROM bookings b
                  INNER JOIN locations l ON l.id::text = b.location_id::text
                  INNER JOIN service_variation sv ON sv.uuid = b.service_variation_id
                  WHERE b.customer_id = ${customerId}
                    AND l.square_location_id = ${squareLocationId}
                    AND sv.square_variation_id = ${li.service_variation_id}
                    AND b.start_at >= ${startWindow}::timestamp
                    AND b.start_at <= ${endWindow}::timestamp
                  ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
                  LIMIT 1
                `
              } else if (locationUuid) {
                matchingBookings = await prisma.$queryRaw`
                  SELECT b.id, b.booking_id, b.start_at
                  FROM bookings b
                  INNER JOIN service_variation sv ON sv.uuid = b.service_variation_id
                  WHERE b.customer_id = ${customerId}
                    AND b.location_id::text = ${locationUuid}::text
                    AND sv.square_variation_id = ${li.service_variation_id}
                    AND b.start_at >= ${startWindow}::timestamp
                    AND b.start_at <= ${endWindow}::timestamp
                  ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
                  LIMIT 1
                `
              }
              
              if (matchingBookings && matchingBookings.length > 0) {
                console.log(`  ✅ MATCH FOUND: ${matchingBookings[0].id}`)
                foundMatch = true
                successCount++
                break
              }
            } catch (sqlError) {
              console.log(`  ❌ SQL ERROR: ${sqlError.message}`)
              errors.push({
                order: order.order_id,
                error: sqlError.message,
                method: 'service_variation_matching'
              })
              errorCount++
            }
          }
          
          if (!foundMatch) {
            console.log(`  ⚠️  No match found`)
            noMatchCount++
          }
        } else {
          console.log(`  ⏭️  Skipped (missing data)`)
          noMatchCount++
        }
        
      } catch (error) {
        console.log(`  ❌ ERROR: ${error.message}`)
        errors.push({
          order: order.order_id,
          error: error.message,
          stack: error.stack
        })
        errorCount++
      }
    }
    
    console.log(`\n${'='.repeat(80)}`)
    console.log('📊 TEST SUMMARY\n')
    console.log(`Total orders tested: ${orders.length}`)
    console.log(`✅ Successful matches: ${successCount}`)
    console.log(`❌ Errors: ${errorCount}`)
    console.log(`⚠️  No matches: ${noMatchCount}`)
    
    if (errors.length > 0) {
      console.log(`\n❌ ERRORS FOUND:\n`)
      errors.forEach((err, idx) => {
        console.log(`${idx + 1}. Order: ${err.order}`)
        console.log(`   Error: ${err.error}`)
        if (err.method) {
          console.log(`   Method: ${err.method}`)
        }
      })
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message)
    console.error('Stack:', error.stack)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

test2025Reconciliation()
  .then(() => {
    console.log('\n✅ Test Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test Failed:', error)
    process.exit(1)
  })



