#!/usr/bin/env node
require('dotenv').config()

const { exec } = require('child_process')
const util = require('util')
const execPromise = util.promisify(exec)

async function getRecentWebhookLogs() {
  try {
    console.log('📡 Fetching recent webhook logs from Vercel...')
    
    const { stdout } = await execPromise('vercel logs referral-system-salon.vercel.app --since 30m 2>&1')
    
    console.log('\n' + '=' .repeat(80))
    console.log('WEBHOOK LOGS (last 30 minutes):')
    console.log('=' .repeat(80))
    console.log(stdout)
    console.log('=' .repeat(80))
    
    // Parse for important events
    const lines = stdout.split('\n')
    const webhookEvents = lines.filter(line => 
      line.includes('customer.created') || 
      line.includes('booking.created') || 
      line.includes('Received') ||
      line.includes('Error') ||
      line.includes('Aby') ||
      line.includes('Y4BV3AGY3NXYCK63PA4ZA2ZJ14')
    )
    
    if (webhookEvents.length > 0) {
      console.log('\n\n🎯 KEY EVENTS FOUND:')
      webhookEvents.forEach((line, i) => {
        console.log(`${i + 1}. ${line}`)
      })
    }
    
  } catch (error) {
    console.error('Error fetching logs:', error.message)
  }
}

getRecentWebhookLogs()

