#!/usr/bin/env node

/**
 * Simple script to import existing Square customers
 * Run with: node scripts/import-existing-customers.js
 */

const { importAllCustomers } = require('../scripts/import-existing-customers')

async function main() {
  console.log('🚀 Starting customer import...')
  
  try {
    const result = await importAllCustomers()
    console.log('\n✨ Import completed successfully!')
    console.log(`📊 Final Results:`)
    console.log(`   ✅ Imported: ${result.imported}`)
    console.log(`   ⏭️  Skipped: ${result.skipped}`)
    console.log(`   ❌ Errors: ${result.errors}`)
  } catch (error) {
    console.error('💥 Import failed:', error)
    process.exit(1)
  }
}

main()
