#!/usr/bin/env node
/**
 * Test different Supabase connection options
 * Supabase provides multiple connection methods:
 * 1. Direct connection (port 5432)
 * 2. Connection pooling (port 6543) - recommended for serverless
 */

const { PrismaClient } = require('@prisma/client')

const baseUrl = 'db.fqkrigvliyphjwpokwbl.supabase.co'
const user = 'postgres'
const password = 'Step7nett.Umit'
const database = 'postgres'

const connectionOptions = [
  {
    name: 'Direct Connection (Port 5432)',
    url: `postgresql://${user}:${password}@${baseUrl}:5432/${database}?sslmode=require`
  },
  {
    name: 'Connection Pooling (Port 6543)',
    url: `postgresql://${user}:${password}@${baseUrl}:6543/${database}?sslmode=require&pgbouncer=true`
  },
  {
    name: 'Direct with Connection Timeout',
    url: `postgresql://${user}:${password}@${baseUrl}:5432/${database}?sslmode=require&connect_timeout=10`
  }
]

async function testConnection(name, url) {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: url
      }
    }
  })
  
  try {
    const startTime = Date.now()
    await prisma.$queryRaw`SELECT 1 as test`
    const duration = Date.now() - startTime
    
    return {
      success: true,
      duration,
      message: `✅ ${name}: Connected in ${duration}ms`
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: `❌ ${name}: ${error.code || 'Connection failed'}`
    }
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  console.log('🔍 Testing Supabase Connection Options\n')
  console.log('='.repeat(60))
  console.log(`📡 Base URL: ${baseUrl}`)
  console.log(`👤 User: ${user}`)
  console.log(`🗄️  Database: ${database}\n`)
  
  for (const option of connectionOptions) {
    const maskedUrl = option.url.replace(/:([^:@]+)@/, ':***@')
    console.log(`\n${option.name}`)
    console.log(`   URL: ${maskedUrl}`)
    
    const result = await testConnection(option.name, option.url)
    console.log(`   ${result.message}`)
    
    if (!result.success && result.error) {
      const errorPreview = result.error.substring(0, 100)
      console.log(`   Error: ${errorPreview}...`)
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  console.log('\n' + '='.repeat(60))
  console.log('💡 Recommendations:')
  console.log('   • Use connection pooling (port 6543) for serverless/edge functions')
  console.log('   • Use direct connection (port 5432) for long-lived connections')
  console.log('   • Check Supabase dashboard if all connections fail')
  console.log('   • Wait 5-15 minutes if database was recently restored')
}

main().catch(error => {
  console.error('\n❌ Unexpected error:', error.message)
  process.exit(1)
})

