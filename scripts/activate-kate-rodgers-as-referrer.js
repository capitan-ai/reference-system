#!/usr/bin/env node
/**
 * Manually activate Kate Rodgers as referrer and send referral code
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { generateUniquePersonalCode, sendReferralCodeToNewClient } = require('../lib/webhooks/giftcard-processors')

const CUSTOMER_ID = 'WGKFCXD42JE1QPFBNX5DS2D0NG' // Kate Rodgers

async function activateKateRodgersAsReferrer() {
  console.log('🎯 Activating Kate Rodgers as Referrer\n')
  console.log('='.repeat(80))
  
  try {
    // 1. Get customer info
    console.log('\n1️⃣ Getting Customer Info:')
    const customer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        phone_number,
        personal_code,
        activated_as_referrer,
        referral_email_sent,
        first_payment_completed,
        gift_card_id
      FROM square_existing_clients
      WHERE square_customer_id = ${CUSTOMER_ID}
    `
    
    if (!customer || customer.length === 0) {
      console.log('❌ Customer not found!')
      process.exit(1)
    }
    
    const c = customer[0]
    const customerName = `${c.given_name || ''} ${c.family_name || ''}`.trim()
    
    console.log(`   Name: ${customerName}`)
    console.log(`   Email: ${c.email_address || 'N/A'}`)
    console.log(`   Phone: ${c.phone_number || 'N/A'}`)
    console.log(`   Personal code: ${c.personal_code || '❌ NONE'}`)
    console.log(`   Activated as referrer: ${c.activated_as_referrer ? '✅ Yes' : '❌ No'}`)
    console.log(`   Referral email sent: ${c.referral_email_sent ? '✅ Yes' : '❌ No'}`)
    console.log(`   First payment completed: ${c.first_payment_completed ? '✅ Yes' : '❌ No'}`)
    console.log(`   Gift card ID: ${c.gift_card_id || 'N/A'}`)
    
    if (c.activated_as_referrer && c.personal_code && c.referral_email_sent) {
      console.log('\n⚠️  Customer is already activated as referrer!')
      console.log(`   Personal code: ${c.personal_code}`)
      console.log(`   Email already sent: ${c.referral_email_sent}`)
      console.log('\n   Do you want to resend the email? (This script will proceed anyway)')
    }
    
    if (!c.first_payment_completed) {
      console.log('\n⚠️  WARNING: First payment not completed yet!')
      console.log('   Proceeding anyway...')
    }
    
    // 2. Activate as referrer using sendReferralCodeToNewClient
    console.log('\n2️⃣ Activating as Referrer:')
    
    if (!c.email_address) {
      console.log('❌ No email address - cannot send referral code email')
      console.log('   But will still activate in database...')
    }
    
    const result = await sendReferralCodeToNewClient(
      CUSTOMER_ID,
      customerName,
      c.email_address,
      c.phone_number
    )
    
    if (result.success) {
      console.log(`\n✅ Successfully activated as referrer!`)
      if (result.referralCode) {
        console.log(`   Referral code: ${result.referralCode}`)
      }
      if (result.alreadySent) {
        console.log(`   ⚠️  Email was already sent previously`)
      }
    } else {
      console.log(`\n❌ Failed to activate: ${result.error || 'Unknown error'}`)
      process.exit(1)
    }
    
    // 3. Verify
    console.log('\n3️⃣ Verification:')
    const updated = await prisma.$queryRaw`
      SELECT 
        personal_code,
        activated_as_referrer,
        referral_email_sent,
        referral_url,
        gift_card_id
      FROM square_existing_clients
      WHERE square_customer_id = ${CUSTOMER_ID}
    `
    
    const u = updated[0]
    console.log(`   Personal code: ${u.personal_code || '❌ NONE'}`)
    console.log(`   Activated as referrer: ${u.activated_as_referrer ? '✅ Yes' : '❌ No'}`)
    console.log(`   Referral email sent: ${u.referral_email_sent ? '✅ Yes' : '❌ No'}`)
    console.log(`   Referral URL: ${u.referral_url || 'N/A'}`)
    console.log(`   Gift card ID: ${u.gift_card_id || 'N/A'}`)
    
    console.log('\n' + '='.repeat(80))
    console.log('✅ Activation complete!')
    console.log('='.repeat(80))
    
    if (u.personal_code) {
      console.log(`\n📧 Referral code: ${u.personal_code}`)
      console.log(`🔗 Referral URL: ${u.referral_url || 'N/A'}`)
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

activateKateRodgersAsReferrer()

