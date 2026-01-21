#!/usr/bin/env node
/**
 * Check if customer used referral code during booking
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

async function checkBookingReferralCode() {
  console.log('🔍 Checking if Referral Code was Used During Booking')
  console.log('='.repeat(60))
  console.log(`Customer ID: ${CUSTOMER_ID}`)
  console.log('')

  try {
    // Step 1: Check database
    console.log('📋 Step 1: Database Information')
    const dbCustomer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        used_referral_code,
        got_signup_bonus,
        first_payment_completed
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
    console.log(`   - Used Referral Code: ${customer.used_referral_code || '❌ None'}`)
    console.log(`   - Got Signup Bonus: ${customer.got_signup_bonus ? '✅ Yes' : '❌ No'}`)
    console.log(`   - First Payment Completed: ${customer.first_payment_completed ? '✅ Yes' : '❌ No'}`)
    console.log('')

    // Step 2: Check bookings in Square API
    console.log('📋 Step 2: Checking Bookings for Referral Code...')
    try {
      const bookingsApi = squareClient.bookingsApi
      
      // Get bookings for this customer
      const allBookings = []
      const now = new Date()
      const monthsToCheck = 12
      
      for (let i = 0; i < monthsToCheck; i++) {
        const endDate = new Date(now)
        endDate.setMonth(endDate.getMonth() - i)
        const startDate = new Date(endDate)
        startDate.setDate(startDate.getDate() - 31)
        
        try {
          const bookingsResponse = await bookingsApi.listBookings(
            100,
            undefined,
            CUSTOMER_ID,
            undefined,
            undefined,
            startDate.toISOString(),
            endDate.toISOString()
          )
          
          const bookings = bookingsResponse.result?.bookings || []
          allBookings.push(...bookings)
          
          if (i < monthsToCheck - 1) {
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        } catch (rangeError) {
          continue
        }
      }
      
      // Remove duplicates
      const uniqueBookings = Array.from(
        new Map(allBookings.map(b => [b.id, b])).values()
      )
      
      if (uniqueBookings.length > 0) {
        console.log(`   ✅ Found ${uniqueBookings.length} booking(s)`)
        console.log('')
        
        for (const booking of uniqueBookings) {
          const startAt = booking.startAt ? new Date(booking.startAt) : null
          const createdAt = booking.createdAt ? new Date(booking.createdAt) : null
          
          console.log(`   Booking ID: ${booking.id}`)
          if (startAt) {
            console.log(`   - Start Time: ${startAt.toLocaleString()}`)
          }
          if (createdAt) {
            console.log(`   - Created: ${createdAt.toLocaleString()}`)
          }
          console.log(`   - Status: ${booking.status}`)
          console.log('')
          
          // Check for referral code in booking data
          console.log(`   📋 Checking for Referral Code in Booking Data:`)
          
          // Method 1: Check customerNote
          if (booking.customerNote) {
            console.log(`      - Customer Note: "${booking.customerNote}"`)
            const noteLower = booking.customerNote.toLowerCase()
            if (noteLower.includes('referral') || noteLower.includes('ref') || noteLower.includes('code')) {
              console.log(`      ⚠️  Note contains referral-related text!`)
            }
          } else {
            console.log(`      - Customer Note: None`)
          }
          
          // Method 2: Check custom attributes
          if (booking.customAttributes && booking.customAttributes.length > 0) {
            console.log(`      - Custom Attributes: ${booking.customAttributes.length} attribute(s)`)
            let foundReferralAttr = false
            booking.customAttributes.forEach(attr => {
              console.log(`         * ${attr.key}: ${attr.value?.stringValue || attr.value || 'N/A'}`)
              const keyLower = attr.key.toLowerCase()
              const valueLower = (attr.value?.stringValue || attr.value || '').toString().toLowerCase()
              if (keyLower.includes('referral') || keyLower.includes('ref') || 
                  valueLower.includes('referral') || valueLower.match(/^[A-Z0-9]{4,12}$/)) {
                foundReferralAttr = true
                console.log(`         ⚠️  This looks like a referral code!`)
              }
            })
            if (!foundReferralAttr) {
              console.log(`         ℹ️  No referral code found in custom attributes`)
            }
          } else {
            console.log(`      - Custom Attributes: None`)
          }
          
          // Method 3: Check appointment segments for notes
          if (booking.appointmentSegments && booking.appointmentSegments.length > 0) {
            console.log(`      - Appointment Segments: ${booking.appointmentSegments.length} segment(s)`)
            booking.appointmentSegments.forEach((segment, idx) => {
              if (segment.anyTeamMemberId) {
                console.log(`         Segment ${idx + 1}: Team Member ID = ${segment.anyTeamMemberId}`)
              }
              if (segment.serviceVariationId) {
                console.log(`         Segment ${idx + 1}: Service Variation ID = ${segment.serviceVariationId}`)
              }
            })
          }
          
          // Method 4: Retrieve full booking details
          try {
            const fullBookingResponse = await bookingsApi.retrieveBooking(booking.id)
            const fullBooking = fullBookingResponse.result?.booking
            
            if (fullBooking) {
              // Check all possible fields
              console.log(`      - Full Booking Details:`)
              
              // Check source
              if (fullBooking.source) {
                console.log(`         Source: ${fullBooking.source}`)
              }
              
              // Check sellerNote
              if (fullBooking.sellerNote) {
                console.log(`         Seller Note: "${fullBooking.sellerNote}"`)
                const sellerNoteLower = fullBooking.sellerNote.toLowerCase()
                if (sellerNoteLower.includes('referral') || sellerNoteLower.includes('ref')) {
                  console.log(`         ⚠️  Seller note contains referral-related text!`)
                }
              }
              
              // Check all custom attributes more thoroughly
              if (fullBooking.customAttributes && fullBooking.customAttributes.length > 0) {
                console.log(`         All Custom Attributes:`)
                fullBooking.customAttributes.forEach(attr => {
                  const value = attr.value?.stringValue || attr.value || ''
                  console.log(`            ${attr.key} = "${value}"`)
                })
              }
            }
          } catch (retrieveError) {
            console.log(`      ⚠️  Could not retrieve full booking details: ${retrieveError.message}`)
          }
          
          console.log('')
        }
        
        // Summary
        console.log('📊 Summary:')
        if (customer.used_referral_code) {
          console.log(`   ✅ Database shows referral code was used: ${customer.used_referral_code}`)
          console.log(`   ✅ Customer got signup bonus: ${customer.got_signup_bonus ? 'Yes' : 'No'}`)
        } else {
          console.log(`   ❌ Database shows NO referral code was used`)
          console.log(`   ❌ Customer did NOT get signup bonus`)
          console.log('')
          console.log('   This means:')
          console.log('   - Customer booked WITHOUT using a referral code')
          console.log('   - Customer did NOT receive $10 gift card as friend reward')
          console.log('   - Customer will get referral code after first payment')
        }
        
      } else {
        console.log('   ❌ No bookings found')
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

checkBookingReferralCode()

