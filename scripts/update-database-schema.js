#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function updateDatabaseSchema() {
  console.log('🔧 Updating database schema for referral system...')
  
  try {
    await prisma.$connect()
    
    // Add new columns to square_existing_clients table
    const updates = [
      `ALTER TABLE square_existing_clients ADD COLUMN IF NOT EXISTS gift_card_id TEXT;`,
      `ALTER TABLE square_existing_clients ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;`,
      `ALTER TABLE square_existing_clients ADD COLUMN IF NOT EXISTS referral_url TEXT;`,
      `ALTER TABLE square_existing_clients ADD COLUMN IF NOT EXISTS total_referrals INTEGER DEFAULT 0;`,
      `ALTER TABLE square_existing_clients ADD COLUMN IF NOT EXISTS total_rewards INTEGER DEFAULT 0;`,
      `ALTER TABLE square_existing_clients ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP WITH TIME ZONE;`
    ]

    for (const update of updates) {
      try {
        await prisma.$executeRaw`${update}`
        console.log(`✅ Executed: ${update}`)
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`ℹ️ Column already exists: ${update}`)
        } else {
          console.error(`❌ Error executing: ${update}`, error.message)
        }
      }
    }

    // Create indexes for better performance
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_referral_code ON square_existing_clients (referral_code);`,
      `CREATE INDEX IF NOT EXISTS idx_gift_card_id ON square_existing_clients (gift_card_id);`,
      `CREATE INDEX IF NOT EXISTS idx_activated_referrer ON square_existing_clients (activated_as_referrer);`
    ]

    for (const index of indexes) {
      try {
        await prisma.$executeRaw`${index}`
        console.log(`✅ Created index: ${index}`)
      } catch (error) {
        console.error(`❌ Error creating index: ${index}`, error.message)
      }
    }

    console.log('\n🎉 Database schema updated successfully!')
    
    // Show current table structure
    const tableInfo = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'square_existing_clients' 
      ORDER BY ordinal_position
    `
    
    console.log('\n📊 Current table structure:')
    tableInfo.forEach(col => {
      console.log(`   - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : ''}`)
    })

  } catch (error) {
    console.error('💥 Fatal error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

updateDatabaseSchema()
