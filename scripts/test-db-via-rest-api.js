#!/usr/bin/env node
/**
 * Test database connectivity via REST API
 * This actually hits the database through PostgREST
 * 
 * If this works → Database is alive, issue is external connectivity
 * If this fails → Database path is broken
 */

require('dotenv').config()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fqkrigvliyphjwpokwbl.supabase.co'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.argv[2]
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.argv[3]

async function testRestApi() {
  console.log('🔍 Testing Database via REST API\n')
  console.log('='.repeat(60))
  console.log(`📡 Supabase URL: ${SUPABASE_URL}`)
  
  // Check which key to use
  const apiKey = SERVICE_KEY || ANON_KEY
  if (!apiKey) {
    console.error('❌ No API key found!')
    console.error('   Options:')
    console.error('   1. Set NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY in .env')
    console.error('   2. Pass as argument: node scripts/test-db-via-rest-api.js <anon_key> [service_key]')
    console.error('   3. Use curl directly:')
    console.error(`      curl -i '${SUPABASE_URL}/rest/v1/' \\`)
    console.error('        -H "apikey: <YOUR_KEY>" \\')
    console.error('        -H "Authorization: Bearer <YOUR_KEY>"')
    process.exit(1)
  }
  
  const keyType = SERVICE_KEY ? 'Service Role Key' : 'Anon Key'
  console.log(`🔑 Using: ${keyType} (${apiKey.substring(0, 20)}...)\n`)
  
  // Test 1: Basic REST API endpoint
  console.log('1️⃣  Testing REST API endpoint (hits database)...')
  try {
    const startTime = Date.now()
    const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'GET',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    })
    
    const duration = Date.now() - startTime
    const status = response.status
    const responseText = await response.text()
    
    console.log(`   Status: ${status} ${response.statusText}`)
    console.log(`   Response time: ${duration}ms`)
    
    // Parse response if possible
    let responseData
    try {
      responseData = JSON.parse(responseText)
    } catch (e) {
      responseData = responseText.substring(0, 200)
    }
    
    if (status === 200 || status === 404) {
      console.log('   ✅ REST API is working (database path is responding)')
      console.log('   📦 Response:', typeof responseData === 'object' ? JSON.stringify(responseData, null, 2) : responseData)
      console.log('\n   💡 This means:')
      console.log('      • Database is ALIVE and accessible')
      console.log('      • PostgREST can connect to database')
      console.log('      • Issue is likely external connectivity (IP ban, firewall, network)')
      return true
    } else if (status >= 500) {
      console.log('   ❌ Server error (5xx)')
      console.log('   📦 Response:', responseData)
      console.log('\n   💡 This means:')
      console.log('      • Database path is broken')
      console.log('      • PostgREST cannot connect to database')
      console.log('      • Database may be truly down')
      return false
    } else if (status === 401 || status === 403) {
      console.log('   ⚠️  Authentication error (expected without proper key)')
      console.log('   📦 Response:', responseData)
      console.log('\n   💡 This means:')
      console.log('      • REST API is responding')
      console.log('      • But authentication failed')
      console.log('      • Try with a valid API key')
      return null // Inconclusive
    } else {
      console.log(`   ⚠️  Unexpected status: ${status}`)
      console.log('   📦 Response:', responseData)
      return null
    }
  } catch (error) {
    console.log('   ❌ Request failed:', error.message)
    if (error.message.includes('timeout') || error.message.includes('ECONNRESET')) {
      console.log('\n   💡 This means:')
      console.log('      • Connection timeout (522-like behavior)')
      console.log('      • Database path may be broken')
      console.log('      • Or network connectivity issue')
    }
    return false
  }
}

// Test 2: Try to query a table (if we know one exists)
async function testTableQuery() {
  const apiKey = SERVICE_KEY || ANON_KEY
  if (!apiKey) return
  
  console.log('\n2️⃣  Testing table query (if tables exist)...')
  
  // Try to list tables or query a common table
  const testTables = ['organizations', 'square_existing_clients', 'bookings', 'orders']
  
  for (const table of testTables) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?limit=1`, {
        method: 'GET',
        headers: {
          'apikey': apiKey,
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
          'Prefer': 'count=exact'
        }
      })
      
      if (response.status === 200) {
        const data = await response.json()
        console.log(`   ✅ Table "${table}" is accessible`)
        console.log(`   📊 Sample data: ${JSON.stringify(data).substring(0, 100)}...`)
        return true
      } else if (response.status === 404) {
        console.log(`   ⚠️  Table "${table}" not found (may not exist)`)
      } else if (response.status === 401 || response.status === 403) {
        console.log(`   ⚠️  Table "${table}" requires authentication (RLS may be blocking)`)
      }
    } catch (error) {
      // Skip errors, try next table
    }
  }
  
  return null
}

async function main() {
  const restApiWorks = await testRestApi()
  const tableQueryWorks = await testTableQuery()
  
  console.log('\n' + '='.repeat(60))
  console.log('📊 Diagnosis Summary:')
  console.log('='.repeat(60))
  
  if (restApiWorks === true) {
    console.log('✅ Database is ALIVE and accessible via REST API')
    console.log('   → Issue is external connectivity (not database being down)')
    console.log('   → Check: IP restrictions, firewall, network settings')
  } else if (restApiWorks === false) {
    console.log('❌ Database path is broken')
    console.log('   → Database may be truly down')
    console.log('   → Check Supabase dashboard for service status')
  } else {
    console.log('⚠️  Inconclusive - need valid API key to test properly')
  }
  
  console.log('\n💡 Next step: Test from Supabase SQL Editor')
  console.log('   1. Go to Supabase Dashboard → SQL Editor')
  console.log('   2. Run: SELECT now();')
  console.log('   3. If this works → DB is alive, issue is external')
  console.log('   4. If this fails → DB is truly down')
}

main().catch(error => {
  console.error('\n❌ Unexpected error:', error.message)
  process.exit(1)
})

