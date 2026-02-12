#!/usr/bin/env node
/**
 * Test a specific database connection string
 * Usage: node scripts/test-db-connection-string.js
 */

const { PrismaClient } = require('@prisma/client')

const connectionString = process.argv[2] || 'postgresql://postgres:Step7nett.Umit@db.fqkrigvliyphjwpokwbl.supabase.co:5432/postgres'

async function testConnection() {
  console.log('🔍 Testing database connection...\n')
  console.log('='.repeat(60))
  
  // Mask password in display
  const maskedUrl = connectionString.replace(/:([^:@]+)@/, ':***@')
  console.log(`📡 Connection String: ${maskedUrl}\n`)
  
  // Create Prisma client with the connection string
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: connectionString
      }
    }
  })
  
  try {
    console.log('⏳ Attempting to connect...')
    const startTime = Date.now()
    
    // Test connection with a simple query
    const result = await prisma.$queryRaw`SELECT 1 as test, NOW() as current_time, version() as pg_version`
    
    const duration = Date.now() - startTime
    
    console.log('✅ Connection successful!')
    console.log(`   Response time: ${duration}ms`)
    console.log(`   Test result:`, result[0])
    console.log(`   PostgreSQL version: ${result[0].pg_version.split(' ')[0]} ${result[0].pg_version.split(' ')[1]}`)
    console.log(`   Current time: ${result[0].current_time}`)
    
    // Try a more complex query to verify full connectivity
    console.log('\n⏳ Testing database access...')
    const tableCheck = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      LIMIT 5
    `
    
    console.log(`✅ Database access verified!`)
    console.log(`   Found ${tableCheck.length} table(s) in public schema`)
    if (tableCheck.length > 0) {
      console.log(`   Sample tables: ${tableCheck.map(t => t.table_name).join(', ')}`)
    }
    
    process.exit(0)
    
  } catch (error) {
    console.error('❌ Connection failed!')
    console.error(`\n   Error Code: ${error.code || 'UNKNOWN'}`)
    console.error(`   Error Message: ${error.message}`)
    
    // Provide helpful error messages
    if (error.code === 'P1001') {
      console.error('\n   💡 This error means the database server is unreachable.')
      console.error('      Possible causes:')
      console.error('      1. Database is paused (Supabase free tier)')
      console.error('      2. Database is being restored')
      console.error('      3. Network connectivity issues')
      console.error('      4. Incorrect host/port')
    } else if (error.code === 'P1000') {
      console.error('\n   💡 Authentication failed.')
      console.error('      Check your username and password in the connection string.')
    } else if (error.code === 'P1017') {
      console.error('\n   💡 Database server closed the connection.')
      console.error('      This may indicate the database is paused or overloaded.')
    }
    
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

testConnection().catch(error => {
  console.error('\n❌ Unexpected error:', error.message)
  process.exit(1)
})

