#!/usr/bin/env node
/**
 * Check why emails are not being sent to customers
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkEmailStatus() {
  console.log('🔍 Checking Email Sending Status\n')
  
  const fifteenDaysAgo = new Date()
  fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15)

  try {
    // Check environment variables
    console.log('1️⃣ Checking Email Configuration...')
    console.log(`   SENDGRID_API_KEY: ${process.env.SENDGRID_API_KEY ? '✅ Set' : '❌ NOT SET'}`)
    console.log(`   FROM_EMAIL: ${process.env.FROM_EMAIL || '❌ NOT SET'}`)
    console.log(`   DISABLE_EMAIL_SENDING: ${process.env.DISABLE_EMAIL_SENDING || 'Not set (default: false)'}`)
    console.log(`   EMAIL_ENABLED: ${process.env.EMAIL_ENABLED || 'Not set (default: true)'}`)
    
    const emailDisabled = process.env.DISABLE_EMAIL_SENDING === 'true' || process.env.EMAIL_ENABLED === 'false'
    if (emailDisabled) {
      console.log(`   ⚠️  Email sending is DISABLED by environment variables`)
    }
    
    if (!process.env.SENDGRID_API_KEY) {
      console.log(`   ⚠️  SENDGRID_API_KEY not set - emails will NOT be sent`)
    }

    // Check notification events
    console.log('\n2️⃣ Checking Notification Events (Last 15 Days)...')
    
    const notificationEvents = await prisma.notificationEvent.findMany({
      where: {
        channel: 'EMAIL',
        createdAt: { gte: fifteenDaysAgo }
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        templateType: true,
        status: true,
        customerId: true,
        referrerCustomerId: true,
        errorMessage: true,
        errorCode: true,
        externalId: true,
        createdAt: true,
        metadata: true
      }
    })

    console.log(`   Found ${notificationEvents.length} email notification events`)

    if (notificationEvents.length > 0) {
      const statusCounts = notificationEvents.reduce((acc, event) => {
        acc[event.status] = (acc[event.status] || 0) + 1
        return acc
      }, {})

      console.log(`\n   Status Breakdown:`)
      Object.entries(statusCounts).forEach(([status, count]) => {
        console.log(`      ${status}: ${count}`)
      })

      console.log(`\n   Recent Email Events:`)
      notificationEvents.slice(0, 10).forEach((event, idx) => {
        console.log(`\n   ${idx + 1}. ${event.createdAt.toISOString()}`)
        console.log(`      Template: ${event.templateType}`)
        console.log(`      Status: ${event.status}`)
        if (event.errorMessage) {
          console.log(`      Error: ${event.errorMessage}`)
        }
        if (event.externalId) {
          console.log(`      SendGrid ID: ${event.externalId}`)
        }
        if (event.metadata) {
          const meta = event.metadata
          if (meta.simulated) {
            console.log(`      ⚠️  Simulated (not actually sent): ${meta.reason || 'unknown'}`)
          }
        }
      })
    } else {
      console.log(`   ⚠️  No email notification events found!`)
      console.log(`   This means emails are not being triggered at all.`)
    }

    // Check if jobs are processing (emails are sent during job processing)
    console.log('\n3️⃣ Checking Job Processing Status...')
    
    const completedJobs = await prisma.giftCardJob.count({
      where: {
        status: 'completed',
        created_at: { gte: fifteenDaysAgo }
      }
    })

    const queuedJobs = await prisma.giftCardJob.count({
      where: {
        status: 'queued',
        created_at: { gte: fifteenDaysAgo }
      }
    })

    console.log(`   Completed jobs: ${completedJobs}`)
    console.log(`   Queued jobs: ${queuedJobs}`)
    
    if (queuedJobs > 0 && completedJobs === 0) {
      console.log(`   ⚠️  Jobs are not processing - emails won't be sent until jobs run!`)
    }

    // Check customers who should have received emails
    console.log('\n4️⃣ Checking Customers Who Should Receive Emails...')
    
    // Customers who became referrers (should get referral code email)
    const newReferrers = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        activated_as_referrer,
        referral_email_sent,
        personal_code,
        created_at
      FROM square_existing_clients
      WHERE activated_as_referrer = true
        AND created_at >= ${fifteenDaysAgo}
      ORDER BY created_at DESC
      LIMIT 20
    `

    console.log(`   Customers who became referrers: ${newReferrers.length}`)
    
    if (newReferrers.length > 0) {
      const withoutEmail = newReferrers.filter(c => !c.referral_email_sent)
      console.log(`   Without referral email sent: ${withoutEmail.length}`)
      
      if (withoutEmail.length > 0) {
        console.log(`\n   Customers missing referral emails:`)
        withoutEmail.slice(0, 10).forEach((customer, idx) => {
          const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
          console.log(`   ${idx + 1}. ${name} (${customer.email_address || 'No email'})`)
          console.log(`      Code: ${customer.personal_code || 'No code'}`)
          console.log(`      Created: ${customer.created_at.toISOString()}`)
        })
      }
    }

    // Check gift cards issued (should trigger emails)
    console.log('\n5️⃣ Checking Gift Cards Issued...')
    console.log('   ⚠️  Reward tracking moved to square_existing_clients.total_rewards')
    
    const customersWithRewards = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        total_rewards,
        gift_card_id,
        created_at
      FROM square_existing_clients
      WHERE total_rewards > 0
        AND created_at >= ${fifteenDaysAgo}
      ORDER BY created_at DESC
      LIMIT 20
    `

    console.log(`   Customers with rewards: ${customersWithRewards.length}`)
    
    if (customersWithRewards.length > 0) {
      console.log(`\n   Recent Customers with Rewards:`)
      customersWithRewards.slice(0, 10).forEach((customer, idx) => {
        const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
        console.log(`   ${idx + 1}. ${name} (${customer.email_address || 'No email'})`)
        console.log(`      Total Rewards: ${customer.total_rewards || 0}`)
        console.log(`      Gift Card ID: ${customer.gift_card_id || 'None'}`)
        console.log(`      Created: ${customer.created_at.toISOString()}`)
      })
    }

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('📊 EMAIL DIAGNOSIS')
    console.log('='.repeat(60))
    
    const issues = []
    
    if (!process.env.SENDGRID_API_KEY) {
      issues.push('❌ SENDGRID_API_KEY not configured')
    }
    
    if (emailDisabled) {
      issues.push('❌ Email sending is disabled (DISABLE_EMAIL_SENDING or EMAIL_ENABLED)')
    }
    
    if (queuedJobs > 0 && completedJobs === 0) {
      issues.push('❌ Jobs are not processing - emails triggered during job processing')
    }
    
    if (notificationEvents.length === 0) {
      issues.push('⚠️  No email notification events found - emails not being triggered')
    } else {
      const failed = notificationEvents.filter(e => e.status === 'failed').length
      const simulated = notificationEvents.filter(e => e.metadata?.simulated).length
      
      if (failed > 0) {
        issues.push(`⚠️  ${failed} email notifications failed`)
      }
      
      if (simulated > 0) {
        issues.push(`⚠️  ${simulated} emails were simulated (not actually sent)`)
      }
    }

    if (issues.length > 0) {
      console.log(`\n🚨 Issues Found:\n`)
      issues.forEach(issue => console.log(`   ${issue}`))
    } else {
      console.log(`\n✅ No obvious issues found`)
      console.log(`   Check Vercel logs for detailed email sending logs`)
    }

    console.log(`\n💡 Recommendations:`)
    if (!process.env.SENDGRID_API_KEY) {
      console.log(`   1. Add SENDGRID_API_KEY to Vercel environment variables`)
    }
    if (queuedJobs > 0) {
      console.log(`   2. Fix cron job to process queued jobs (emails sent during processing)`)
    }
    if (notificationEvents.length === 0) {
      console.log(`   3. Check webhook handlers - emails should be triggered when:`)
      console.log(`      - Customer becomes referrer (referral code email)`)
      console.log(`      - Gift card is issued (gift card email)`)
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkEmailStatus()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })

