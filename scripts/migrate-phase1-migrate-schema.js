#!/usr/bin/env node

/**
 * Phase 1: Migrate Schema to Supabase
 * 
 * Applies all Prisma migrations to Supabase database
 * This creates the complete schema structure on Supabase
 * 
 * Usage:
 *   node scripts/migrate-phase1-migrate-schema.js
 * 
 * Environment Variables:
 *   SUPABASE_DIRECT_URL - Supabase direct connection (port 5432) - REQUIRED for migrations
 */

require('dotenv').config()
const { execSync } = require('child_process')

const SUPABASE_DIRECT_URL = process.env.SUPABASE_DIRECT_URL || 
  'postgres://postgres:Step7nett.Umit@db.fqkrigvliyphjwpokwbl.supabase.co:5432/postgres'

if (!SUPABASE_DIRECT_URL) {
  console.error('❌ Error: SUPABASE_DIRECT_URL environment variable is required')
  console.error('   Migrations require direct connection (port 5432), not pooled connection')
  process.exit(1)
}

console.log('🔄 Migrating schema to Supabase...\n')
console.log(`📡 Using: ${SUPABASE_DIRECT_URL.replace(/:[^:@]+@/, ':****@')}\n`)

try {
  // Set DATABASE_URL to Supabase for migration
  process.env.DATABASE_URL = SUPABASE_DIRECT_URL

  console.log('📋 Applying Prisma migrations...')
  console.log('   This will create all tables, indexes, and constraints on Supabase\n')

  // Run Prisma migrate deploy
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: SUPABASE_DIRECT_URL
    }
  })

  console.log('\n✅ Schema migration completed successfully!')
  console.log('\n💡 Next step: Run migrate-phase1-migrate-data.js to import data')

} catch (error) {
  console.error('\n❌ Schema migration failed:', error.message)
  console.error('\n💡 Troubleshooting:')
  console.error('   - Ensure SUPABASE_DIRECT_URL uses port 5432 (direct connection)')
  console.error('   - Check that Supabase database is accessible')
  console.error('   - Verify your Supabase password is correct')
  process.exit(1)
}




