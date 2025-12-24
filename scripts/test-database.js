#!/usr/bin/env node

// Load environment variables
require('dotenv').config()

console.log('🚀 Testing database connection...')

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function testDatabase() {
  try {
    console.log('📡 Testing database connection...')
    
    // Test basic connection
    await prisma.$connect()
    console.log('✅ Database connection successful!')
    
    // Test if square_existing_clients table exists
    try {
      const result = await prisma.$queryRaw`SELECT COUNT(*) FROM square_existing_clients`
      console.log('✅ square_existing_clients table exists!')
      console.log('📊 Current records:', result[0].count)
    } catch (error) {
      console.error('❌ square_existing_clients table not found:', error.message)
    }
    
    console.log('🎉 Database test completed!')
  } catch (error) {
    console.error('❌ Database test failed:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

testDatabase()
