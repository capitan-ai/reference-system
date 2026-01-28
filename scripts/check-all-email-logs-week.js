#!/usr/bin/env node
/**
 * Comprehensive check of all email logs for the last week
 * Checks:
 * 1. Database notification_events table
 * 2. SendGrid API activity
 * 3. Customers who should have received emails but didn't
 * 4. Failed emails that need retry
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')
const sendgridClient = require('@sendgrid/client')

async function checkAllEmailLogs() {
  console.log('🔍 Comprehensive Email Log Check (Last 7 Days)\n')
  console.log('='.repeat(80))
  
  const oneWeekAgo = new Date()
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)
  
  const today = new Date()
  
  console.log(`\n📅 Date Range: ${oneWeekAgo.toISOString().split('T')[0]} to ${today.toISOString().split('T')[0]}\n`)
  
  // 1. Check Database - notification_events
  console.log('1️⃣ DATABASE: notification_events Table\n')
  try {
    const dbEvents = await prisma.notificationEvent.findMany({
      where: {
        channel: 'EMAIL',
        createdAt: { gte: oneWeekAgo }
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        templateType: true,
        status: true,
        customerId: true,
        referrerCustomerId: true,
        externalId: true,
        sentAt: true,
        errorMessage: true,
        errorCode: true,
        createdAt: true,
        metadata: true
      }
    })
    
    console.log(`   📊 Total email events in database: ${dbEvents.length}`)
    
    if (dbEvents.length > 0) {
      // Group by status
      const statusCounts = dbEvents.reduce((acc, event) => {
        acc[event.status] = (acc[event.status] || 0) + 1
        return acc
      }, {})
      
      console.log('\n   Status Breakdown:')
      Object.entries(statusCounts).forEach(([status, count]) => {
        const icon = status === 'sent' ? '✅' : status === 'queued' ? '⏳' : status === 'failed' ? '❌' : '⚠️'
        console.log(`      ${icon} ${status}: ${count}`)
      })
      
      // Group by template type
      const templateCounts = dbEvents.reduce((acc, event) => {
        acc[event.templateType] = (acc[event.templateType] || 0) + 1
        return acc
      }, {})
      
      console.log('\n   Template Type Breakdown:')
      Object.entries(templateCounts).forEach(([type, count]) => {
        console.log(`      - ${type}: ${count}`)
      })
      
      // Show failed emails
      const failed = dbEvents.filter(e => e.status === 'failed')
      if (failed.length > 0) {
        console.log(`\n   ❌ Failed Emails (${failed.length}):`)
        failed.slice(0, 10).forEach((event, idx) => {
          console.log(`\n      ${idx + 1}. Failed at ${event.createdAt.toISOString()}`)
          console.log(`         Customer ID: ${event.customerId || 'N/A'}`)
          console.log(`         Template: ${event.templateType}`)
          console.log(`         Error: ${event.errorMessage || event.errorCode || 'Unknown'}`)
        })
      }
      
      // Show recent successful emails
      const successful = dbEvents.filter(e => e.status === 'sent').slice(0, 10)
      if (successful.length > 0) {
        console.log(`\n   ✅ Recent Successful Emails (showing first 10 of ${dbEvents.filter(e => e.status === 'sent').length}):`)
        successful.forEach((event, idx) => {
          const email = event.metadata?.email || 'N/A'
          console.log(`      ${idx + 1}. ${event.templateType} to ${email} at ${event.createdAt.toISOString()}`)
          if (event.externalId) {
            console.log(`         SendGrid ID: ${event.externalId}`)
          }
        })
      }
    } else {
      console.log('   ⚠️  No email events found in database for the last week')
    }
  } catch (error) {
    console.error('   ❌ Error querying database:', error.message)
  }
  
  // 2. Check SendGrid API
  console.log('\n\n2️⃣ SENDGRID API: Recent Email Activity\n')
  try {
    if (!process.env.SENDGRID_API_KEY) {
      console.log('   ⚠️  SENDGRID_API_KEY not set, skipping SendGrid API check')
    } else {
      sendgridClient.setApiKey(process.env.SENDGRID_API_KEY)
      
      // Get messages from last week (SendGrid API uses different format)
      const [response, body] = await sendgridClient.request({
        url: '/v3/messages?limit=100',
        method: 'GET'
      })
      
      if (response.statusCode === 200) {
        const allMessages = body.messages || []
        // Filter messages from last week
        const messages = allMessages.filter(msg => {
          if (!msg.last_event_time) return false
          const msgTime = new Date(msg.last_event_time * 1000)
          return msgTime >= oneWeekAgo && msgTime <= today
        })
        console.log(`   📊 Total messages in SendGrid (last 100): ${allMessages.length}`)
        console.log(`   📊 Messages from last week: ${messages.length}`)
        
        if (messages.length > 0) {
          // Group by status
          const statusCounts = {}
          messages.forEach(msg => {
            const status = msg.status || 'unknown'
            statusCounts[status] = (statusCounts[status] || 0) + 1
          })
          
          console.log('\n   Status Breakdown:')
          Object.entries(statusCounts).forEach(([status, count]) => {
            const icon = status === 'delivered' ? '✅' : status === 'processed' ? '⏳' : status === 'bounce' ? '❌' : status === 'blocked' ? '🚫' : '⚠️'
            console.log(`      ${icon} ${status}: ${count}`)
          })
          
          // Show recent messages
          console.log(`\n   📧 Recent Messages (showing first 10):`)
          messages.slice(0, 10).forEach((msg, idx) => {
            const status = msg.status || 'unknown'
            const icon = status === 'delivered' ? '✅' : status === 'processed' ? '⏳' : status === 'bounce' ? '❌' : status === 'blocked' ? '🚫' : '⚠️'
            const time = msg.last_event_time ? new Date(msg.last_event_time * 1000).toISOString() : 'N/A'
            
            console.log(`\n      ${idx + 1}. ${icon} ${status.toUpperCase()}`)
            console.log(`         To: ${msg.to_email}`)
            console.log(`         From: ${msg.from_email}`)
            console.log(`         Subject: ${msg.subject || 'N/A'}`)
            console.log(`         Time: ${time}`)
            console.log(`         Message ID: ${msg.msg_id}`)
          })
          
          // Check for bounces/blocks
          const bounces = messages.filter(m => m.status === 'bounce')
          const blocks = messages.filter(m => m.status === 'blocked')
          
          if (bounces.length > 0) {
            console.log(`\n   ❌ Bounced Emails (${bounces.length}):`)
            bounces.slice(0, 5).forEach((msg, idx) => {
              console.log(`      ${idx + 1}. ${msg.to_email} - ${msg.last_event_time ? new Date(msg.last_event_time * 1000).toISOString() : 'N/A'}`)
            })
          }
          
          if (blocks.length > 0) {
            console.log(`\n   🚫 Blocked Emails (${blocks.length}):`)
            blocks.slice(0, 5).forEach((msg, idx) => {
              console.log(`      ${idx + 1}. ${msg.to_email} - ${msg.last_event_time ? new Date(msg.last_event_time * 1000).toISOString() : 'N/A'}`)
            })
          }
        } else {
          console.log('   ⚠️  No messages found in SendGrid for the last week')
        }
      } else {
        console.log(`   ❌ Failed to get SendGrid messages: Status ${response.statusCode}`)
      }
    }
  } catch (error) {
    console.error('   ❌ Error checking SendGrid API:', error.message)
  }
  
  // 3. Check for customers who should have received emails
  console.log('\n\n3️⃣ CUSTOMERS: Who Should Have Received Emails\n')
  try {
    // Check customers with referral codes - both sent and not sent
    const customersWithReferralCodes = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        personal_code,
        referral_email_sent,
        created_at,
        updated_at
      FROM square_existing_clients
      WHERE personal_code IS NOT NULL
        AND email_address IS NOT NULL
        AND (created_at >= ${oneWeekAgo} OR updated_at >= ${oneWeekAgo})
      ORDER BY COALESCE(updated_at, created_at) DESC
      LIMIT 50
    `
    
    const customersWithoutEmail = customersWithReferralCodes?.filter(c => !c.referral_email_sent) || []
    const customersWithEmail = customersWithReferralCodes?.filter(c => c.referral_email_sent) || []
    
    console.log(`   📊 Customers with referral codes (last week activity):`)
    console.log(`      ✅ Email sent: ${customersWithEmail.length}`)
    console.log(`      ⚠️  Email NOT sent: ${customersWithoutEmail.length}`)
    
    if (customersWithoutEmail && customersWithoutEmail.length > 0) {
      console.log(`\n   ⚠️  Customers with referral codes but no email sent (${customersWithoutEmail.length}):`)
      customersWithoutEmail.slice(0, 20).forEach((customer, idx) => {
        console.log(`\n      ${idx + 1}. ${customer.given_name || ''} ${customer.family_name || ''} (${customer.email_address})`)
        console.log(`         Referral Code: ${customer.personal_code}`)
        console.log(`         Created: ${customer.created_at}`)
        console.log(`         Last Updated: ${customer.updated_at || 'N/A'}`)
      })
    }
    
    if (customersWithEmail && customersWithEmail.length > 0) {
      console.log(`\n   ✅ Recent customers with emails sent (showing first 10 of ${customersWithEmail.length}):`)
      customersWithEmail.slice(0, 10).forEach((customer, idx) => {
        console.log(`      ${idx + 1}. ${customer.given_name || ''} ${customer.family_name || ''} (${customer.email_address})`)
        console.log(`         Email sent at: ${customer.updated_at || customer.created_at}`)
      })
    }
    
    // Check customers with gift cards but no email
    const customersWithGiftCards = await prisma.$queryRaw`
      SELECT DISTINCT
        c.square_customer_id,
        c.given_name,
        c.family_name,
        c.email_address,
        gc.square_gift_card_id,
        gc.reward_type,
        gc.created_at as gift_card_created_at
      FROM square_existing_clients c
      INNER JOIN gift_cards gc ON c.square_customer_id = gc.square_customer_id
      WHERE gc.created_at >= ${oneWeekAgo}
        AND c.email_address IS NOT NULL
      ORDER BY gc.created_at DESC
      LIMIT 20
    `
    
    if (customersWithGiftCards && customersWithGiftCards.length > 0) {
      console.log(`\n   📧 Customers with Gift Cards (${customersWithGiftCards.length}):`)
      customersWithGiftCards.slice(0, 10).forEach((customer, idx) => {
        console.log(`\n      ${idx + 1}. ${customer.given_name || ''} ${customer.family_name || ''} (${customer.email_address})`)
        console.log(`         Gift Card ID: ${customer.square_gift_card_id}`)
        console.log(`         Reward Type: ${customer.reward_type}`)
        console.log(`         Created: ${customer.gift_card_created_at}`)
      })
    }
  } catch (error) {
    console.error('   ❌ Error checking customers:', error.message)
  }
  
  // 4. Summary and recommendations
  console.log('\n\n4️⃣ SUMMARY & RECOMMENDATIONS\n')
  console.log('='.repeat(80))
  
  try {
    const dbEvents = await prisma.notificationEvent.findMany({
      where: {
        channel: 'EMAIL',
        createdAt: { gte: oneWeekAgo }
      }
    })
    
    const sent = dbEvents.filter(e => e.status === 'sent').length
    const failed = dbEvents.filter(e => e.status === 'failed').length
    const queued = dbEvents.filter(e => e.status === 'queued').length
    
    console.log(`\n📊 Database Statistics:`)
    console.log(`   ✅ Sent: ${sent}`)
    console.log(`   ❌ Failed: ${failed}`)
    console.log(`   ⏳ Queued: ${queued}`)
    console.log(`   📧 Total: ${dbEvents.length}`)
    
    if (failed > 0) {
      console.log(`\n⚠️  ACTION REQUIRED: ${failed} emails failed and may need retry`)
      console.log(`   Run: node scripts/retry-failed-emails.js`)
    }
    
    if (queued > 0) {
      console.log(`\n⏳ ${queued} emails are still queued - they may be processing`)
    }
    
    console.log(`\n✅ All email logs checked successfully`)
    console.log(`\n💡 Next Steps:`)
    console.log(`   1. Review failed emails above`)
    console.log(`   2. Check SendGrid Activity Dashboard for delivery status`)
    console.log(`   3. Verify sender email in SendGrid if delivery issues persist`)
    
  } catch (error) {
    console.error('   ❌ Error generating summary:', error.message)
  }
  
  console.log('\n' + '='.repeat(80) + '\n')
}

checkAllEmailLogs()
  .catch((error) => {
    console.error('\n❌ Fatal error:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

