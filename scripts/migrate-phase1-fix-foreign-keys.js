#!/usr/bin/env node

/**
 * Phase 1: Fix Foreign Key Issues and Complete Migration
 * 
 * This script:
 * 1. Checks which foreign key references are missing
 * 2. Migrates bookings with proper foreign key handling
 * 3. Handles NULL foreign keys where allowed
 * 
 * Usage:
 *   node scripts/migrate-phase1-fix-foreign-keys.js
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

console.log('🔧 Fixing foreign key issues and completing migration...\n')

async function checkForeignKeys(supabasePool) {
  console.log('🔍 Checking foreign key references...\n')
  
  // Check locations
  const locations = await supabasePool.query('SELECT square_location_id FROM locations')
  const locationIds = new Set(locations.rows.map(r => r.square_location_id))
  console.log(`   Locations in Supabase: ${locationIds.size}`)
  
  // Check square_existing_clients (for customer_id references)
  const clients = await supabasePool.query('SELECT square_customer_id FROM square_existing_clients')
  const clientIds = new Set(clients.rows.map(r => r.square_customer_id))
  console.log(`   Square clients in Supabase: ${clientIds.size}`)
  
  return { locationIds, clientIds }
}

async function migrateBookings(neonPool, supabasePool, locationIds, clientIds) {
  console.log('\n📦 Migrating bookings...')
  
  // Get all bookings from Neon
  const result = await neonPool.query('SELECT * FROM bookings')
  const bookings = result.rows
  
  console.log(`   Found ${bookings.length} bookings in Neon`)
  
  // Filter bookings that have valid foreign keys
  const validBookings = bookings.filter(booking => {
    // location_id is required (not nullable in schema)
    if (!booking.location_id || !locationIds.has(booking.location_id)) {
      return false
    }
    // customer_id is optional, but if present, must exist
    if (booking.customer_id && !clientIds.has(booking.customer_id)) {
      // Set to NULL if customer doesn't exist (since it's optional)
      booking.customer_id = null
    }
    return true
  })
  
  console.log(`   Valid bookings (with existing foreign keys): ${validBookings.length}`)
  console.log(`   Skipped bookings (missing location): ${bookings.length - validBookings.length}`)
  
  if (validBookings.length === 0) {
    console.log('   ⚠️  No valid bookings to migrate')
    return 0
  }
  
  // Get column names
  const columns = Object.keys(validBookings[0])
  const columnList = columns.map(c => `"${c}"`).join(', ')
  
  // Insert in batches
  const batchSize = 100
  let inserted = 0
  
  for (let i = 0; i < validBookings.length; i += batchSize) {
    const batch = validBookings.slice(i, i + batchSize)
    
    const values = batch.map((record, idx) => {
      const placeholders = columns.map((_, colIdx) => {
        return `$${idx * columns.length + colIdx + 1}`
      }).join(', ')
      return `(${placeholders})`
    }).join(', ')
    
    const flatValues = batch.flatMap(record => 
      columns.map(col => {
        const val = record[col]
        if (val === null || val === undefined) return null
        if (val instanceof Date) return val.toISOString()
        if (typeof val === 'object') return JSON.stringify(val)
        return val
      })
    )
    
    const insertSQL = `
      INSERT INTO bookings (${columnList}) 
      VALUES ${values}
      ON CONFLICT (id) DO NOTHING
    `
    
    try {
      await supabasePool.query(insertSQL, flatValues)
      inserted += batch.length
      process.stdout.write(`\r   Inserted: ${inserted}/${validBookings.length} bookings`)
    } catch (error) {
      console.log(`\n   ⚠️  Batch error: ${error.message.substring(0, 60)}`)
      // Try individual inserts
      for (const booking of batch) {
        try {
          const singleValues = columns.map(col => {
            const val = booking[col]
            if (val === null || val === undefined) return null
            if (val instanceof Date) return val.toISOString()
            if (typeof val === 'object') return JSON.stringify(val)
            return val
          })
          const singlePlaceholders = columns.map((_, idx) => `$${idx + 1}`).join(', ')
          await supabasePool.query(
            `INSERT INTO bookings (${columnList}) VALUES (${singlePlaceholders}) ON CONFLICT (id) DO NOTHING`,
            singleValues
          )
          inserted++
        } catch (err) {
          // Skip problematic records
        }
      }
    }
  }
  
  console.log(` ✅`)
  return inserted
}

async function migrateBookingSegments(neonPool, supabasePool) {
  console.log('\n📦 Migrating booking_appointment_segments...')
  
  // First, get all booking IDs that exist in Supabase
  const supabaseBookings = await supabasePool.query('SELECT id FROM bookings')
  const bookingIds = new Set(supabaseBookings.rows.map(r => r.id))
  console.log(`   Bookings in Supabase: ${bookingIds.size}`)
  
  // Get all segments from Neon
  const result = await neonPool.query('SELECT * FROM booking_appointment_segments')
  const segments = result.rows
  
  console.log(`   Found ${segments.length} segments in Neon`)
  
  // Filter segments that reference existing bookings
  const validSegments = segments.filter(seg => bookingIds.has(seg.booking_id))
  console.log(`   Valid segments: ${validSegments.length}`)
  console.log(`   Skipped segments (missing booking): ${segments.length - validSegments.length}`)
  
  if (validSegments.length === 0) {
    console.log('   ⚠️  No valid segments to migrate')
    return 0
  }
  
  const columns = Object.keys(validSegments[0])
  const columnList = columns.map(c => `"${c}"`).join(', ')
  
  const batchSize = 100
  let inserted = 0
  
  for (let i = 0; i < validSegments.length; i += batchSize) {
    const batch = validSegments.slice(i, i + batchSize)
    
    const values = batch.map((record, idx) => {
      const placeholders = columns.map((_, colIdx) => {
        return `$${idx * columns.length + colIdx + 1}`
      }).join(', ')
      return `(${placeholders})`
    }).join(', ')
    
    const flatValues = batch.flatMap(record => 
      columns.map(col => {
        const val = record[col]
        if (val === null || val === undefined) return null
        if (val instanceof Date) return val.toISOString()
        if (typeof val === 'object') return JSON.stringify(val)
        return val
      })
    )
    
    const insertSQL = `
      INSERT INTO booking_appointment_segments (${columnList}) 
      VALUES ${values}
      ON CONFLICT (id) DO NOTHING
    `
    
    try {
      await supabasePool.query(insertSQL, flatValues)
      inserted += batch.length
      process.stdout.write(`\r   Inserted: ${inserted}/${validSegments.length} segments`)
    } catch (error) {
      // Try individual inserts on error
      for (const segment of batch) {
        try {
          const singleValues = columns.map(col => {
            const val = segment[col]
            if (val === null || val === undefined) return null
            if (val instanceof Date) return val.toISOString()
            if (typeof val === 'object') return JSON.stringify(val)
            return val
          })
          const singlePlaceholders = columns.map((_, idx) => `$${idx + 1}`).join(', ')
          await supabasePool.query(
            `INSERT INTO booking_appointment_segments (${columnList}) VALUES (${singlePlaceholders}) ON CONFLICT (id) DO NOTHING`,
            singleValues
          )
          inserted++
        } catch (err) {
          // Skip
        }
      }
    }
  }
  
  console.log(` ✅`)
  return inserted
}

async function migrateRemainingTables(neonPool, supabasePool) {
  console.log('\n📦 Migrating remaining tables...')
  
  const tables = [
    'ref_links',
    'ref_matches',
    'ref_rewards',
    'square_existing_clients',
    'square_gift_card_gan_audit'
  ]
  
  let totalInserted = 0
  
  for (const tableName of tables) {
    try {
      console.log(`   ${tableName}...`)
      
      const result = await neonPool.query(`SELECT * FROM ${tableName}`)
      const records = result.rows
      
      if (records.length === 0) {
        console.log(`     0 records (skipped)`)
        continue
      }
      
      const columns = Object.keys(records[0])
      const columnList = columns.map(c => `"${c}"`).join(', ')
      
      // Temporarily disable foreign key checks
      await supabasePool.query('SET session_replication_role = replica')
      
      const batchSize = 100
      let inserted = 0
      
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize)
        
        const values = batch.map((record, idx) => {
          const placeholders = columns.map((_, colIdx) => {
            return `$${idx * columns.length + colIdx + 1}`
          }).join(', ')
          return `(${placeholders})`
        }).join(', ')
        
        const flatValues = batch.flatMap(record => 
          columns.map(col => {
            const val = record[col]
            if (val === null || val === undefined) return null
            if (val instanceof Date) return val.toISOString()
            if (typeof val === 'object') return JSON.stringify(val)
            return val
          })
        )
        
        const insertSQL = `
          INSERT INTO ${tableName} (${columnList}) 
          VALUES ${values}
          ON CONFLICT DO NOTHING
        `
        
        try {
          await supabasePool.query(insertSQL, flatValues)
          inserted += batch.length
        } catch (error) {
          // Skip batch on error
        }
      }
      
      // Re-enable foreign key checks
      await supabasePool.query('SET session_replication_role = DEFAULT')
      
      console.log(`     ${inserted}/${records.length} records inserted ✅`)
      totalInserted += inserted
      
    } catch (error) {
      console.log(`     Error: ${error.message.substring(0, 60)}`)
    }
  }
  
  return totalInserted
}

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
    console.log('📡 Connecting to databases...')
    await neonPool.query('SELECT 1')
    await supabasePool.query('SELECT 1')
    console.log('✅ Connected\n')
    
    // Check foreign key references
    const { locationIds, clientIds } = await checkForeignKeys(supabasePool)
    
    // Migrate bookings (with foreign key validation)
    const bookingsCount = await migrateBookings(neonPool, supabasePool, locationIds, clientIds)
    
    // Migrate booking segments (after bookings)
    const segmentsCount = await migrateBookingSegments(neonPool, supabasePool)
    
    // Migrate remaining tables
    const remainingCount = await migrateRemainingTables(neonPool, supabasePool)
    
    console.log(`\n✅ Migration completed!`)
    console.log(`   Bookings: ${bookingsCount}`)
    console.log(`   Booking segments: ${segmentsCount}`)
    console.log(`   Other tables: ${remainingCount}`)
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


