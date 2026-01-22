#!/usr/bin/env node
/**
 * Backfill bookings data by fetching individual bookings from Square API
 * 
 * Fetches bookings one by one from Square API using their IDs from the database
 * and updates missing fields including technician_id.
 * 
 * Usage:
 *   node scripts/backfill-bookings-by-id.js [limit] [offset]
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

const envName = (process.env.SQUARE_ENV || 'production').toLowerCase()
const environment = envName === 'sandbox' ? Environment.Sandbox : Environment.Production
let token = process.env.SQUARE_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN_2
if (!token) {
  console.error('❌ Missing SQUARE_ACCESS_TOKEN')
  process.exit(1)
}
if (token.startsWith('Bearer ')) token = token.slice(7)

const square = new Client({ accessToken: token.trim(), environment })
const bookingsApi = square.bookingsApi

/**
 * Safely stringify JSON, handling BigInt values
 */
function safeStringify(obj) {
  return JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  )
}

/**
 * Get team member UUID from Square team member ID
 */
async function getTeamMemberUuid(squareTeamMemberId) {
  if (!squareTeamMemberId) return null
  
  try {
    const result = await prisma.$queryRawUnsafe(`
      SELECT id
      FROM team_members
      WHERE square_team_member_id = $1
      LIMIT 1
    `, squareTeamMemberId)
    
    return result && result.length > 0 ? result[0].id : null
  } catch (error) {
    console.warn(`   ⚠️  Could not find team member for Square ID ${squareTeamMemberId}: ${error.message}`)
    return null
  }
}

/**
 * Update booking record with data from Square API
 */
async function updateBookingFromSquare(bookingId, booking, merchantId) {
  const baseBookingId = booking.id
  if (!baseBookingId || baseBookingId !== bookingId.split('-')[0]) {
    return { skipped: true, reason: 'id_mismatch' }
  }
  
  const segments = booking.appointmentSegments || []
  
  // For multi-service bookings, use the first segment's technician (most bookings have same tech for all services)
  if (segments.length > 0) {
    // Get technician from first segment
    const firstSegment = segments[0]
    const squareTeamMemberId = firstSegment.teamMemberId || firstSegment.team_member_id || null
    const technicianId = squareTeamMemberId ? await getTeamMemberUuid(squareTeamMemberId) : null
    const anyTeamMember = firstSegment.anyTeamMember ?? firstSegment.any_team_member ?? false
    const serviceVariationId = firstSegment.serviceVariationId && firstSegment.serviceVariationId.trim() !== '' ? firstSegment.serviceVariationId : null
    
      // Remove debug logging - too verbose
    
    try {
      // Simple update - just technician_id for now
      if (!technicianId) {
        return { updated: false, count: 0 }
      }
      
      const result = await prisma.$executeRawUnsafe(`
        UPDATE bookings
        SET technician_id = $1::uuid, updated_at = NOW()
        WHERE booking_id = $2 AND technician_id IS NULL
      `, technicianId, baseBookingId)
      return { updated: (result && result > 0) || false, count: result || 0 }
    } catch (error) {
      return { updated: false, error: error.message }
    }
    
    // Also update base booking ID if it exists
    try {
      await prisma.$executeRawUnsafe(`
        UPDATE bookings
        SET
          merchant_id = COALESCE(NULLIF(merchant_id, ''), $1),
          raw_json = COALESCE(raw_json, $2::jsonb),
          updated_at = NOW()
        WHERE booking_id = $3
          AND (
            (merchant_id IS NULL OR merchant_id = '')
            OR raw_json IS NULL
          )
      `, merchantId || null, safeStringify(booking), baseBookingId)
    } catch (error) {
      // Silent fail
    }
    
    return { updated: updated > 0, count: updated }
  } else {
    // Single service booking or no segments
    // Try to get technician_id from first segment if available, or from booking directly
    const squareTeamMemberId = segments.length > 0 
      ? (segments[0].teamMemberId || segments[0].team_member_id || null)
      : null
    const technicianId = squareTeamMemberId ? await getTeamMemberUuid(squareTeamMemberId) : null
    const anyTeamMember = segments.length > 0
      ? (segments[0].anyTeamMember ?? segments[0].any_team_member ?? false)
      : false
    
    // Simple update - just technician_id
    if (!technicianId) {
      return { updated: false, count: 0 }
    }
    
    try {
      const result = await prisma.$executeRawUnsafe(`
        UPDATE bookings
        SET technician_id = $1::uuid, updated_at = NOW()
        WHERE booking_id = $2 AND technician_id IS NULL
      `, technicianId, baseBookingId)
      return { updated: (result && result > 0) || false, count: result || 0 }
    } catch (error) {
      return { updated: false, error: error.message }
    }
  }
}

/**
 * Process a single batch of bookings
 */
async function processBatch(limit, offset, merchantId) {
  // Get unique base booking IDs that need updating (including technician_id)
  // Note: Using booking_id (actual DB column name) instead of id (Prisma model field)
  // Focus on technician_id IS NULL since that's the main goal
  const bookingsToUpdate = await prisma.$queryRawUnsafe(`
    SELECT 
      CASE 
        WHEN booking_id LIKE '%-%' THEN SPLIT_PART(booking_id, '-', 1)
        ELSE booking_id
      END as base_id,
      booking_id as original_id,
      created_at
    FROM bookings
    WHERE technician_id IS NULL
    ORDER BY created_at ASC
    LIMIT $1
    OFFSET $2
  `, limit, offset)
  
  // Get unique base IDs
  const uniqueBaseIds = [...new Set(bookingsToUpdate.map(b => b.base_id))]
  
  if (!bookingsToUpdate || bookingsToUpdate.length === 0) {
    return { done: true, updated: 0, skipped: 0, errors: 0, technicianUpdated: 0 }
  }
  
  // Debug: log first few bookings
  if (offset === 0 && bookingsToUpdate.length > 0) {
    console.log(`   📋 Sample booking IDs: ${bookingsToUpdate.slice(0, 3).map(b => b.original_id).join(', ')}`)
  }
  
  let batchUpdated = 0
  let batchSkipped = 0
  let batchErrors = 0
  let batchTechnicianUpdated = 0
  
  // Process bookings in parallel batches for speed (10 at a time to avoid rate limits)
  const parallelBatchSize = 10
  for (let i = 0; i < uniqueBaseIds.length; i += parallelBatchSize) {
    const batch = uniqueBaseIds.slice(i, i + parallelBatchSize)
    
    // Process batch in parallel with retry logic for rate limits
    const results = await Promise.allSettled(
      batch.map(async (baseId) => {
        let retries = 3
        let lastError = null
        
        while (retries > 0) {
          try {
            const response = await bookingsApi.retrieveBooking(baseId)
            const booking = response.result?.booking
          
          if (!booking) {
            return { skipped: true, baseId }
          }
          
          // Debug: log first booking details
          if (offset === 0 && i === 0 && batch.indexOf(baseId) === 0) {
            console.log(`   🔍 Sample booking from Square: id=${booking.id}, segments=${booking.appointmentSegments?.length || 0}`)
            if (booking.appointmentSegments && booking.appointmentSegments.length > 0) {
              console.log(`   🔍 First segment tech: ${booking.appointmentSegments[0].teamMemberId || 'NULL'}`)
            }
          }
          
          // Extract segments and check for technician IDs
          const segments = booking.appointmentSegments || []
          
          // Update all related booking records
          const relatedBookings = bookingsToUpdate.filter(b => b.base_id === baseId)
          let updated = 0
          let technicianUpdated = 0
          
          for (const dbBooking of relatedBookings) {
            const finalMerchantId = merchantId || booking.merchantId || null
            const result = await updateBookingFromSquare(dbBooking.original_id, booking, finalMerchantId)
            
            if (result.updated) {
              updated += result.count || 1
              
              // Check if this booking has a technician_id
              let hasTechnician = false
              if (segments.length > 0) {
                if (dbBooking.original_id.includes('-')) {
                  const serviceVariationId = dbBooking.original_id.split('-')[1]
                  const matchingSegment = segments.find(s => 
                    (s.serviceVariationId || s.service_variation_id) === serviceVariationId
                  )
                  hasTechnician = !!(matchingSegment && (matchingSegment.teamMemberId || matchingSegment.team_member_id))
                } else {
                  hasTechnician = !!(segments[0] && (segments[0].teamMemberId || segments[0].team_member_id))
                }
              }
              
              if (hasTechnician) {
                technicianUpdated++
              }
            }
          }
          
            return { updated, technicianUpdated, baseId }
          } catch (error) {
            if (error.statusCode === 403 || (error.errors && error.errors.some(e => e.code === 'FORBIDDEN'))) {
              return { skipped: true, baseId }
            }
            
            // Handle rate limiting (429) with retry
            if (error.statusCode === 429) {
              lastError = error
              retries--
              if (retries > 0) {
                // Exponential backoff: wait 1s, 2s, 4s
                const waitTime = Math.pow(2, 3 - retries) * 1000
                await new Promise(resolve => setTimeout(resolve, waitTime))
                continue
              }
            }
            
            throw error
          }
        }
        
        // If we exhausted retries, return skipped
        if (lastError && lastError.statusCode === 429) {
          return { skipped: true, baseId, rateLimited: true }
        }
        throw lastError || new Error('Unknown error')
      })
    )
    
    // Process results
    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value.skipped) {
          batchSkipped++
        } else {
          batchUpdated += result.value.updated || 0
          batchTechnicianUpdated += result.value.technicianUpdated || 0
        }
      } else {
        batchErrors++
        if (batchErrors <= 5) {
          console.error(`   ❌ Error: ${result.reason.message}`)
        }
      }
    }
    
    // Progress update
    if (batchTechnicianUpdated > 0 && batchTechnicianUpdated % 50 === 0) {
      console.log(`   ✅ Updated ${batchTechnicianUpdated} bookings with technician_id...`)
    }
    
    // Delay between parallel batches to avoid rate limits (200ms per batch of 10)
    if (i + parallelBatchSize < uniqueBaseIds.length) {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }
  
  return {
    done: false,
    updated: batchUpdated,
    skipped: batchSkipped,
    errors: batchErrors,
    technicianUpdated: batchTechnicianUpdated
  }
}

async function main() {
  const limit = parseInt(process.argv[2] || '100', 10)
  const batchSize = limit
  
  console.log(`🔑 Using Square ${environment === Environment.Production ? 'Production' : 'Sandbox'} environment`)
  console.log(`\n🚀 Starting continuous backfill of all bookings...`)
  console.log(`   Batch size: ${batchSize}\n`)
  
  try {
    const merchantId = process.env.SQUARE_MERCHANT_ID || null
    
    let offset = 0
    let totalUpdated = 0
    let totalSkipped = 0
    let totalErrors = 0
    let totalTechnicianUpdated = 0
    let batchNumber = 0
    let consecutiveEmptyBatches = 0
    
    // Process batches continuously until done
    while (true) {
      batchNumber++
      console.log(`\n📦 Processing batch ${batchNumber} (offset: ${offset})...`)
      
      const result = await processBatch(batchSize, offset, merchantId)
      
      totalUpdated += result.updated
      totalSkipped += result.skipped
      totalErrors += result.errors
      totalTechnicianUpdated += result.technicianUpdated
      
      console.log(`   Batch ${batchNumber} complete: ${result.updated} updated, ${result.technicianUpdated} technician IDs filled`)
      
      if (result.done || (result.updated === 0 && result.technicianUpdated === 0)) {
        consecutiveEmptyBatches++
        if (consecutiveEmptyBatches >= 3) {
          console.log(`\n✅ No more bookings to process (${consecutiveEmptyBatches} consecutive empty batches)`)
          break
        }
      } else {
        consecutiveEmptyBatches = 0
      }
      
      if (result.done) {
        console.log(`\n✅ All bookings processed!`)
        break
      }
      
      offset += batchSize
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    console.log(`\n📊 Final Summary:`)
    console.log(`   ✅ Total Updated: ${totalUpdated}`)
    console.log(`   👤 Total Technician IDs filled: ${totalTechnicianUpdated}`)
    console.log(`   ⏭️  Total Skipped: ${totalSkipped}`)
    console.log(`   ❌ Total Errors: ${totalErrors}`)
    console.log(`   📦 Batches Processed: ${batchNumber}`)
    
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

