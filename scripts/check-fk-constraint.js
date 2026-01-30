#!/usr/bin/env node
require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkFKConstraint() {
  console.log('🔍 Checking Foreign Key Constraint: orders_location_id_fkey')
  console.log('='.repeat(60))
  console.log('')

  try {
    // Query 1: Basic constraint info
    console.log('📋 Query 1: Basic constraint information')
    const constraintInfo = await prisma.$queryRaw`
      SELECT
        conname,
        conrelid::regclass::text AS source_table,
        confrelid::regclass::text AS referenced_table
      FROM pg_constraint
      WHERE conname = 'orders_location_id_fkey';
    `

    if (!constraintInfo || constraintInfo.length === 0) {
      console.log('   ❌ Constraint "orders_location_id_fkey" not found!')
      return
    }

    const constraint = constraintInfo[0]
    console.log(`   ✅ Constraint found:`)
    console.log(`      - Name: ${constraint.conname}`)
    console.log(`      - Source table: ${constraint.source_table}`)
    console.log(`      - Referenced table: ${constraint.referenced_table}`)
    console.log('')

    // Check if referenced table is correct
    if (constraint.referenced_table !== 'locations') {
      console.log('   ⚠️  WARNING: Referenced table is NOT "locations"!')
      console.log(`      Expected: locations`)
      console.log(`      Actual: ${constraint.referenced_table}`)
    } else {
      console.log('   ✅ Referenced table is correct: locations')
    }
    console.log('')

    // Query 2: Detailed constraint information
    console.log('📋 Query 2: Detailed constraint information')
    const detailedInfo = await prisma.$queryRaw`
      SELECT
        tc.constraint_name,
        tc.table_name AS source_table,
        kcu.column_name AS source_column,
        ccu.table_name AS referenced_table,
        ccu.column_name AS referenced_column
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.constraint_name = 'orders_location_id_fkey';
    `

    if (detailedInfo && detailedInfo.length > 0) {
      const detail = detailedInfo[0]
      console.log(`   ✅ Detailed information:`)
      console.log(`      - Constraint name: ${detail.constraint_name}`)
      console.log(`      - Source table: ${detail.source_table}`)
      console.log(`      - Source column: ${detail.source_column}`)
      console.log(`      - Referenced table: ${detail.referenced_table}`)
      console.log(`      - Referenced column: ${detail.referenced_column}`)
      console.log('')

      // Verify the mapping
      if (detail.source_table === 'orders' && 
          detail.source_column === 'location_id' &&
          detail.referenced_table === 'locations' &&
          detail.referenced_column === 'id') {
        console.log('   ✅ FK constraint mapping is CORRECT')
        console.log('      orders.location_id → locations.id')
      } else {
        console.log('   ⚠️  FK constraint mapping is INCORRECT:')
        console.log(`      ${detail.source_table}.${detail.source_column} → ${detail.referenced_table}.${detail.referenced_column}`)
        console.log('      Expected: orders.location_id → locations.id')
      }
    }

    console.log('')
    console.log('='.repeat(60))
    console.log('✅ FK constraint check completed')

  } catch (error) {
    console.error('❌ Error checking FK constraint:', error.message)
    console.error('   Stack:', error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

checkFKConstraint()

