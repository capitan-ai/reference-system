#!/usr/bin/env node
/**
 * Backfill bookings for each customer
 * 
 * Fetches bookings from Square API for each customer in the database
 * and upserts them using the backfill system.
 * 
 * Usage:
 *   node scripts/backfill-bookings-by-customer.js
 *   node scripts/backfill-bookings-by-customer.js --location LT4ZHFBQQYB2N
 *   node scripts/backfill-bookings-by-customer.js --customer-id <id>
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const SquareBookingsBackfill = require('../lib/square-bookings-backfill')

const prisma = new PrismaClient()

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    locationId: null,
    customerId: null,
    limit: null // Limit number of customers to process
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    
    if (arg === '--location' || arg === '-l') {
      options.locationId = args[++i]
    } else if (arg === '--customer-id' || arg === '-c') {
      options.customerId = args[++i]
    } else if (arg === '--limit') {
      options.limit = parseInt(args[++i], 10)
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Backfill Bookings by Customer

Usage:
  node scripts/backfill-bookings-by-customer.js [options]

Options:
  --location, -l <id>        Filter by location ID
  --customer-id, -c <id>     Process specific customer only
  --limit <number>           Limit number of customers to process
  --help, -h                 Show this help

Examples:
  # Backfill for all customers
  node scripts/backfill-bookings-by-customer.js

  # Backfill for Union St location only
  node scripts/backfill-bookings-by-customer.js --location LT4ZHFBQQYB2N

  # Backfill for specific customer
  node scripts/backfill-bookings-by-customer.js --customer-id 6TAMED2WXPV705C5058ANHXHMG
`)
      process.exit(0)
    }
  }

  return options
}

async function fetchBookingsForCustomer(square, customerId, locationId = null) {
  const bookingsApi = square.bookingsApi
  const bookings = []
  let cursor = null
  let page = 0

  do {
    page++
    try {
      const response = await bookingsApi.listBookings(
        100, // limit
        cursor || undefined,
        customerId, // Filter by customer
        undefined, // teamMemberId
        locationId || undefined, // locationId (optional)
        undefined, // startAtMin (no date limit)
        undefined  // startAtMax (no date limit)
      )

      const result = response.result || {}
      const pageBookings = result.bookings || []
      bookings.push(...pageBookings)
      cursor = result.cursor || null

      if (pageBookings.length > 0) {
        console.log(`      Page ${page}: ${pageBookings.length} bookings`)
      }
    } catch (error) {
      if (error.statusCode === 400 && error.errors) {
        // Check if it's a date range error
        const dateError = error.errors.find(e => 
          e.detail && e.detail.includes('31 days')
        )
        if (dateError) {
          console.log(`      ⚠️  Date range too large, skipping customer (Square API limitation)`)
          break
        }
      }
      console.error(`      ❌ Error on page ${page}:`, error.message)
      break
    }

    // Small delay to avoid rate limiting
    if (cursor) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  } while (cursor)

  return bookings
}

async function main() {
  const options = parseArgs()

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

  console.log(`🔑 Using Square ${environment === Environment.Production ? 'Production' : 'Sandbox'} environment\n`)

  // Get customers to process
  let customers = []

  if (options.customerId) {
    // Single customer - try Customer table first, then check if they have bookings
    let customer = await prisma.customer.findUnique({
      where: { squareCustomerId: options.customerId },
      select: { id: true, squareCustomerId: true, firstName: true, lastName: true, email: true }
    })

      if (!customer) {
        // Customer not in Customer table - that's OK, we can still fetch their bookings
        // Create a stub customer object
        customer = {
          id: null,
          squareCustomerId: options.customerId,
          firstName: null,
          lastName: null,
          email: null
        }
        console.log(`   ℹ️  Customer not in Customer table, will fetch bookings directly from Square`)
      }

    customers = [customer]
    } else {
      // Get customers from bookings (more reliable than Customer table)
      let customerIds = []

      if (options.locationId) {
        // Get customers who have bookings at this location
        const locationBookings = await prisma.booking.findMany({
          where: { location_id: options.locationId, customer_id: { not: null } },
          select: { customer_id: true },
          distinct: ['customer_id']
        })
        
        customerIds = locationBookings.map(b => b.customer_id)
        console.log(`📍 Filtering by location: ${options.locationId}`)
        console.log(`   Found ${customerIds.length} customers with bookings at this location\n`)
      } else {
        // Get all unique customers from bookings
        const allBookings = await prisma.booking.findMany({
          where: { customer_id: { not: null } },
          select: { customer_id: true },
          distinct: ['customer_id']
        })
        customerIds = allBookings.map(b => b.customer_id)
        console.log(`📋 Found ${customerIds.length} unique customers from bookings\n`)
      }

      if (customerIds.length === 0) {
        console.log(`⚠️  No customers found`)
        process.exit(0)
      }

      // Limit if specified
      if (options.limit) {
        customerIds = customerIds.slice(0, options.limit)
      }

      // Get customer details from Customer table where available
      const customerDetails = await prisma.customer.findMany({
        where: { squareCustomerId: { in: customerIds } },
        select: { id: true, squareCustomerId: true, firstName: true, lastName: true, email: true }
      })

      // Create a map for quick lookup
      const customerMap = new Map()
      customerDetails.forEach(c => {
        customerMap.set(c.squareCustomerId, c)
      })

      // Build customer list (include all customer IDs, even if not in Customer table)
      customers = customerIds.map(customerId => {
        const customer = customerMap.get(customerId)
        return customer || {
          id: null,
          squareCustomerId: customerId,
          firstName: null,
          lastName: null,
          email: null
        }
      })
    }

  if (customers.length === 0) {
    console.log('❌ No customers found')
    process.exit(0)
  }

  console.log(`📋 Processing ${customers.length} customer(s)...\n`)

  // Initialize backfill for upserting
  const backfill = new SquareBookingsBackfill(prisma, square, options.locationId || 'ALL', {
    limit: 100,
    maxRetries: 3,
    initialRetryDelay: 1000,
    maxRetryDelay: 30000
  })

  const stats = {
    totalCustomers: customers.length,
    customersProcessed: 0,
    customersWithBookings: 0,
    totalBookingsFetched: 0,
    totalBookingsUpserted: 0,
    errors: 0
  }

  // Process each customer
  for (let i = 0; i < customers.length; i++) {
    const customer = customers[i]
    const customerName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.email || 'Unknown'
    
    console.log(`\n${i + 1}/${customers.length} 👤 Customer: ${customerName}`)
    console.log(`   ID: ${customer.squareCustomerId}`)

    try {
      // Fetch bookings for this customer
      const bookings = await fetchBookingsForCustomer(
        square,
        customer.squareCustomerId,
        options.locationId || null
      )

      if (bookings.length === 0) {
        console.log(`   ⚪ No bookings found`)
        stats.customersProcessed++
        continue
      }

      console.log(`   ✅ Found ${bookings.length} booking(s)`)

      // Upsert each booking
      let upserted = 0
      for (const booking of bookings) {
        const success = await backfill.upsertBooking(booking)
        if (success) {
          upserted++
        }
      }

      console.log(`   💾 Upserted ${upserted}/${bookings.length} booking(s)`)

      stats.customersProcessed++
      stats.customersWithBookings++
      stats.totalBookingsFetched += bookings.length
      stats.totalBookingsUpserted += upserted

      // Progress update every 10 customers
      if ((i + 1) % 10 === 0) {
        console.log(`\n📊 Progress: ${i + 1}/${customers.length} customers, ${stats.totalBookingsUpserted} bookings upserted`)
      }

    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`)
      stats.errors++
      stats.customersProcessed++
    }

    // Small delay between customers
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  // Summary
  console.log(`\n\n📊 Summary:`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`   Total customers: ${stats.totalCustomers}`)
  console.log(`   Customers processed: ${stats.customersProcessed}`)
  console.log(`   Customers with bookings: ${stats.customersWithBookings}`)
  console.log(`   Total bookings fetched: ${stats.totalBookingsFetched}`)
  console.log(`   Total bookings upserted: ${stats.totalBookingsUpserted}`)
  console.log(`   Errors: ${stats.errors}`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

  // Generate report by customer
  console.log(`\n📋 Bookings per customer:`)
  const customerBookings = await prisma.booking.groupBy({
    by: ['customer_id'],
    where: {
      ...(options.locationId ? { location_id: options.locationId } : {}),
      customer_id: { not: null }
    },
    _count: { id: true }
  })

  // Sort by count descending
  customerBookings.sort((a, b) => b._count.id - a._count.id)

  if (customerBookings.length > 0) {
    console.log(`\n   Top customers by booking count:`)
    for (let i = 0; i < Math.min(10, customerBookings.length); i++) {
      const item = customerBookings[i]
      if (!item.customer_id) continue
      
      const customer = await prisma.customer.findUnique({
        where: { squareCustomerId: item.customer_id },
        select: { firstName: true, lastName: true, email: true }
      }).catch(() => null)
      
      const name = customer 
        ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.email || 'Unknown'
        : `Customer ${item.customer_id.substring(0, 10)}...`
      console.log(`   ${i + 1}. ${name}: ${item._count.id} booking(s)`)
    }

    if (customerBookings.length > 10) {
      console.log(`   ... and ${customerBookings.length - 10} more`)
    }
  } else {
    console.log(`   ⚪ No customers with bookings found`)
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

