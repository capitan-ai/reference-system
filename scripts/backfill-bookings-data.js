#!/usr/bin/env node
/**
 * Backfill missing data for bookings table:
 * - merchant_id
 * - service_variation_id
 * - service_variation_version
 * 
 * Extracts data from raw_json field which contains the full booking object from Square.
 * 
 * Usage:
 *   node scripts/backfill-bookings-data.js [limit] [offset]
 * 
 * Examples:
 *   node scripts/backfill-bookings-data.js 100 0    # Process 100 bookings starting from offset 0
 *   node scripts/backfill-bookings-data.js          # Process 100 bookings (default)
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

/**
 * Extract merchant_id from raw_json
 * Can be at top level (merchantId, merchant_id) or in webhook event structure
 */
function extractMerchantId(rawJson) {
  if (!rawJson) return null
  
  // Try direct fields (booking object from Square API)
  if (rawJson.merchantId) return rawJson.merchantId
  if (rawJson.merchant_id) return rawJson.merchant_id
  
  return null
}

/**
 * Extract service_variation_id and service_variation_version from raw_json
 * These can be in appointment_segments array
 */
function extractServiceVariationData(rawJson, bookingId) {
  if (!rawJson) return { serviceVariationId: null, serviceVariationVersion: null }
  
  // Check if this is a multi-service booking (ID contains service variation)
  // Format: {baseBookingId}-{serviceVariationId}
  const parts = bookingId.split('-')
  if (parts.length > 1) {
    // This is a multi-service booking, extract from ID
    const serviceVariationId = parts.slice(1).join('-')
    
    // Try to find the version from segments
    const segments = rawJson.appointment_segments || rawJson.appointmentSegments || []
    const matchingSegment = segments.find(
      seg => (seg.service_variation_id || seg.serviceVariationId) === serviceVariationId
    )
    
    const version = matchingSegment 
      ? (matchingSegment.service_variation_version || matchingSegment.serviceVariationVersion)
      : null
    
    return {
      serviceVariationId,
      serviceVariationVersion: version ? BigInt(version) : null
    }
  }
  
  // Single service booking - get from first segment
  const segments = rawJson.appointment_segments || rawJson.appointmentSegments || []
  if (segments.length > 0) {
    const firstSegment = segments[0]
    const serviceVariationId = firstSegment.service_variation_id || firstSegment.serviceVariationId || null
    const version = firstSegment.service_variation_version || firstSegment.serviceVariationVersion || null
    
    return {
      serviceVariationId,
      serviceVariationVersion: version ? BigInt(version) : null
    }
  }
  
  return { serviceVariationId: null, serviceVariationVersion: null }
}

async function backfillBooking(booking) {
  const { id, raw_json } = booking
  
  if (!raw_json) {
    console.log(`⚠️  Booking ${id} has no raw_json, skipping`)
    return { skipped: true, reason: 'no_raw_json' }
  }
  
  let rawJson
  try {
    rawJson = typeof raw_json === 'string' ? JSON.parse(raw_json) : raw_json
  } catch (error) {
    console.error(`❌ Error parsing raw_json for booking ${id}:`, error.message)
    return { skipped: true, reason: 'parse_error' }
  }
  
  const merchantId = extractMerchantId(rawJson)
  const { serviceVariationId, serviceVariationVersion } = extractServiceVariationData(rawJson, id)
  
  // Check if we have anything to update
  const needsMerchantId = !booking.merchant_id && merchantId
  const needsServiceVariationId = !booking.service_variation_id && serviceVariationId
  const needsServiceVariationVersion = !booking.service_variation_version && serviceVariationVersion
  
  if (!needsMerchantId && !needsServiceVariationId && !needsServiceVariationVersion) {
    return { skipped: true, reason: 'no_updates_needed' }
  }
  
  // Build update query using Prisma's template literal syntax
  try {
    if (needsMerchantId && needsServiceVariationId && needsServiceVariationVersion) {
      await prisma.$executeRaw`
        UPDATE bookings
        SET 
          merchant_id = ${merchantId},
          service_variation_id = ${serviceVariationId},
          service_variation_version = ${serviceVariationVersion}
        WHERE id = ${id}
      `
    } else if (needsMerchantId && needsServiceVariationId) {
      await prisma.$executeRaw`
        UPDATE bookings
        SET 
          merchant_id = ${merchantId},
          service_variation_id = ${serviceVariationId}
        WHERE id = ${id}
      `
    } else if (needsMerchantId && needsServiceVariationVersion) {
      await prisma.$executeRaw`
        UPDATE bookings
        SET 
          merchant_id = ${merchantId},
          service_variation_version = ${serviceVariationVersion}
        WHERE id = ${id}
      `
    } else if (needsServiceVariationId && needsServiceVariationVersion) {
      await prisma.$executeRaw`
        UPDATE bookings
        SET 
          service_variation_id = ${serviceVariationId},
          service_variation_version = ${serviceVariationVersion}
        WHERE id = ${id}
      `
    } else if (needsMerchantId) {
      await prisma.$executeRaw`
        UPDATE bookings
        SET merchant_id = ${merchantId}
        WHERE id = ${id}
      `
    } else if (needsServiceVariationId) {
      await prisma.$executeRaw`
        UPDATE bookings
        SET service_variation_id = ${serviceVariationId}
        WHERE id = ${id}
      `
    } else if (needsServiceVariationVersion) {
      await prisma.$executeRaw`
        UPDATE bookings
        SET service_variation_version = ${serviceVariationVersion}
        WHERE id = ${id}
      `
    }
    
    const updatedFields = []
    if (needsMerchantId) updatedFields.push('merchant_id')
    if (needsServiceVariationId) updatedFields.push('service_variation_id')
    if (needsServiceVariationVersion) updatedFields.push('service_variation_version')
    
    console.log(`✅ Updated booking ${id}: ${updatedFields.join(', ')}`)
    return { updated: true, fields: updatedFields }
  } catch (error) {
    console.error(`❌ Error updating booking ${id}:`, error.message)
    return { skipped: true, reason: 'update_error', error: error.message }
  }
}

async function main() {
  const limit = parseInt(process.argv[2] || '100', 10)
  const offset = parseInt(process.argv[3] || '0', 10)
  
  console.log(`\n🔍 Backfilling bookings data (limit: ${limit}, offset: ${offset})`)
  console.log(`   Looking for bookings with missing merchant_id, service_variation_id, or service_variation_version\n`)
  
  try {
    // Find bookings that need backfilling
    const bookings = await prisma.$queryRaw`
      SELECT 
        id,
        merchant_id,
        service_variation_id,
        service_variation_version,
        raw_json
      FROM bookings
      WHERE (
        merchant_id IS NULL 
        OR service_variation_id IS NULL 
        OR service_variation_version IS NULL
      )
      AND raw_json IS NOT NULL
      ORDER BY created_at ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `
    
    if (!bookings || bookings.length === 0) {
      console.log('✅ No bookings found that need backfilling')
      return
    }
    
    console.log(`📊 Found ${bookings.length} bookings to process\n`)
    
    let updated = 0
    let skipped = 0
    let errors = 0
    
    for (const booking of bookings) {
      const result = await backfillBooking(booking)
      
      if (result.updated) {
        updated++
      } else if (result.skipped) {
        skipped++
        if (result.reason !== 'no_updates_needed') {
          console.log(`   ⏭️  Skipped: ${result.reason}`)
        }
      } else {
        errors++
      }
    }
    
    console.log(`\n📊 Summary:`)
    console.log(`   ✅ Updated: ${updated}`)
    console.log(`   ⏭️  Skipped: ${skipped}`)
    console.log(`   ❌ Errors: ${errors}`)
    console.log(`   📦 Total processed: ${bookings.length}`)
    
    if (updated > 0) {
      console.log(`\n💡 Tip: Run again to process more bookings (use offset ${offset + limit})`)
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error)
    process.exit(1)
  }
}

main()
  .catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

