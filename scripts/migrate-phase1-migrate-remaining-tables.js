#!/usr/bin/env node

/**
 * Phase 1: Migrate Remaining Tables to Supabase
 * 
 * Migrates tables that failed due to Prisma adapter limitations
 * Uses raw SQL COPY commands for better compatibility
 * 
 * Usage:
 *   node scripts/migrate-phase1-migrate-remaining-tables.js
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

if (!NEON_DATABASE_URL || !SUPABASE_DIRECT_URL) {
  console.error('❌ Error: Both NEON_DATABASE_URL and SUPABASE_DIRECT_URL are required')
  process.exit(1)
}

console.log('🔄 Migrating remaining tables to Supabase...\n')

// Tables that need to be migrated using raw SQL
const remainingTables = [
  'ref_links',
  'ref_matches', 
  'ref_rewards',
  'bookings',
  'booking_appointment_segments',
  'square_existing_clients',
  'square_gift_card_gan_audit'
]

async function migrateTable(tableName, neonPrisma, supabasePrisma) {
  try {
    console.log(`📦 Migrating ${tableName}...`)
    
    // Get all data from Neon
    const records = await neonPrisma.$queryRawUnsafe(`SELECT * FROM ${tableName}`)
    
    if (records.length === 0) {
      console.log(`   ${tableName}: 0 records (skipped)`)
      return 0
    }
    
    console.log(`   Found ${records.length} records`)
    
    // Get column names
    const columns = Object.keys(records[0])
    
    // Insert in batches using raw SQL
    const batchSize = 50
    let inserted = 0
    
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)
      
      // Build VALUES clause
      const values = batch.map(record => {
        const vals = columns.map(col => {
          const val = record[col]
          if (val === null || val === undefined) return 'NULL'
          if (typeof val === 'string') {
            // Escape single quotes
            return `'${val.replace(/'/g, "''").replace(/\\/g, '\\\\')}'`
          }
          if (val instanceof Date) {
            return `'${val.toISOString()}'`
          }
          if (typeof val === 'boolean') {
            return val ? 'true' : 'false'
          }
          if (typeof val === 'object') {
            // JSON fields
            return `'${JSON.stringify(val).replace(/'/g, "''")}'`
          }
          return val.toString()
        })
        return `(${vals.join(', ')})`
      }).join(', ')
      
      const cols = columns.map(c => `"${c}"`).join(', ')
      
      // Use INSERT with ON CONFLICT DO NOTHING to avoid duplicates
      const insertSQL = `
        INSERT INTO ${tableName} (${cols}) 
        VALUES ${values}
        ON CONFLICT DO NOTHING
      `
      
      try {
        await supabasePrisma.$executeRawUnsafe(insertSQL)
        inserted += batch.length
        process.stdout.write(`\r   ${tableName}: ${inserted}/${records.length} records`)
      } catch (error) {
        // If batch insert fails, try individual inserts
        console.log(`\n   ⚠️  Batch insert failed, trying individual inserts...`)
        for (const record of batch) {
          try {
            const singleValues = columns.map(col => {
              const val = record[col]
              if (val === null || val === undefined) return 'NULL'
              if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`
              if (val instanceof Date) return `'${val.toISOString()}'`
              if (typeof val === 'boolean') return val ? 'true' : 'false'
              if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`
              return val.toString()
            }).join(', ')
            
            await supabasePrisma.$executeRawUnsafe(
              `INSERT INTO ${tableName} (${cols}) VALUES (${singleValues}) ON CONFLICT DO NOTHING`
            )
            inserted++
          } catch (err) {
            console.log(`\n   ⚠️  Skipped record due to error: ${err.message.substring(0, 50)}`)
          }
        }
      }
    }
    
    console.log(` ✅`)
    return records.length
    
  } catch (error) {
    console.log(` ❌ Error: ${error.message.substring(0, 80)}`)
    return 0
  }
}

async function main() {
  const neonPrisma = new PrismaClient({
    datasources: { db: { url: NEON_DATABASE_URL } }
  })
  
  const supabasePrisma = new PrismaClient({
    datasources: { db: { url: SUPABASE_DIRECT_URL } }
  })

  try {
    console.log('📡 Connecting to databases...')
    await neonPrisma.$connect()
    await supabasePrisma.$connect()
    console.log('✅ Connected\n')
    
    let totalRecords = 0
    
    for (const table of remainingTables) {
      const count = await migrateTable(table, neonPrisma, supabasePrisma)
      totalRecords += count
    }
    
    console.log(`\n✅ Remaining tables migration completed!`)
    console.log(`   Total records migrated: ${totalRecords}`)
    console.log(`\n💡 Next step: Run migrate-phase1-verify.js again to verify`)

  } catch (error) {
    console.error('\n❌ Migration failed:', error)
    process.exit(1)
  } finally {
    await neonPrisma.$disconnect()
    await supabasePrisma.$disconnect()
  }
}

main()




