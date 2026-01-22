#!/usr/bin/env node
/**
 * Backfill bookings data from Square API
 * 
 * Fetches bookings from Square API and updates:
 * - merchant_id
 * - service_variation_id
 * - service_variation_version
 * - raw_json
 * 
 * Handles both single-service and multi-service bookings.
 * 
 * Usage:
 *   node scripts/backfill-bookings-from-api.js [limit] [offset]
 * 
 * Examples:
 *   node scripts/backfill-bookings-from-api.js 100 0
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

function getDate(value) {
  if (!value) return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Safely stringify JSON, handling BigInt values
 */
function safeStringify(obj) {
  return JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  )
}

/**
 * Update booking record with data from Square API
 */
async function updateBookingFromSquare(booking, merchantId) {
  const baseBookingId = booking.id
  if (!baseBookingId) return { skipped: true, reason: 'no_id' }
  
  const segments = booking.appointmentSegments || []
  
  // For multi-service bookings, we need to update each service record
  if (segments.length > 0) {
    let updated = 0
    for (const segment of segments) {
      const serviceVariationId = segment.serviceVariationId
      if (!serviceVariationId) continue
      
      // Booking ID format for multi-service: {baseId}-{serviceVariationId}
      const bookingId = `${baseBookingId}-${serviceVariationId}`
      
      try {
        const result = await prisma.$executeRaw`
          UPDATE bookings
          SET
            merchant_id = COALESCE(NULLIF(merchant_id, ''), ${merchantId}),
            service_variation_id = COALESCE(NULLIF(service_variation_id, ''), ${serviceVariationId}),
            service_variation_version = COALESCE(service_variation_version, ${segment.serviceVariationVersion ? BigInt(segment.serviceVariationVersion) : null}),
            raw_json = COALESCE(raw_json, ${safeStringify(booking)}::jsonb),
            updated_at = NOW()
          WHERE id = ${bookingId} OR id = ${baseBookingId} OR id LIKE ${`${baseBookingId}-%`}
        `
        if (result && result > 0) {
          updated++
        }
      } catch (error) {
        // Try to update by base ID pattern (id LIKE 'baseId-%')
        try {
          const result = await prisma.$executeRaw`
            UPDATE bookings
            SET
              merchant_id = COALESCE(merchant_id, ${merchantId}),
              service_variation_id = COALESCE(service_variation_id, ${serviceVariationId}),
              service_variation_version = COALESCE(service_variation_version, ${segment.serviceVariationVersion ? BigInt(segment.serviceVariationVersion) : null}),
              raw_json = COALESCE(raw_json, ${safeStringify(booking)}::jsonb),
              updated_at = NOW()
            WHERE id LIKE ${`${baseBookingId}-%`}
              AND service_variation_id = ${serviceVariationId}
              AND (
                merchant_id IS NULL 
                OR service_variation_id IS NULL 
                OR service_variation_version IS NULL
                OR raw_json IS NULL
              )
          `
          if (result && result > 0) {
            updated++
          }
        } catch (err) {
          // Silent fail - booking might not exist or already updated
        }
      }
    }
    
    // Also update base booking ID if it exists (for single-service bookings stored with base ID)
    try {
      const result = await prisma.$executeRaw`
        UPDATE bookings
        SET
          merchant_id = COALESCE(NULLIF(merchant_id, ''), ${merchantId}),
          raw_json = COALESCE(raw_json, ${safeStringify(booking)}::jsonb),
          updated_at = NOW()
        WHERE id = ${baseBookingId} OR id LIKE ${`${baseBookingId}-%`}
      `
      if (result && result > 0 && updated === 0) {
        // If we updated the base ID but no service-specific IDs, count it
        updated = 1
      }
    } catch (error) {
      // Silent fail
    }
    
    return { updated: updated > 0, count: updated }
  } else {
    // Single service booking or no segments
    try {
      const result = await prisma.$executeRaw`
        UPDATE bookings
        SET
          merchant_id = COALESCE(NULLIF(merchant_id, ''), ${merchantId}),
          raw_json = COALESCE(raw_json, ${safeStringify(booking)}::jsonb),
          updated_at = NOW()
        WHERE id = ${baseBookingId} OR id LIKE ${`${baseBookingId}-%`}
      `
      return { updated: (result && result > 0) || false, count: result || 0 }
    } catch (error) {
      return { updated: false, error: error.message }
    }
  }
}

/**
 * Fetch bookings from Square API and update database
 * Uses time windows to efficiently fetch all bookings
 */
async function backfillBookings() {
  console.log(`\n🔍 Fetching bookings from Square API to backfill missing data\n`)
  
  try {
    // Get merchant ID from environment or fetch it from Square API
    let merchantId = process.env.SQUARE_MERCHANT_ID || null
    
    if (!merchantId) {
      try {
        const merchantResponse = await square.merchantsApi.retrieveMerchant('me')
        merchantId = merchantResponse.result?.merchant?.id || null
        if (merchantId) {
          console.log(`✅ Retrieved merchant ID from Square API: ${merchantId}\n`)
        }
      } catch (error) {
        console.warn(`⚠️  Could not fetch merchant ID from Square API: ${error.message}`)
      }
    }
    
    // Get date range from existing bookings
    const dateRange = await prisma.$queryRaw`
      SELECT 
        MIN(created_at) as min_date,
        MAX(created_at) as max_date
      FROM bookings
      WHERE (
        merchant_id IS NULL 
        OR service_variation_id IS NULL 
        OR service_variation_version IS NULL
        OR raw_json IS NULL
      )
    `
    
    if (!dateRange || !dateRange[0] || !dateRange[0].min_date) {
      console.log('✅ No bookings found that need backfilling')
      return { updated: 0, skipped: 0, errors: 0 }
    }
    
    const minDate = new Date(dateRange[0].min_date)
    const maxDate = new Date(dateRange[0].max_date)
    
    console.log(`📅 Date range: ${minDate.toISOString()} to ${maxDate.toISOString()}\n`)
    
    // Get Square location IDs from locations table
    // bookings.location_id is a UUID that references locations.id (not square_location_id)
    const locations = await prisma.$queryRaw`
      SELECT DISTINCT l.square_location_id as location_id
      FROM bookings b
      INNER JOIN locations l ON b.location_id = l.id
      WHERE (
        b.merchant_id IS NULL 
        OR b.service_variation_id IS NULL 
        OR b.service_variation_version IS NULL
        OR b.raw_json IS NULL
      )
      AND l.square_location_id IS NOT NULL
    `
    
    console.log(`📍 Found ${locations.length} locations to process\n`)
    
    const WINDOW_DAYS = 30 // Square API limit
    let totalUpdated = 0
    let totalSkipped = 0
    let totalErrors = 0
    
    // Process each location
    for (const loc of locations) {
      const locationId = loc.location_id
      
      // Skip invalid location IDs (UUIDs or too long)
      if (!locationId || locationId.length > 32 || !locationId.startsWith('L')) {
        console.log(`   ⏭️  Skipping invalid location ID: ${locationId}`)
        continue
      }
      
      console.log(`📍 Processing location ${locationId}`)
      
      // Process forward in time, starting from minDate
      // Square API automatically sets end to 31 days after start if end is not provided
      // Per documentation: https://developer.squareup.com/reference/square/bookings-api/list-bookings
      let start = new Date(minDate)
      let locationUpdated = 0
      let windowNumber = 0
      const totalWindows = Math.ceil((maxDate - minDate) / (WINDOW_DAYS * 24 * 60 * 60 * 1000))
      
      console.log(`   Processing ${totalWindows} time windows from ${minDate.toISOString().substring(0, 10)} to ${maxDate.toISOString().substring(0, 10)}`)
      
      // Process in time windows going forward
      while (start <= maxDate) {
        windowNumber++
        const startStr = start.toISOString()
        // Don't set end - let Square API automatically use 31 days after start
        // This is more reliable per the API documentation
        
        let cursor = null
        let windowCount = 0
        let windowFetched = 0
        
        do {
          try {
            const response = await bookingsApi.listBookings(
              100,
              cursor || undefined,
              undefined, // customerId
              undefined, // teamMemberId
              locationId,
              startStr,
              undefined // Let API set end automatically (31 days after start)
            )
            
            const squareBookings = response.result?.bookings || []
            cursor = response.result?.cursor
            windowFetched += squareBookings.length
            
            for (const booking of squareBookings) {
              if (!merchantId && booking.merchantId) {
                merchantId = booking.merchantId
              }
              
              // Use merchantId from env, booking, or try to get from Square
              const finalMerchantId = merchantId || booking.merchantId || process.env.SQUARE_MERCHANT_ID || null
              
              const result = await updateBookingFromSquare(booking, finalMerchantId)
              if (result.updated) {
                locationUpdated += result.count || 1
                windowCount += result.count || 1
                if (windowCount % 10 === 0) {
                  console.log(`   ... ${windowCount} bookings updated so far in this window`)
                }
              } else if (!result.skipped) {
                totalSkipped++
              }
            }
            
            // Also try to fetch and update bookings from database that match this time window
            // This helps catch bookings that listBookings might miss
            if (squareBookings.length > 0 && squareBookings.length < 100) {
              // If we got fewer than 100 results, there might be more bookings in DB for this period
              try {
                const dbBookings = await prisma.$queryRaw`
                  SELECT DISTINCT
                    CASE 
                      WHEN id LIKE '%-%' THEN SPLIT_PART(id, '-', 1)
                      ELSE id
                    END as base_id
                  FROM bookings
                  WHERE location_id = ${locationId}
                    AND created_at >= ${startStr}::timestamptz
                    AND created_at < ${new Date(start.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()}::timestamptz
                    AND (merchant_id IS NULL OR service_variation_id IS NULL OR raw_json IS NULL)
                  LIMIT 50
                `
                
                const fetchedSquareIds = new Set(squareBookings.map(b => b.id))
                for (const dbBooking of dbBookings) {
                  const baseId = dbBooking.base_id
                  if (fetchedSquareIds.has(baseId)) continue // Already processed
                  
                  try {
                    const individualResponse = await bookingsApi.retrieveBooking(baseId)
                    const individualBooking = individualResponse.result?.booking
                    if (individualBooking) {
                      const result = await updateBookingFromSquare(individualBooking, merchantId || process.env.SQUARE_MERCHANT_ID || null)
                      if (result.updated) {
                        locationUpdated += result.count || 1
                        windowCount += result.count || 1
                      }
                      // Small delay to avoid rate limiting
                      await new Promise(resolve => setTimeout(resolve, 50))
                    }
                  } catch (error) {
                    // Skip bookings that can't be fetched (403, 404, etc.)
                  }
                }
              } catch (error) {
                // Continue if database query fails
              }
            }
          } catch (error) {
            console.error(`   ❌ Error fetching bookings: ${error.message}`)
            if (error.errors) {
              console.error(`   Square API errors:`, JSON.stringify(error.errors, null, 2))
            }
            totalErrors++
            break
          }
        } while (cursor)
        
        const windowEnd = new Date(start)
        windowEnd.setDate(windowEnd.getDate() + WINDOW_DAYS)
        if (windowCount > 0 || windowFetched > 0) {
          console.log(`   📊 [${windowNumber}/${totalWindows}] ${startStr.substring(0, 10)} - ${windowEnd.toISOString().substring(0, 10)}: ${windowFetched} fetched, ${windowCount} updated`)
        } else if (windowNumber % 10 === 0) {
          console.log(`   ⏳ [${windowNumber}/${totalWindows}] Processing ${startStr.substring(0, 10)}...`)
        }
        
        // Move window forward by 31 days (Square API's automatic window size)
        start = new Date(start)
        start.setDate(start.getDate() + WINDOW_DAYS)
        if (start > maxDate) break
      }
      
      totalUpdated += locationUpdated
      console.log(`   📊 Location ${locationId}: ${locationUpdated} bookings updated\n`)
    }
    
    console.log(`\n📊 Summary:`)
    console.log(`   ✅ Updated: ${totalUpdated}`)
    console.log(`   ⏭️  Skipped: ${totalSkipped}`)
    console.log(`   ❌ Errors: ${totalErrors}`)
    
    return { updated: totalUpdated, skipped: totalSkipped, errors: totalErrors }
    
  } catch (error) {
    console.error('❌ Fatal error:', error)
    throw error
  }
}

async function main() {
  console.log(`🔑 Using Square ${environment === Environment.Production ? 'Production' : 'Sandbox'} environment`)
  
  try {
    await backfillBookings()
    
    console.log(`\n✅ Backfill complete!`)
  } catch (error) {
    console.error('Fatal error:', error)
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

