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

async function getCustomerGiftCardData(customerId) {
  console.log('🎁 Fetching Gift Card Data')
  console.log('=' .repeat(60))
  console.log(`Customer ID: ${customerId}`)
  console.log('')
  
  try {
    // Step 1: Get customer data from database
    console.log('📋 Step 1: Database Information...')
    const dbCustomer = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address,
             gift_card_id, got_signup_bonus, used_referral_code,
             first_payment_completed, activated_as_referrer, personal_code
      FROM square_existing_clients 
      WHERE square_customer_id = ${customerId}
    `
    
    if (!dbCustomer || dbCustomer.length === 0) {
      console.log('   ❌ Customer not found in database')
      return
    }
    
    const customer = dbCustomer[0]
    console.log(`   ✅ Customer: ${customer.given_name || 'Unknown'} ${customer.family_name || ''}`)
    console.log(`   - Email: ${customer.email_address || 'None'}`)
    console.log(`   - Gift Card ID (from DB): ${customer.gift_card_id || 'None'}`)
    console.log(`   - Got signup bonus: ${customer.got_signup_bonus}`)
    console.log(`   - Used referral code: ${customer.used_referral_code || 'None'}`)
    console.log(`   - First payment completed: ${customer.first_payment_completed || false}`)
    console.log(`   - Activated as referrer: ${customer.activated_as_referrer || false}`)
    console.log(`   - Personal code: ${customer.personal_code || 'None'}`)
    console.log('')
    
    // Step 2: Get gift card from Square
    if (customer.gift_card_id) {
      console.log('📋 Step 2: Square Gift Card Information...')
      console.log(`   Gift Card ID: ${customer.gift_card_id}`)
      
      try {
        const giftCardResponse = await giftCardsApi.retrieveGiftCard(customer.gift_card_id)
        const giftCard = giftCardResponse.result.giftCard
        
        if (giftCard) {
          console.log('   ✅ Gift Card Found in Square:')
          console.log('')
          console.log('   📊 Gift Card Details:')
          console.log(`      - ID: ${giftCard.id}`)
          console.log(`      - Type: ${giftCard.type}`)
          console.log(`      - State: ${giftCard.state}`)
          console.log(`      - Balance: $${(giftCard.balanceMoney?.amount || 0) / 100}`)
          console.log(`      - Currency: ${giftCard.balanceMoney?.currency || 'USD'}`)
          
          if (giftCard.ganSource) {
            console.log(`      - GAN Source: ${giftCard.ganSource}`)
          }
          
          if (giftCard.gan) {
            console.log(`      - GAN: ${giftCard.gan}`)
          }
          
          console.log('')
          
          // Get gift card activities
          console.log('📋 Step 3: Gift Card Activities...')
          try {
            const activitiesResponse = await giftCardsApi.listGiftCardActivities(
              customer.gift_card_id,
              {}
            )
            
            if (activitiesResponse.result && activitiesResponse.result.giftCardActivities) {
              const activities = activitiesResponse.result.giftCardActivities
              console.log(`   Found ${activities.length} activity/activities:`)
              console.log('')
              
              activities.forEach((activity, index) => {
                console.log(`   Activity ${index + 1}:`)
                console.log(`      - ID: ${activity.id}`)
                console.log(`      - Type: ${activity.type}`)
                console.log(`      - Created At: ${activity.createdAt}`)
                
                if (activity.activateActivityDetails) {
                  const details = activity.activateActivityDetails
                  console.log(`      - Amount: $${(details.amountMoney?.amount || 0) / 100}`)
                  console.log(`      - Order ID: ${details.orderId || 'N/A'}`)
                }
                
                if (activity.activateActivityDetails) {
                  const details = activity.activateActivityDetails
                  console.log(`      - Amount: $${(details.amountMoney?.amount || 0) / 100}`)
                }
                
                if (activity.redeemActivityDetails) {
                  const details = activity.redeemActivityDetails
                  console.log(`      - Amount Redeemed: $${(details.amountMoney?.amount || 0) / 100}`)
                  console.log(`      - Payment ID: ${details.paymentId || 'N/A'}`)
                }
                
                if (activity.loadActivityDetails) {
                  const details = activity.loadActivityDetails
                  console.log(`      - Amount Loaded: $${(details.amountMoney?.amount || 0) / 100}`)
                  console.log(`      - Order ID: ${details.orderId || 'N/A'}`)
                }
                
                console.log('')
              })
            } else {
              console.log('   No activities found')
            }
          } catch (error) {
            console.log(`   ⚠️ Could not fetch activities: ${error.message}`)
          }
          
          // Get customer from Square
          console.log('📋 Step 4: Customer Information from Square...')
          try {
            const customerResponse = await customersApi.retrieveCustomer(customerId)
            const squareCustomer = customerResponse.result.customer
            
            if (squareCustomer) {
              console.log(`   ✅ Customer found in Square:`)
              console.log(`      - Name: ${squareCustomer.givenName || ''} ${squareCustomer.familyName || ''}`)
              console.log(`      - Email: ${squareCustomer.emailAddress || 'None'}`)
              console.log(`      - Phone: ${squareCustomer.phoneNumber || 'None'}`)
              console.log(`      - Created: ${squareCustomer.createdAt || 'N/A'}`)
            }
          } catch (error) {
            console.log(`   ⚠️ Could not fetch customer: ${error.message}`)
          }
          
        } else {
          console.log('   ❌ Gift card not found in Square')
        }
      } catch (error) {
        console.log(`   ❌ Error fetching gift card: ${error.message}`)
        if (error.errors) {
          console.log(`   Square API Errors:`, JSON.stringify(error.errors, null, 2))
        }
      }
    } else {
      console.log('📋 Step 2: No Gift Card ID in database')
      console.log('   ⚠️ Customer does not have a gift card assigned')
    }
    
    // Step 5: Check if they used a referral code
    if (customer.used_referral_code) {
      console.log('')
      console.log('📋 Step 5: Referrer Information...')
      const referrer = await prisma.$queryRaw`
        SELECT square_customer_id, given_name, family_name, personal_code,
               total_referrals, total_rewards, gift_card_id
        FROM square_existing_clients 
        WHERE personal_code = ${customer.used_referral_code}
      `
      
      if (referrer && referrer.length > 0) {
        const r = referrer[0]
        console.log(`   ✅ Referrer: ${r.given_name} ${r.family_name}`)
        console.log(`      - Referral Code: ${r.personal_code}`)
        console.log(`      - Total Referrals: ${r.total_referrals || 0}`)
        console.log(`      - Total Rewards: $${(r.total_rewards || 0) / 100}`)
        console.log(`      - Referrer Gift Card: ${r.gift_card_id || 'None'}`)
      }
    }
    
    console.log('')
    console.log('✅ Complete!')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

const customerId = process.argv[2] || '5XSV6VT86R5CYWCJC4QK7FW0E0'
getCustomerGiftCardData(customerId)






