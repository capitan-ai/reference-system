#!/usr/bin/env node
/**
 * Backfill missing location_id in orders table
 * Extracts location_id from raw_json and updates orders
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function backfillMissingLocationId() {
  console.log('🔄 Backfilling Missing location_id in Orders\n')
  console.log('='.repeat(60))

  try {
    // Find orders with NULL location_id but have locationId in raw_json
    const ordersToUpdate = await prisma.$queryRaw`
      SELECT 
        o.id,
        o.order_id,
        o.organization_id,
        o.location_id,
        o.raw_json->>'locationId' as square_location_id,
        o.raw_json->'locationId' as location_id_json
      FROM orders o
      WHERE o.location_id IS NULL
        AND o.raw_json IS NOT NULL
        AND (o.raw_json->>'locationId' IS NOT NULL OR o.raw_json->'locationId' IS NOT NULL)
      LIMIT 1000
    `

    console.log(`Found ${ordersToUpdate.length} orders with missing location_id\n`)

    if (ordersToUpdate.length === 0) {
      console.log('✅ No orders need location_id backfill')
      return
    }

    let updated = 0
    let skipped = 0
    let errors = 0

    for (const order of ordersToUpdate) {
      try {
        const squareLocationId = order.square_location_id || order.location_id_json
        
        if (!squareLocationId) {
          skipped++
          continue
        }

        // Find location UUID from square_location_id
        const locationRecord = await prisma.$queryRaw`
          SELECT id FROM locations 
          WHERE square_location_id = ${squareLocationId}
            AND organization_id = ${order.organization_id}::uuid
          LIMIT 1
        `

        if (!locationRecord || locationRecord.length === 0) {
          console.log(`⚠️  Location not found for square_location_id: ${squareLocationId} (order: ${order.order_id})`)
          skipped++
          continue
        }

        const locationUuid = locationRecord[0].id

        // Update order with location_id
        await prisma.$executeRaw`
          UPDATE orders
          SET location_id = ${locationUuid}::uuid
          WHERE id = ${order.id}::uuid
        `

        updated++
        
        if (updated % 100 === 0) {
          console.log(`   Updated ${updated}/${ordersToUpdate.length} orders...`)
        }

      } catch (error) {
        console.error(`❌ Error updating order ${order.order_id}: ${error.message}`)
        errors++
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n📊 Results:')
    console.log(`   Total processed: ${ordersToUpdate.length}`)
    console.log(`   ✅ Updated: ${updated}`)
    console.log(`   ⏭️  Skipped: ${skipped}`)
    console.log(`   ❌ Errors: ${errors}`)

    // Check if there are more orders to update
    const remaining = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM orders o
      WHERE o.location_id IS NULL
        AND o.raw_json IS NOT NULL
        AND (o.raw_json->>'locationId' IS NOT NULL OR o.raw_json->'locationId' IS NOT NULL)
    `

    const remainingCount = parseInt(remaining[0].count)
    if (remainingCount > 0) {
      console.log(`\n⚠️  ${remainingCount} more orders still need location_id backfill`)
      console.log(`   Run this script again to process more`)
    } else {
      console.log(`\n✅ All orders with location data have been updated`)
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

backfillMissingLocationId()
  .then(() => {
    console.log('\n✅ Backfill complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Backfill failed:', error)
    process.exit(1)
  })



