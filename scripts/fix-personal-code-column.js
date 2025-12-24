#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function fixPersonalCodeColumn() {
  try {
    console.log('🔧 Fixing personal_code column to allow NULL...')
    
    // First check current state
    const currentState = await prisma.$queryRaw`
      SELECT column_name, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'square_existing_clients' 
        AND column_name = 'personal_code'
    `
    
    console.log('Current state:', JSON.stringify(currentState, null, 2))
    
    if (currentState[0].is_nullable === 'NO') {
      console.log('\n⚠️ Column is NOT NULL, fixing...')
      
      await prisma.$executeRaw`
        ALTER TABLE square_existing_clients 
        ALTER COLUMN personal_code DROP NOT NULL
      `
      
      console.log('✅ Fixed! Column now allows NULL')
    } else {
      console.log('\n✅ Column already allows NULL')
    }
    
    // Verify
    const verifyState = await prisma.$queryRaw`
      SELECT column_name, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'square_existing_clients' 
        AND column_name = 'personal_code'
    `
    
    console.log('\nVerified state:', JSON.stringify(verifyState, null, 2))
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

fixPersonalCodeColumn()

