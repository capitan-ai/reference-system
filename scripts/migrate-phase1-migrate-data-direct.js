#!/usr/bin/env node

/**
 * Phase 1: Migrate Data to Supabase
 * 
 * Copies all data from Neon to Supabase using Prisma
 * Processes tables in dependency order to avoid foreign key issues
 * 
 * Usage:
 *   node scripts/migrate-phase1-migrate-data-direct.js
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

console.log('🔄 Migrating data from Neon to Supabase...\n')

// Tables in dependency order (parents before children)
const tables = [
  { name: 'customers', model: 'customer' },
  { name: 'locations', model: 'location' },
  { name: 'team_members', model: 'teamMember' },
  { name: 'service_variations', model: 'serviceVariation' },
  { name: 'bookings', model: 'booking' },
  { name: 'booking_appointment_segments', model: 'bookingAppointmentSegment' },
  { name: 'orders', model: 'order' },
  { name: 'payments', model: 'payment' },
  { name: 'payment_tenders', model: 'paymentTender' },
  { name: 'ref_links', model: 'refLink' },
  { name: 'ref_clicks', model: 'refClick' },
  { name: 'ref_matches', model: 'refMatch' },
  { name: 'ref_rewards', model: 'refReward' },
  { name: 'giftcard_runs', model: 'giftCardRun' },
  { name: 'giftcard_jobs', model: 'giftCardJob' },
  { name: 'notification_events', model: 'notificationEvent' },
  { name: 'device_pass_registrations', model: 'devicePassRegistration' },
  { name: 'processed_events', model: 'processedEvent' },
  { name: 'analytics_dead_letter', model: 'analyticsDeadLetter' },
  { name: 'square_existing_clients', model: null }, // Legacy table
  { name: 'square_gift_card_gan_audit', model: null } // Legacy table
]

async function migrateTable(tableInfo, neonPrisma, supabasePrisma) {
  const { name, model } = tableInfo
  
  try {
    let records = []
    
    if (model) {
      // Use Prisma model
      records = await neonPrisma[model].findMany()
    } else {
      // Use raw SQL for legacy tables
      records = await neonPrisma.$queryRawUnsafe(`SELECT * FROM ${name}`)
    }
    
    if (records.length === 0) {
      console.log(`   ${name}: 0 records (skipped)`)
      return 0
    }
    
    console.log(`   ${name}: ${records.length} records...`)
    
    // Insert records in batches
    const batchSize = 100
    let inserted = 0
    
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)
      
      if (model) {
        // Use Prisma createMany
        await supabasePrisma[model].createMany({
          data: batch,
          skipDuplicates: true
        })
      } else {
        // Use raw SQL for legacy tables
        // Build INSERT statement
        if (batch.length > 0) {
          const columns = Object.keys(batch[0])
          const values = batch.map(record => {
            const vals = columns.map(col => {
              const val = record[col]
              if (val === null) return 'NULL'
              if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`
              if (val instanceof Date) return `'${val.toISOString()}'`
              return val
            })
            return `(${vals.join(', ')})`
          }).join(', ')
          
          const cols = columns.map(c => `"${c}"`).join(', ')
          await supabasePrisma.$executeRawUnsafe(
            `INSERT INTO ${name} (${cols}) VALUES ${values} ON CONFLICT DO NOTHING`
          )
        }
      }
      
      inserted += batch.length
      process.stdout.write(`\r   ${name}: ${inserted}/${records.length} records`)
    }
    
    console.log(` ✅`)
    return records.length
    
  } catch (error) {
    console.log(` ❌ Error: ${error.message.substring(0, 60)}`)
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
    
    console.log('💾 Migrating data (this may take several minutes)...\n')
    
    let totalRecords = 0
    
    for (const table of tables) {
      const count = await migrateTable(table, neonPrisma, supabasePrisma)
      totalRecords += count
    }
    
    console.log(`\n✅ Data migration completed!`)
    console.log(`   Total records migrated: ${totalRecords}`)
    console.log(`\n💡 Next step: Run migrate-phase1-verify.js to verify the migration`)

  } catch (error) {
    console.error('\n❌ Migration failed:', error)
    process.exit(1)
  } finally {
    await neonPrisma.$disconnect()
    await supabasePrisma.$disconnect()
  }
}

main()




