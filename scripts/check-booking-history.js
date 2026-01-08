#!/usr/bin/env node
/**
 * Check booking history for customers to determine when referral code was used
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { Client, Environment } = require('square')
const { getSquareEnvironmentName } = require('../lib/utils/square-env')

const squareEnvironmentName = getSquareEnvironmentName()
const environment = squareEnvironmentName === 'sandbox' ? Environment.Sandbox : Environment.Production
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment,
})
const bookingsApi = squareClient.bookingsApi
const customersApi = squareClient.customersApi

async function getCustomerBookings(customerId) {
  try {
    const bookings = []
    let cursor = undefined
    
    do {
      const response = await bookingsApi.listBookings(
        100, // limit
        cursor,
        customerId, // customerId filter
        undefined, // teamMemberId
        undefined, // locationId
        undefined, // startAt
        undefined  // endAt
      )
      
      if (response.result?.bookings) {
        bookings.push(...response.result.bookings)
      }
      
      cursor = response.result?.cursor || undefined
    } while (cursor)
    
    return bookings.sort((a, b) => {
      const aTime = a.createdAt || a.created_at || 0
      const bTime = b.createdAt || b.created_at || 0
      return new Date(aTime) - new Date(bTime)
    })
  } catch (error) {
    console.error(`   ❌ Error fetching bookings: ${error.message}`)
    return []
  }
}

async function extractReferralCodeFromBooking(booking) {
  // Check various places where referral code might be stored
  const sources = [
    booking.source,
    booking.customerNote,
    booking.sellerNote,
    booking.appointmentSegments?.[0]?.customerNote,
    booking.customAttributes,
    booking.metadata
  ]
  
  for (const source of sources) {
    if (!source) continue
    
    if (typeof source === 'string') {
      // Try to find referral code pattern (uppercase letters + numbers)
      const match = source.match(/\b([A-Z]{2,}[A-Z0-9]{4,})\b/)
      if (match) {
        return { code: match[1], source: 'string_field' }
      }
    }
    
    if (typeof source === 'object') {
      // Check custom attributes
      if (Array.isArray(source)) {
        for (const attr of source) {
          if (attr.key && attr.key.includes('referral')) {
            return { code: attr.value, source: 'custom_attribute' }
          }
        }
      } else {
        // Check metadata object
        for (const [key, value] of Object.entries(source)) {
          if (key.toLowerCase().includes('referral') || key.toLowerCase().includes('ref')) {
            return { code: value, source: `metadata.${key}` }
          }
        }
      }
    }
  }
  
  return null
}

async function checkBookingHistory() {
  console.log('📅 Checking Booking History for Self-Referral Cases\n')
  console.log('='.repeat(80))
  
  try {
    const selfReferrals = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        used_referral_code,
        personal_code,
        first_payment_completed,
        got_signup_bonus,
        gift_card_id,
        created_at,
        updated_at,
        activated_as_referrer
      FROM square_existing_clients
      WHERE used_referral_code IS NOT NULL
        AND used_referral_code != ''
        AND personal_code IS NOT NULL
        AND personal_code != ''
        AND UPPER(TRIM(used_referral_code)) = UPPER(TRIM(personal_code))
      ORDER BY created_at
    `
    
    if (!selfReferrals || selfReferrals.length === 0) {
      console.log('✅ No self-referrals found.')
      return
    }
    
    console.log(`\n📋 Found ${selfReferrals.length} potential self-referrals:\n`)
    
    for (const customer of selfReferrals) {
      const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim()
      console.log(`\n${'='.repeat(80)}`)
      console.log(`\n👤 ${name} (${customer.square_customer_id})`)
      console.log(`   Used code: ${customer.used_referral_code}`)
      console.log(`   Personal code: ${customer.personal_code}`)
      console.log(`   Account created: ${customer.created_at}`)
      console.log(`   First payment completed: ${customer.first_payment_completed ? '✅ Yes' : '❌ No'}`)
      console.log(`   Activated as referrer: ${customer.activated_as_referrer ? '✅ Yes' : '❌ No'}`)
      if (customer.activated_as_referrer) {
        console.log(`   Referrer activated at: ${customer.updated_at}`)
      }
      
      // Get bookings from Square
      console.log(`\n   📅 Fetching booking history from Square...`)
      const bookings = await getCustomerBookings(customer.square_customer_id)
      
      if (bookings.length === 0) {
        console.log(`   ⚠️  No bookings found in Square API`)
        continue
      }
      
      console.log(`   ✅ Found ${bookings.length} booking(s)\n`)
      
      let firstBookingWithCode = null
      let bookingWithMatchingCode = null
      
      for (let i = 0; i < bookings.length; i++) {
        const booking = bookings[i]
        const bookingId = booking.id
        const createdAt = booking.createdAt || booking.created_at
        const status = booking.status || 'UNKNOWN'
        
        console.log(`   ${i + 1}. Booking ${bookingId}`)
        console.log(`      Created: ${createdAt}`)
        console.log(`      Status: ${status}`)
        
        // Try to extract referral code from booking
        const codeInfo = await extractReferralCodeFromBooking(booking)
        
        if (codeInfo) {
          console.log(`      Referral code found: ${codeInfo.code} (from ${codeInfo.source})`)
          
          if (!firstBookingWithCode) {
            firstBookingWithCode = { booking, codeInfo, index: i + 1 }
          }
          
          if (codeInfo.code.toUpperCase().trim() === customer.used_referral_code.toUpperCase().trim()) {
            bookingWithMatchingCode = { booking, codeInfo, index: i + 1 }
            console.log(`      ✅ MATCHES used_referral_code!`)
          }
        } else {
          console.log(`      No referral code found in booking data`)
        }
        
        // Check if this booking has customer ID
        const bookingCustomerId = booking.customerId || booking.customer_id || booking.creator_details?.customer_id
        if (bookingCustomerId) {
          console.log(`      Customer ID: ${bookingCustomerId}`)
        }
      }
      
      // Analysis
      console.log(`\n   🔍 ANALYSIS:`)
      
      if (bookings.length > 0) {
        const firstBooking = bookings[0]
        const firstBookingTime = new Date(firstBooking.createdAt || firstBooking.created_at)
        const accountCreated = new Date(customer.created_at)
        const referrerActivated = customer.activated_as_referrer 
          ? new Date(customer.updated_at) 
          : null
        
        console.log(`      First booking: ${firstBookingTime.toISOString()}`)
        console.log(`      Account created: ${accountCreated.toISOString()}`)
        
        if (referrerActivated) {
          console.log(`      Referrer activated: ${referrerActivated.toISOString()}`)
          
          if (firstBookingTime < referrerActivated) {
            console.log(`      ✅ First booking was BEFORE becoming a referrer`)
            console.log(`      ✅ Personal code didn't exist yet at first booking`)
            if (bookingWithMatchingCode) {
              console.log(`      ⚠️  BUT: Found matching code in booking #${bookingWithMatchingCode.index}`)
              const matchingBookingTime = new Date(
                bookingWithMatchingCode.booking.createdAt || 
                bookingWithMatchingCode.booking.created_at
              )
              if (matchingBookingTime >= referrerActivated) {
                console.log(`      ⚠️  Matching code was used AFTER becoming a referrer`)
                console.log(`      ⚠️  This IS a self-referral!`)
              } else {
                console.log(`      ✅ Matching code was used BEFORE becoming a referrer`)
                console.log(`      ✅ This is NOT a self-referral (data inconsistency)`)
              }
            } else {
              console.log(`      ⚠️  No matching code found in any booking`)
              console.log(`      ⚠️  Code might have been set incorrectly in database`)
            }
          } else {
            console.log(`      ⚠️  First booking was AFTER becoming a referrer`)
            console.log(`      ⚠️  They could have used their own code!`)
            if (bookingWithMatchingCode) {
              console.log(`      ⚠️  Found matching code - this IS a self-referral!`)
            }
          }
        } else {
          console.log(`      ⚠️  Not activated as referrer yet`)
        }
      }
      
      // Check ref_matches in database
      const refMatches = await prisma.$queryRaw`
        SELECT 
          id,
          "refCode",
          "matchedAt",
          "matchedVia",
          "bookingId"
        FROM ref_matches
        WHERE "customerId" = ${customer.square_customer_id}
        ORDER BY "matchedAt" ASC
      `
      
      if (refMatches && refMatches.length > 0) {
        console.log(`\n   📋 Database RefMatches:`)
        refMatches.forEach((match, idx) => {
          console.log(`      ${idx + 1}. Code: ${match.refCode}`)
          console.log(`         Matched at: ${match.matchedAt}`)
          console.log(`         Via: ${match.matchedVia || 'N/A'}`)
          console.log(`         Booking: ${match.bookingId || 'N/A'}`)
        })
      }
    }
    
    console.log(`\n${'='.repeat(80)}`)
    console.log('\n✅ Booking history check complete\n')
    
  } catch (error) {
    console.error('\n❌ Error checking booking history:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  checkBookingHistory()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

module.exports = { checkBookingHistory }

