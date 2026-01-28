#!/usr/bin/env node
/**
 * Manually grant referrer reward for Kate Van Van Horne
 * for referring Kate Rodgers
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { createGiftCard, sendGiftCardEmailNotification } = require('../lib/webhooks/giftcard-processors')

const REFERRER_ID = 'A07R0HJ5AS37KDPNENA1W5V2N0' // Kate Van Van Horne
const FRIEND_ID = 'WGKFCXD42JE1QPFBNX5DS2D0NG' // Kate Rodgers
const REFERRER_CODE = 'KATE1520'

async function grantManualReferrerReward() {
  console.log('🎁 Manual Referrer Reward Grant\n')
  console.log('='.repeat(80))
  
  try {
    // 1. Check referrer status
    console.log('\n1️⃣ Checking Referrer Status:')
    const referrer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        personal_code,
        activated_as_referrer,
        total_referrals,
        total_rewards,
        gift_card_id
      FROM square_existing_clients
      WHERE square_customer_id = ${REFERRER_ID}
    `
    
    if (!referrer || referrer.length === 0) {
      console.log('❌ Referrer not found!')
      process.exit(1)
    }
    
    const r = referrer[0]
    console.log(`   Name: ${r.given_name} ${r.family_name}`)
    console.log(`   Email: ${r.email_address || 'N/A'}`)
    console.log(`   Personal code: ${r.personal_code}`)
    console.log(`   Activated: ${r.activated_as_referrer ? '✅ Yes' : '❌ No'}`)
    console.log(`   Current referrals: ${r.total_referrals || 0}`)
    console.log(`   Current rewards: $${((r.total_rewards || 0) / 100).toFixed(2)}`)
    console.log(`   Gift card ID: ${r.gift_card_id || '❌ NONE'}`)
    
    // 2. Check friend status
    console.log('\n2️⃣ Checking Friend Status:')
    const friend = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        used_referral_code,
        first_payment_completed
      FROM square_existing_clients
      WHERE square_customer_id = ${FRIEND_ID}
    `
    
    if (!friend || friend.length === 0) {
      console.log('❌ Friend not found!')
      process.exit(1)
    }
    
    const f = friend[0]
    console.log(`   Name: ${f.given_name} ${f.family_name}`)
    console.log(`   Used code: ${f.used_referral_code}`)
    console.log(`   First payment: ${f.first_payment_completed ? '✅ Completed' : '❌ Not completed'}`)
    
    if (f.used_referral_code !== REFERRER_CODE) {
      console.log(`   ⚠️  WARNING: Friend used code ${f.used_referral_code}, not ${REFERRER_CODE}`)
    }
    
    if (!f.first_payment_completed) {
      console.log(`   ⚠️  WARNING: Friend hasn't completed first payment yet!`)
      console.log(`   Proceed anyway? (This script will grant reward regardless)`)
    }
    
    // 3. Grant reward
    console.log('\n3️⃣ Granting Reward:')
    
    if (!r.gift_card_id) {
      console.log('   Creating NEW gift card for referrer...')
      
      const referrerGiftCard = await createGiftCard(
        r.square_customer_id,
        `${r.given_name} ${r.family_name}`,
        1000, // $10
        true, // isReferrer
        {
          idempotencyKeySeed: `manual-reward-${REFERRER_ID}-${Date.now()}`
        }
      )
      
      if (referrerGiftCard?.giftCardId) {
        await prisma.$executeRaw`
          UPDATE square_existing_clients 
          SET 
            total_referrals = COALESCE(total_referrals, 0) + 1,
            total_rewards = COALESCE(total_rewards, 0) + 1000,
            gift_card_id = ${referrerGiftCard.giftCardId},
            gift_card_gan = ${referrerGiftCard.giftCardGan ?? null},
            gift_card_order_id = ${referrerGiftCard.orderId ?? null},
            gift_card_line_item_uid = ${referrerGiftCard.lineItemUid ?? null},
            gift_card_delivery_channel = ${referrerGiftCard.activationChannel ?? null},
            gift_card_activation_url = ${referrerGiftCard.activationUrl ?? null},
            gift_card_pass_kit_url = ${referrerGiftCard.passKitUrl ?? null},
            gift_card_digital_email = ${referrerGiftCard.digitalEmail ?? null},
            updated_at = NOW()
          WHERE square_customer_id = ${r.square_customer_id}
        `
        
        console.log(`   ✅ Created gift card: ${referrerGiftCard.giftCardId}`)
        console.log(`   ✅ Updated referrer stats`)
        
        // Send email
        if (r.email_address) {
          console.log('   Sending email notification...')
          await sendGiftCardEmailNotification({
            customerName: `${r.given_name} ${r.family_name}`,
            email: r.email_address,
            giftCardGan: referrerGiftCard.giftCardGan,
            amountCents: 1000,
            balanceCents: referrerGiftCard.balanceCents,
            activationUrl: referrerGiftCard.activationUrl,
            passKitUrl: referrerGiftCard.passKitUrl
          })
          console.log('   ✅ Email sent')
        } else {
          console.log('   ⚠️  No email address, skipping email')
        }
      } else {
        console.log('   ❌ Failed to create gift card')
        process.exit(1)
      }
    } else {
      console.log('   Loading $10 onto EXISTING gift card...')
      const { loadGiftCard } = require('../lib/webhooks/giftcard-processors')
      
      const loadResult = await loadGiftCard(
        r.gift_card_id,
        1000, // $10
        r.square_customer_id,
        'Manual referrer reward grant',
        {
          idempotencyKeySeed: `manual-load-${REFERRER_ID}-${Date.now()}`
        }
      )
      
      if (loadResult.success) {
        await prisma.$executeRaw`
          UPDATE square_existing_clients 
          SET 
            total_referrals = COALESCE(total_referrals, 0) + 1,
            total_rewards = COALESCE(total_rewards, 0) + 1000,
            gift_card_gan = ${loadResult.giftCardGan ?? null},
            gift_card_delivery_channel = ${loadResult.deliveryChannel ?? null},
            gift_card_activation_url = ${loadResult.activationUrl ?? null},
            gift_card_pass_kit_url = ${loadResult.passKitUrl ?? null},
            gift_card_digital_email = ${loadResult.digitalEmail ?? null},
            updated_at = NOW()
          WHERE square_customer_id = ${r.square_customer_id}
        `
        
        console.log(`   ✅ Loaded $10 onto gift card: ${r.gift_card_id}`)
        console.log(`   ✅ Updated referrer stats`)
        
        // Send email
        if (r.email_address && loadResult.giftCardGan) {
          console.log('   Sending email notification...')
          await sendGiftCardEmailNotification({
            customerName: `${r.given_name} ${r.family_name}`,
            email: r.email_address,
            giftCardGan: loadResult.giftCardGan,
            amountCents: 1000,
            balanceCents: loadResult.balanceCents,
            activationUrl: loadResult.activationUrl,
            passKitUrl: loadResult.passKitUrl
          })
          console.log('   ✅ Email sent')
        } else {
          console.log('   ⚠️  No email address or GAN, skipping email')
        }
      } else {
        console.log(`   ❌ Failed to load gift card: ${loadResult.error || 'Unknown error'}`)
        process.exit(1)
      }
    }
    
    // 4. Verify
    console.log('\n4️⃣ Verification:')
    const updated = await prisma.$queryRaw`
      SELECT 
        total_referrals,
        total_rewards,
        gift_card_id
      FROM square_existing_clients
      WHERE square_customer_id = ${REFERRER_ID}
    `
    
    const u = updated[0]
    console.log(`   Total referrals: ${u.total_referrals}`)
    console.log(`   Total rewards: $${((u.total_rewards || 0) / 100).toFixed(2)}`)
    console.log(`   Gift card ID: ${u.gift_card_id || 'N/A'}`)
    
    console.log('\n' + '='.repeat(80))
    console.log('✅ Reward granted successfully!')
    console.log('='.repeat(80))
    
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

grantManualReferrerReward()





