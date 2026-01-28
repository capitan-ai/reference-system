#!/usr/bin/env node

/**
 * Phase 1: Migrate Data to Supabase
 * 
 * Imports all data from Neon backup to Supabase
 * Uses the data-only backup created earlier
 * 
 * Usage:
 *   node scripts/migrate-phase1-migrate-data.js [backup-file-path]
 * 
 * If no backup file is provided, it will look for the most recent data backup
 * 
 * Environment Variables:
 *   SUPABASE_DIRECT_URL - Supabase direct connection (port 5432) - REQUIRED
 *   NEON_DATABASE_URL - Neon database URL (optional, for verification)
 */

require('dotenv').config()
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const SUPABASE_DIRECT_URL = process.env.SUPABASE_DIRECT_URL || 
  'postgres://postgres:Step7nett.Umit@db.fqkrigvliyphjwpokwbl.supabase.co:5432/postgres'

if (!SUPABASE_DIRECT_URL) {
  console.error('❌ Error: SUPABASE_DIRECT_URL environment variable is required')
  process.exit(1)
}

// Find backup file
let backupFile = process.argv[2]

if (!backupFile) {
  // Find most recent data backup
  const backupsDir = path.join(process.cwd(), 'backups')
  if (fs.existsSync(backupsDir)) {
    const dates = fs.readdirSync(backupsDir)
      .filter(d => fs.statSync(path.join(backupsDir, d)).isDirectory())
      .sort()
      .reverse()

    for (const date of dates) {
      const dateDir = path.join(backupsDir, date)
      const files = fs.readdirSync(dateDir)
        .filter(f => f.includes('data_only') && f.endsWith('.sql'))
        .sort()
        .reverse()

      if (files.length > 0) {
        backupFile = path.join(dateDir, files[0])
        break
      }
    }
  }
}

if (!backupFile || !fs.existsSync(backupFile)) {
  console.error('❌ Error: Data backup file not found')
  console.error('   Please provide backup file path:')
  console.error('   node scripts/migrate-phase1-migrate-data.js <backup-file-path>')
  console.error('\n   Or run migrate-phase1-backup-neon.js first to create a backup')
  process.exit(1)
}

console.log('🔄 Migrating data to Supabase...\n')
console.log(`📁 Backup file: ${backupFile}`)
console.log(`📡 Target: ${SUPABASE_DIRECT_URL.replace(/:[^:@]+@/, ':****@')}\n`)

const fileSize = fs.statSync(backupFile).size
console.log(`📦 Backup size: ${(fileSize / 1024 / 1024).toFixed(2)} MB\n`)

try {
  // Check if psql is available
  try {
    execSync('which psql', { stdio: 'ignore' })
  } catch (error) {
    console.error('❌ Error: psql not found. Please install PostgreSQL client tools.')
    console.error('   On macOS: brew install postgresql')
    console.error('   On Ubuntu: sudo apt-get install postgresql-client')
    process.exit(1)
  }

  console.log('⚠️  Important: This will import data into Supabase.')
  console.log('   Make sure the schema has already been migrated!\n')

  // Import data
  console.log('💾 Importing data...')
  console.log('   This may take several minutes depending on data size...\n')

  // Temporarily disable foreign key checks to avoid constraint errors during import
  const importCommand = `
    psql "${SUPABASE_DIRECT_URL}" << 'EOF'
    SET session_replication_role = 'replica';
    \\i ${backupFile}
    SET session_replication_role = 'origin';
    EOF
  `

  execSync(importCommand, {
    stdio: 'inherit',
    shell: true
  })

  console.log('\n✅ Data migration completed successfully!')
  console.log('\n💡 Next step: Run migrate-phase1-verify.js to verify the migration')

} catch (error) {
  console.error('\n❌ Data migration failed:', error.message)
  console.error('\n💡 Troubleshooting:')
  console.error('   - Ensure schema has been migrated first (run migrate-phase1-migrate-schema.js)')
  console.error('   - Check that backup file is valid')
  console.error('   - Verify Supabase connection is working')
  console.error('   - Check for foreign key constraint errors in the output above')
  process.exit(1)
}




