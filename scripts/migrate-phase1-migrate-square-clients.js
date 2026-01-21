#!/usr/bin/env node

/**
 * Migrate square_existing_clients table
 * This table has a unique constraint that might be causing conflicts
 */

require('dotenv').config()
const { Pool } = require('pg')

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL
const SUPABASE_DIRECT_URL = process.env.SUPABASE_DIRECT_URL || 
  'postgres://postgres:Step7nett.Umit@db.fqkrigvliyphjwpokwbl.supabase.co:5432/postgres'

async function main() {
  const neonPool = new Pool({
    connectionString: NEON_DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  })
  
  const supabasePool = new Pool({
    connectionString: SUPABASE_DIRECT_URL,
    ssl: { rejectUnauthorized: false }
  })

  try {
    console.log('📦 Migrating square_existing_clients...\n')
    
    // Get all records from Neon
    const result = await neonPool.query('SELECT * FROM square_existing_clients')
    const records = result.rows
    
    console.log(`   Found ${records.length} records in Neon`)
    
    if (records.length === 0) {
      console.log('   No records to migrate')
      return
    }
    
    const columns = Object.keys(records[0])
    const columnList = columns.map(c => `"${c}"`).join(', ')
    
    // Disable foreign key checks
    await supabasePool.query('SET session_replication_role = replica')
    
    // Use smaller batches to avoid parameter limits
    const batchSize = 50
    let inserted = 0
    let skipped = 0
    
    // Build UPDATE clause for ON CONFLICT (exclude id and square_customer_id)
    const updateColumns = columns.filter(c => c !== 'id' && c !== 'square_customer_id')
    const updateClause = updateColumns.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ')
    
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)
      
      // Use individual inserts within a transaction for better error handling
      const client = await supabasePool.connect()
      try {
        await client.query('BEGIN')
        
        for (const record of batch) {
          try {
            const values = columns.map((_, idx) => `$${idx + 1}`).join(', ')
            const singleValues = columns.map(col => {
              const val = record[col]
              if (val === null || val === undefined) return null
              if (val instanceof Date) return val.toISOString()
              // Handle arrays - PostgreSQL arrays should be passed as arrays, not JSON strings
              if (Array.isArray(val)) return val
              // Handle objects - convert to JSON string
              if (typeof val === 'object') return JSON.stringify(val)
              return val
            })
            
            await client.query(
              `INSERT INTO square_existing_clients (${columnList}) VALUES (${values}) ON CONFLICT (square_customer_id) DO UPDATE SET ${updateClause}`,
              singleValues
            )
            inserted++
          } catch (error) {
            // Skip this record but continue with others
            skipped++
            if (skipped <= 5) {
              console.log(`\n   ⚠️  Skipped record: ${error.message.substring(0, 60)}`)
            }
          }
        }
        
        await client.query('COMMIT')
        process.stdout.write(`\r   Inserted: ${inserted}/${records.length} records (${skipped} skipped)`)
      } catch (error) {
        await client.query('ROLLBACK')
        console.log(`\n   ⚠️  Transaction failed: ${error.message.substring(0, 60)}`)
        skipped += batch.length
      } finally {
        client.release()
      }
    }
    
    // Re-enable foreign key checks
    await supabasePool.query('SET session_replication_role = DEFAULT')
    
    console.log(`\n✅ Migration completed!`)
    console.log(`   Inserted/Updated: ${inserted}`)
    console.log(`   Skipped: ${skipped}`)

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  } finally {
    await neonPool.end()
    await supabasePool.end()
  }
}

main()

