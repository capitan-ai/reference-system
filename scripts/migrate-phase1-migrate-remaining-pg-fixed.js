#!/usr/bin/env node

/**
 * Phase 1: Migrate Remaining Tables (with foreign key handling)
 * 
 * Temporarily disables foreign key checks during import
 * Uses pg library directly to avoid Prisma adapter limitations
 * 
 * Usage:
 *   node scripts/migrate-phase1-migrate-remaining-pg-fixed.js
 * 
 * Environment Variables:
 *   NEON_DATABASE_URL - Neon database connection string
 *   SUPABASE_DIRECT_URL - Supabase direct connection (port 5432)
 */

require('dotenv').config()
const { Pool } = require('pg')

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL
const SUPABASE_DIRECT_URL = process.env.SUPABASE_DIRECT_URL || 
  'postgres://postgres:Step7nett.Umit@db.fqkrigvliyphjwpokwbl.supabase.co:5432/postgres'

if (!NEON_DATABASE_URL || !SUPABASE_DIRECT_URL) {
  console.error('❌ Error: Both NEON_DATABASE_URL and SUPABASE_DIRECT_URL are required')
  process.exit(1)
}

console.log('🔄 Migrating remaining tables with foreign key handling...\n')

// Tables in order - simpler tables first, then ones with foreign keys
const remainingTables = [
  'ref_links',      // References customers
  'ref_matches',    // References bookings, customers
  'ref_rewards',    // References customers
  'bookings',       // References locations, customers
  'booking_appointment_segments', // References bookings
  'square_existing_clients',
  'square_gift_card_gan_audit'
]

async function migrateTable(tableName, neonPool, supabasePool) {
  try {
    console.log(`📦 Migrating ${tableName}...`)
    
    // Get all data from Neon
    const result = await neonPool.query(`SELECT * FROM ${tableName}`)
    const records = result.rows
    
    if (records.length === 0) {
      console.log(`   ${tableName}: 0 records (skipped)`)
      return 0
    }
    
    console.log(`   Found ${records.length} records`)
    
    // Get column names
    const columns = Object.keys(records[0])
    const columnList = columns.map(c => `"${c}"`).join(', ')
    
    // Temporarily disable foreign key checks for this table
    await supabasePool.query('SET session_replication_role = replica')
    
    // Insert in batches
    const batchSize = 100
    let inserted = 0
    let skipped = 0
    
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)
      
      // Build VALUES clause with proper escaping
      const values = batch.map((record, idx) => {
        const placeholders = columns.map((_, colIdx) => {
          return `$${idx * columns.length + colIdx + 1}`
        }).join(', ')
        return `(${placeholders})`
      }).join(', ')
      
      // Flatten all values for parameterized query
      const flatValues = batch.flatMap(record => 
        columns.map(col => {
          const val = record[col]
          if (val === null || val === undefined) return null
          if (val instanceof Date) return val.toISOString()
          if (typeof val === 'object') return JSON.stringify(val)
          return val
        })
      )
      
      // Use parameterized query
      const insertSQL = `
        INSERT INTO ${tableName} (${columnList}) 
        VALUES ${values}
        ON CONFLICT DO NOTHING
      `
      
      try {
        await supabasePool.query(insertSQL, flatValues)
        inserted += batch.length
        process.stdout.write(`\r   ${tableName}: ${inserted}/${records.length} records`)
      } catch (error) {
        // If batch fails, try individual inserts
        for (const record of batch) {
          try {
            const singleValues = columns.map(col => {
              const val = record[col]
              if (val === null || val === undefined) return null
              if (val instanceof Date) return val.toISOString()
              if (typeof val === 'object') return JSON.stringify(val)
              return val
            })
            
            const singlePlaceholders = columns.map((_, idx) => `$${idx + 1}`).join(', ')
            await supabasePool.query(
              `INSERT INTO ${tableName} (${columnList}) VALUES (${singlePlaceholders}) ON CONFLICT DO NOTHING`,
              singleValues
            )
            inserted++
            process.stdout.write(`\r   ${tableName}: ${inserted}/${records.length} records`)
          } catch (err) {
            skipped++
            // Only show first few errors to avoid spam
            if (skipped <= 3) {
              console.log(`\n   ⚠️  Skipped record: ${err.message.substring(0, 60)}`)
            }
          }
        }
      }
    }
    
    // Re-enable foreign key checks
    await supabasePool.query('SET session_replication_role = DEFAULT')
    
    if (skipped > 0) {
      console.log(`\n   ⚠️  ${skipped} records skipped due to errors`)
    }
    console.log(` ✅ (${inserted} inserted, ${skipped} skipped)`)
    return inserted
    
  } catch (error) {
    // Re-enable foreign key checks on error
    try {
      await supabasePool.query('SET session_replication_role = DEFAULT')
    } catch {}
    console.log(` ❌ Error: ${error.message.substring(0, 80)}`)
    return 0
  }
}

async function main() {
  // Create connection pools using pg library directly
  const neonPool = new Pool({
    connectionString: NEON_DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  })
  
  const supabasePool = new Pool({
    connectionString: SUPABASE_DIRECT_URL,
    ssl: { rejectUnauthorized: false }
  })

  try {
    console.log('📡 Connecting to databases...')
    await neonPool.query('SELECT 1')
    await supabasePool.query('SELECT 1')
    console.log('✅ Connected\n')
    
    let totalRecords = 0
    
    for (const table of remainingTables) {
      const count = await migrateTable(table, neonPool, supabasePool)
      totalRecords += count
    }
    
    console.log(`\n✅ Remaining tables migration completed!`)
    console.log(`   Total records migrated: ${totalRecords}`)
    console.log(`\n💡 Next step: Run migrate-phase1-verify.js to verify`)

  } catch (error) {
    console.error('\n❌ Migration failed:', error)
    process.exit(1)
  } finally {
    await neonPool.end()
    await supabasePool.end()
  }
}

main()




