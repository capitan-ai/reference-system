#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function addMissingColumns() {
  console.log('🔧 Adding missing columns to square_existing_clients table...')
  
  try {
    await prisma.$connect()
    
    // Add missing columns one by one
    const columns = [
      'ALTER TABLE square_existing_clients ADD COLUMN IF NOT EXISTS gift_card_id TEXT',
      'ALTER TABLE square_existing_clients ADD COLUMN IF NOT EXISTS referral_code TEXT',
      'ALTER TABLE square_existing_clients ADD COLUMN IF NOT EXISTS referral_url TEXT',
      'ALTER TABLE square_existing_clients ADD COLUMN IF NOT EXISTS total_referrals INTEGER DEFAULT 0',
      'ALTER TABLE square_existing_clients ADD COLUMN IF NOT EXISTS total_rewards INTEGER DEFAULT 0',
      'ALTER TABLE square_existing_clients ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP WITH TIME ZONE'
    ]
    
    for (const column of columns) {
      try {
        await prisma.$executeRawUnsafe(column)
        console.log(`✅ Added column: ${column.split(' ')[5]}`)
      } catch (error) {
        console.log(`⚠️ Column might already exist: ${column.split(' ')[5]}`)
      }
    }
    
    // Add unique constraint on referral_code
    try {
      await prisma.$executeRawUnsafe('ALTER TABLE square_existing_clients ADD CONSTRAINT unique_referral_code UNIQUE (referral_code)')
      console.log('✅ Added unique constraint on referral_code')
    } catch (error) {
      console.log('⚠️ Unique constraint might already exist')
    }
    
    // Create indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_referral_code ON square_existing_clients (referral_code)',
      'CREATE INDEX IF NOT EXISTS idx_gift_card_id ON square_existing_clients (gift_card_id)',
      'CREATE INDEX IF NOT EXISTS idx_activated_referrer ON square_existing_clients (activated_as_referrer)'
    ]
    
    for (const index of indexes) {
      try {
        await prisma.$executeRawUnsafe(index)
        console.log(`✅ Created index: ${index.split(' ')[5]}`)
      } catch (error) {
        console.log(`⚠️ Index might already exist: ${index.split(' ')[5]}`)
      }
    }
    
    console.log('🎉 Database schema updated successfully!')
    
  } catch (error) {
    console.error('❌ Error updating database:', error)
  } finally {
    await prisma.$disconnect()
  }
}

addMissingColumns()
