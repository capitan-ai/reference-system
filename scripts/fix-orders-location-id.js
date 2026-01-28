#!/usr/bin/env node
/**
 * Fix location_id in orders table
 * Converts Square location ID strings to UUID location IDs
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function fixOrdersLocationId() {
  console.log('🔧 Fixing location_id in Orders Table\n')
  console.log('='.repeat(60))

  try {
    // Find orders where location_id is a Square location ID string instead of UUID
    // We'll convert them to UUIDs by looking up in locations table
    const ordersToFix = await prisma.$queryRaw`
      SELECT 
        o.id,
        o.order_id,
        o.organization_id,
        o.location_id::text as current_location_id,
        COALESCE(o.raw_json->>'locationId', o.location_id::text) as square_location_id
      FROM orders o
      WHERE o.location_id IS NOT NULL
        AND o.location_id::text NOT LIKE '%-%-%-%-%'  -- Not UUID format (has dashes)
        AND LENGTH(o.location_id::text) < 36  -- Square IDs are shorter than UUIDs
      LIMIT 1000
    `

    console.log(`Found ${ordersToFix.length} orders with Square location ID instead of UUID\n`)

    if (ordersToFix.length === 0) {
      console.log('✅ No orders need location_id fix')
      return
    }

    let updated = 0
    let skipped = 0
    let errors = 0

    for (const order of ordersToFix) {
      try {
        const squareLocationId = order.square_location_id || order.current_location_id
        
        if (!squareLocationId) {
          skipped++
          continue
        }

        // Find location UUID from square_location_id
        // Try with organization_id first, then without if not found
        let locationRecord = await prisma.$queryRaw`
          SELECT id FROM locations 
          WHERE square_location_id = ${squareLocationId}
            AND organization_id = ${order.organization_id}::uuid
          LIMIT 1
        `

        if (!locationRecord || locationRecord.length === 0) {
          // Try without organization_id constraint (some locations might be shared)
          locationRecord = await prisma.$queryRaw`
            SELECT id FROM locations 
            WHERE square_location_id = ${squareLocationId}
            LIMIT 1
          `
        }

        if (!locationRecord || locationRecord.length === 0) {
          console.log(`⚠️  Location not found for square_location_id: ${squareLocationId} (order: ${order.order_id})`)
          skipped++
          continue
        }

        const locationUuid = locationRecord[0].id

        // Update order with UUID location_id
        // Use CAST to convert the UUID string to UUID type
        await prisma.$executeRaw`
          UPDATE orders
          SET location_id = ${locationUuid}::uuid
          WHERE id = ${order.id}::uuid
        `

        updated++
        
        if (updated % 100 === 0) {
          console.log(`   Updated ${updated}/${ordersToFix.length} orders...`)
        }

      } catch (error) {
        console.error(`❌ Error updating order ${order.order_id}: ${error.message}`)
        errors++
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n📊 Results:')
    console.log(`   Total processed: ${ordersToFix.length}`)
    console.log(`   ✅ Updated: ${updated}`)
    console.log(`   ⏭️  Skipped: ${skipped}`)
    console.log(`   ❌ Errors: ${errors}`)

    // Check if there are more orders to fix
    const remaining = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM orders o
      WHERE o.location_id IS NOT NULL
        AND o.location_id::text NOT LIKE '%-%-%-%-%'
        AND LENGTH(o.location_id::text) < 36
    `

    const remainingCount = parseInt(remaining[0].count)
    if (remainingCount > 0) {
      console.log(`\n⚠️  ${remainingCount} more orders still need location_id fix`)
      console.log(`   Run this script again to process more`)
    } else {
      console.log(`\n✅ All orders have been fixed`)
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
    if (error.stack) {
      console.error('Stack:', error.stack.split('\n').slice(0, 5).join('\n'))
    }
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

fixOrdersLocationId()
  .then(() => {
    console.log('\n✅ Fix complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Fix failed:', error)
    process.exit(1)
  })

