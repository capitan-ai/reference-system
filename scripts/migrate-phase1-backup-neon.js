#!/usr/bin/env node

/**
 * Phase 1: Backup Neon Database
 * 
 * Creates full backup, schema-only, and data-only backups of Neon database
 * These backups will be used to migrate to Supabase
 * 
 * Usage:
 *   node scripts/migrate-phase1-backup-neon.js
 * 
 * Environment Variables:
 *   NEON_DATABASE_URL - Neon database connection string
 */

require('dotenv').config()
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL

if (!NEON_DATABASE_URL) {
  console.error('❌ Error: NEON_DATABASE_URL or DATABASE_URL environment variable is required')
  process.exit(1)
}

if (!NEON_DATABASE_URL.includes('neon.tech')) {
  console.warn('⚠️  Warning: DATABASE_URL does not appear to be a Neon database URL')
  console.warn('   Continuing anyway, but please verify this is correct')
}

// Create backup directory
const backupDir = path.join(process.cwd(), 'backups', new Date().toISOString().split('T')[0].replace(/-/g, ''))
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true })
}
console.log(`📁 Backup directory: ${backupDir}`)

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0]
const fullBackup = path.join(backupDir, `neon_full_backup_${timestamp}.sql`)
const schemaBackup = path.join(backupDir, `neon_schema_only_${timestamp}.sql`)
const dataBackup = path.join(backupDir, `neon_data_only_${timestamp}.sql`)

console.log('\n🔄 Starting Neon database backup...\n')

try {
  // Check if pg_dump is available
  try {
    execSync('which pg_dump', { stdio: 'ignore' })
  } catch (error) {
    console.error('❌ Error: pg_dump not found. Please install PostgreSQL client tools.')
    console.error('   On macOS: brew install postgresql')
    console.error('   On Ubuntu: sudo apt-get install postgresql-client')
    process.exit(1)
  }

  // Full backup (schema + data)
  console.log('📦 Creating full backup (schema + data)...')
  execSync(`pg_dump "${NEON_DATABASE_URL}" --no-owner --no-acl --verbose > "${fullBackup}"`, {
    stdio: 'inherit',
    shell: true
  })
  const fullSize = fs.statSync(fullBackup).size
  console.log(`✅ Full backup created: ${(fullSize / 1024 / 1024).toFixed(2)} MB\n`)

  // Schema-only backup
  console.log('📋 Creating schema-only backup...')
  execSync(`pg_dump "${NEON_DATABASE_URL}" --schema-only --no-owner --no-acl --verbose > "${schemaBackup}"`, {
    stdio: 'inherit',
    shell: true
  })
  const schemaSize = fs.statSync(schemaBackup).size
  console.log(`✅ Schema backup created: ${(schemaSize / 1024).toFixed(2)} KB\n`)

  // Data-only backup
  console.log('💾 Creating data-only backup...')
  execSync(`pg_dump "${NEON_DATABASE_URL}" --data-only --no-owner --no-acl --verbose > "${dataBackup}"`, {
    stdio: 'inherit',
    shell: true
  })
  const dataSize = fs.statSync(dataBackup).size
  console.log(`✅ Data backup created: ${(dataSize / 1024 / 1024).toFixed(2)} MB\n`)

  // Verify backups contain expected content
  console.log('🔍 Verifying backups...')
  const fullContent = fs.readFileSync(fullBackup, 'utf8')
  const schemaContent = fs.readFileSync(schemaBackup, 'utf8')
  
  const tableMatches = fullContent.match(/CREATE TABLE/g) || []
  console.log(`   Found ${tableMatches.length} CREATE TABLE statements in full backup`)
  
  if (tableMatches.length === 0) {
    console.warn('⚠️  Warning: No tables found in backup. Please verify the connection.')
  }

  console.log('\n✅ Backup completed successfully!')
  console.log(`\n📁 Backup files:`)
  console.log(`   Full: ${fullBackup}`)
  console.log(`   Schema: ${schemaBackup}`)
  console.log(`   Data: ${dataBackup}`)
  console.log(`\n💡 Next step: Run migrate-phase1-test-supabase.js to test Supabase connections`)

} catch (error) {
  console.error('\n❌ Backup failed:', error.message)
  process.exit(1)
}




