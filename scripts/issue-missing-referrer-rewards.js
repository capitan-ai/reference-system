#!/usr/bin/env node
/**
 * Issue missing referrer rewards for customers who completed first payment
 * but their referrer didn't get a reward
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { findMissingReferrerRewards } = require('./find-missing-referrer-rewards')
const { 
  createGiftCard, 
  loadGiftCard
} = require('../lib/webhooks/giftcard-processors')
const { sendGiftCardEmailNotification } = require('../lib/webhooks/giftcard-processors')

async function issueReferrerReward(friendCustomerId, referrerCustomerId, referrerCode) {
  try {
    console.log(`\n💰 Processing referrer reward:`)
    console.log(`   Friend: ${friendCustomerId}`)
    console.log(`   Referrer: ${referrerCustomerId} (${referrerCode})`)
    
    // Get referrer info
    const referrerData = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        gift_card_id,
        total_referrals,
        total_rewards,
        gift_card_order_id,
        gift_card_line_item_uid,
        gift_card_delivery_channel,
        gift_card_activation_url,
        gift_card_pass_kit_url,
        gift_card_digital_email,
        gift_card_gan
      FROM square_existing_clients 
      WHERE square_customer_id = ${referrerCustomerId}
    `
    
    if (!referrerData || referrerData.length === 0) {
      throw new Error(`Referrer ${referrerCustomerId} not found`)
    }
    
    const referrer = referrerData[0]
    const referrerName = `${referrer.given_name || ''} ${referrer.family_name || ''}`.trim()
    const rewardAmountCents = 1000 // $10
    
    if (!referrer.gift_card_id) {
      // Create new gift card for referrer
      console.log(`   Creating new gift card for referrer...`)
      
      const locationId = process.env.SQUARE_LOCATION_ID?.trim()
      let orderInfoForActivation = null
      
      if (locationId) {
        // Try to create promotion order (optional, can skip if fails)
        try {
          const { createPromotionOrder, completePromotionOrderPayment } = require('../lib/webhooks/giftcard-processors')
          
          const promotionOrder = await createPromotionOrder(
            referrer.square_customer_id,
            { amount: rewardAmountCents, currency: 'USD' },
            'Referrer reward $10',
            locationId,
            { idempotencyKeySeed: `missing-reward-${referrerCustomerId}-${Date.now()}` }
          )
          
          if (promotionOrder?.orderId && promotionOrder?.lineItemUid) {
            const paymentResult = await completePromotionOrderPayment(
              promotionOrder.orderId,
              promotionOrder.amountMoney,
              locationId,
              'Referrer reward gift card',
              { idempotencyKeySeed: `missing-reward-payment-${referrerCustomerId}-${Date.now()}` }
            )
            
            if (paymentResult.success) {
              orderInfoForActivation = {
                orderId: promotionOrder.orderId,
                lineItemUid: promotionOrder.lineItemUid
              }
            }
          }
        } catch (orderError) {
          console.warn(`   ⚠️  Could not create promotion order, will use owner-funded activation:`, orderError.message)
        }
      }
      
      const referrerGiftCard = await createGiftCard(
        referrer.square_customer_id,
        referrerName,
        rewardAmountCents,
        true, // isReferrer
        {
          orderInfo: orderInfoForActivation || undefined,
          idempotencyKeySeed: `missing-reward-${referrerCustomerId}-${friendCustomerId}-${Date.now()}`
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
          WHERE square_customer_id = ${referrer.square_customer_id}
        `
        
        console.log(`   ✅ Created new gift card: ${referrerGiftCard.giftCardId}`)
        console.log(`   ✅ Updated referrer stats: +1 referral, +$10 reward`)
        
        // Send email notification
        const referrerEmail = referrer.email_address || referrerGiftCard.digitalEmail || null
        if (referrerEmail && referrerGiftCard.giftCardGan) {
          await sendGiftCardEmailNotification({
            customerName: referrerName || referrerEmail || 'there',
            email: referrerEmail,
            giftCardGan: referrerGiftCard.giftCardGan,
            amountCents: referrerGiftCard.amountCents,
            balanceCents: referrerGiftCard.balanceCents,
            activationUrl: referrerGiftCard.activationUrl,
            passKitUrl: referrerGiftCard.passKitUrl
          })
          console.log(`   ✅ Sent gift card email to ${referrerEmail}`)
        } else {
          console.log(`   ⚠️  Skipped email - missing email address or GAN`)
        }
        
        return { success: true, giftCardId: referrerGiftCard.giftCardId, action: 'created' }
      } else {
        throw new Error('Failed to create referrer gift card')
      }
    } else {
      // Load $10 onto existing gift card
      console.log(`   Loading $10 onto existing gift card: ${referrer.gift_card_id}`)
      
      const loadResult = await loadGiftCard(
        referrer.gift_card_id,
        rewardAmountCents,
        referrer.square_customer_id,
        'Referrer reward gift card load (missing reward fix)',
        { idempotencyKeySeed: `missing-reward-load-${referrerCustomerId}-${friendCustomerId}-${Date.now()}` }
      )
      
      if (loadResult.success) {
        await prisma.$executeRaw`
          UPDATE square_existing_clients 
          SET 
            total_referrals = COALESCE(total_referrals, 0) + 1,
            total_rewards = COALESCE(total_rewards, 0) + 1000,
            gift_card_gan = ${loadResult.giftCardGan ?? referrer.gift_card_gan ?? null},
            gift_card_delivery_channel = ${loadResult.deliveryChannel ?? referrer.gift_card_delivery_channel ?? null},
            gift_card_activation_url = ${loadResult.activationUrl ?? referrer.gift_card_activation_url ?? null},
            gift_card_pass_kit_url = ${loadResult.passKitUrl ?? referrer.gift_card_pass_kit_url ?? null},
            gift_card_digital_email = ${loadResult.digitalEmail ?? referrer.gift_card_digital_email ?? null},
            updated_at = NOW()
          WHERE square_customer_id = ${referrer.square_customer_id}
        `
        
        console.log(`   ✅ Loaded $10 onto gift card`)
        console.log(`   ✅ Updated referrer stats: +1 referral, +$10 reward`)
        
        // Send email notification
        const referrerEmail = referrer.email_address || loadResult.digitalEmail || null
        if (referrerEmail && loadResult.giftCardGan) {
          await sendGiftCardEmailNotification({
            customerName: referrerName || referrerEmail || 'there',
            email: referrerEmail,
            giftCardGan: loadResult.giftCardGan,
            amountCents: rewardAmountCents,
            balanceCents: loadResult.balanceCents,
            activationUrl: loadResult.activationUrl,
            passKitUrl: loadResult.passKitUrl
          })
          console.log(`   ✅ Sent gift card email to ${referrerEmail}`)
        } else {
          console.log(`   ⚠️  Skipped email - missing email address or GAN`)
        }
        
        return { success: true, giftCardId: referrer.gift_card_id, action: 'loaded' }
      } else {
        throw new Error(`Failed to load gift card: ${loadResult.error || 'Unknown error'}`)
      }
    }
  } catch (error) {
    console.error(`   ❌ Error issuing referrer reward:`, error.message)
    return { success: false, error: error.message }
  }
}

async function issueMissingReferrerRewards(dryRun = false) {
  console.log('🎁 Issuing Missing Referrer Rewards\n')
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n')
  }
  console.log('='.repeat(80))
  
  try {
    const missingRewards = await findMissingReferrerRewards()
    
    if (!missingRewards || missingRewards.length === 0) {
      console.log('\n✅ No missing rewards found. Nothing to issue.')
      return { issued: 0, failed: 0, skipped: 0 }
    }
    
    console.log(`\n📋 Found ${missingRewards.length} missing rewards to issue\n`)
    
    if (dryRun) {
      console.log('🔍 DRY RUN - Would issue rewards for:')
      missingRewards.forEach((item, idx) => {
        console.log(`   ${idx + 1}. ${item.friend.name} → ${item.referrer.name}`)
      })
      return { issued: 0, failed: 0, skipped: missingRewards.length }
    }
    
    let issued = 0
    let failed = 0
    const results = []
    
    for (const item of missingRewards) {
      console.log(`\n${'='.repeat(80)}`)
      const result = await issueReferrerReward(
        item.friend.id,
        item.referrer.id,
        item.referrer.code
      )
      
      if (result.success) {
        issued++
        results.push({ ...item, result: 'success', action: result.action })
      } else {
        failed++
        results.push({ ...item, result: 'failed', error: result.error })
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    console.log(`\n${'='.repeat(80)}`)
    console.log(`\n📊 Summary:`)
    console.log(`   ✅ Successfully issued: ${issued}`)
    console.log(`   ❌ Failed: ${failed}`)
    console.log(`   📋 Total processed: ${missingRewards.length}`)
    
    if (failed > 0) {
      console.log(`\n⚠️  Failed rewards:`)
      results.filter(r => r.result === 'failed').forEach((item, idx) => {
        console.log(`   ${idx + 1}. ${item.friend.name} → ${item.referrer.name}: ${item.error}`)
      })
    }
    
    return { issued, failed, skipped: 0, results }
    
  } catch (error) {
    console.error('\n❌ Error issuing missing referrer rewards:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run') || process.argv.includes('-d')
  
  issueMissingReferrerRewards(dryRun)
    .then(({ issued, failed, skipped }) => {
      if (dryRun) {
        console.log(`\n✅ Dry run complete. Would issue ${skipped} rewards.`)
        console.log(`\n💡 Run without --dry-run to actually issue rewards`)
      } else {
        console.log(`\n✅ Complete. Issued ${issued} rewards, ${failed} failed.`)
      }
      process.exit(failed > 0 ? 1 : 0)
    })
    .catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

module.exports = { issueMissingReferrerRewards, issueReferrerReward }

