/**
 * Backfill technician_id in order_line_items from bookings
 * 
 * Matches order_line_items to bookings by:
 * 1. Finding payment for the order
 * 2. Getting booking_id from payment
 * 3. Matching catalog_object_id to service_variation_id in bookings
 * 4. Setting technician_id from the matching booking
 */

const prisma = require('../lib/prisma-client')

async function backfillTechnicianIds() {
  try {
    console.log('🔧 Backfilling technician_id in order_line_items from bookings...')
    
    // Get all order_line_items that need technician_id
    const lineItemsNeedingTechnician = await prisma.$queryRaw`
      SELECT 
        oli.id,
        oli.order_id,
        oli.service_variation_id,
        oli.technician_id,
        oli.administrator_id
      FROM order_line_items oli
      WHERE oli.technician_id IS NULL
        AND oli.service_variation_id IS NOT NULL
      ORDER BY oli.created_at DESC
      LIMIT 10000
    `
    
    console.log(`📊 Found ${lineItemsNeedingTechnician.length} line items needing technician_id`)
    
    let updated = 0
    let skipped = 0
    
    for (const lineItem of lineItemsNeedingTechnician) {
      try {
        // Find payment for this order
        const payment = await prisma.$queryRaw`
          SELECT booking_id, administrator_id
          FROM payments
          WHERE order_id = ${lineItem.order_id}
            AND booking_id IS NOT NULL
          LIMIT 1
        `
        
        if (!payment || payment.length === 0) {
          skipped++
          continue
        }
        
        const bookingId = payment[0].booking_id
        
        // Find booking with matching service_variation_id
        const booking = await prisma.$queryRaw`
          SELECT technician_id
          FROM bookings
          WHERE booking_id LIKE ${`${bookingId}%`}
            AND service_variation_id = ${lineItem.service_variation_id}
            AND technician_id IS NOT NULL
            AND any_team_member = false
          LIMIT 1
        `
        
        if (booking && booking.length > 0) {
          const technicianId = booking[0].technician_id
          
          // Update the line item
          await prisma.$executeRaw`
            UPDATE order_line_items
            SET technician_id = ${technicianId}
            WHERE id = ${lineItem.id}
              AND technician_id IS NULL
          `
          
          updated++
          
          if (updated % 100 === 0) {
            console.log(`   ✅ Updated ${updated} line items...`)
          }
        } else {
          skipped++
        }
      } catch (error) {
        console.error(`❌ Error processing line item ${lineItem.id}:`, error.message)
        skipped++
      }
    }
    
    console.log(`\n✅ Backfill completed!`)
    console.log(`   - Updated: ${updated} line items`)
    console.log(`   - Skipped: ${skipped} line items (no booking match found)`)
    
  } catch (error) {
    console.error('❌ Error backfilling technician_id:', error.message)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run if called directly
if (require.main === module) {
  backfillTechnicianIds()
    .then(() => {
      console.log('✅ Script completed successfully')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Script failed:', error)
      process.exit(1)
    })
}

module.exports = { backfillTechnicianIds }

