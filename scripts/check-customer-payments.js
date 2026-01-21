#!/usr/bin/env node
/**
 * Check if customer has payments
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production,
})

const CUSTOMER_ID = process.argv[2] || 'PC9XDNW0KATPG52FAXJXV9045G'

async function checkCustomerPayments() {
  console.log('💳 Checking Customer Payments')
  console.log('='.repeat(60))
  console.log(`Customer ID: ${CUSTOMER_ID}`)
  console.log('')

  try {
    // Step 1: Get customer info
    console.log('📋 Step 1: Customer Information')
    const dbCustomer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        phone_number,
        first_payment_completed,
        created_at
      FROM square_existing_clients 
      WHERE square_customer_id = ${CUSTOMER_ID}
    `

    if (!dbCustomer || dbCustomer.length === 0) {
      console.log('❌ Customer not found in database')
      return
    }

    const customer = dbCustomer[0]
    const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
    
    console.log(`   ✅ Customer: ${customerName}`)
    console.log(`   - Email: ${customer.email_address || 'None'}`)
    console.log(`   - Phone: ${customer.phone_number || 'None'}`)
    console.log(`   - First Payment Completed: ${customer.first_payment_completed ? '✅ Yes' : '❌ No'}`)
    console.log(`   - Created: ${customer.created_at}`)
    console.log('')

    // Step 2: Check payments in Square API
    console.log('📋 Step 2: Checking Payments in Square API...')
    console.log('   Searching last 6 months...')
    
    try {
      const paymentsApi = squareClient.paymentsApi
      
      // Check last 6 months in 1-month windows (Square API limit is 31 days per request)
      const now = new Date()
      const allPayments = []
      
      for (let monthOffset = 0; monthOffset < 6; monthOffset++) {
        const endDate = new Date(now)
        endDate.setMonth(endDate.getMonth() - monthOffset)
        const startDate = new Date(endDate)
        startDate.setDate(startDate.getDate() - 31) // 31 days window
        
        let cursor = null
        let page = 0
        
        do {
          page++
          try {
            const response = await paymentsApi.listPayments(
              startDate.toISOString(), // beginTime
              endDate.toISOString(),   // endTime
              'ASC',                    // sortOrder
              cursor                    // cursor
            )
            
            const payments = response.result?.payments || []
            cursor = response.result?.cursor
            
            // Filter by customer ID
            for (const payment of payments) {
              const paymentCustomerId = payment.customerId || payment.customer_id
              if (paymentCustomerId === CUSTOMER_ID) {
                allPayments.push(payment)
              }
            }
            
            // Small delay to avoid rate limits
            if (cursor) {
              await new Promise(resolve => setTimeout(resolve, 100))
            }
          } catch (pageError) {
            // Skip this page if it fails
            break
          }
        } while (cursor)
        
        // Small delay between months
        if (monthOffset < 5) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
      
      // Remove duplicates
      const uniquePayments = Array.from(
        new Map(allPayments.map(p => [p.id, p])).values()
      )
      
      if (uniquePayments.length > 0) {
        console.log(`   ✅ Found ${uniquePayments.length} payment(s):`)
        console.log('')
        
        uniquePayments
          .sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0)
            const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0)
            return dateB - dateA // Most recent first
          })
          .forEach((payment, index) => {
            const createdDate = payment.createdAt ? new Date(payment.createdAt) : null
            const updatedDate = payment.updatedAt ? new Date(payment.updatedAt) : null
            const amountMoney = payment.totalMoney || payment.amountMoney
            const amountCents = amountMoney?.amount || 0
            const amount = (typeof amountCents === 'bigint' ? Number(amountCents) : amountCents) / 100
            const currency = amountMoney?.currency || 'USD'
            
            console.log(`   Payment ${index + 1}:`)
            console.log(`      - Payment ID: ${payment.id}`)
            console.log(`      - Status: ${payment.status}`)
            console.log(`      - Amount: $${amount.toFixed(2)} ${currency}`)
            if (createdDate) {
              console.log(`      - Created: ${createdDate.toLocaleString()}`)
            }
            if (updatedDate) {
              console.log(`      - Updated: ${updatedDate.toLocaleString()}`)
            }
            if (payment.locationId) {
              console.log(`      - Location ID: ${payment.locationId}`)
            }
            if (payment.orderId) {
              console.log(`      - Order ID: ${payment.orderId}`)
            }
            if (payment.sourceId) {
              console.log(`      - Source ID: ${payment.sourceId}`)
            }
            if (payment.cardDetails?.card?.cardBrand) {
              console.log(`      - Card Brand: ${payment.cardDetails.card.cardBrand}`)
            }
            if (payment.refundIds && payment.refundIds.length > 0) {
              console.log(`      - Refunds: ${payment.refundIds.length} refund(s)`)
            }
            console.log('')
          })
        
        // Summary
        const completedPayments = uniquePayments.filter(p => p.status === 'COMPLETED')
        const totalAmount = uniquePayments.reduce((sum, p) => {
          const amountMoney = p.totalMoney || p.amountMoney
          const amountCents = amountMoney?.amount || 0
          const amount = typeof amountCents === 'bigint' ? Number(amountCents) : amountCents
          return sum + amount
        }, 0)
        
        console.log('📊 Summary:')
        console.log(`   - Total Payments: ${uniquePayments.length}`)
        console.log(`   - Completed Payments: ${completedPayments.length}`)
        console.log(`   - Total Amount: $${(totalAmount / 100).toFixed(2)}`)
        console.log('')
        
        if (completedPayments.length > 0 && !customer.first_payment_completed) {
          console.log('⚠️  ISSUE FOUND:')
          console.log(`   Customer has ${completedPayments.length} completed payment(s), but`)
          console.log(`   first_payment_completed is still FALSE in database!`)
          console.log('')
          console.log('   This means the payment webhook was not processed correctly.')
          console.log('   You may need to:')
          console.log('   1. Manually update first_payment_completed = TRUE')
          console.log('   2. Or replay the payment webhook using replay-square-events.js')
        }
        
      } else {
        console.log('   ❌ No payments found for this customer')
        console.log('')
        console.log('   This explains why:')
        console.log('   - first_payment_completed = FALSE')
        console.log('   - referral code was not generated automatically')
      }
      
    } catch (squareError) {
      console.log(`   ❌ Error fetching from Square: ${squareError.message}`)
      if (squareError.errors) {
        console.log(`   Square API Errors:`, JSON.stringify(squareError.errors, null, 2))
      }
    }

    console.log('')
    console.log('✅ Check complete!')

  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkCustomerPayments()

