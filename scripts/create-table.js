#!/usr/bin/env node

// Load environment variables
require('dotenv').config()

console.log('🚀 Creating square_existing_clients table...')

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function createTable() {
  try {
    console.log('📡 Creating square_existing_clients table...')
    
    // Create the table with the exact columns you specified
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS square_existing_clients (
        id SERIAL PRIMARY KEY,
        square_customer_id TEXT UNIQUE NOT NULL,
        given_name TEXT,
        family_name TEXT,
        email_address TEXT,
        phone_number TEXT,
        got_signup_bonus BOOLEAN DEFAULT FALSE,
        activated_as_referrer BOOLEAN DEFAULT FALSE,
        personal_code TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `
    
    console.log('✅ square_existing_clients table created successfully!')
    
    // Create indexes for better performance
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS idx_square_customer_id ON square_existing_clients(square_customer_id)
    `
    
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS idx_personal_code ON square_existing_clients(personal_code)
    `
    
    console.log('✅ Indexes created successfully!')
    console.log('🎉 Table setup completed!')
    
  } catch (error) {
    console.error('❌ Table creation failed:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

createTable()
