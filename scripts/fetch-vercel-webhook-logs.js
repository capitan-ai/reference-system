#!/usr/bin/env node
/**
 * Fetch recent Vercel logs for Square webhook activity
 * This script helps identify payment webhook issues
 */

const { execSync } = require('child_process')

async function fetchVercelLogs() {
  console.log('🔍 Fetching Vercel logs for Square webhook activity...\n')
  
  try {
    // Get latest deployment URL
    console.log('📡 Getting latest deployment...')
    const deploymentsOutput = execSync('vercel ls --json', { encoding: 'utf-8', stdio: 'pipe' })
    const deployments = JSON.parse(deploymentsOutput)
    
    if (!deployments || deployments.length === 0) {
      console.log('❌ No deployments found')
      return
    }
    
    const latestDeployment = deployments[0]
    const deploymentUrl = latestDeployment.url || latestDeployment.uid
    
    console.log(`✅ Latest deployment: ${deploymentUrl}`)
    console.log(`   Created: ${latestDeployment.created || 'N/A'}`)
    console.log(`   State: ${latestDeployment.state || 'N/A'}\n`)
    
    // Fetch logs
    console.log('📋 Fetching logs (last 5 minutes)...\n')
    try {
      const logsOutput = execSync(`vercel logs "${deploymentUrl}"`, { 
        encoding: 'utf-8', 
        stdio: 'pipe',
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      })
      
      const logs = logsOutput.split('\n')
      
      // Filter for payment/webhook related logs
      const webhookLogs = logs.filter(line => 
        line.toLowerCase().includes('payment') ||
        line.toLowerCase().includes('webhook') ||
        line.toLowerCase().includes('square') ||
        line.toLowerCase().includes('location')
      )
      
      if (webhookLogs.length === 0) {
        console.log('ℹ️  No payment/webhook logs found in recent logs')
        console.log('   This might mean:')
        console.log('   1. No webhooks received in the last 5 minutes')
        console.log('   2. Logs are filtered out')
        console.log('   3. Webhooks are going to a different endpoint\n')
        
        // Show sample of all logs
        console.log('📋 Sample of all recent logs (last 20 lines):')
        logs.slice(-20).forEach(line => {
          if (line.trim()) console.log(line)
        })
      } else {
        console.log(`✅ Found ${webhookLogs.length} payment/webhook related log entries:\n`)
        webhookLogs.forEach((line, idx) => {
          console.log(`${idx + 1}. ${line}`)
        })
      }
      
    } catch (logError) {
      console.error('❌ Error fetching logs:', logError.message)
      console.error('\n💡 Alternative: Check Vercel Dashboard')
      console.error('   https://vercel.com/dashboard')
      console.error('   Navigate to: Deployments → Latest → Logs')
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error('\n💡 Make sure you are:')
    console.error('   1. Logged into Vercel CLI: vercel login')
    console.error('   2. In the correct project directory')
    console.error('   3. Have access to the project')
  }
}

fetchVercelLogs()
  .then(() => {
    console.log('\n✅ Log check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Failed:', error)
    process.exit(1)
  })

