#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function testDatabaseConnection() {
  try {
    console.log('🔍 Testing database connection...')
    
    // Test query
    const result = await prisma.$queryRaw`SELECT COUNT(*) as count FROM square_existing_clients`
    
    console.log('✅ Database connection works!')
    console.log('Total customers:', result[0].count)
    
    // Test insert
    const testId = 'DB_TEST_' + Date.now()
    console.log('\n🧪 Testing INSERT...')
    
    await prisma.$executeRaw`
      INSERT INTO square_existing_clients (
        square_customer_id,
        given_name,
        family_name,
        got_signup_bonus,
        activated_as_referrer
      ) VALUES (
        ${testId},
        'Test',
        'DB',
        FALSE,
        FALSE
      )
    `
    
    console.log('✅ INSERT successful!')
    
    // Verify
    const verify = await prisma.$queryRaw`
      SELECT * FROM square_existing_clients WHERE square_customer_id = ${testId}
    `
    
    console.log('✅ Verification:', verify.length > 0 ? 'Found' : 'Not found')
    
    // Cleanup
    await prisma.$executeRaw`DELETE FROM square_existing_clients WHERE square_customer_id = ${testId}`
    console.log('✅ Cleanup successful!')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

testDatabaseConnection()

