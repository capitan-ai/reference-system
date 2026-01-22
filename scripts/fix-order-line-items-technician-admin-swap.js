/**
 * Fix order_line_items data swap issue
 * 
 * Problem: The migration incorrectly copied team_member_id (which was admin ID) to technician_id
 * Solution: Swap the data - move technician_id values to administrator_id, then clear technician_id
 *           so it can be populated correctly from bookings
 */

const prisma = require('../lib/prisma-client')

async function fixOrderLineItemsDataSwap() {
  try {
    console.log('🔧 Fixing order_line_items technician_id/administrator_id data swap...')
    
    // Step 1: Move technician_id values to administrator_id (since they're actually admin IDs)
    // Only update rows where administrator_id is NULL and technician_id is NOT NULL
    const updateResult1 = await prisma.$executeRaw`
      UPDATE order_line_items
      SET administrator_id = technician_id
      WHERE technician_id IS NOT NULL
        AND administrator_id IS NULL
    `
    
    console.log(`✅ Moved ${updateResult1} rows: technician_id → administrator_id`)
    
    // Step 2: Clear technician_id so it can be populated correctly from bookings
    // We'll keep administrator_id as is
    const updateResult2 = await prisma.$executeRaw`
      UPDATE order_line_items
      SET technician_id = NULL
      WHERE technician_id IS NOT NULL
    `
    
    console.log(`✅ Cleared technician_id for ${updateResult2} rows (will be repopulated from bookings)`)
    
    // Step 3: Get count of rows that need technician_id from bookings
    const rowsNeedingTechnician = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM order_line_items
      WHERE technician_id IS NULL
        AND service_variation_id IS NOT NULL
    `
    
    console.log(`📊 ${rowsNeedingTechnician[0].count} rows need technician_id to be populated from bookings`)
    
    console.log('✅ Data swap fix completed!')
    console.log('   - administrator_id now has the correct admin IDs')
    console.log('   - technician_id cleared and ready to be populated from bookings')
    console.log('   - Future webhooks will correctly populate both fields')
    
  } catch (error) {
    console.error('❌ Error fixing data swap:', error.message)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run if called directly
if (require.main === module) {
  fixOrderLineItemsDataSwap()
    .then(() => {
      console.log('✅ Script completed successfully')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Script failed:', error)
      process.exit(1)
    })
}

module.exports = { fixOrderLineItemsDataSwap }

