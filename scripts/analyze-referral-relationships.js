#!/usr/bin/env node
/**
 * Analyze referral relationships for specific customers
 * Shows who is the referrer, who is the new client, and when they used the code
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

const customersToAnalyze = [
  { name: 'Laura Craciun', code: 'KATHLEEN9248' },
  { name: 'Marina Apostolaki', code: 'ANNAMARIA1737' },
  { name: 'Rahel Tekeste', code: 'MAKDA4078' },
  { name: 'Mariele Longfellow', code: 'BRENNA1414' },
  { name: 'Kate Rodgers', code: 'KATE1520' }
]

async function analyzeReferralRelationships() {
  console.log('🔍 Analyzing Referral Relationships\n')
  console.log('='.repeat(80))
  
  try {
    for (const customerInfo of customersToAnalyze) {
      console.log(`\n📋 Analyzing: ${customerInfo.name} (used code: ${customerInfo.code})`)
      console.log('-'.repeat(80))
      
      // 1. Find the new client (who used the code)
      const newClient = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          given_name,
          family_name,
          email_address,
          phone_number,
          used_referral_code,
          first_payment_completed,
          got_signup_bonus,
          gift_card_id,
          personal_code,
          created_at,
          updated_at
        FROM square_existing_clients
        WHERE used_referral_code = ${customerInfo.code}
        LIMIT 1
      `
      
      if (!newClient || newClient.length === 0) {
        console.log(`   ❌ New client not found for code ${customerInfo.code}`)
        continue
      }
      
      const client = newClient[0]
      const clientName = `${client.given_name || ''} ${client.family_name || ''}`.trim()
      
      console.log(`\n   👤 NEW CLIENT (who used the code):`)
      console.log(`      Name: ${clientName}`)
      console.log(`      Customer ID: ${client.square_customer_id}`)
      console.log(`      Email: ${client.email_address || 'N/A'}`)
      console.log(`      Phone: ${client.phone_number || 'N/A'}`)
      console.log(`      Used referral code: ${client.used_referral_code}`)
      console.log(`      First payment completed: ${client.first_payment_completed ? '✅ Yes' : '❌ No'}`)
      console.log(`      Got signup bonus: ${client.got_signup_bonus ? '✅ Yes' : '❌ No'}`)
      console.log(`      Gift card ID: ${client.gift_card_id || 'N/A'}`)
      console.log(`      Personal code: ${client.personal_code || 'N/A'}`)
      console.log(`      Created: ${client.created_at}`)
      console.log(`      Updated: ${client.updated_at}`)
      
      // 2. Find the referrer (who owns the code)
      const referrer = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          given_name,
          family_name,
          email_address,
          phone_number,
          personal_code,
          activated_as_referrer,
          total_referrals,
          total_rewards,
          gift_card_id,
          created_at,
          updated_at
        FROM square_existing_clients
        WHERE UPPER(TRIM(personal_code)) = UPPER(TRIM(${customerInfo.code}))
        LIMIT 1
      `
      
      if (!referrer || referrer.length === 0) {
        console.log(`\n   ⚠️  REFERRER NOT FOUND for code ${customerInfo.code}`)
        console.log(`      This could mean:`)
        console.log(`      - The referrer doesn't exist in the database`)
        console.log(`      - The code was entered incorrectly`)
        console.log(`      - The referrer hasn't completed their first payment yet`)
        continue
      }
      
      const ref = referrer[0]
      const referrerName = `${ref.given_name || ''} ${ref.family_name || ''}`.trim()
      
      console.log(`\n   🎯 REFERRER (who owns the code):`)
      console.log(`      Name: ${referrerName}`)
      console.log(`      Customer ID: ${ref.square_customer_id}`)
      console.log(`      Email: ${ref.email_address || 'N/A'}`)
      console.log(`      Phone: ${ref.phone_number || 'N/A'}`)
      console.log(`      Personal code: ${ref.personal_code}`)
      console.log(`      Activated as referrer: ${ref.activated_as_referrer ? '✅ Yes' : '❌ No'}`)
      console.log(`      Total referrals: ${ref.total_referrals || 0}`)
      console.log(`      Total rewards: $${((ref.total_rewards || 0) / 100).toFixed(2)}`)
      console.log(`      Gift card ID: ${ref.gift_card_id || 'N/A'}`)
      console.log(`      Created: ${ref.created_at}`)
      console.log(`      Updated: ${ref.updated_at}`)
      
      // 3. Check when the code was used (from giftcard_jobs or ref_matches)
      const refMatch = await prisma.$queryRaw`
        SELECT 
          "refCode",
          "customerId",
          "bookingId",
          "matchedVia",
          "matchedAt"
        FROM ref_matches
        WHERE "refCode" = ${customerInfo.code}
          AND "customerId" = ${client.square_customer_id}
        ORDER BY "matchedAt" DESC
        LIMIT 1
      `
      
      if (refMatch && refMatch.length > 0) {
        const match = refMatch[0]
        console.log(`\n   📅 WHEN CODE WAS USED:`)
        console.log(`      Matched at: ${match.matchedAt}`)
        console.log(`      Booking ID: ${match.bookingId || 'N/A'}`)
        console.log(`      Matched via: ${match.matchedVia || 'N/A'}`)
      } else {
        // Try to find from giftcard_jobs
        const jobs = await prisma.$queryRaw`
          SELECT 
            id,
            stage,
            correlation_id,
            status,
            created_at,
            scheduled_at,
            updated_at
          FROM giftcard_jobs
          WHERE correlation_id LIKE ${`%${client.square_customer_id}%`}
            AND stage IN ('booking', 'payment')
          ORDER BY created_at DESC
          LIMIT 5
        `
        
        if (jobs && jobs.length > 0) {
          console.log(`\n   📅 JOB HISTORY (when code might have been processed):`)
          jobs.forEach((job, idx) => {
            console.log(`      ${idx + 1}. Stage: ${job.stage}, Status: ${job.status}`)
            console.log(`         Created: ${job.created_at}`)
            if (job.status === 'completed') {
              console.log(`         Updated (completed): ${job.updated_at}`)
            }
          })
        } else {
          console.log(`\n   📅 WHEN CODE WAS USED: Not found in ref_matches or jobs`)
        }
      }
      
      // 4. Check if referrer got reward
      const reward = await prisma.$queryRaw`
        SELECT 
          id,
          type,
          "referrerCustomerId",
          "friendCustomerId",
          amount,
          status,
          "createdAt"
        FROM ref_rewards
        WHERE "referrerCustomerId" = ${ref.square_customer_id}
          AND "friendCustomerId" = ${client.square_customer_id}
        ORDER BY "createdAt" DESC
        LIMIT 1
      `
      
      if (reward && reward.length > 0) {
        const r = reward[0]
        console.log(`\n   💰 REFERRER REWARD:`)
        console.log(`      Type: ${r.type}`)
        console.log(`      Amount: $${(r.amount / 100).toFixed(2)}`)
        console.log(`      Status: ${r.status}`)
        console.log(`      Created: ${r.createdAt}`)
      } else {
        console.log(`\n   💰 REFERRER REWARD: Not found`)
        if (client.first_payment_completed) {
          console.log(`      ⚠️  Client completed first payment but referrer didn't get reward yet`)
        } else {
          console.log(`      ℹ️  Client hasn't completed first payment yet`)
        }
      }
      
      // 5. Summary
      console.log(`\n   📊 SUMMARY:`)
      console.log(`      Referrer: ${referrerName} (${ref.personal_code})`)
      console.log(`      New Client: ${clientName} (${client.square_customer_id})`)
      console.log(`      Code used: ${customerInfo.code}`)
      console.log(`      First payment: ${client.first_payment_completed ? '✅ Completed' : '❌ Not completed'}`)
      console.log(`      Signup bonus: ${client.got_signup_bonus ? '✅ Received' : '❌ Not received'}`)
      console.log(`      Referrer reward: ${reward && reward.length > 0 ? '✅ Given' : '❌ Not given'}`)
    }
    
    console.log(`\n${'='.repeat(80)}`)
    console.log('✅ Analysis complete')
    
  } catch (error) {
    console.error('\n❌ Error analyzing referral relationships:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

analyzeReferralRelationships()

