#!/usr/bin/env node
/**
 * Check if emails are actually being sent via SendGrid
 * This script verifies:
 * 1. SendGrid API key is valid
 * 2. Recent email activity in SendGrid
 * 3. Whether emails are being delivered or rejected
 */

require('dotenv').config()
const sendgridClient = require('@sendgrid/client')

async function checkEmailStatus() {
  console.log('🔍 Checking SendGrid Email Status\n')
  
  // 1. Check environment variables
  console.log('1️⃣ Environment Variables:')
  const apiKey = process.env.SENDGRID_API_KEY
  const fromEmail = process.env.FROM_EMAIL || 'info@studiozorina.com'
  
  if (!apiKey) {
    console.log('   ❌ SENDGRID_API_KEY not set!')
    console.log('   💡 Add SENDGRID_API_KEY to Vercel Environment Variables')
    process.exit(1)
  }
  
  console.log(`   ✅ SENDGRID_API_KEY: Set (length: ${apiKey.length})`)
  console.log(`   ✅ FROM_EMAIL: ${fromEmail}`)
  
  // 2. Test API key
  console.log('\n2️⃣ Testing SendGrid API Key:')
  sendgridClient.setApiKey(apiKey)
  
  try {
    const [response, body] = await sendgridClient.request({
      url: '/v3/user/profile',
      method: 'GET'
    })
    
    if (response.statusCode === 200) {
      console.log(`   ✅ API Key is valid`)
      console.log(`   📧 Account: ${body.email || body.username}`)
    } else {
      console.log(`   ❌ API Key test failed: Status ${response.statusCode}`)
      console.log(`   💡 Check API key permissions in SendGrid Dashboard`)
      process.exit(1)
    }
  } catch (error) {
    console.log(`   ❌ API Key test failed: ${error.message}`)
    if (error.response) {
      console.log(`   Status: ${error.response.statusCode}`)
      console.log(`   Body:`, JSON.stringify(error.response.body, null, 2))
    }
    console.log(`   💡 Verify API key in SendGrid Dashboard → Settings → API Keys`)
    process.exit(1)
  }
  
  // 3. Check recent email activity
  console.log('\n3️⃣ Recent Email Activity (last 20 messages):')
  try {
    const [activityResponse, activityBody] = await sendgridClient.request({
      url: '/v3/messages?limit=20',
      method: 'GET'
    })
    
    if (activityResponse.statusCode === 200) {
      const messages = activityBody.messages || []
      
      if (messages.length === 0) {
        console.log('   ⚠️  No email activity found in SendGrid')
        console.log('   💡 This could mean:')
        console.log('      - Emails are not being sent')
        console.log('      - API key does not have access to this account')
        console.log('      - Emails are being sent from a different account')
      } else {
        console.log(`   ✅ Found ${messages.length} recent messages\n`)
        
        // Group by status
        const statusCounts = {}
        messages.forEach(msg => {
          const status = msg.status || 'unknown'
          statusCounts[status] = (statusCounts[status] || 0) + 1
        })
        
        console.log('   Status Summary:')
        Object.entries(statusCounts).forEach(([status, count]) => {
          const icon = status === 'delivered' ? '✅' : status === 'processed' ? '⏳' : status === 'bounce' ? '❌' : status === 'blocked' ? '🚫' : '⚠️'
          console.log(`      ${icon} ${status}: ${count}`)
        })
        
        console.log('\n   Recent Messages:')
        messages.slice(0, 10).forEach((msg, idx) => {
          const status = msg.status || 'unknown'
          const icon = status === 'delivered' ? '✅' : status === 'processed' ? '⏳' : status === 'bounce' ? '❌' : status === 'blocked' ? '🚫' : '⚠️'
          const time = msg.last_event_time ? new Date(msg.last_event_time * 1000).toLocaleString() : 'N/A'
          
          console.log(`\n   ${idx + 1}. ${icon} ${status.toUpperCase()}`)
          console.log(`      To: ${msg.to_email}`)
          console.log(`      From: ${msg.from_email}`)
          console.log(`      Subject: ${msg.subject || 'N/A'}`)
          console.log(`      Last Event: ${time}`)
          console.log(`      Message ID: ${msg.msg_id}`)
          
          if (msg.events && msg.events.length > 0) {
            console.log(`      Events:`)
            msg.events.forEach(event => {
              console.log(`         - ${event.event} at ${new Date(event.timestamp * 1000).toLocaleString()}`)
              if (event.reason) {
                console.log(`           Reason: ${event.reason}`)
              }
            })
          }
        })
      }
    } else {
      console.log(`   ❌ Failed to get activity: Status ${activityResponse.statusCode}`)
      console.log(`   Body:`, JSON.stringify(activityBody, null, 2))
    }
  } catch (error) {
    console.log(`   ❌ Error checking activity: ${error.message}`)
    if (error.response) {
      console.log(`   Status: ${error.response.statusCode}`)
      console.log(`   Body:`, JSON.stringify(error.response.body, null, 2))
    }
  }
  
  // 4. Check suppression lists
  console.log('\n4️⃣ Suppression Lists (bounces, blocks, spam):')
  try {
    const [bouncesResponse, bouncesBody] = await sendgridClient.request({
      url: '/v3/suppression/bounces?limit=10',
      method: 'GET'
    })
    
    const [blocksResponse, blocksBody] = await sendgridClient.request({
      url: '/v3/suppression/blocks?limit=10',
      method: 'GET'
    })
    
    const [spamResponse, spamBody] = await sendgridClient.request({
      url: '/v3/suppression/spam_reports?limit=10',
      method: 'GET'
    })
    
    const bounces = Array.isArray(bouncesBody) ? bouncesBody : []
    const blocks = Array.isArray(blocksBody) ? blocksBody : []
    const spam = Array.isArray(spamBody) ? spamBody : []
    
    console.log(`   Bounces: ${bounces.length}`)
    if (bounces.length > 0) {
      console.log(`   Recent bounces:`)
      bounces.slice(0, 5).forEach(b => {
        console.log(`      - ${b.email} (${b.reason || 'No reason'})`)
      })
    }
    
    console.log(`   Blocks: ${blocks.length}`)
    if (blocks.length > 0) {
      console.log(`   Recent blocks:`)
      blocks.slice(0, 5).forEach(b => {
        console.log(`      - ${b.email} (${b.reason || 'No reason'})`)
      })
    }
    
    console.log(`   Spam Reports: ${spam.length}`)
    if (spam.length > 0) {
      console.log(`   Recent spam reports:`)
      spam.slice(0, 5).forEach(s => {
        console.log(`      - ${s.email}`)
      })
    }
    
    if (bounces.length === 0 && blocks.length === 0 && spam.length === 0) {
      console.log(`   ✅ No suppressions found`)
    }
  } catch (error) {
    console.log(`   ⚠️  Could not check suppression lists: ${error.message}`)
  }
  
  // 5. Check sender verification
  console.log('\n5️⃣ Sender Verification:')
  try {
    const [sendersResponse, sendersBody] = await sendgridClient.request({
      url: '/v3/verified_senders',
      method: 'GET'
    })
    
    if (sendersResponse.statusCode === 200) {
      const senders = sendersBody.results || []
      const verifiedSender = senders.find(s => s.from?.email === fromEmail)
      
      if (verifiedSender) {
        console.log(`   ✅ ${fromEmail} is verified`)
        console.log(`   Status: ${verifiedSender.verified?.status || 'unknown'}`)
      } else {
        console.log(`   ⚠️  ${fromEmail} is NOT verified in SendGrid`)
        console.log(`   💡 Verify sender in SendGrid Dashboard → Settings → Sender Authentication`)
        console.log(`   Found ${senders.length} verified senders:`)
        senders.slice(0, 5).forEach(s => {
          console.log(`      - ${s.from?.email || 'N/A'}`)
        })
      }
    }
  } catch (error) {
    console.log(`   ⚠️  Could not check sender verification: ${error.message}`)
  }
  
  console.log('\n' + '='.repeat(60))
  console.log('📊 SUMMARY')
  console.log('='.repeat(60))
  console.log('✅ API Key: Valid')
  console.log('📧 Check SendGrid Dashboard → Activity for detailed delivery status')
  console.log('💡 If emails show as "processed" but not "delivered", check:')
  console.log('   1. Sender email is verified in SendGrid')
  console.log('   2. Domain is verified in SendGrid')
  console.log('   3. Recipient email is not in suppression lists')
  console.log('   4. Check SendGrid Activity Dashboard for specific errors')
}

checkEmailStatus()
  .catch((error) => {
    console.error('\n❌ Fatal error:', error)
    process.exit(1)
  })





