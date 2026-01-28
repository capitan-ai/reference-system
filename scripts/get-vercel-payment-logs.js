#!/usr/bin/env node
/**
 * Get recent Vercel logs for payment webhooks
 * Uses Vercel CLI to fetch logs from the latest deployment
 */

const { execSync } = require('child_process')

async function getPaymentLogs() {
  console.log('🔍 Fetching Vercel logs for payment webhooks...\n')
  
  try {
    // Get list of deployments
    console.log('📡 Getting deployments list...')
    const deploymentsOutput = execSync('vercel ls', { encoding: 'utf-8', stdio: 'pipe' })
    const lines = deploymentsOutput.split('\n').filter(l => l.trim())
    
    console.log('Deployments found:')
    lines.slice(0, 10).forEach((line, idx) => {
      console.log(`  ${idx + 1}. ${line}`)
    })
    
    // Try to extract deployment URL from first line
    // Format is usually: https://project-name.vercel.app (production)
    const productionMatch = lines.find(l => l.includes('production') || l.includes('https://'))
    let deploymentUrl = null
    
    if (productionMatch) {
      // Extract URL from line (format varies)
      const urlMatch = productionMatch.match(/https?:\/\/[^\s]+/)
      if (urlMatch) {
        deploymentUrl = urlMatch[0]
      }
    }
    
    // If no URL found, try to get from vercel.json or environment
    if (!deploymentUrl) {
      // Try common patterns
      const possibleUrls = [
        'https://www.zorinastudio-referral.com',
        'https://zorinastudio-referral.vercel.app',
        process.env.VERCEL_URL
      ].filter(Boolean)
      
      if (possibleUrls.length > 0) {
        deploymentUrl = possibleUrls[0]
        console.log(`\n📍 Using deployment URL: ${deploymentUrl}`)
      }
    }
    
    if (!deploymentUrl) {
      console.error('\n❌ Could not determine deployment URL')
      console.error('   Please provide deployment URL manually:')
      console.error('   vercel logs <deployment-url>')
      return
    }
    
    console.log(`\n📋 Fetching logs from: ${deploymentUrl}`)
    console.log('   (This will show logs from now, streaming for 5 minutes max)\n')
    
    // Fetch logs with JSON format for easier parsing
    try {
      const logsOutput = execSync(`vercel logs "${deploymentUrl}" --json`, { 
        encoding: 'utf-8', 
        stdio: 'pipe',
        maxBuffer: 10 * 1024 * 1024, // 10MB
        timeout: 10000 // 10 second timeout
      })
      
      const logLines = logsOutput.split('\n').filter(l => l.trim())
      
      // Parse JSON logs and filter for payment/webhook related
      const paymentLogs = []
      const allLogs = []
      
      for (const line of logLines) {
        try {
          const logEntry = JSON.parse(line)
          allLogs.push(logEntry)
          
          const message = logEntry.message || logEntry.text || ''
          const lowerMessage = message.toLowerCase()
          
          if (lowerMessage.includes('payment') || 
              lowerMessage.includes('webhook') || 
              lowerMessage.includes('square') ||
              lowerMessage.includes('location_id') ||
              lowerMessage.includes('locationid') ||
              lowerMessage.includes('💳') ||
              lowerMessage.includes('🔔')) {
            paymentLogs.push(logEntry)
          }
        } catch (e) {
          // Not JSON, check if it's a payment-related text line
          const lowerLine = line.toLowerCase()
          if (lowerLine.includes('payment') || 
              lowerLine.includes('webhook') || 
              lowerLine.includes('square')) {
            paymentLogs.push({ message: line, raw: true })
          }
        }
      }
      
      if (paymentLogs.length > 0) {
        console.log(`✅ Found ${paymentLogs.length} payment/webhook related log entries:\n`)
        paymentLogs.slice(-50).forEach((log, idx) => {
          const timestamp = log.timestamp || log.date || new Date().toISOString()
          const message = log.message || log.text || log.raw || JSON.stringify(log)
          console.log(`${idx + 1}. [${timestamp}] ${message}`)
        })
      } else {
        console.log('ℹ️  No payment/webhook logs found in recent logs')
        console.log(`   Total log entries: ${allLogs.length}`)
        console.log('\n📋 Showing last 20 log entries:')
        allLogs.slice(-20).forEach((log, idx) => {
          const timestamp = log.timestamp || log.date || new Date().toISOString()
          const message = log.message || log.text || JSON.stringify(log)
          console.log(`${idx + 1}. [${timestamp}] ${message.substring(0, 200)}`)
        })
      }
      
    } catch (logError) {
      console.error('❌ Error fetching logs:', logError.message)
      console.error('\n💡 Alternative methods:')
      console.error('   1. Check Vercel Dashboard: https://vercel.com/dashboard')
      console.error('   2. Navigate to: Deployments → Latest → Logs')
      console.error('   3. Filter logs for "payment" or "webhook"')
      console.error('   4. Or run: vercel logs <deployment-url>')
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error('\n💡 Make sure you are:')
    console.error('   1. Logged into Vercel CLI: vercel login')
    console.error('   2. In the correct project directory')
    console.error('   3. Have access to the project')
  }
}

getPaymentLogs()
  .then(() => {
    console.log('\n✅ Log check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Failed:', error)
    process.exit(1)
  })



