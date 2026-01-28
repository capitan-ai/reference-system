#!/usr/bin/env node
require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function fixMigrationHistory() {
  console.log('🔧 Fixing Migration History\n')
  console.log('=' .repeat(60))
  
  try {
    // Step 1: Mark local migrations that aren't in DB as applied (if they're already in schema)
    console.log('\n📝 Step 1: Resolving local migrations not in database...\n')
    
    const localMigrationsNotInDb = [
      '$(date +%Y%m%d%H%M%S)_add_booking_notes',
      '20260127130110_add_booking_notes',
      '20260127130113_add_booking_notes'
    ]
    
    for (const migrationName of localMigrationsNotInDb) {
      console.log(`   Marking ${migrationName} as applied...`)
      try {
        await prisma.$executeRaw`
          INSERT INTO _prisma_migrations (
            id,
            checksum,
            finished_at,
            migration_name,
            logs,
            rolled_back_at,
            started_at,
            applied_steps_count
          ) VALUES (
            gen_random_uuid(),
            '',
            NOW(),
            ${migrationName},
            NULL,
            NULL,
            NOW(),
            1
          )
          ON CONFLICT (migration_name) DO NOTHING
        `
        console.log(`   ✅ ${migrationName} marked as applied`)
      } catch (error) {
        if (error.message.includes('duplicate') || error.message.includes('unique')) {
          console.log(`   ℹ️  ${migrationName} already exists, skipping`)
        } else {
          console.log(`   ⚠️  Error: ${error.message}`)
        }
      }
    }
    
    // Step 2: Mark DB migrations that aren't local as rolled back (they're duplicates)
    console.log('\n📝 Step 2: Handling database migrations not in local files...\n')
    
    const dbMigrationsNotLocal = [
      '$(date +%Y%m%d%H%M%S)_add_gift_card_info_to_device_registrations',
      '$(date +%Y%m%d%H%M%S)_add_device_pass_registrations'
    ]
    
    // Check if these have equivalent local migrations
    const equivalentMappings = {
      '$(date +%Y%m%d%H%M%S)_add_gift_card_info_to_device_registrations': '20260121002935_add_gift_card_info_to_device_registrations',
      '$(date +%Y%m%d%H%M%S)_add_device_pass_registrations': '20251124163444_add_device_pass_registrations'
    }
    
    for (const [brokenName, correctName] of Object.entries(equivalentMappings)) {
      console.log(`   Checking ${brokenName}...`)
      
      // Check if correct migration exists in DB
      const correctExists = await prisma.$queryRaw`
        SELECT migration_name FROM _prisma_migrations
        WHERE migration_name = ${correctName}
        LIMIT 1
      `
      
      if (correctExists && correctExists.length > 0) {
        console.log(`   ✅ Equivalent migration ${correctName} exists, marking broken one as rolled back`)
        await prisma.$executeRaw`
          UPDATE _prisma_migrations
          SET rolled_back_at = NOW()
          WHERE migration_name = ${brokenName}
            AND rolled_back_at IS NULL
        `
      } else {
        console.log(`   ⚠️  No equivalent found, keeping ${brokenName}`)
      }
    }
    
    // Step 3: Clean up PENDING migrations that are duplicates
    console.log('\n📝 Step 3: Cleaning up duplicate PENDING migrations...\n')
    
    const pendingMigrations = await prisma.$queryRaw`
      SELECT migration_name, COUNT(*) as count
      FROM _prisma_migrations
      WHERE finished_at IS NULL
      GROUP BY migration_name
      HAVING COUNT(*) > 1
    `
    
    if (pendingMigrations.length > 0) {
      console.log(`   Found ${pendingMigrations.length} duplicate pending migrations`)
      for (const dup of pendingMigrations) {
        console.log(`   - ${dup.migration_name} (${dup.count} duplicates)`)
        // Keep the oldest one, mark others as rolled back
        await prisma.$executeRaw`
          UPDATE _prisma_migrations
          SET rolled_back_at = NOW()
          WHERE migration_name = ${dup.migration_name}
            AND finished_at IS NULL
            AND id NOT IN (
              SELECT id FROM _prisma_migrations
              WHERE migration_name = ${dup.migration_name}
                AND finished_at IS NULL
              ORDER BY started_at ASC
              LIMIT 1
            )
        `
      }
    } else {
      console.log('   ✅ No duplicate pending migrations found')
    }
    
    console.log('\n✅ Migration history cleanup complete!')
    console.log('\n📋 Next steps:')
    console.log('   1. Run: npx prisma migrate status (to verify)')
    console.log('   2. Run: npx prisma migrate dev --name add_merchant_id_to_locations')
    
  } catch (error) {
    console.error('\n❌ Error fixing migration history:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

fixMigrationHistory()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })



