#!/usr/bin/env node
/**
 * Get all bookings for a specific customer from Square API
 * 
 * Usage:
 *   node scripts/get-customer-bookings.js DERWBBRTJ2SVSDYKCW2Q5B0654
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

const customerId = process.argv[2]

if (!customerId) {
  console.error('❌ Please provide a customer ID')
  console.error('   Usage: node scripts/get-customer-bookings.js <customer-id>')
  process.exit(1)
}

async function main() {
  console.log(`🔍 Fetching bookings for customer: ${customerId}\n`)

  // Initialize Square
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

  // Check database first
  const dbBookings = await prisma.booking.findMany({
    where: { customer_id: customerId },
    select: { id: true, start_at: true, status: true, location_id: true },
    orderBy: { start_at: 'desc' }
  })

  console.log(`📊 Database: ${dbBookings.length} booking(s) found\n`)

  // Fetch from Square API
  console.log(`📡 Fetching from Square API...\n`)

  const allBookings = []
  let cursor = null
  let page = 0

  do {
    page++
    try {
      const response = await bookingsApi.listBookings(
        100,
        cursor || undefined,
        customerId, // Filter by customer
        undefined, // teamMemberId
        undefined, // locationId (all locations)
        undefined, // startAtMin (no date limit)
        undefined  // startAtMax (no date limit)
      )

      const result = response.result || {}
      const bookings = result.bookings || []
      allBookings.push(...bookings)
      cursor = result.cursor || null

      if (bookings.length > 0) {
        console.log(`   Page ${page}: ${bookings.length} booking(s)`)
      }
    } catch (error) {
      console.error(`   ❌ Error on page ${page}:`, error.message)
      if (error.statusCode === 400 && error.errors) {
        const dateError = error.errors.find(e => e.detail && e.detail.includes('31 days'))
        if (dateError) {
          console.log(`   ⚠️  Square API requires date filters (31-day limit)`)
          console.log(`   💡 Trying with date ranges...`)
          
          // Try fetching in date ranges
          const now = new Date()
          const ranges = []
          for (let i = 0; i < 12; i++) {
            const end = new Date(now)
            end.setMonth(end.getMonth() - i)
            const start = new Date(end)
            start.setMonth(start.getMonth() - 1)
            ranges.push({ start, end })
          }

          for (const range of ranges) {
            try {
              const rangeResponse = await bookingsApi.listBookings(
                100,
                undefined,
                customerId,
                undefined,
                undefined,
                range.start.toISOString(),
                range.end.toISOString()
              )
              const rangeBookings = rangeResponse.result?.bookings || []
              allBookings.push(...rangeBookings)
              if (rangeBookings.length > 0) {
                console.log(`   Found ${rangeBookings.length} booking(s) in ${range.start.toISOString().split('T')[0]} to ${range.end.toISOString().split('T')[0]}`)
              }
            } catch (rangeError) {
              // Ignore range errors
            }
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        }
      }
      break
    }

    if (cursor) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  } while (cursor)

  // Remove duplicates
  const uniqueBookings = Array.from(
    new Map(allBookings.map(b => [b.id, b])).values()
  )

  console.log(`\n✅ Square API: ${uniqueBookings.length} unique booking(s) found\n`)

  if (uniqueBookings.length > 0) {
    console.log(`📋 Bookings from Square API:\n`)
    uniqueBookings
      .sort((a, b) => new Date(a.startAt || 0) - new Date(b.startAt || 0))
      .forEach((booking, idx) => {
        const startDate = booking.startAt ? new Date(booking.startAt).toISOString().split('T')[0] : 'N/A'
        console.log(`   ${idx + 1}. ID: ${booking.id}`)
        console.log(`      Start: ${startDate}`)
        console.log(`      Status: ${booking.status || 'N/A'}`)
        console.log(`      Location: ${booking.locationId || 'N/A'}`)
        console.log(`      Version: ${booking.version || 'N/A'}`)
        if (booking.appointmentSegments && booking.appointmentSegments.length > 0) {
          console.log(`      Services: ${booking.appointmentSegments.length} segment(s)`)
        }
        console.log()
      })

    // Summary by location
    const byLocation = {}
    uniqueBookings.forEach(b => {
      const loc = b.locationId || 'Unknown'
      byLocation[loc] = (byLocation[loc] || 0) + 1
    })

    console.log(`📊 Summary by location:`)
    Object.entries(byLocation).forEach(([loc, count]) => {
      console.log(`   ${loc}: ${count} booking(s)`)
    })

    // Summary by status
    const byStatus = {}
    uniqueBookings.forEach(b => {
      const status = b.status || 'Unknown'
      byStatus[status] = (byStatus[status] || 0) + 1
    })

    console.log(`\n📊 Summary by status:`)
    Object.entries(byStatus).forEach(([status, count]) => {
      console.log(`   ${status}: ${count} booking(s)`)
    })

    // Date range
    const dates = uniqueBookings
      .map(b => b.startAt ? new Date(b.startAt) : null)
      .filter(d => d !== null)
      .sort((a, b) => a - b)

    if (dates.length > 0) {
      console.log(`\n📅 Date range:`)
      console.log(`   Earliest: ${dates[0].toISOString().split('T')[0]}`)
      console.log(`   Latest: ${dates[dates.length - 1].toISOString().split('T')[0]}`)
    }
  } else {
    console.log(`⚠️  No bookings found in Square API for this customer`)
  }

  // Compare with database
  console.log(`\n📊 Comparison:`)
  console.log(`   Database: ${dbBookings.length} booking(s)`)
  console.log(`   Square API: ${uniqueBookings.length} booking(s)`)
  
  if (dbBookings.length !== uniqueBookings.length) {
    console.log(`   ⚠️  Count mismatch!`)
    
    const dbIds = new Set(dbBookings.map(b => b.id))
    const squareIds = new Set(uniqueBookings.map(b => b.id))
    
    const missingInDb = uniqueBookings.filter(b => !dbIds.has(b.id))
    const missingInSquare = dbBookings.filter(b => !squareIds.has(b.id))
    
    if (missingInDb.length > 0) {
      console.log(`\n   Bookings in Square but not in database: ${missingInDb.length}`)
      missingInDb.slice(0, 5).forEach(b => {
        console.log(`     - ${b.id} (${b.startAt ? new Date(b.startAt).toISOString().split('T')[0] : 'N/A'})`)
      })
    }
    
    if (missingInSquare.length > 0) {
      console.log(`\n   Bookings in database but not in Square: ${missingInSquare.length}`)
      missingInSquare.slice(0, 5).forEach(b => {
        console.log(`     - ${b.id} (${b.start_at.toISOString().split('T')[0]})`)
      })
    }
  } else {
    console.log(`   ✅ Counts match!`)
  }
}

main()
  .catch((err) => {
    console.error('\n❌ Error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

