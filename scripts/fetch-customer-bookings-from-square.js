#!/usr/bin/env node
/**
 * Fetch all bookings for a specific customer from Square API
 * 
 * Usage:
 *   node scripts/fetch-customer-bookings-from-square.js DERWBBRTJ2SVSDYKCW2Q5B0654
 *   node scripts/fetch-customer-bookings-from-square.js DERWBBRTJ2SVSDYKCW2Q5B0654 --location LT4ZHFBQQYB2N
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

async function main() {
  const customerId = process.argv[2]
  const locationId = process.argv.find(arg => arg.startsWith('--location') || arg.startsWith('-l'))?.split('=')[1] || 
                     process.argv[process.argv.indexOf('--location') + 1] ||
                     process.argv[process.argv.indexOf('-l') + 1] ||
                     null

  if (!customerId) {
    console.error('❌ Please provide a customer ID')
    console.error('   Usage: node scripts/fetch-customer-bookings-from-square.js <customer-id> [--location <location-id>]')
    process.exit(1)
  }

  console.log(`🔍 Fetching bookings for customer: ${customerId}\n`)

  // Check customer in square_existing_clients
  const customer = await prisma.$queryRaw`
    SELECT square_customer_id, given_name, family_name, email_address, phone_number
    FROM square_existing_clients
    WHERE square_customer_id = ${customerId}
  `

  if (customer && customer.length > 0) {
    const c = customer[0]
    console.log(`✅ Customer found in square_existing_clients:`)
    console.log(`   Name: ${c.given_name || ''} ${c.family_name || ''}`.trim() || 'N/A')
    console.log(`   Email: ${c.email_address || 'N/A'}`)
    console.log(`   Phone: ${c.phone_number || 'N/A'}\n`)
  } else {
    console.log(`⚠️  Customer not found in square_existing_clients table`)
    console.log(`   Will fetch bookings directly from Square API\n`)
  }

  // Initialize Square client
  const envName = (process.env.SQUARE_ENV || 'production').toLowerCase()
  const environment = envName === 'sandbox' ? Environment.Sandbox : Environment.Production
  let token = process.env.SQUARE_ACCESS_TOKEN_2 || process.env.SQUARE_ACCESS_TOKEN
  
  if (!token) {
    console.error('❌ Missing SQUARE_ACCESS_TOKEN(_2)')
    process.exit(1)
  }
  
  if (token.startsWith('Bearer ')) {
    token = token.slice(7)
  }

  const square = new Client({
    accessToken: token.trim(),
    environment
  })

  const bookingsApi = square.bookingsApi

  console.log(`📡 Fetching bookings from Square API...`)
  if (locationId) {
    console.log(`   Location filter: ${locationId}\n`)
  } else {
    console.log(`   All locations\n`)
  }

  const allBookings = []
  let cursor = null
  let page = 0
  let hasMore = true

  // Square API REQUIRES start_at_range in every request
  // We'll fetch in 30-day windows going back from now
  console.log(`\n📋 Fetching bookings in 30-day windows (Square API requirement)...\n`)
  
  const now = new Date()
  let endDate = new Date(now)
  let startDate = new Date(now)
  startDate.setDate(startDate.getDate() - 30) // 30-day window
  let yearCount = 0
  const maxYears = 10 // Go back up to 10 years
  
  while (yearCount < maxYears) {
    const startStr = startDate.toISOString()
    const endStr = endDate.toISOString()
    
    console.log(`   Window ${yearCount + 1}: ${startStr.split('T')[0]} to ${endStr.split('T')[0]}`)
    
    try {
      let windowCursor = null
      let windowPage = 0
      let windowBookings = 0
      
      do {
        windowPage++
        const response = await bookingsApi.listBookings(
          100,
          windowCursor || undefined,
          customerId,
          undefined,
          locationId || undefined,
          startStr, // startAtMin - REQUIRED
          endStr    // startAtMax - REQUIRED
        )
        
        const result = response.result || {}
        const bookings = result.bookings || []
        windowCursor = result.cursor || null
        
        allBookings.push(...bookings)
        windowBookings += bookings.length
        
        if (bookings.length > 0) {
          console.log(`      Page ${windowPage}: ${bookings.length} bookings`)
        }
      } while (windowCursor)
      
      if (windowBookings > 0) {
        console.log(`      ✅ Total: ${windowBookings} bookings in this window`)
      }
      
      // Move window back
      endDate = new Date(startDate)
      endDate.setDate(endDate.getDate() - 1)
      startDate = new Date(endDate)
      startDate.setDate(startDate.getDate() - 30)
      
      yearCount++
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200))
    } catch (error) {
      console.log(`   ❌ Error in date range ${startStr} to ${endStr}: ${error.message}`)
      if (error.statusCode === 400 && error.errors) {
        const dateError = error.errors.find(e => e.detail && e.detail.includes('31 days'))
        if (dateError) {
          console.log(`   ⚠️  Date range too large, stopping`)
          break
        }
      }
      // Continue to next window
      endDate = new Date(startDate)
      endDate.setDate(endDate.getDate() - 1)
      startDate = new Date(endDate)
      startDate.setDate(startDate.getDate() - 30)
      yearCount++
    }
  }

  // Remove duplicates (by booking ID)
  const uniqueBookings = []
  const seenIds = new Set()
  
  for (const booking of allBookings) {
    if (booking.id && !seenIds.has(booking.id)) {
      seenIds.add(booking.id)
      uniqueBookings.push(booking)
    }
  }

  console.log(`\n✅ Results:`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`   Total bookings found: ${uniqueBookings.length}`)
  
  if (uniqueBookings.length > 0) {
    // Group by location
    const byLocation = {}
    uniqueBookings.forEach(booking => {
      const loc = booking.locationId || 'UNKNOWN'
      byLocation[loc] = (byLocation[loc] || 0) + 1
    })
    
    console.log(`\n   By location:`)
    Object.entries(byLocation).forEach(([loc, count]) => {
      console.log(`     ${loc}: ${count} booking(s)`)
    })
    
    // Group by status
    const byStatus = {}
    uniqueBookings.forEach(booking => {
      const status = booking.status || 'UNKNOWN'
      byStatus[status] = (byStatus[status] || 0) + 1
    })
    
    console.log(`\n   By status:`)
    Object.entries(byStatus).forEach(([status, count]) => {
      console.log(`     ${status}: ${count} booking(s)`)
    })
    
    // Date range
    const dates = uniqueBookings
      .map(b => b.startAt ? new Date(b.startAt) : null)
      .filter(d => d !== null)
      .sort((a, b) => a - b)
    
    if (dates.length > 0) {
      console.log(`\n   Date range:`)
      console.log(`     Earliest: ${dates[0].toISOString().split('T')[0]}`)
      console.log(`     Latest: ${dates[dates.length - 1].toISOString().split('T')[0]}`)
    }
    
    // Show sample bookings
    console.log(`\n   Sample bookings (first 10):`)
    uniqueBookings.slice(0, 10).forEach((booking, idx) => {
      const date = booking.startAt ? new Date(booking.startAt).toISOString().split('T')[0] : 'N/A'
      console.log(`     ${idx + 1}. ${booking.id.substring(0, 15)}... - ${date} - ${booking.status} - Location: ${booking.locationId || 'N/A'}`)
    })
    
    if (uniqueBookings.length > 10) {
      console.log(`     ... and ${uniqueBookings.length - 10} more`)
    }
  } else {
    console.log(`\n   ⚪ No bookings found for this customer in Square API`)
    console.log(`\n   💡 Possible reasons:`)
    console.log(`      - Customer has no bookings`)
    console.log(`      - Bookings are outside the date range we checked`)
    console.log(`      - Bookings might be in a different location`)
    console.log(`      - Square API limitations`)
  }

  // Check database for comparison
  const dbBookings = await prisma.booking.findMany({
    where: {
      customer_id: customerId,
      ...(locationId ? { location_id: locationId } : {})
    },
    select: { id: true, start_at: true, status: true, location_id: true }
  })

  console.log(`\n📊 Database comparison:`)
  console.log(`   Bookings in database: ${dbBookings.length}`)
  console.log(`   Bookings in Square API: ${uniqueBookings.length}`)
  
  if (dbBookings.length !== uniqueBookings.length) {
    console.log(`   ⚠️  Count mismatch: ${Math.abs(dbBookings.length - uniqueBookings.length)} difference`)
  } else if (dbBookings.length > 0) {
    console.log(`   ✅ Counts match!`)
  }
}

main()
  .catch((err) => {
    console.error('\n❌ Fatal error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

