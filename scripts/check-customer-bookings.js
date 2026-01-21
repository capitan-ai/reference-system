#!/usr/bin/env node
/**
 * Check if customer has bookings/appointments
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

async function checkCustomerBookings() {
  console.log('🔍 Checking Customer Bookings')
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

    // Step 2: Check bookings in Square API
    console.log('📋 Step 2: Checking Bookings in Square API...')
    try {
      const bookingsApi = squareClient.bookingsApi
      
      // Square API requires date ranges to be at most 31 days
      // Check multiple 31-day windows
      const allBookings = []
      const now = new Date()
      const monthsToCheck = 12 // Check last 12 months
      
      for (let i = 0; i < monthsToCheck; i++) {
        const endDate = new Date(now)
        endDate.setMonth(endDate.getMonth() - i)
        const startDate = new Date(endDate)
        startDate.setDate(startDate.getDate() - 31) // 31 days window
        
        try {
          const bookingsResponse = await bookingsApi.listBookings(
            100,              // limit
            undefined,        // cursor
            CUSTOMER_ID,      // customerId (filter by this customer)
            undefined,        // teamMemberId
            undefined,        // locationId (all locations)
            startDate.toISOString(), // startAtMin
            endDate.toISOString()    // startAtMax
          )
          
          const bookings = bookingsResponse.result?.bookings || []
          allBookings.push(...bookings)
          
          // Small delay to avoid rate limits
          if (i < monthsToCheck - 1) {
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        } catch (rangeError) {
          // Skip this range if it fails
          continue
        }
      }
      
      // Remove duplicates
      const uniqueBookings = Array.from(
        new Map(allBookings.map(b => [b.id, b])).values()
      )
      
      const bookings = uniqueBookings

      if (bookings.length > 0) {
        console.log(`   ✅ Found ${bookings.length} booking(s):`)
        console.log('')

        bookings.forEach((booking, index) => {
          const startAt = booking.startAt ? new Date(booking.startAt) : null
          const createdAt = booking.createdAt ? new Date(booking.createdAt) : null
          
          console.log(`   Booking ${index + 1}:`)
          console.log(`      - Booking ID: ${booking.id}`)
          console.log(`      - Status: ${booking.status}`)
          console.log(`      - Location ID: ${booking.locationId}`)
          if (startAt) {
            console.log(`      - Start Time: ${startAt.toLocaleString()}`)
          }
          if (createdAt) {
            console.log(`      - Created: ${createdAt.toLocaleString()}`)
          }
          if (booking.customerNote) {
            console.log(`      - Note: ${booking.customerNote}`)
          }
          if (booking.appointmentSegments && booking.appointmentSegments.length > 0) {
            console.log(`      - Service Segments: ${booking.appointmentSegments.length}`)
            booking.appointmentSegments.forEach((segment, segIndex) => {
              console.log(`         Segment ${segIndex + 1}:`)
              if (segment.serviceVariationId) {
                console.log(`            - Service Variation ID: ${segment.serviceVariationId}`)
              }
              if (segment.durationMinutes) {
                console.log(`            - Duration: ${segment.durationMinutes} minutes`)
              }
              if (segment.teamMemberId) {
                console.log(`            - Team Member ID: ${segment.teamMemberId}`)
              }
            })
          }
          console.log('')
        })

        // Check if any bookings have payments
        console.log('📋 Step 3: Checking Payments for Bookings...')
        let hasPayments = false
        
        for (const booking of bookings) {
          if (booking.appointmentSegments && booking.appointmentSegments.length > 0) {
            // Try to find payments for this booking
            try {
              const paymentsApi = squareClient.paymentsApi
              const searchPaymentsRequest = {
                query: {
                  filter: {
                    customerIds: [CUSTOMER_ID]
                  }
                },
                limit: 100
              }

              const paymentsResponse = await paymentsApi.searchPayments(searchPaymentsRequest)
              const payments = paymentsResponse.result?.payments || []

              if (payments.length > 0) {
                hasPayments = true
                console.log(`   ✅ Found ${payments.length} payment(s) for customer:`)
                
                payments.forEach((payment, pIndex) => {
                  const paymentDate = payment.createdAt ? new Date(payment.createdAt) : null
                  const amountMoney = payment.amountMoney
                  const amount = amountMoney ? (Number(amountMoney.amount) / 100).toFixed(2) : '0.00'
                  
                  console.log(`      Payment ${pIndex + 1}:`)
                  console.log(`         - Payment ID: ${payment.id}`)
                  console.log(`         - Amount: $${amount}`)
                  console.log(`         - Status: ${payment.status}`)
                  if (paymentDate) {
                    console.log(`         - Date: ${paymentDate.toLocaleString()}`)
                  }
                  if (payment.sourceId) {
                    console.log(`         - Source ID: ${payment.sourceId}`)
                  }
                })
                console.log('')
              } else {
                console.log(`   ❌ No payments found for this customer`)
              }
            } catch (paymentError) {
              console.log(`   ⚠️  Error checking payments: ${paymentError.message}`)
            }
            break // Only check once
          }
        }

        if (!hasPayments) {
          console.log('   ⚠️  No payments found for bookings')
        }

      } else {
        console.log('   ❌ No bookings found for this customer in Square')
        console.log('')
        
        // Check if there are any payments at all
        console.log('📋 Step 3: Checking for any Payments...')
        try {
          const paymentsApi = squareClient.paymentsApi
          const searchPaymentsRequest = {
            query: {
              filter: {
                customerIds: [CUSTOMER_ID]
              }
            },
            limit: 100
          }

          const paymentsResponse = await paymentsApi.searchPayments(searchPaymentsRequest)
          const payments = paymentsResponse.result?.payments || []

          if (payments.length > 0) {
            console.log(`   ✅ Found ${payments.length} payment(s) (but no bookings):`)
            payments.forEach((payment, pIndex) => {
              const paymentDate = payment.createdAt ? new Date(payment.createdAt) : null
              const amountMoney = payment.amountMoney
              const amount = amountMoney ? (Number(amountMoney.amount) / 100).toFixed(2) : '0.00'
              
              console.log(`      Payment ${pIndex + 1}:`)
              console.log(`         - Payment ID: ${payment.id}`)
              console.log(`         - Amount: $${amount}`)
              console.log(`         - Status: ${payment.status}`)
              if (paymentDate) {
                console.log(`         - Date: ${paymentDate.toLocaleString()}`)
              }
            })
          } else {
            console.log('   ❌ No payments found either')
          }
        } catch (paymentError) {
          console.log(`   ⚠️  Error checking payments: ${paymentError.message}`)
        }
        console.log('')
      }

    } catch (squareError) {
      console.log(`   ❌ Error fetching from Square: ${squareError.message}`)
      if (squareError.errors) {
        console.log(`   Square API Errors:`, JSON.stringify(squareError.errors, null, 2))
      }
    }

    // Step 4: Summary
    console.log('📋 Step 4: Summary')
    if (!customer.first_payment_completed) {
      console.log('   ⚠️  Customer has NOT completed first payment')
      console.log('      → This explains why referral code was not generated automatically')
      console.log('      → Referral codes are generated after first payment completion')
    } else {
      console.log('   ✅ Customer has completed first payment')
      console.log('      → But referral code may have been created manually')
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

checkCustomerBookings()

