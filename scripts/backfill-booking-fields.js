#!/usr/bin/env node
/**
 * Backfill script to populate missing booking fields from raw_json
 * 
 * Fills:
 * - duration_minutes (from appointment_segments)
 * - service_variation_id (from appointment_segments, resolve to UUID)
 * - administrator_id (from creator_details, resolve to UUID)
 * - customer_note (from raw_json)
 * - seller_note (from raw_json)
 * - address_line_1 (if missing and available in raw_json)
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Helper to safely stringify BigInt values
function safeStringify(obj) {
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'bigint') {
      return value.toString()
    }
    return value
  })
}

// Resolve Square service variation ID to UUID
async function resolveServiceVariationId(squareServiceVariationId, organizationId) {
  if (!squareServiceVariationId || !organizationId) return null
  
  try {
    const sv = await prisma.$queryRaw`
      SELECT uuid FROM service_variation
      WHERE square_variation_id = ${squareServiceVariationId}
        AND organization_id = ${organizationId}::uuid
      LIMIT 1
    `
    return sv && sv.length > 0 ? sv[0].uuid : null
  } catch (error) {
    console.warn(`   ⚠️ Error resolving service variation ${squareServiceVariationId}: ${error.message}`)
    return null
  }
}

// Resolve Square team member ID to UUID
async function resolveTeamMemberId(squareTeamMemberId, organizationId) {
  if (!squareTeamMemberId || !organizationId) return null
  
  try {
    const tm = await prisma.$queryRaw`
      SELECT id FROM team_members
      WHERE square_team_member_id = ${squareTeamMemberId}
        AND organization_id = ${organizationId}::uuid
      LIMIT 1
    `
    return tm && tm.length > 0 ? tm[0].id : null
  } catch (error) {
    console.warn(`   ⚠️ Error resolving team member ${squareTeamMemberId}: ${error.message}`)
    return null
  }
}

async function backfillBookingFields() {
  console.log('🔄 Starting booking fields backfill...\n')
  console.log('='.repeat(80))
  
  try {
    // Get all bookings with raw_json
    console.log('📋 Step 1: Fetching bookings with raw_json...')
    const bookings = await prisma.$queryRaw`
      SELECT 
        id,
        organization_id,
        booking_id,
        service_variation_id,
        technician_id,
        administrator_id,
        duration_minutes,
        customer_note,
        seller_note,
        address_line_1,
        raw_json
      FROM bookings
      WHERE raw_json IS NOT NULL
      ORDER BY created_at DESC
    `
    
    console.log(`✅ Found ${bookings.length.toLocaleString()} bookings with raw_json\n`)
    
    let updated = 0
    let skipped = 0
    let errors = 0
    
    const stats = {
      duration_minutes: { filled: 0, alreadyFilled: 0 },
      service_variation_id: { filled: 0, alreadyFilled: 0, notFound: 0 },
      administrator_id: { filled: 0, alreadyFilled: 0, notFound: 0 },
      customer_note: { filled: 0, alreadyFilled: 0 },
      seller_note: { filled: 0, alreadyFilled: 0 },
      address_line_1: { filled: 0, alreadyFilled: 0 }
    }
    
    console.log('📝 Step 2: Processing bookings...\n')
    
    for (let i = 0; i < bookings.length; i++) {
      const booking = bookings[i]
      const bookingId = booking.booking_id
      const bookingUuid = booking.id
      const organizationId = booking.organization_id
      const rawJson = booking.raw_json
      
      if (i % 1000 === 0 && i > 0) {
        console.log(`   Progress: ${i}/${bookings.length} (${((i / bookings.length) * 100).toFixed(1)}%)`)
      }
      
      try {
        const updateFields = []
        const updateValues = []
        let hasUpdates = false
        
        // Extract appointment_segments
        const appointmentSegments = rawJson.appointmentSegments || rawJson.appointment_segments || []
        const firstSegment = appointmentSegments.length > 0 ? appointmentSegments[0] : null
        
        // 1. Fill duration_minutes (95% empty)
        if (!booking.duration_minutes && firstSegment) {
          const duration = firstSegment.durationMinutes || firstSegment.duration_minutes
          if (duration) {
            updateFields.push('duration_minutes = $' + (updateValues.length + 1))
            updateValues.push(duration)
            stats.duration_minutes.filled++
            hasUpdates = true
          }
        } else if (booking.duration_minutes) {
          stats.duration_minutes.alreadyFilled++
        }
        
        // 2. Fill service_variation_id (62.8% empty)
        if (!booking.service_variation_id && firstSegment) {
          const squareServiceVariationId = firstSegment.serviceVariationId || firstSegment.service_variation_id
          if (squareServiceVariationId) {
            const serviceVariationUuid = await resolveServiceVariationId(squareServiceVariationId, organizationId)
            if (serviceVariationUuid) {
              updateFields.push('service_variation_id = $' + (updateValues.length + 1) + '::uuid')
              updateValues.push(serviceVariationUuid)
              stats.service_variation_id.filled++
              hasUpdates = true
            } else {
              stats.service_variation_id.notFound++
            }
          }
        } else if (booking.service_variation_id) {
          stats.service_variation_id.alreadyFilled++
        }
        
        // 3. Fill administrator_id (69.3% empty)
        if (!booking.administrator_id) {
          const creatorDetails = rawJson.creatorDetails || rawJson.creator_details || {}
          const squareTeamMemberId = creatorDetails.teamMemberId || creatorDetails.team_member_id
          if (squareTeamMemberId) {
            const administratorUuid = await resolveTeamMemberId(squareTeamMemberId, organizationId)
            if (administratorUuid) {
              updateFields.push('administrator_id = $' + (updateValues.length + 1) + '::uuid')
              updateValues.push(administratorUuid)
              stats.administrator_id.filled++
              hasUpdates = true
            } else {
              stats.administrator_id.notFound++
            }
          }
        } else {
          stats.administrator_id.alreadyFilled++
        }
        
        // 4. Fill customer_note (new field)
        if (!booking.customer_note) {
          const customerNote = rawJson.customerNote || rawJson.customer_note
          if (customerNote) {
            updateFields.push('customer_note = $' + (updateValues.length + 1))
            updateValues.push(customerNote)
            stats.customer_note.filled++
            hasUpdates = true
          }
        } else {
          stats.customer_note.alreadyFilled++
        }
        
        // 5. Fill seller_note (new field)
        if (!booking.seller_note) {
          const sellerNote = rawJson.sellerNote || rawJson.seller_note
          if (sellerNote) {
            updateFields.push('seller_note = $' + (updateValues.length + 1))
            updateValues.push(sellerNote)
            stats.seller_note.filled++
            hasUpdates = true
          }
        } else {
          stats.seller_note.alreadyFilled++
        }
        
        // 6. Fill address_line_1 (31.1% empty - optional, only if missing)
        if (!booking.address_line_1) {
          const address = rawJson.address || {}
          const addressLine1 = address.addressLine1 || address.address_line_1
          if (addressLine1) {
            updateFields.push('address_line_1 = $' + (updateValues.length + 1))
            updateValues.push(addressLine1)
            stats.address_line_1.filled++
            hasUpdates = true
          }
        } else {
          stats.address_line_1.alreadyFilled++
        }
        
        // Execute update if there are changes
        if (hasUpdates) {
          updateFields.push('updated_at = NOW()')
          updateValues.push(bookingUuid)
          
          const updateQuery = `
            UPDATE bookings
            SET ${updateFields.join(', ')}
            WHERE id = $${updateValues.length}::uuid
          `
          
          await prisma.$executeRawUnsafe(updateQuery, ...updateValues)
          updated++
        } else {
          skipped++
        }
        
      } catch (error) {
        errors++
        console.error(`   ❌ Error processing booking ${bookingId}: ${error.message}`)
        if (errors <= 10) {
          console.error(`      Stack: ${error.stack?.split('\n').slice(0, 3).join('\n')}`)
        }
      }
    }
    
    console.log('\n' + '='.repeat(80))
    console.log('📊 BACKFILL RESULTS\n')
    console.log(`Total bookings processed: ${bookings.length.toLocaleString()}`)
    console.log(`✅ Updated: ${updated.toLocaleString()}`)
    console.log(`⏭️  Skipped (no changes needed): ${skipped.toLocaleString()}`)
    console.log(`❌ Errors: ${errors.toLocaleString()}\n`)
    
    console.log('📈 Field Statistics:\n')
    console.log('duration_minutes:')
    console.log(`  ✅ Filled: ${stats.duration_minutes.filled.toLocaleString()}`)
    console.log(`  ℹ️  Already filled: ${stats.duration_minutes.alreadyFilled.toLocaleString()}`)
    
    console.log('\nservice_variation_id:')
    console.log(`  ✅ Filled: ${stats.service_variation_id.filled.toLocaleString()}`)
    console.log(`  ℹ️  Already filled: ${stats.service_variation_id.alreadyFilled.toLocaleString()}`)
    console.log(`  ⚠️  Not found in DB: ${stats.service_variation_id.notFound.toLocaleString()}`)
    
    console.log('\nadministrator_id:')
    console.log(`  ✅ Filled: ${stats.administrator_id.filled.toLocaleString()}`)
    console.log(`  ℹ️  Already filled: ${stats.administrator_id.alreadyFilled.toLocaleString()}`)
    console.log(`  ⚠️  Not found in DB: ${stats.administrator_id.notFound.toLocaleString()}`)
    
    console.log('\ncustomer_note:')
    console.log(`  ✅ Filled: ${stats.customer_note.filled.toLocaleString()}`)
    console.log(`  ℹ️  Already filled: ${stats.customer_note.alreadyFilled.toLocaleString()}`)
    
    console.log('\nseller_note:')
    console.log(`  ✅ Filled: ${stats.seller_note.filled.toLocaleString()}`)
    console.log(`  ℹ️  Already filled: ${stats.seller_note.alreadyFilled.toLocaleString()}`)
    
    console.log('\naddress_line_1:')
    console.log(`  ✅ Filled: ${stats.address_line_1.filled.toLocaleString()}`)
    console.log(`  ℹ️  Already filled: ${stats.address_line_1.alreadyFilled.toLocaleString()}`)
    
    console.log('\n' + '='.repeat(80))
    console.log('✅ Backfill completed!\n')
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run if called directly
if (require.main === module) {
  backfillBookingFields()
    .then(() => {
      console.log('✅ Script completed successfully')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Script failed:', error)
      process.exit(1)
    })
}

module.exports = { backfillBookingFields }

