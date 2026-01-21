#!/usr/bin/env node

/**
 * Square Payments Historical Backfill
 * 
 * Fetches all payments from Square REST API and saves them to the database.
 * Handles both payments and payment_tenders tables.
 * 
 * Usage:
 *   node scripts/backfill-payments.js [--begin ISO_DATE] [--end ISO_DATE] [--location LOCATION_ID] [--limit N]
 * 
 * Environment variables:
 *   SQUARE_ACCESS_TOKEN (required)
 *   SQUARE_ENVIRONMENT (optional, defaults to 'production')
 *   DATABASE_URL (required)
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

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

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
 * Transform Square payment data to match Payment model schema
 */
function transformPayment(payment) {
  // Handle both snake_case and camelCase from Square API
  const getValue = (obj, ...keys) => {
    for (const key of keys) {
      if (obj?.[key] !== undefined && obj?.[key] !== null) {
        return obj[key]
      }
    }
    return null
  }

  const paymentId = payment.id
  const customerId = getValue(payment, 'customerId', 'customer_id')
  const locationId = getValue(payment, 'locationId', 'location_id')
  const orderId = getValue(payment, 'orderId', 'order_id')
  
  // Extract booking_id from order (if available) - might need to fetch order separately
  const bookingId = null

  // Money amounts (all in cents)
  const amountMoney = getValue(payment, 'amountMoney', 'amount_money') || {}
  const tipMoney = getValue(payment, 'tipMoney', 'tip_money') || {}
  const totalMoney = getValue(payment, 'totalMoney', 'total_money') || {}
  const approvedMoney = getValue(payment, 'approvedMoney', 'approved_money') || {}

  // Card details (from cardDetails or card_details)
  const cardDetails = getValue(payment, 'cardDetails', 'card_details') || {}
  const card = cardDetails.card || {}

  // Processing fees
  const processingFees = getValue(payment, 'processingFee', 'processing_fee') || []
  const firstProcessingFee = Array.isArray(processingFees) ? processingFees[0] : processingFees
  const processingFeeAmount = firstProcessingFee?.amountMoney?.amount || firstProcessingFee?.amount_money?.amount || null
  const processingFeeCurrency = firstProcessingFee?.amountMoney?.currency || firstProcessingFee?.amount_money?.currency || 'USD'
  const processingFeeType = firstProcessingFee?.type || null

  // Application details
  const appDetails = getValue(payment, 'applicationDetails', 'application_details') || {}

  // Device details
  const deviceDetails = getValue(payment, 'deviceDetails', 'device_details') || {}

  // Card payment timeline
  const cardTimeline = cardDetails.cardPaymentTimeline || cardDetails.card_payment_timeline || {}

  return {
    id: paymentId,
    square_event_id: null, // Not available from listPayments
    event_type: 'payment.created', // Default, will be updated if payment.updated
    merchant_id: getValue(payment, 'merchantId', 'merchant_id'),
    
    // Customer & Location
    customer_id: customerId,
    location_id: locationId,
    order_id: orderId,
    booking_id: bookingId,
    
    // Money amounts
    amount_money_amount: amountMoney.amount || 0,
    amount_money_currency: amountMoney.currency || 'USD',
    tip_money_amount: tipMoney.amount || null,
    tip_money_currency: tipMoney.currency || 'USD',
    total_money_amount: totalMoney.amount || 0,
    total_money_currency: totalMoney.currency || 'USD',
    approved_money_amount: approvedMoney.amount || null,
    approved_money_currency: approvedMoney.currency || 'USD',
    
    // Status
    status: payment.status || null,
    source_type: getValue(payment, 'sourceType', 'source_type'),
    delay_action: getValue(payment, 'delayAction', 'delay_action'),
    delay_duration: getValue(payment, 'delayDuration', 'delay_duration'),
    delayed_until: getValue(payment, 'delayedUntil', 'delayed_until') 
      ? new Date(getValue(payment, 'delayedUntil', 'delayed_until'))
      : null,
    
    // Staff/Team Member
    team_member_id: getValue(payment, 'teamMemberId', 'team_member_id') || getValue(payment, 'employeeId', 'employee_id'),
    employee_id: getValue(payment, 'employeeId', 'employee_id'),
    
    // Application details
    application_details_square_product: appDetails.squareProduct || appDetails.square_product || null,
    
    // Capabilities
    capabilities: Array.isArray(payment.capabilities) ? payment.capabilities : [],
    
    // Card details
    card_application_cryptogram: card.applicationCryptogram || card.application_cryptogram || null,
    card_application_identifier: card.applicationIdentifier || card.application_identifier || null,
    card_application_name: card.applicationName || card.application_name || null,
    card_auth_result_code: cardDetails.authResultCode || cardDetails.auth_result_code || null,
    card_avs_status: cardDetails.avsStatus || cardDetails.avs_status || null,
    card_bin: card.bin || null,
    card_brand: card.cardBrand || card.card_brand || null,
    card_type: card.cardType || card.card_type || null,
    card_exp_month: card.expMonth || card.exp_month || null,
    card_exp_year: card.expYear || card.exp_year || null,
    card_fingerprint: card.fingerprint || null,
    card_last_4: card.last4 || card.last_4 || null,
    card_payment_account_reference: card.paymentAccountReference || card.payment_account_reference || null,
    card_prepaid_type: card.prepaidType || card.prepaid_type || null,
    card_entry_method: cardDetails.entryMethod || cardDetails.entry_method || null,
    card_statement_description: cardDetails.statementDescription || cardDetails.statement_description || null,
    card_status: cardDetails.status || null,
    card_verification_method: cardDetails.verificationMethod || cardDetails.verification_method || null,
    card_verification_results: cardDetails.verificationResults || cardDetails.verification_results || null,
    card_cvv_status: cardDetails.cvvStatus || cardDetails.cvv_status || null,
    card_payment_timeline_authorized_at: cardTimeline.authorizedAt || cardTimeline.authorized_at 
      ? new Date(cardTimeline.authorizedAt || cardTimeline.authorized_at)
      : null,
    card_payment_timeline_captured_at: cardTimeline.capturedAt || cardTimeline.captured_at
      ? new Date(cardTimeline.capturedAt || cardTimeline.captured_at)
      : null,
    card_emv_authorization_response_code: cardDetails.emvAuthData?.emvApplicationCryptogram || 
                                         cardDetails.emv_auth_data?.emv_application_cryptogram || null,
    
    // Device details
    device_id: deviceDetails.id || deviceDetails.device_id || null,
    device_installation_id: deviceDetails.installationId || deviceDetails.installation_id || null,
    device_name: deviceDetails.name || deviceDetails.device_name || null,
    card_device_id: cardDetails.deviceDetails?.id || cardDetails.device_details?.device_id || null,
    card_device_installation_id: cardDetails.deviceDetails?.installationId || 
                                  cardDetails.device_details?.device_installation_id || null,
    card_device_name: cardDetails.deviceDetails?.name || cardDetails.device_details?.device_name || null,
    
    // Receipt
    receipt_number: getValue(payment, 'receiptNumber', 'receipt_number'),
    receipt_url: getValue(payment, 'receiptUrl', 'receipt_url'),
    
    // Processing fees
    processing_fee_amount: processingFeeAmount,
    processing_fee_currency: processingFeeCurrency,
    processing_fee_type: processingFeeType,
    
    // Refund info
    refund_ids: Array.isArray(payment.refundIds) ? payment.refundIds : 
                Array.isArray(payment.refund_ids) ? payment.refund_ids : [],
    
    // Timestamps
    created_at: payment.createdAt || payment.created_at ? new Date(payment.createdAt || payment.created_at) : new Date(),
    updated_at: payment.updatedAt || payment.updated_at ? new Date(payment.updatedAt || payment.updated_at) : new Date(),
    square_created_at: null, // Not available from listPayments
    
    // Version
    version: payment.versionToken ? 1 : (payment.version || 0),
  }
}

/**
 * Extract tenders from payment data
 * Square listPayments may not include tenders array, so we construct from available data
 */
function extractTenders(payment) {
  const tenders = []
  const getValue = (obj, ...keys) => {
    for (const key of keys) {
      if (obj?.[key] !== undefined && obj?.[key] !== null) {
        return obj[key]
      }
    }
    return null
  }

  // Check if payment has tenders array
  const tendersArray = payment.tenders || payment.tender || []
  if (Array.isArray(tendersArray) && tendersArray.length > 0) {
    return tendersArray
  }

  // If no tenders array, construct from payment data
  // Most payments have card_details, so create a CARD tender
  const cardDetails = getValue(payment, 'cardDetails', 'card_details')
  const sourceType = getValue(payment, 'sourceType', 'source_type')
  const totalMoney = getValue(payment, 'totalMoney', 'total_money') || {}

  if (sourceType === 'CARD' && cardDetails) {
    // Create a CARD tender from card_details
    tenders.push({
      type: 'CARD',
      amountMoney: totalMoney,
      cardDetails: cardDetails
    })
  } else if (sourceType === 'CASH') {
    // Create a CASH tender
    const cashDetails = getValue(payment, 'cashDetails', 'cash_details') || {}
    tenders.push({
      type: 'CASH',
      amountMoney: totalMoney,
      cashDetails: cashDetails
    })
  } else if (sourceType === 'SQUARE_GIFT_CARD') {
    // Create a SQUARE_GIFT_CARD tender
    const giftCardDetails = getValue(payment, 'giftCardDetails', 'gift_card_details') || {}
    tenders.push({
      type: 'SQUARE_GIFT_CARD',
      amountMoney: totalMoney,
      giftCardDetails: giftCardDetails
    })
  } else if (sourceType) {
    // Unknown source type, create generic tender
    tenders.push({
      type: sourceType,
      amountMoney: totalMoney
    })
  }

  return tenders
}

/**
 * Transform Square tender data to match PaymentTender model schema
 */
function transformTender(tender, paymentId) {
  const getValue = (obj, ...keys) => {
    for (const key of keys) {
      if (obj?.[key] !== undefined && obj?.[key] !== null) {
        return obj[key]
      }
    }
    return null
  }

  const tenderId = tender.id || null
  const type = tender.type || null
  
  // Money amount
  const amountMoney = getValue(tender, 'amountMoney', 'amount_money') || {}

  // Card details (if type is CARD)
  const cardDetails = getValue(tender, 'cardDetails', 'card_details') || {}
  const card = cardDetails.card || {}
  const cardTimeline = cardDetails.cardPaymentTimeline || cardDetails.card_payment_timeline || {}

  // Cash details (if type is CASH)
  const cashDetails = getValue(tender, 'cashDetails', 'cash_details') || {}

  // Gift card details (if type is SQUARE_GIFT_CARD)
  const giftCardDetails = getValue(tender, 'giftCardDetails', 'gift_card_details') || {}

  // Bank account details (if type is BANK_ACCOUNT)
  const bankAccountDetails = getValue(tender, 'bankAccountDetails', 'bank_account_details') || {}

  return {
    id: `${paymentId}-${tenderId || Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    payment_id: paymentId,
    tender_id: tenderId,
    
    // Tender fields
    type: type,
    amount_money_amount: amountMoney.amount || 0,
    amount_money_currency: amountMoney.currency || 'USD',
    note: tender.note || null,
    
    // Card details
    card_status: cardDetails.status || null,
    card_application_cryptogram: card.applicationCryptogram || card.application_cryptogram || null,
    card_application_identifier: card.applicationIdentifier || card.application_identifier || null,
    card_application_name: card.applicationName || card.application_name || null,
    card_auth_result_code: cardDetails.authResultCode || cardDetails.auth_result_code || null,
    card_avs_status: cardDetails.avsStatus || cardDetails.avs_status || null,
    card_bin: card.bin || null,
    card_brand: card.cardBrand || card.card_brand || null,
    card_type: card.cardType || card.card_type || null,
    card_exp_month: card.expMonth || card.exp_month || null,
    card_exp_year: card.expYear || card.exp_year || null,
    card_fingerprint: card.fingerprint || null,
    card_last_4: card.last4 || card.last_4 || null,
    card_payment_account_reference: card.paymentAccountReference || card.payment_account_reference || null,
    card_prepaid_type: card.prepaidType || card.prepaid_type || null,
    card_entry_method: cardDetails.entryMethod || cardDetails.entry_method || null,
    card_statement_description: cardDetails.statementDescription || cardDetails.statement_description || null,
    card_verification_method: cardDetails.verificationMethod || cardDetails.verification_method || null,
    card_verification_results: cardDetails.verificationResults || cardDetails.verification_results || null,
    card_cvv_status: cardDetails.cvvStatus || cardDetails.cvv_status || null,
    card_payment_timeline_authorized_at: cardTimeline.authorizedAt || cardTimeline.authorized_at
      ? new Date(cardTimeline.authorizedAt || cardTimeline.authorized_at)
      : null,
    card_payment_timeline_captured_at: cardTimeline.capturedAt || cardTimeline.captured_at
      ? new Date(cardTimeline.capturedAt || cardTimeline.captured_at)
      : null,
    card_emv_authorization_response_code: cardDetails.emvAuthData?.emvApplicationCryptogram ||
                                           cardDetails.emv_auth_data?.emv_application_cryptogram || null,
    card_device_id: cardDetails.deviceDetails?.id || cardDetails.device_details?.device_id || null,
    card_device_installation_id: cardDetails.deviceDetails?.installationId ||
                                 cardDetails.device_details?.device_installation_id || null,
    card_device_name: cardDetails.deviceDetails?.name || cardDetails.device_details?.device_name || null,
    
    // Cash details
    cash_buyer_tendered_amount: cashDetails.buyerTenderedMoney?.amount || 
                                cashDetails.buyer_tendered_money?.amount || null,
    cash_buyer_tendered_currency: cashDetails.buyerTenderedMoney?.currency || 
                                  cashDetails.buyer_tendered_money?.currency || 'USD',
    cash_change_back_amount: cashDetails.changeBackMoney?.amount || 
                             cashDetails.change_back_money?.amount || null,
    cash_change_back_currency: cashDetails.changeBackMoney?.currency || 
                               cashDetails.change_back_money?.currency || 'USD',
    
    // Gift card details
    gift_card_id: giftCardDetails.giftCardId || giftCardDetails.gift_card_id || null,
    gift_card_gan: giftCardDetails.gan || null,
    
    // Bank account details
    bank_account_details_account_last_4: bankAccountDetails.accountLast4 || 
                                         bankAccountDetails.account_last_4 || null,
    bank_account_details_account_type: bankAccountDetails.accountType || 
                                       bankAccountDetails.account_type || null,
    bank_account_details_routing_number: bankAccountDetails.routingNumber || 
                                          bankAccountDetails.routing_number || null,
    
    // Timestamp
    created_at: new Date(),
  }
}

/**
 * Ensure location exists in database
 */
async function ensureLocation(prisma, locationId) {
  if (!locationId) return null

  try {
    const location = await prisma.location.findUnique({
      where: { square_location_id: locationId }
    })
    
    if (!location) {
      // Location doesn't exist - create minimal record
      try {
        return await prisma.location.create({
          data: {
            square_location_id: locationId,
            name: `Location ${locationId.substring(0, 8)}...`
          }
        })
      } catch (error) {
        // Location might have been created by another process
        return await prisma.location.findUnique({
          where: { square_location_id: locationId }
        })
      }
    }
    
    return location
  } catch (error) {
    console.warn(`   ⚠️  Could not ensure location ${locationId}: ${error.message}`)
    return null
  }
}

/**
 * Ensure customer exists in database
 */
async function ensureCustomer(prisma, customerId) {
  if (!customerId) return null

  try {
    const customer = await prisma.squareExistingClient.findUnique({
      where: { square_customer_id: customerId }
    })
    
    if (!customer) {
      // Customer doesn't exist - create minimal record
      try {
        return await prisma.squareExistingClient.create({
          data: {
            square_customer_id: customerId,
            got_signup_bonus: false
          }
        })
      } catch (error) {
        // Customer might have been created by another process
        return await prisma.squareExistingClient.findUnique({
          where: { square_customer_id: customerId }
        })
      }
    }
    
    return customer
  } catch (error) {
    console.warn(`   ⚠️  Could not ensure customer ${customerId}: ${error.message}`)
    return null
  }
}

/**
 * Ensure order exists in database, or return null if it doesn't exist
 */
async function ensureOrder(prisma, orderId, locationId) {
  if (!orderId) return null

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId }
    })
    
    if (!order) {
      // Order doesn't exist - create minimal record
      try {
        return await prisma.order.create({
          data: {
            id: orderId,
            location_id: locationId || null
          }
        })
      } catch (error) {
        // Order might have been created by another process
        return await prisma.order.findUnique({
          where: { id: orderId }
        })
      }
    }
    
    return order
  } catch (error) {
    console.warn(`   ⚠️  Could not ensure order ${orderId}: ${error.message}`)
    return null
  }
}

/**
 * Upsert payment and its tenders
 */
async function upsertPayment(prisma, payment) {
  try {
    const paymentData = transformPayment(payment)
    
    // Ensure location exists
    if (paymentData.location_id) {
      await ensureLocation(prisma, paymentData.location_id)
    }

    // Ensure customer exists (if payment has customer_id)
    if (paymentData.customer_id) {
      await ensureCustomer(prisma, paymentData.customer_id)
    }

    // Ensure order exists (if payment has order_id)
    // If order doesn't exist and can't be created, set order_id to null
    if (paymentData.order_id) {
      const order = await ensureOrder(prisma, paymentData.order_id, paymentData.location_id)
      if (!order) {
        // Order doesn't exist and couldn't be created - set to null to avoid FK violation
        paymentData.order_id = null
      }
    }

    // Extract tenders from payment
    const tenders = extractTenders(payment)

    // Check if payment exists before transaction
    const existingPayment = await prisma.payment.findUnique({
      where: { id: paymentData.id },
      select: { id: true }
    })
    const wasCreated = !existingPayment

    // Upsert payment using transaction
    await prisma.$transaction(async (tx) => {
      // Final checks within transaction
      if (paymentData.customer_id) {
        const customerExists = await tx.squareExistingClient.findUnique({
          where: { square_customer_id: paymentData.customer_id },
          select: { square_customer_id: true }
        })
        if (!customerExists) {
          // Create customer within transaction
          await tx.squareExistingClient.create({
            data: {
              square_customer_id: paymentData.customer_id,
              got_signup_bonus: false
            }
          })
        }
      }

      if (paymentData.order_id) {
        const orderExists = await tx.order.findUnique({
          where: { id: paymentData.order_id },
          select: { id: true }
        })
        if (!orderExists) {
          // Create order within transaction
          await tx.order.create({
            data: {
              id: paymentData.order_id,
              location_id: paymentData.location_id || null
            }
          })
        }
      }

      // Upsert payment
      await tx.payment.upsert({
        where: { id: paymentData.id },
        update: paymentData,
        create: paymentData,
      })

      // Delete existing tenders and recreate (to handle updates)
      await tx.paymentTender.deleteMany({
        where: { payment_id: paymentData.id }
      })

      // Create tenders
      if (tenders.length > 0) {
        const tenderData = tenders.map(tender => transformTender(tender, paymentData.id))
        await tx.paymentTender.createMany({
          data: tenderData
        })
      }
    })

    return { success: true, tendersCount: tenders.length, wasCreated }
  } catch (error) {
    if (error.code === 'P2002') {
      // Unique constraint violation - payment might have been created by another process
      return { success: false, skipped: true }
    }
    throw error
  }
}

/**
 * Main backfill function
 */
async function backfillPayments(accessToken, baseUrl, options = {}) {
  const {
    beginTime = null,
    endTime = null,
    locationId = null,
    limit = 100, // Square max is 100
  } = options

  console.log('\n🚀 Starting Square payments backfill')
  console.log('='.repeat(80))
  console.log(`   Begin time: ${beginTime || '(default: 1 year ago)'}`)
  console.log(`   End time: ${endTime || '(default: now)'}`)
  if (locationId) {
    console.log(`   Location ID: ${locationId}`)
  }
  console.log(`   Limit per page: ${limit}`)
  console.log('='.repeat(80))

  let cursor = null
  let totalFetched = 0
  let totalUpserted = 0
  let totalCreated = 0
  let totalUpdated = 0
  let totalErrors = 0
  let totalSkipped = 0
  let pageNumber = 0

  do {
    pageNumber++
    
    try {
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
        // Handle rate limiting
        if (response.status === 429) {
          console.log(`⏳ Rate limited. Waiting 5 seconds...`)
          await new Promise(resolve => setTimeout(resolve, 5000))
          continue // Retry this page
        }

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
        console.warn(`⚠️  Square API returned ${errors.length} error(s) on page ${pageNumber}`)
        errors.forEach(err => {
          console.warn(`   - ${err.code}: ${err.detail || err.message}`)
        })
      }

      if (payments.length > 0) {
        console.log(`✅ Fetched ${payments.length} payment(s)`)
        
        for (const payment of payments) {
          try {
            const result = await upsertPayment(prisma, payment)
            if (result.success) {
              totalUpserted++
              if (result.wasCreated) {
                totalCreated++
                if (result.tendersCount > 0) {
                  console.log(`   ✅ Created payment ${payment.id} (${result.tendersCount} tender(s))`)
                } else {
                  console.log(`   ✅ Created payment ${payment.id} (no tenders)`)
                }
              } else {
                totalUpdated++
                if (result.tendersCount > 0) {
                  console.log(`   🔄 Updated payment ${payment.id} (${result.tendersCount} tender(s))`)
                } else {
                  console.log(`   🔄 Updated payment ${payment.id} (no tenders)`)
                }
              }
            } else if (result.skipped) {
              totalSkipped++
            }
            totalFetched++
          } catch (error) {
            totalErrors++
            console.error(`   ❌ Failed to upsert payment ${payment.id}:`, error.message)
            if (error.stack && totalErrors < 3) {
              console.error('   Stack:', error.stack.split('\n')[0])
            }
          }
        }
      } else {
        console.log(`ℹ️  No payments found on this page`)
      }

      cursor = nextCursor || null

      // Small delay to avoid rate limiting
      if (cursor) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    } catch (error) {
      // Handle rate limiting
      if (error.message.includes('429')) {
        console.log(`⏳ Rate limited. Waiting 5 seconds...`)
        await new Promise(resolve => setTimeout(resolve, 5000))
        continue // Retry this page
      }
      
      console.error(`❌ Fatal error on page ${pageNumber}:`, error.message)
      if (error.stack && totalErrors < 3) {
        console.error('Stack:', error.stack.split('\n').slice(0, 3).join('\n'))
      }
      totalErrors++
      
      // Continue to next page if possible
      if (cursor) {
        continue
      } else {
        break
      }
    }
  } while (cursor)

  console.log(`\n\n${'='.repeat(80)}`)
  console.log('✅ Backfill completed!')
  console.log('='.repeat(80))
  console.log(`   Pages processed: ${pageNumber}`)
  console.log(`   Total fetched: ${totalFetched}`)
  console.log(`   Total upserted: ${totalUpserted}`)
  console.log(`     - Created: ${totalCreated}`)
  console.log(`     - Updated: ${totalUpdated}`)
  console.log(`   Total skipped (already exists): ${totalSkipped}`)
  console.log(`   Total errors: ${totalErrors}`)
  
  return {
    pagesProcessed: pageNumber,
    totalFetched,
    totalUpserted,
    totalCreated,
    totalUpdated,
    totalSkipped,
    totalErrors
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
  const limit = args.limit ? parseInt(args.limit, 10) : 100

  try {
    await backfillPayments(accessToken, baseUrl, {
      beginTime,
      endTime,
      locationId,
      limit,
    })
  } catch (error) {
    console.error('\n❌ Backfill failed:', error.message)
    if (error.stack) {
      console.error('Stack:', error.stack.split('\n').slice(0, 5).join('\n'))
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main()
}

module.exports = { backfillPayments, transformPayment, transformTender }

