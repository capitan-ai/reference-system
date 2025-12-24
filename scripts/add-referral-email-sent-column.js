#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function addReferralEmailSentColumn() {
  try {
    console.log('🔧 Adding referral_email_sent column to square_existing_clients table...')
    
    await prisma.$executeRaw`
      ALTER TABLE square_existing_clients 
      ADD COLUMN IF NOT EXISTS referral_email_sent BOOLEAN DEFAULT FALSE
    `
    
    console.log('✅ Column added successfully!')
    console.log('')
    console.log('Column details:')
    console.log('  - Name: referral_email_sent')
    console.log('  - Type: BOOLEAN')
    console.log('  - Default: FALSE')
    console.log('  - Purpose: Track if referral code email was sent to customer')
    
  } catch (error) {
    console.error('❌ Error adding column:', error.message)
    if (error.message.includes('already exists')) {
      console.log('ℹ️ Column already exists, skipping...')
    }
  } finally {
    await prisma.$disconnect()
  }
}

addReferralEmailSentColumn()
