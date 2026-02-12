#!/usr/bin/env node
/**
 * Verify Supabase URLs are configured correctly
 * 
 * IMPORTANT DISTINCTION:
 * - HTTP API Base URL: https://<ref>.supabase.co (NO db. prefix)
 * - Database Host: db.<ref>.supabase.co (WITH db. prefix)
 */

require('dotenv').config()

const supabaseApiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const databaseUrl = process.env.DATABASE_URL

console.log('🔍 Verifying Supabase URL Configuration\n')
console.log('='.repeat(60))

let hasErrors = false

// Check HTTP API URL (for Supabase Auth, Storage, etc.)
console.log('\n📡 HTTP API Base URL (NEXT_PUBLIC_SUPABASE_URL):')
if (!supabaseApiUrl) {
  console.error('   ❌ NOT SET - Required for Supabase Auth API calls')
  hasErrors = true
} else {
  const maskedUrl = supabaseApiUrl.replace(/:([^:@]+)@/, ':***@')
  console.log(`   URL: ${maskedUrl}`)
  
  // Check if it has the correct format
  if (supabaseApiUrl.includes('db.')) {
    console.error('   ❌ ERROR: Should NOT include "db." prefix!')
    console.error('      Correct format: https://fqkrigvliyphjwpokwbl.supabase.co')
    console.error('      Wrong format:   https://db.fqkrigvliyphjwpokwbl.supabase.co')
    hasErrors = true
  } else if (supabaseApiUrl.startsWith('https://') && supabaseApiUrl.includes('.supabase.co')) {
    console.log('   ✅ Correct format (no db. prefix)')
  } else {
    console.warn('   ⚠️  May not be correct format')
  }
}

// Check Database URL (for PostgreSQL connections)
console.log('\n🗄️  Database Connection URL (DATABASE_URL):')
if (!databaseUrl) {
  console.error('   ❌ NOT SET - Required for database connections')
  hasErrors = true
} else {
  const maskedUrl = databaseUrl.replace(/:([^:@]+)@/, ':***@')
  console.log(`   URL: ${maskedUrl}`)
  
  // Check if it has the correct format
  if (databaseUrl.includes('db.') && databaseUrl.includes('.supabase.co')) {
    console.log('   ✅ Correct format (includes db. prefix for PostgreSQL)')
  } else if (databaseUrl.includes('.supabase.co') && !databaseUrl.includes('db.')) {
    console.warn('   ⚠️  Database URL should use db.<ref>.supabase.co for direct connections')
    console.warn('      Or use port 6543 for connection pooling')
  } else {
    console.log('   ℹ️  Using custom database URL')
  }
}

// Summary
console.log('\n' + '='.repeat(60))
console.log('📋 Summary:')
console.log('   • HTTP API URL: Used for Supabase Auth, Storage, Realtime')
console.log('     Format: https://<ref>.supabase.co (NO db. prefix)')
console.log('   • Database URL: Used for PostgreSQL connections')
console.log('     Format: postgresql://...@db.<ref>.supabase.co:5432/... (WITH db. prefix)')
console.log('     Or: postgresql://...@<ref>.supabase.co:6543/... (connection pooling)')

if (hasErrors) {
  console.log('\n❌ Configuration errors found! Please fix the issues above.')
  process.exit(1)
} else {
  console.log('\n✅ URL configuration looks correct!')
  process.exit(0)
}

