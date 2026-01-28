#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function checkCustomerInfo(phoneNumber) {
  console.log('🔍 Checking Customer Information')
  console.log('='.repeat(60))
  console.log(`Phone Number: ${phoneNumber}`)
  console.log('')

  try {
    // Normalize phone number
    const normalized = phoneNumber.replace(/\D/g, '')
    const last10 = normalized.slice(-10)
    
    // Find customer
    const customers = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        phone_number,
        email_address,
        personal_code,
        referral_url,
        used_referral_code,
        got_signup_bonus,
        first_payment_completed,
        activated_as_referrer,
        gift_card_id,
        gift_card_gan,
        total_referrals,
        total_rewards,
        created_at,
        updated_at
      FROM square_existing_clients
      WHERE phone_number LIKE ${`%${last10}%`}
         OR phone_number LIKE ${`%${normalized}%`}
         OR phone_number LIKE ${`%+${normalized}%`}
      ORDER BY updated_at DESC
      LIMIT 5
    `

    if (!customers || customers.length === 0) {
      console.log('❌ Customer not found')
      return
    }

    const customer = customers[0]
    console.log('✅ Customer Found:')
    console.log(`   Name: ${customer.given_name || ''} ${customer.family_name || ''}`)
    console.log(`   Customer ID: ${customer.square_customer_id}`)
    console.log(`   Phone: ${customer.phone_number}`)
    console.log(`   Email: ${customer.email_address || 'None'}`)
    console.log(`   Personal Code: ${customer.personal_code || 'None'}`)
    console.log(`   Referral URL: ${customer.referral_url || 'None'}`)
    console.log('')

    // Check bookings
    console.log('📅 Bookings:')
    const bookings = await prisma.$queryRaw`
      SELECT 
        id,
        booking_id,
        customer_id,
        status,
        start_at,
        location_id,
        service_variation_id,
        created_at
      FROM bookings
      WHERE customer_id = ${customer.square_customer_id}
      ORDER BY start_at DESC
      LIMIT 10
    `

    if (bookings && bookings.length > 0) {
      console.log(`   Found ${bookings.length} booking(s):`)
      bookings.forEach((booking, idx) => {
        const date = booking.start_at ? new Date(booking.start_at).toLocaleString() : 'N/A'
        console.log(`   ${idx + 1}. ${date} - Status: ${booking.status} - Booking ID: ${booking.booking_id || 'N/A'}`)
      })
    } else {
      console.log('   No bookings found')
    }
    console.log('')

    // Check referral code usage
    console.log('🎁 Referral & Gift Card Information:')
    console.log(`   Used Referral Code: ${customer.used_referral_code || 'None'}`)
    console.log(`   Got Signup Bonus: ${customer.got_signup_bonus ? 'Yes' : 'No'}`)
    console.log(`   First Payment Completed: ${customer.first_payment_completed ? 'Yes' : 'No'}`)
    console.log(`   Activated as Referrer: ${customer.activated_as_referrer ? 'Yes' : 'No'}`)
    console.log(`   Total Referrals: ${customer.total_referrals || 0}`)
    console.log(`   Total Rewards: $${((customer.total_rewards || 0) / 100).toFixed(2)}`)
    console.log(`   Gift Card ID: ${customer.gift_card_id || 'None'}`)
    console.log(`   Gift Card GAN: ${customer.gift_card_gan || 'None'}`)
    console.log('')

    // Check if they received $10 gift card
    if (customer.gift_card_id) {
      console.log('💰 Gift Card Details:')
      console.log(`   Gift Card ID: ${customer.gift_card_id}`)
      
      // Check gift card transactions/balance
      const giftCardTransactions = await prisma.$queryRaw`
        SELECT 
          id,
          gift_card_id,
          transaction_type,
          amount_cents,
          created_at
        FROM gift_card_transactions
        WHERE gift_card_id = ${customer.gift_card_id}
        ORDER BY created_at DESC
        LIMIT 5
      `

      if (giftCardTransactions && giftCardTransactions.length > 0) {
        console.log(`   Found ${giftCardTransactions.length} transaction(s):`)
        let totalIssued = 0
        giftCardTransactions.forEach((tx, idx) => {
          const amount = tx.amount_cents ? `$${(tx.amount_cents / 100).toFixed(2)}` : '$0.00'
          const date = tx.created_at ? new Date(tx.created_at).toLocaleString() : 'N/A'
          console.log(`   ${idx + 1}. ${date} - ${tx.transaction_type} - ${amount}`)
          if (tx.transaction_type === 'ISSUE' || tx.transaction_type === 'ACTIVATE') {
            totalIssued += tx.amount_cents || 0
          }
        })
        console.log(`   Total Issued: $${(totalIssued / 100).toFixed(2)}`)
        
        if (totalIssued >= 1000) {
          console.log('   ✅ $10 gift card was given')
        } else if (totalIssued > 0) {
          console.log(`   ⚠️  Only $${(totalIssued / 100).toFixed(2)} was given (expected $10)`)
        } else {
          console.log('   ❌ No gift card amount found')
        }
      } else {
        console.log('   ⚠️  No gift card transactions found in database')
        if (customer.got_signup_bonus) {
          console.log('   ℹ️  Database shows got_signup_bonus = true, but no transactions recorded')
        }
      }
    } else {
      console.log('   ❌ No gift card ID found')
      if (customer.got_signup_bonus) {
        console.log('   ⚠️  Database shows got_signup_bonus = true, but no gift_card_id')
      }
    }
    console.log('')

    // Check if they used a referral code and who referred them
    if (customer.used_referral_code) {
      console.log('👥 Referrer Information:')
      const referrer = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          given_name,
          family_name,
          personal_code,
          total_referrals,
          total_rewards
        FROM square_existing_clients
        WHERE personal_code = ${customer.used_referral_code}
        LIMIT 1
      `

      if (referrer && referrer.length > 0) {
        const r = referrer[0]
        console.log(`   Referred by: ${r.given_name || ''} ${r.family_name || ''}`)
        console.log(`   Referrer Code: ${r.personal_code}`)
        console.log(`   Referrer's Total Referrals: ${r.total_referrals || 0}`)
        console.log(`   Referrer's Total Rewards: $${((r.total_rewards || 0) / 100).toFixed(2)}`)
      } else {
        console.log(`   ⚠️  Referrer with code "${customer.used_referral_code}" not found`)
      }
      console.log('')
    }

    console.log('✅ Complete!')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

const phoneNumber = process.argv[2] || '+18156009303'
checkCustomerInfo(phoneNumber)

