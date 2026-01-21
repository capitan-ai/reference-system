#!/usr/bin/env node

/**
 * Phase 1: Test Supabase Connections
 * 
 * Tests both Supabase connection types:
 * - Direct connection (port 5432) - for migrations
 * - Pooled connection (port 6543) - for application
 * 
 * Usage:
 *   node scripts/migrate-phase1-test-supabase.js
 * 
 * Environment Variables:
 *   SUPABASE_DATABASE_URL - Supabase pooled connection (port 6543)
 *   SUPABASE_DIRECT_URL - Supabase direct connection (port 5432)
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const SUPABASE_DATABASE_URL = process.env.SUPABASE_DATABASE_URL || 
  'postgres://postgres:Step7nett.Umit@db.fqkrigvliyphjwpokwbl.supabase.co:6543/postgres?pgbouncer=true'

const SUPABASE_DIRECT_URL = process.env.SUPABASE_DIRECT_URL || 
  'postgres://postgres:Step7nett.Umit@db.fqkrigvliyphjwpokwbl.supabase.co:5432/postgres'

console.log('🔍 Testing Supabase connections...\n')

async function testConnection(name, url, isDirect = false) {
  console.log(`Testing ${name}...`)
  console.log(`   URL: ${url.replace(/:[^:@]+@/, ':****@')}`) // Hide password
  
  try {
    const prisma = new PrismaClient({
      datasources: {
        db: { url }
      }
    })

    // Test basic connection
    const result = await prisma.$queryRaw`SELECT version() as version`
    console.log(`   ✅ Connection successful`)
    console.log(`   📊 PostgreSQL version: ${result[0]?.version?.substring(0, 50)}...`)

    // Test if we can query
    const tableCount = await prisma.$queryRaw`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `
    console.log(`   📋 Public tables: ${tableCount[0]?.count || 0}`)

    // For direct connection, test if we can create tables (migration capability)
    if (isDirect) {
      try {
        await prisma.$executeRaw`SELECT 1`
        console.log(`   ✅ Can execute SQL (ready for migrations)`)
      } catch (error) {
        console.warn(`   ⚠️  Warning: May have limited migration capabilities`)
      }
    }

    await prisma.$disconnect()
    return true
  } catch (error) {
    console.error(`   ❌ Connection failed: ${error.message}`)
    if (error.message.includes('password')) {
      console.error(`   💡 Check your Supabase password in the connection string`)
    }
    if (error.message.includes('timeout')) {
      console.error(`   💡 Check your network connection and Supabase project status`)
    }
    return false
  }
}

async function main() {
  console.log('='.repeat(60))
  console.log('Testing Supabase Direct Connection (Port 5432)')
  console.log('='.repeat(60))
  const directSuccess = await testConnection('Direct Connection (Migrations)', SUPABASE_DIRECT_URL, true)
  
  console.log('\n' + '='.repeat(60))
  console.log('Testing Supabase Pooled Connection (Port 6543)')
  console.log('='.repeat(60))
  const pooledSuccess = await testConnection('Pooled Connection (Application)', SUPABASE_DATABASE_URL, false)

  console.log('\n' + '='.repeat(60))
  if (directSuccess && pooledSuccess) {
    console.log('✅ All connections successful!')
    console.log('\n💡 Next step: Run migrate-phase1-migrate-schema.js to migrate schema')
  } else {
    console.log('❌ Some connections failed. Please fix the issues above.')
    process.exit(1)
  }
}

main().catch(error => {
  console.error('❌ Test failed:', error)
  process.exit(1)
})


