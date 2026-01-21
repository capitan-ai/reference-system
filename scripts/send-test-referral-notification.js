require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { sendReferralCodeUsageNotification } = require('../lib/email-service-simple')

async function findLastReferralCodeUsage() {
  try {
    console.log('🔍 Finding last customer who used a referral code...\n')

    // Find the most recent customer who used a referral code
    const lastCustomer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        phone_number,
        personal_code,
        used_referral_code,
        gift_card_id,
        gift_card_gan,
        created_at,
        updated_at
      FROM square_existing_clients
      WHERE used_referral_code IS NOT NULL
        AND used_referral_code != ''
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `

    if (!lastCustomer || lastCustomer.length === 0) {
      console.log('❌ No customers found who used a referral code')
      return null
    }

    const customer = lastCustomer[0]
    console.log(`✅ Found customer: ${customer.given_name} ${customer.family_name}`)
    console.log(`   Customer ID: ${customer.square_customer_id}`)
    console.log(`   Used referral code: ${customer.used_referral_code}`)
    console.log(`   Email: ${customer.email_address || 'N/A'}`)
    console.log(`   Updated: ${customer.updated_at}\n`)

    // Find the referrer
    const referrer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        personal_code
      FROM square_existing_clients
      WHERE personal_code = ${customer.used_referral_code}
        OR UPPER(TRIM(personal_code)) = UPPER(TRIM(${customer.used_referral_code}))
      LIMIT 1
    `

    if (!referrer || referrer.length === 0) {
      console.log(`⚠️ Referrer not found for code: ${customer.used_referral_code}`)
      return null
    }

    const referrerData = referrer[0]
    console.log(`✅ Found referrer: ${referrerData.given_name} ${referrerData.family_name}`)
    console.log(`   Referrer ID: ${referrerData.square_customer_id}`)
    console.log(`   Personal code: ${referrerData.personal_code}\n`)

    // Try to find booking information
    let bookingInfo = null
    try {
      const booking = await prisma.$queryRaw`
        SELECT 
          id as booking_id,
          start_at,
          location_id
        FROM bookings
        WHERE customer_id = ${customer.square_customer_id}
        ORDER BY start_at DESC
        LIMIT 1
      `
      if (booking && booking.length > 0) {
        bookingInfo = booking[0]
        console.log(`✅ Found booking: ${bookingInfo.booking_id}`)
      }
    } catch (error) {
      console.log(`ℹ️ Could not find booking info (table might not exist): ${error.message}`)
    }

    // Prepare gift card info
    const giftCardInfo = customer.gift_card_id ? {
      giftCardId: customer.gift_card_id,
      giftCardGan: customer.gift_card_gan || 'N/A',
      amountCents: 1000 // $10
    } : null

    if (giftCardInfo) {
      console.log(`✅ Found gift card: ${giftCardInfo.giftCardId}`)
    }

    console.log('\n📧 Preparing notification email...\n')

    // Send notification
    const result = await sendReferralCodeUsageNotification({
      referralCode: customer.used_referral_code,
      customer: {
        square_customer_id: customer.square_customer_id,
        given_name: customer.given_name,
        family_name: customer.family_name,
        email_address: customer.email_address,
        phone_number: customer.phone_number,
        personal_code: customer.personal_code
      },
      referrer: {
        square_customer_id: referrerData.square_customer_id,
        given_name: referrerData.given_name,
        family_name: referrerData.family_name,
        email_address: referrerData.email_address,
        personal_code: referrerData.personal_code
      },
      booking: bookingInfo ? {
        id: bookingInfo.booking_id,
        start_at: bookingInfo.start_at,
        location_id: bookingInfo.location_id
      } : null,
      giftCard: giftCardInfo,
      source: 'test-script (last-customer)'
    })

    if (result.success) {
      console.log('✅ Notification sent successfully!')
      console.log(`   Method: ${result.method || 'unknown'}`)
      console.log(`   Message ID: ${result.messageId || 'N/A'}`)
      console.log(`   Email: ${result.email || 'N/A'}`)
    } else if (result.skipped) {
      console.log('⚠️ Notification skipped')
      console.log(`   Reason: ${result.reason || 'unknown'}`)
    } else {
      console.log('❌ Failed to send notification')
      console.log(`   Error: ${result.error || 'unknown'}`)
    }

    return result
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
findLastReferralCodeUsage()
  .then(() => {
    console.log('\n✅ Script completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error.message)
    process.exit(1)
  })



