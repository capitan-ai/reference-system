#!/usr/bin/env node
/**
 * Comprehensive system health check
 * Tests all Supabase services and database connectivity
 */

require('dotenv').config()
const { checkDatabaseHealth } = require('../lib/db-health-check')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fqkrigvliyphjwpokwbl.supabase.co'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

async function checkHttpEndpoint(name, path) {
  try {
    const url = `${SUPABASE_URL}${path}`
    const startTime = Date.now()
    
    const response = await fetch(url, {
      method: 'GET',
      headers: ANON_KEY ? { 'apikey': ANON_KEY } : {}
    })
    
    const duration = Date.now() - startTime
    const status = response.status
    
    return {
      name,
      url,
      status,
      duration,
      healthy: status < 500, // 2xx, 3xx, 4xx are OK (service is responding)
      error: null
    }
  } catch (error) {
    return {
      name,
      url: `${SUPABASE_URL}${path}`,
      status: null,
      duration: null,
      healthy: false,
      error: error.message
    }
  }
}

async function main() {
  console.log('🏥 System Health Check\n')
  console.log('='.repeat(60))
  console.log(`📡 Supabase URL: ${SUPABASE_URL}`)
  console.log(`🔑 Anon Key: ${ANON_KEY ? '✅ Set' : '❌ Not set'}\n`)
  
  // Check URL format
  if (SUPABASE_URL.includes('db.')) {
    console.error('❌ ERROR: NEXT_PUBLIC_SUPABASE_URL should NOT include "db." prefix!')
    console.error(`   Current: ${SUPABASE_URL}`)
    console.error(`   Should be: ${SUPABASE_URL.replace('db.', '')}`)
    return
  }
  
  const checks = []
  
  // 1. Check Auth endpoint
  console.log('1️⃣  Checking Auth Service...')
  const authCheck = await checkHttpEndpoint('Auth', '/auth/v1/health')
  checks.push(authCheck)
  if (authCheck.healthy) {
    console.log(`   ✅ Auth service is responding (${authCheck.status} in ${authCheck.duration}ms)`)
  } else {
    console.log(`   ❌ Auth service error: ${authCheck.error || `HTTP ${authCheck.status}`}`)
  }
  
  // 2. Check REST API endpoint
  console.log('\n2️⃣  Checking REST API Service...')
  const restCheck = await checkHttpEndpoint('REST API', '/rest/v1/')
  checks.push(restCheck)
  if (restCheck.healthy) {
    console.log(`   ✅ REST API is responding (${restCheck.status} in ${restCheck.duration}ms)`)
  } else {
    console.log(`   ❌ REST API error: ${restCheck.error || `HTTP ${restCheck.status}`}`)
  }
  
  // 3. Check Database connection
  console.log('\n3️⃣  Checking Database Connection...')
  const dbHealth = await checkDatabaseHealth()
  checks.push({
    name: 'Database',
    healthy: dbHealth.healthy,
    error: dbHealth.error
  })
  if (dbHealth.healthy) {
    console.log(`   ✅ Database connection successful`)
    console.log(`   ${dbHealth.details.message}`)
  } else {
    console.log(`   ❌ Database connection failed`)
    if (dbHealth.error) {
      const errorLines = dbHealth.error.split('\n').slice(0, 3)
      errorLines.forEach(line => console.log(`   ${line}`))
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('📊 Health Summary:')
  console.log('='.repeat(60))
  
  const healthyCount = checks.filter(c => c.healthy).length
  const totalCount = checks.length
  
  checks.forEach(check => {
    const icon = check.healthy ? '✅' : '❌'
    const status = check.healthy ? 'Healthy' : 'Unhealthy'
    console.log(`   ${icon} ${check.name}: ${status}`)
  })
  
  console.log(`\n   Overall: ${healthyCount}/${totalCount} services healthy`)
  
  if (healthyCount === totalCount) {
    console.log('\n🎉 All systems operational!')
    process.exit(0)
  } else {
    console.log('\n⚠️  Some services are unavailable')
    console.log('\n💡 Next steps:')
    console.log('   1. Check Supabase dashboard for service status')
    console.log('   2. Wait for services to recover if recently restored')
    console.log('   3. Verify environment variables are set correctly')
    process.exit(1)
  }
}

main().catch(error => {
  console.error('\n❌ Unexpected error:', error.message)
  process.exit(1)
})

