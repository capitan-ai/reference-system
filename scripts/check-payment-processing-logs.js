#!/usr/bin/env node
/**
 * Check payment processing logs for specific customers
 * to understand why referrer rewards weren't granted
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

const customersToCheck = [
  { name: 'Marina Apostolaki', id: '0MHT1S68NENXGAS2S635FDTQ74', code: 'ANNAMARIA1737' },
  { name: 'Rahel Tekeste', id: 'P51JT0CJ0RQXEYZFERE67SXEQG', code: 'MAKDA4078' },
  { name: 'Mariele Longfellow', id: 'GE4KAHES1P4DY056MNTVQV3SJ4', code: 'BRENNA1414' },
  { name: 'Kate Rodgers', id: 'WGKFCXD42JE1QPFBNX5DS2D0NG', code: 'KATE1520' }
]

async function checkPaymentProcessing() {
  console.log('🔍 Checking Payment Processing for Customers\n')
  console.log('='.repeat(80))
  
  try {
    for (const customerInfo of customersToCheck) {
      console.log(`\n📋 Customer: ${customerInfo.name}`)
      console.log(`   Customer ID: ${customerInfo.id}`)
      console.log(`   Used code: ${customerInfo.code}`)
      console.log('-'.repeat(80))
      
      // 1. Check customer status
      const customer = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          given_name,
          family_name,
          used_referral_code,
          first_payment_completed,
          got_signup_bonus,
          gift_card_id,
          created_at,
          updated_at
        FROM square_existing_clients
        WHERE square_customer_id = ${customerInfo.id}
      `
      
      if (!customer || customer.length === 0) {
        console.log('   ❌ Customer not found')
        continue
      }
      
      const c = customer[0]
      console.log(`\n   👤 Customer Status:`)
      console.log(`      First payment completed: ${c.first_payment_completed ? '✅ Yes' : '❌ No'}`)
      console.log(`      Got signup bonus: ${c.got_signup_bonus ? '✅ Yes' : '❌ No'}`)
      console.log(`      Gift card ID: ${c.gift_card_id || 'N/A'}`)
      console.log(`      Created: ${c.created_at}`)
      console.log(`      Updated: ${c.updated_at}`)
      
      // 2. Check referrer
      const referrer = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          given_name,
          family_name,
          personal_code,
          total_referrals,
          total_rewards,
          gift_card_id
        FROM square_existing_clients
        WHERE UPPER(TRIM(personal_code)) = UPPER(TRIM(${customerInfo.code}))
      `
      
      if (referrer && referrer.length > 0) {
        const r = referrer[0]
        console.log(`\n   🎯 Referrer Status:`)
        console.log(`      Name: ${r.given_name} ${r.family_name}`)
        console.log(`      Total referrals: ${r.total_referrals || 0}`)
        console.log(`      Total rewards: $${((r.total_rewards || 0) / 100).toFixed(2)}`)
        console.log(`      Gift card ID: ${r.gift_card_id || 'N/A'}`)
      } else {
        console.log(`\n   ⚠️  Referrer not found for code ${customerInfo.code}`)
      }
      
      // 3. Check giftcard_jobs for payment processing
      const paymentJobs = await prisma.$queryRaw`
        SELECT 
          id,
          stage,
          status,
          correlation_id,
          attempts,
          last_error,
          created_at,
          scheduled_at,
          updated_at
        FROM giftcard_jobs
        WHERE correlation_id LIKE ${`%${customerInfo.id}%`}
          AND stage = 'payment'
        ORDER BY created_at DESC
        LIMIT 5
      `
      
      if (paymentJobs && paymentJobs.length > 0) {
        console.log(`\n   📅 Payment Jobs (${paymentJobs.length} found):`)
        paymentJobs.forEach((job, idx) => {
          console.log(`      ${idx + 1}. Stage: ${job.stage}, Status: ${job.status}`)
          console.log(`         Correlation: ${job.correlation_id}`)
          console.log(`         Attempts: ${job.attempts}`)
          if (job.last_error) {
            console.log(`         ❌ Error: ${job.last_error.substring(0, 200)}`)
          }
          console.log(`         Created: ${job.created_at}`)
          console.log(`         Updated: ${job.updated_at}`)
        })
      } else {
        console.log(`\n   📅 Payment Jobs: None found`)
      }
      
      // 4. Check giftcard_runs for processing history
      const runs = await prisma.$queryRaw`
        SELECT 
          id,
          correlation_id,
          stage,
          status,
          attempts,
          last_error,
          context,
          created_at,
          updated_at
        FROM giftcard_runs
        WHERE correlation_id LIKE ${`%${customerInfo.id}%`}
        ORDER BY created_at DESC
        LIMIT 5
      `
      
      if (runs && runs.length > 0) {
        console.log(`\n   🔄 Gift Card Runs (${runs.length} found):`)
        runs.forEach((run, idx) => {
          console.log(`      ${idx + 1}. Stage: ${run.stage}, Status: ${run.status}`)
          console.log(`         Correlation: ${run.correlation_id}`)
          console.log(`         Attempts: ${run.attempts}`)
          if (run.last_error) {
            console.log(`         ❌ Error: ${run.last_error.substring(0, 200)}`)
          }
          if (run.context) {
            const context = typeof run.context === 'string' ? JSON.parse(run.context) : run.context
            console.log(`         Context: ${JSON.stringify(context).substring(0, 150)}`)
          }
          console.log(`         Created: ${run.created_at}`)
        })
      } else {
        console.log(`\n   🔄 Gift Card Runs: None found`)
      }
      
      // 5. Check if payment was processed before first_payment_completed was set
      if (c.first_payment_completed && c.updated_at) {
        console.log(`\n   ⚠️  ANALYSIS:`)
        console.log(`      Customer has first_payment_completed = TRUE`)
        console.log(`      Updated at: ${c.updated_at}`)
        console.log(`      This means payment processing should have happened`)
        if (!referrer || referrer.length === 0 || !referrer[0].gift_card_id) {
          console.log(`      ❌ BUT referrer doesn't have gift_card_id or wasn't found`)
          console.log(`      This suggests referrer reward processing failed or was skipped`)
        } else {
          const r = referrer[0]
          if ((r.total_referrals || 0) === 0 && (r.total_rewards || 0) === 0) {
            console.log(`      ❌ BUT referrer has total_referrals=0 and total_rewards=0`)
            console.log(`      This suggests referrer reward was NOT granted`)
          } else {
            console.log(`      ✅ Referrer has rewards: ${r.total_referrals} referrals, $${((r.total_rewards || 0) / 100).toFixed(2)}`)
            console.log(`      ⚠️  But no record in ref_rewards table (this is expected - table not used)`)
          }
        }
      }
    }
    
    console.log(`\n${'='.repeat(80)}`)
    console.log('✅ Analysis complete')
    
  } catch (error) {
    console.error('\n❌ Error checking payment processing:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

checkPaymentProcessing()

