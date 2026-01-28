#!/usr/bin/env node

/**
 * Find missing payments by comparing Square API with database
 * Fetches payments WITHOUT location filter to find any we might be missing
 */

const path = require('path')
const fs = require('fs')

try {
  const dotenvPath = process.env.DOTENV_PATH || path.resolve(process.cwd(), '.env')
  if (fs.existsSync(dotenvPath)) {
    require('dotenv').config({ path: dotenvPath })
  }
} catch (error) {
  // dotenv is optional
}

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()
if (!accessToken) {
  console.error('❌ Missing SQUARE_ACCESS_TOKEN')
  process.exit(1)
}

const environmentName = (process.env.SQUARE_ENVIRONMENT || 'production').toLowerCase()
const baseUrl = environmentName === 'sandbox' 
  ? 'https://connect.squareupsandbox.com'
  : 'https://connect.squareup.com'

async function findMissingPayments(beginTime, endTime, locationId) {
  console.log('\n🔍 Finding missing payments...')
  console.log('='.repeat(80))
  console.log(`   Begin: ${beginTime}`)
  console.log(`   End: ${endTime}`)
  if (locationId) {
    console.log(`   Location: ${locationId}`)
  } else {
    console.log(`   Location: ALL (no filter)`)
  }
  console.log('='.repeat(80))

  // Get all payment IDs from database for this location and date range
  const dbPayments = await prisma.payment.findMany({
    where: {
      ...(locationId ? { location_id: locationId } : {}),
      created_at: {
        gte: new Date(beginTime),
        lte: new Date(endTime)
      }
    },
    select: { id: true }
  })
  const dbPaymentIds = new Set(dbPayments.map(p => p.id))
  console.log(`\n📊 Database has ${dbPaymentIds.size} payments in this range`)

  // Fetch all payments from Square
  let cursor = null
  let totalFetched = 0
  const squarePaymentIds = new Set()
  const missingPayments = []

  do {
    const queryParams = new URLSearchParams()
    if (beginTime) queryParams.append('begin_time', beginTime)
    if (endTime) queryParams.append('end_time', endTime)
    queryParams.append('sort_order', 'ASC')
    if (cursor) queryParams.append('cursor', cursor)
    if (locationId) queryParams.append('location_id', locationId)
    queryParams.append('limit', '100')

    const url = `${baseUrl}/v2/payments?${queryParams.toString()}`
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Square-Version': '2025-10-16',
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      if (response.status === 429) {
        console.log('⏳ Rate limited. Waiting 5 seconds...')
        await new Promise(resolve => setTimeout(resolve, 5000))
        continue
      }
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }

    const result = await response.json()
    const payments = result.payments || []
    cursor = result.cursor || null

    for (const payment of payments) {
      const paymentId = payment.id
      squarePaymentIds.add(paymentId)
      totalFetched++

      // Check if this payment is in our database
      if (!dbPaymentIds.has(paymentId)) {
        const paymentLocationId = payment.locationId || payment.location_id
        // Only count as missing if it matches our location filter (or no filter)
        if (!locationId || paymentLocationId === locationId) {
          missingPayments.push({
            id: paymentId,
            location_id: paymentLocationId,
            created_at: payment.createdAt || payment.created_at,
            amount: payment.amountMoney?.amount || payment.amount_money?.amount,
            status: payment.status
          })
        }
      }
    }

    if (payments.length > 0) {
      console.log(`   Fetched ${totalFetched} payments from Square... (${missingPayments.length} missing so far)`)
    }

    if (cursor) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  } while (cursor)

  console.log(`\n✅ Analysis complete!`)
  console.log('='.repeat(80))
  console.log(`   Total in Square: ${squarePaymentIds.size}`)
  console.log(`   Total in Database: ${dbPaymentIds.size}`)
  console.log(`   Missing from Database: ${missingPayments.length}`)
  
  if (missingPayments.length > 0) {
    console.log(`\n📋 Missing Payments (first 20):`)
    missingPayments.slice(0, 20).forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.id} | Location: ${p.location_id || 'N/A'} | Status: ${p.status} | Amount: ${p.amount || 0}`)
    })
    if (missingPayments.length > 20) {
      console.log(`   ... and ${missingPayments.length - 20} more`)
    }
  }

  return { missingPayments, totalInSquare: squarePaymentIds.size, totalInDb: dbPaymentIds.size }
}

async function main() {
  const args = process.argv.slice(2)
  let beginTime = null
  let endTime = null
  let locationId = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--begin' && args[i + 1]) {
      beginTime = args[i + 1]
      i++
    } else if (args[i] === '--end' && args[i + 1]) {
      endTime = args[i + 1]
      i++
    } else if (args[i] === '--location' && args[i + 1]) {
      locationId = args[i + 1]
      i++
    }
  }

  // Default to January 2024 if not specified
  if (!beginTime) beginTime = '2024-01-01T00:00:00Z'
  if (!endTime) endTime = '2024-01-31T23:59:59Z'

  try {
    await findMissingPayments(beginTime, endTime, locationId)
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    if (error.stack) {
      console.error('Stack:', error.stack.split('\n').slice(0, 3).join('\n'))
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main()
}

module.exports = { findMissingPayments }




