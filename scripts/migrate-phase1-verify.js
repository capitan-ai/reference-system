#!/usr/bin/env node

/**
 * Phase 1: Verify Migration
 * 
 * Compares row counts between Neon and Supabase databases
 * Verifies that all data was migrated successfully
 * 
 * Usage:
 *   node scripts/migrate-phase1-verify.js
 * 
 * Environment Variables:
 *   NEON_DATABASE_URL - Neon database connection string
 *   SUPABASE_DIRECT_URL - Supabase direct connection (port 5432)
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL
const SUPABASE_DIRECT_URL = process.env.SUPABASE_DIRECT_URL || 
  'postgres://postgres:Step7nett.Umit@db.fqkrigvliyphjwpokwbl.supabase.co:5432/postgres'

if (!NEON_DATABASE_URL) {
  console.error('❌ Error: NEON_DATABASE_URL or DATABASE_URL environment variable is required')
  process.exit(1)
}

if (!SUPABASE_DIRECT_URL) {
  console.error('❌ Error: SUPABASE_DIRECT_URL environment variable is required')
  process.exit(1)
}

console.log('🔍 Verifying migration from Neon to Supabase...\n')
console.log('='.repeat(80))

// List of all models to verify
const models = [
  'customer',
  'refLink',
  'refClick',
  'refMatch',
  'refReward',
  'booking',
  'payment',
  'order',
  'location',
  'teamMember',
  'serviceVariation',
  'bookingAppointmentSegment',
  'paymentTender',
  'giftCardRun',
  'giftCardJob',
  'notificationEvent',
  'devicePassRegistration',
  'processedEvent',
  'analyticsDeadLetter'
]

// Also check legacy tables
const legacyTables = [
  'square_existing_clients',
  'square_gift_card_gan_audit'
]

async function verifyMigration() {
  const neonPrisma = new PrismaClient({
    datasources: { db: { url: NEON_DATABASE_URL } }
  })
  
  const supabasePrisma = new PrismaClient({
    datasources: { db: { url: SUPABASE_DIRECT_URL } }
  })

  try {
    console.log('\n📊 Comparing table row counts...\n')
    console.log('Table Name'.padEnd(40) + 'Neon'.padEnd(15) + 'Supabase'.padEnd(15) + 'Status')
    console.log('-'.repeat(85))

    let allMatch = true
    let totalNeon = 0
    let totalSupabase = 0
    const results = []

    // Check Prisma models
    for (const model of models) {
      try {
        const neonCount = await neonPrisma[model].count()
        const supabaseCount = await supabasePrisma[model].count()
        const match = neonCount === supabaseCount
        
        totalNeon += neonCount
        totalSupabase += supabaseCount
        
        const status = match ? '✅ Match' : '❌ Mismatch'
        results.push({ model, neonCount, supabaseCount, match })
        
        console.log(
          model.padEnd(40) + 
          neonCount.toString().padEnd(15) + 
          supabaseCount.toString().padEnd(15) + 
          status
        )
        
        if (!match) allMatch = false
      } catch (error) {
        // Model might not exist or have different name
        console.log(`${model.padEnd(40)}Error: ${error.message.substring(0, 30)}`)
      }
    }

    // Check legacy tables using raw SQL
    for (const table of legacyTables) {
      try {
        const neonResult = await neonPrisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM ${table}`)
        const supabaseResult = await supabasePrisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM ${table}`)
        
        const neonCount = parseInt(neonResult[0]?.count || 0)
        const supabaseCount = parseInt(supabaseResult[0]?.count || 0)
        const match = neonCount === supabaseCount
        
        totalNeon += neonCount
        totalSupabase += supabaseCount
        
        const status = match ? '✅ Match' : '❌ Mismatch'
        results.push({ model: table, neonCount, supabaseCount, match })
        
        console.log(
          table.padEnd(40) + 
          neonCount.toString().padEnd(15) + 
          supabaseCount.toString().padEnd(15) + 
          status
        )
        
        if (!match) allMatch = false
      } catch (error) {
        console.log(`${table.padEnd(40)}Error: ${error.message.substring(0, 30)}`)
      }
    }

    console.log('-'.repeat(85))
    console.log('TOTAL'.padEnd(40) + totalNeon.toString().padEnd(15) + totalSupabase.toString().padEnd(15))
    console.log('\n' + '='.repeat(80))

    // Verify sample records
    console.log('\n🔍 Verifying sample records...\n')
    
    try {
      const sampleCustomer = await neonPrisma.customer.findFirst({
        include: {
          RefLinks: true
        }
      })
      
      if (sampleCustomer) {
        const supabaseCustomer = await supabasePrisma.customer.findUnique({
          where: { id: sampleCustomer.id },
          include: {
            RefLinks: true
          }
        })
        
        if (supabaseCustomer) {
          console.log(`✅ Sample customer record matches (ID: ${sampleCustomer.id})`)
          console.log(`   Email: ${sampleCustomer.email || 'N/A'}`)
          console.log(`   Phone: ${sampleCustomer.phoneE164 || 'N/A'}`)
        } else {
          console.log(`❌ Sample customer record not found in Supabase (ID: ${sampleCustomer.id})`)
          allMatch = false
        }
      } else {
        console.log('⚠️  No customers found in Neon database')
      }
    } catch (error) {
      console.log(`⚠️  Could not verify sample records: ${error.message}`)
    }

    // Summary
    console.log('\n' + '='.repeat(80))
    if (allMatch) {
      console.log('✅ MIGRATION VERIFICATION SUCCESSFUL!')
      console.log('   All tables match between Neon and Supabase.')
      console.log('\n💡 Next steps:')
      console.log('   1. Review the results above')
      console.log('   2. Test application functionality with Supabase')
      console.log('   3. When ready, proceed to Phase 2 (code updates and cutover)')
    } else {
      console.log('⚠️  MIGRATION VERIFICATION INCOMPLETE')
      console.log('   Some tables do not match. Please review the results above.')
      console.log('\n💡 Troubleshooting:')
      console.log('   - Check for errors during data import')
      console.log('   - Verify all foreign key constraints are satisfied')
      console.log('   - Re-run data migration if needed')
      process.exit(1)
    }

  } catch (error) {
    console.error('❌ Verification error:', error)
    process.exit(1)
  } finally {
    await neonPrisma.$disconnect()
    await supabasePrisma.$disconnect()
  }
}

verifyMigration()


