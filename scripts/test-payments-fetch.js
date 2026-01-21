#!/usr/bin/env node

/**
 * Test script to verify Square Payments API access and inspect data structure
 * 
 * This script fetches a small sample of payments from Square API
 * and displays the data structure WITHOUT saving to database.
 * 
 * Usage:
 *   node scripts/test-payments-fetch.js [--limit N] [--begin ISO_DATE] [--end ISO_DATE] [--location LOCATION_ID]
 * 
 * Environment variables:
 *   SQUARE_ACCESS_TOKEN (required)
 *   SQUARE_ENVIRONMENT (optional, defaults to 'production')
 */

const path = require('path')
const fs = require('fs')

// Load .env if available
try {
  const dotenvPath = process.env.DOTENV_PATH || path.resolve(process.cwd(), '.env')
  if (fs.existsSync(dotenvPath)) {
    require('dotenv').config({ path: dotenvPath })
  }
} catch (error) {
  // dotenv is optional
}

// Using Square REST API directly, not SDK

// Parse command line arguments
function parseArgs(argv) {
  const args = {}
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        args[key] = next
        i += 1
      } else {
        args[key] = true
      }
    } else if (token.startsWith('-')) {
      const key = token.slice(1)
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        args[key] = next
        i += 1
      } else {
        args[key] = true
      }
    } else {
      positional.push(token)
    }
  }
  return { args, positional }
}

/**
 * Safely stringify with BigInt support
 */
function safeStringify(obj, space = 2) {
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'bigint') {
      return value.toString()
    }
    return value
  }, space)
}

/**
 * Display payment summary
 */
function displayPaymentSummary(payment, index) {
  console.log(`\n${'='.repeat(80)}`)
  console.log(`Payment #${index + 1}: ${payment.id}`)
  console.log(`${'='.repeat(80)}`)
  
  // Basic info
  console.log('\n📋 Basic Information:')
  console.log(`   ID: ${payment.id}`)
  console.log(`   Status: ${payment.status || 'N/A'}`)
  console.log(`   Source Type: ${payment.sourceType || payment.source_type || 'N/A'}`)
  console.log(`   Created: ${payment.createdAt || payment.created_at || 'N/A'}`)
  console.log(`   Updated: ${payment.updatedAt || payment.updated_at || 'N/A'}`)
  
  // Customer & Location
  console.log('\n👤 Customer & Location:')
  console.log(`   Customer ID: ${payment.customerId || payment.customer_id || 'N/A'}`)
  console.log(`   Location ID: ${payment.locationId || payment.location_id || 'N/A'}`)
  console.log(`   Order ID: ${payment.orderId || payment.order_id || 'N/A'}`)
  
  // Money amounts
  console.log('\n💰 Money Amounts:')
  const amountMoney = payment.amountMoney || payment.amount_money || {}
  const tipMoney = payment.tipMoney || payment.tip_money || {}
  const totalMoney = payment.totalMoney || payment.total_money || {}
  console.log(`   Amount: ${amountMoney.amount || 0} ${amountMoney.currency || 'USD'}`)
  console.log(`   Tip: ${tipMoney.amount || 0} ${tipMoney.currency || 'USD'}`)
  console.log(`   Total: ${totalMoney.amount || 0} ${totalMoney.currency || 'USD'}`)
  
  // Tenders
  const tenders = payment.tenders || payment.tender || []
  const tenderArray = Array.isArray(tenders) ? tenders : [tenders].filter(Boolean)
  console.log(`\n💳 Payment Tenders (${tenderArray.length}):`)
  if (tenderArray.length === 0) {
    console.log('   No tenders found')
  } else {
    tenderArray.forEach((tender, idx) => {
      console.log(`\n   Tender #${idx + 1}:`)
      console.log(`      Type: ${tender.type || 'N/A'}`)
      const tenderAmount = tender.amountMoney || tender.amount_money || {}
      console.log(`      Amount: ${tenderAmount.amount || 0} ${tenderAmount.currency || 'USD'}`)
      
      if (tender.type === 'CARD') {
        const card = tender.cardDetails?.card || tender.card_details?.card || {}
        console.log(`      Card Brand: ${card.cardBrand || card.card_brand || 'N/A'}`)
        console.log(`      Last 4: ${card.last4 || card.last_4 || 'N/A'}`)
      } else if (tender.type === 'SQUARE_GIFT_CARD') {
        const gcDetails = tender.giftCardDetails || tender.gift_card_details || {}
        console.log(`      Gift Card ID: ${gcDetails.giftCardId || gcDetails.gift_card_id || 'N/A'}`)
        console.log(`      GAN: ${gcDetails.gan || 'N/A'}`)
      } else if (tender.type === 'CASH') {
        const cashDetails = tender.cashDetails || tender.cash_details || {}
        console.log(`      Buyer Tendered: ${cashDetails.buyerTenderedMoney?.amount || cashDetails.buyer_tendered_money?.amount || 'N/A'}`)
      }
    })
  }
  
  // Card details (if available at payment level)
  if (payment.cardDetails || payment.card_details) {
    console.log('\n💳 Card Details (Payment Level):')
    const cardDetails = payment.cardDetails || payment.card_details
    const card = cardDetails.card || {}
    console.log(`   Brand: ${card.cardBrand || card.card_brand || 'N/A'}`)
    console.log(`   Last 4: ${card.last4 || card.last_4 || 'N/A'}`)
    console.log(`   Type: ${card.cardType || card.card_type || 'N/A'}`)
    console.log(`   Status: ${cardDetails.status || 'N/A'}`)
  }
  
  // Processing fees
  const processingFees = payment.processingFee || payment.processing_fee || []
  if (Array.isArray(processingFees) && processingFees.length > 0) {
    console.log('\n💵 Processing Fees:')
    processingFees.forEach((fee, idx) => {
      const feeAmount = fee.amountMoney || fee.amount_money || {}
      console.log(`   Fee #${idx + 1}: ${feeAmount.amount || 0} ${feeAmount.currency || 'USD'} (${fee.type || 'N/A'})`)
    })
  }
  
  // Refunds
  if (payment.refundIds || payment.refund_ids) {
    const refundIds = Array.isArray(payment.refundIds) ? payment.refundIds : 
                     Array.isArray(payment.refund_ids) ? payment.refund_ids : []
    if (refundIds.length > 0) {
      console.log(`\n🔄 Refunds: ${refundIds.length} refund(s)`)
      refundIds.forEach((id, idx) => {
        console.log(`   Refund #${idx + 1}: ${id}`)
      })
    }
  }
}

/**
 * Test fetching payments from Square REST API
 */
async function testFetchPayments(accessToken, baseUrl, options = {}) {
  const {
    beginTime = null,
    endTime = null,
    locationId = null,
    limit = 10, // Small limit for testing
    maxPages = 2, // Only fetch 2 pages max
  } = options

  console.log('\n🧪 Testing Square Payments API Connection')
  console.log('='.repeat(80))
  console.log(`   Begin time: ${beginTime || '(default: 1 year ago)'}`)
  console.log(`   End time: ${endTime || '(default: now)'}`)
  if (locationId) {
    console.log(`   Location ID: ${locationId}`)
  }
  console.log(`   Limit per page: ${limit}`)
  console.log(`   Max pages: ${maxPages}`)
  console.log('='.repeat(80))

  let cursor = null
  let totalFetched = 0
  let pageNumber = 0
  const allPayments = []

  try {
    do {
      pageNumber++
      
      if (pageNumber > maxPages) {
        console.log(`\n⏸️  Reached max pages limit (${maxPages}), stopping...`)
        break
      }

      console.log(`\n📡 Fetching page ${pageNumber}...`)

      // Build query parameters for Square REST API
      const queryParams = new URLSearchParams()
      if (beginTime) queryParams.append('begin_time', beginTime)
      if (endTime) queryParams.append('end_time', endTime)
      queryParams.append('sort_order', 'ASC')
      if (cursor) queryParams.append('cursor', cursor)
      if (locationId) queryParams.append('location_id', locationId)
      if (limit) queryParams.append('limit', limit.toString())

      const url = `${baseUrl}/v2/payments?${queryParams.toString()}`
      
      // Call Square REST API directly
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Square-Version': '2025-10-16',
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        const errorText = await response.text()
        let errorData
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { message: errorText }
        }
        throw new Error(`HTTP ${response.status}: ${JSON.stringify(errorData)}`)
      }

      const result = await response.json()
      const payments = result.payments || []
      const nextCursor = result.cursor || null
      const errors = result.errors || []

      if (errors && errors.length > 0) {
        console.warn(`\n⚠️  Square API returned ${errors.length} error(s):`)
        errors.forEach(err => {
          console.warn(`   - ${err.code}: ${err.detail || err.message}`)
        })
      }

      if (payments.length > 0) {
        console.log(`✅ Fetched ${payments.length} payment(s)`)
        allPayments.push(...payments)
        totalFetched += payments.length
        
        // Display first payment in detail
        if (pageNumber === 1 && payments.length > 0) {
          displayPaymentSummary(payments[0], 0)
          
          // Show raw structure of first payment (truncated)
          console.log(`\n\n📄 Raw Payment Data Structure (first payment, truncated):`)
          console.log('─'.repeat(80))
          const rawData = safeStringify(payments[0])
          // Show first 2000 characters
          if (rawData.length > 2000) {
            console.log(rawData.substring(0, 2000) + '\n... (truncated)')
          } else {
            console.log(rawData)
          }
        }
      } else {
        console.log(`ℹ️  No payments found on this page`)
      }

      cursor = nextCursor || null

      if (cursor && pageNumber < maxPages) {
        console.log(`   Next cursor: ${cursor.substring(0, 30)}...`)
        // Small delay
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    } while (cursor && pageNumber < maxPages)

    // Summary
    console.log(`\n\n${'='.repeat(80)}`)
    console.log('📊 Test Summary')
    console.log('='.repeat(80))
    console.log(`   ✅ Successfully connected to Square API`)
    console.log(`   📄 Pages fetched: ${pageNumber}`)
    console.log(`   💰 Total payments fetched: ${totalFetched}`)
    
    if (totalFetched > 0) {
      console.log(`\n   ✅ Test PASSED - Square API is accessible and returning payment data`)
      console.log(`\n   💡 Next step: Run the full backfill script to save payments to database`)
      console.log(`      node scripts/backfill-payments.js`)
    } else {
      console.log(`\n   ⚠️  No payments found in the specified time range`)
      console.log(`   💡 Try adjusting --begin and --end dates`)
    }

    return {
      success: true,
      totalFetched,
      pagesFetched: pageNumber,
      payments: allPayments
    }
  } catch (error) {
    console.error(`\n❌ Test FAILED:`, error.message)
    if (error.statusCode) {
      console.error(`   HTTP Status: ${error.statusCode}`)
    }
    if (error.errors) {
      console.error(`   Errors:`, safeStringify(error.errors))
    }
    if (error.stack) {
      console.error(`\n   Stack trace:`)
      console.error(error.stack)
    }
    throw error
  }
}

/**
 * Main function
 */
async function main() {
  const { args } = parseArgs(process.argv.slice(2))

  const accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()
  if (!accessToken) {
    console.error('❌ Missing SQUARE_ACCESS_TOKEN environment variable.')
    console.error('   Please set SQUARE_ACCESS_TOKEN in your .env file or environment.')
    process.exit(1)
  }

  const environmentName = (process.env.SQUARE_ENVIRONMENT || 'production').toLowerCase()
  const baseUrl = environmentName === 'sandbox' 
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com'

  console.log(`\n🔑 Square Configuration:`)
  console.log(`   Environment: ${environmentName}`)
  console.log(`   Base URL: ${baseUrl}`)
  console.log(`   Access Token: ${accessToken.substring(0, 10)}...${accessToken.substring(accessToken.length - 4)}`)

  const beginTime = args.begin || args.b || null
  const endTime = args.end || args.e || null
  const locationId = args.location || args.l || null
  const limit = args.limit ? parseInt(args.limit, 10) : 10

  try {
    await testFetchPayments(accessToken, baseUrl, {
      beginTime,
      endTime,
      locationId,
      limit,
    })
  } catch (error) {
    console.error('\n❌ Test failed:', error.message)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}

module.exports = { testFetchPayments }

