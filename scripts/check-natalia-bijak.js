#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production,
})

const giftCardsApi = squareClient.giftCardsApi
const customersApi = squareClient.customersApi

const CUSTOMER_ID = '5Q1A2BG073YPWP8G6H0FGQE9VG'

async function checkNataliaBijak() {
  console.log('🔍 Checking Natalia Bijak Gift Card Status')
  console.log('='.repeat(60))
  console.log(`Customer ID: ${CUSTOMER_ID}`)
  console.log('')

  try {
    // Step 1: Get customer from database
    const dbCustomer = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address,
             gift_card_id, gift_card_gan, gift_card_order_id,
             gift_card_delivery_channel, gift_card_activation_url,
             gift_card_pass_kit_url, gift_card_digital_email,
             got_signup_bonus, used_referral_code, first_payment_completed,
             gift_card_order_id, gift_card_line_item_uid
      FROM square_existing_clients 
      WHERE square_customer_id = ${CUSTOMER_ID}
    `

    if (!dbCustomer || dbCustomer.length === 0) {
      console.log('❌ Customer not found in database')
      return
    }

    const customer = dbCustomer[0]
    console.log('📋 Database Information:')
    console.log(`   Name: ${customer.given_name} ${customer.family_name}`)
    console.log(`   Email: ${customer.email_address || 'None'}`)
    console.log(`   Gift Card ID: ${customer.gift_card_id || 'None'}`)
    console.log(`   Gift Card GAN: ${customer.gift_card_gan || 'None'}`)
    console.log(`   Delivery Channel: ${customer.gift_card_delivery_channel || 'None'}`)
    console.log(`   Got Signup Bonus: ${customer.got_signup_bonus}`)
    console.log(`   Used Referral Code: ${customer.used_referral_code || 'None'}`)
    console.log('')

    // Step 2: Get gift card from Square
    if (customer.gift_card_id) {
      console.log('🎁 Square Gift Card Information:')
      try {
        const giftCardResponse = await giftCardsApi.retrieveGiftCard(customer.gift_card_id)
        const giftCard = giftCardResponse.result.giftCard

        if (giftCard) {
          const balanceCents = giftCard.balanceMoney?.amount || 0
          const balance = (balanceCents / 100).toFixed(2)
          console.log(`   ✅ Gift Card Found:`)
          console.log(`      - ID: ${giftCard.id}`)
          console.log(`      - GAN: ${giftCard.gan}`)
          console.log(`      - Balance: $${balance}`)
          console.log(`      - State: ${giftCard.state}`)
          console.log(`      - Type: ${giftCard.type}`)
          console.log('')

          // Check activities
          console.log('📋 Gift Card Activities:')
          try {
            const activitiesResponse = await giftCardsApi.listGiftCardActivities(
              customer.gift_card_id,
              {}
            )

            if (activitiesResponse.result?.giftCardActivities) {
              const activities = activitiesResponse.result.giftCardActivities
              console.log(`   Found ${activities.length} activity/activities:`)
              activities.forEach((activity, index) => {
                console.log(`   Activity ${index + 1}:`)
                console.log(`      - Type: ${activity.type}`)
                console.log(`      - Created: ${activity.createdAt}`)
                
                if (activity.activateActivityDetails) {
                  const details = activity.activateActivityDetails
                  console.log(`      - Activation Amount: $${(details.amountMoney?.amount || 0) / 100}`)
                  console.log(`      - Order ID: ${details.orderId || 'N/A'}`)
                }
                
                if (activity.adjustIncrementActivityDetails) {
                  const details = activity.adjustIncrementActivityDetails
                  console.log(`      - Load Amount: $${(details.amountMoney?.amount || 0) / 100}`)
                }
              })
            } else {
              console.log('   No activities found')
            }
          } catch (error) {
            console.log(`   ⚠️ Could not fetch activities: ${error.message}`)
          }
        }
      } catch (error) {
        console.log(`   ❌ Error fetching gift card: ${error.message}`)
      }
    }

    // Step 3: Check notification events
    console.log('')
    console.log('📧 Email Notification Status:')
    const notifications = await prisma.$queryRaw`
      SELECT * FROM notification_events 
      WHERE "customerId" = ${CUSTOMER_ID} 
         OR "referrerCustomerId" = ${CUSTOMER_ID}
      ORDER BY "createdAt" DESC
      LIMIT 5
    `

    if (notifications && notifications.length > 0) {
      console.log(`   Found ${notifications.length} notification(s):`)
      notifications.forEach((notif, idx) => {
        console.log(`   Notification ${idx + 1}:`)
        console.log(`      - Channel: ${notif.channel}`)
        console.log(`      - Template: ${notif.templateType}`)
        console.log(`      - Status: ${notif.status}`)
        console.log(`      - Created: ${notif.createdAt}`)
        if (notif.errorMessage) {
          console.log(`      - Error: ${notif.errorMessage}`)
        }
      })
    } else {
      console.log('   ⚠️ No notification events found in database')
      console.log('   This suggests the email may not have been sent')
    }

    // Step 4: Check gift card runs
    console.log('')
    console.log('📋 Gift Card Processing Runs:')
    const runs = await prisma.$queryRaw`
      SELECT correlation_id, square_event_type, stage, status, 
             last_error, created_at, updated_at
      FROM giftcard_runs 
      WHERE resource_id = ${CUSTOMER_ID} 
         OR context->>'customerId' = ${CUSTOMER_ID}
      ORDER BY created_at DESC
      LIMIT 3
    `

    if (runs && runs.length > 0) {
      runs.forEach((run, idx) => {
        console.log(`   Run ${idx + 1}:`)
        console.log(`      - Event: ${run.square_event_type}`)
        console.log(`      - Stage: ${run.stage}`)
        console.log(`      - Status: ${run.status}`)
        console.log(`      - Created: ${run.created_at}`)
        if (run.last_error) {
          console.log(`      - Error: ${run.last_error}`)
        }
      })
    }

    // Step 5: Analysis
    console.log('')
    console.log('🔍 Analysis:')
    
    if (!customer.email_address) {
      console.log('   ❌ Issue: Customer has no email address in database')
      console.log('      - Email cannot be sent without email address')
    } else {
      console.log(`   ✅ Email address exists: ${customer.email_address}`)
    }

    if (!customer.gift_card_gan) {
      console.log('   ❌ Issue: Gift card GAN is missing')
      console.log('      - Email requires GAN to send')
    } else {
      console.log(`   ✅ Gift card GAN exists: ${customer.gift_card_gan}`)
    }

    if (!notifications || notifications.length === 0) {
      console.log('   ⚠️ Issue: No notification events found')
      console.log('      - Possible reasons:')
      console.log('        1. Email sending was skipped (check logs)')
      console.log('        2. Email sending failed silently')
      console.log('        3. Notification event was not created')
      console.log('      - Check application logs for:')
      console.log('        * "⚠️ Friend gift card email skipped"')
      console.log('        * "📧 Attempting to send gift card email"')
      console.log('        * "❌ Error sending gift card email"')
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

checkNataliaBijak()




