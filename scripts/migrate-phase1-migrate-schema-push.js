#!/usr/bin/env node

/**
 * Phase 1: Migrate Schema to Supabase (using db push)
 * 
 * Uses prisma db push to create schema directly from schema.prisma
 * This is better for fresh databases than migrations
 * 
 * Usage:
 *   node scripts/migrate-phase1-migrate-schema-push.js
 * 
 * Environment Variables:
 *   SUPABASE_DIRECT_URL - Supabase direct connection (port 5432) - REQUIRED
 */

require('dotenv').config()
const { execSync } = require('child_process')

const SUPABASE_DIRECT_URL = process.env.SUPABASE_DIRECT_URL || 
  'postgres://postgres:Step7nett.Umit@db.fqkrigvliyphjwpokwbl.supabase.co:5432/postgres'

if (!SUPABASE_DIRECT_URL) {
  console.error('❌ Error: SUPABASE_DIRECT_URL environment variable is required')
  process.exit(1)
}

console.log('🔄 Migrating schema to Supabase (using db push)...\n')
console.log(`📡 Using: ${SUPABASE_DIRECT_URL.replace(/:[^:@]+@/, ':****@')}\n`)

try {
  // Set DATABASE_URL to Supabase for migration
  process.env.DATABASE_URL = SUPABASE_DIRECT_URL

  console.log('📋 Pushing schema to Supabase...')
  console.log('   This will create all tables, indexes, and constraints from schema.prisma\n')

  // Run Prisma db push
  execSync('npx prisma db push --accept-data-loss', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: SUPABASE_DIRECT_URL
    }
  })

  console.log('\n✅ Schema migration completed successfully!')
  console.log('\n💡 Next step: Run migrate-phase1-migrate-data-direct.js to import data')

} catch (error) {
  console.error('\n❌ Schema migration failed:', error.message)
  console.error('\n💡 Troubleshooting:')
  console.error('   - Ensure SUPABASE_DIRECT_URL uses port 5432 (direct connection)')
  console.error('   - Check that Supabase database is accessible')
  console.error('   - Verify your Supabase password is correct')
  process.exit(1)
}




