#!/usr/bin/env node
/**
 * Verify location_id correctness in order_line_items
 * Checks:
 * 1. If location_id matches parent order.location_id
 * 2. If location_id exists in locations table
 * 3. If location_id is missing
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function verifyLineItemsLocationId() {
  console.log('🔍 Verifying location_id in Order Line Items\n')
  console.log('='.repeat(60))

  try {
    // Test 1: Check for NULL location_id
    console.log('\n📊 TEST 1: Missing location_id\n')
    
    const nullLocation = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM order_line_items
      WHERE location_id IS NULL
    `
    
    console.log(`Line items with NULL location_id: ${nullLocation[0].count}`)

    // Test 2: Check for mismatches with parent order
    console.log('\n📊 TEST 2: Mismatches with Parent Order\n')
    
    const mismatches = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM order_line_items oli
      INNER JOIN orders o ON o.id = oli.order_id
      WHERE oli.location_id IS DISTINCT FROM o.location_id
    `
    
    console.log(`Line items with location_id different from parent order: ${mismatches[0].count}`)
    
    if (mismatches[0].count > 0) {
      const sampleMismatches = await prisma.$queryRaw`
        SELECT 
          o.order_id,
          o.location_id as order_location,
          oli.location_id as line_item_location,
          oli.name,
          oli.id as line_item_id
        FROM order_line_items oli
        INNER JOIN orders o ON o.id = oli.order_id
        WHERE oli.location_id IS DISTINCT FROM o.location_id
        LIMIT 10
      `
      
      console.log(`\nSample mismatches:`)
      sampleMismatches.forEach(m => {
        console.log(`  Order: ${m.order_id}`)
        console.log(`    Order location: ${m.order_location || 'NULL'}`)
        console.log(`    Line item location: ${m.line_item_location || 'NULL'}`)
        console.log(`    Line item: ${m.name || 'N/A'}`)
        console.log('')
      })
    }

    // Test 3: Check if location_id exists in locations table
    console.log('\n📊 TEST 3: Invalid location_id (not in locations table)\n')
    
    const invalidLocations = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT oli.location_id)::int as count
      FROM order_line_items oli
      WHERE oli.location_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM locations l 
          WHERE l.square_location_id = oli.location_id
        )
    `
    
    console.log(`Line items with location_id not found in locations table: ${invalidLocations[0].count}`)
    
    if (invalidLocations[0].count > 0) {
      const sampleInvalid = await prisma.$queryRaw`
        SELECT DISTINCT oli.location_id, COUNT(*)::int as line_item_count
        FROM order_line_items oli
        WHERE oli.location_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM locations l 
            WHERE l.square_location_id = oli.location_id
          )
        GROUP BY oli.location_id
        ORDER BY line_item_count DESC
        LIMIT 10
      `
      
      console.log(`\nSample invalid location_ids:`)
      sampleInvalid.forEach(loc => {
        console.log(`  Location ID: ${loc.location_id} (used in ${loc.line_item_count} line items)`)
      })
    }

    // Test 4: Check recent line items
    console.log('\n📊 TEST 4: Recent Line Items (Last 7 Days)\n')
    
    const recentStats = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total,
        COUNT(CASE WHEN oli.location_id IS NULL THEN 1 END)::int as null_count,
        COUNT(CASE WHEN oli.location_id IS DISTINCT FROM o.location_id THEN 1 END)::int as mismatch_count
      FROM order_line_items oli
      INNER JOIN orders o ON o.id = oli.order_id
      WHERE o.created_at >= NOW() - INTERVAL '7 days'
    `
    
    console.log(`Recent line items (last 7 days):`)
    console.log(`  Total: ${recentStats[0].total}`)
    console.log(`  NULL location_id: ${recentStats[0].null_count}`)
    console.log(`  Mismatch with order: ${recentStats[0].mismatch_count}`)

    // Test 5: Sample line items to verify correctness
    console.log('\n📊 TEST 5: Sample Line Items Verification\n')
    
    const samples = await prisma.$queryRaw`
      SELECT 
        o.order_id,
        o.location_id as order_location,
        oli.location_id as line_item_location,
        oli.name,
        l.square_location_id as location_exists,
        CASE 
          WHEN oli.location_id = o.location_id THEN '✅ MATCH'
          WHEN oli.location_id IS NULL THEN '⚠️  NULL'
          WHEN o.location_id IS NULL THEN '⚠️  ORDER NULL'
          ELSE '❌ MISMATCH'
        END as status
      FROM order_line_items oli
      INNER JOIN orders o ON o.id = oli.order_id
      LEFT JOIN locations l ON l.square_location_id = oli.location_id
      ORDER BY o.created_at DESC
      LIMIT 10
    `
    
    console.log(`Sample line items:`)
    samples.forEach(item => {
      console.log(`  Order: ${item.order_id}`)
      console.log(`    Line item: ${item.name || 'N/A'}`)
      console.log(`    Order location: ${item.order_location || 'NULL'}`)
      console.log(`    Line item location: ${item.line_item_location || 'NULL'}`)
      console.log(`    Location exists: ${item.location_exists ? '✅' : '❌'}`)
      console.log(`    Status: ${item.status}`)
      console.log('')
    })

    console.log('='.repeat(60))
    console.log('\n✅ Verification Complete\n')

  } catch (error) {
    console.error('❌ Error:', error.message)
    if (error.stack) {
      console.error('Stack:', error.stack.split('\n').slice(0, 5).join('\n'))
    }
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

verifyLineItemsLocationId()
  .then(() => {
    console.log('✅ All checks complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Verification failed:', error)
    process.exit(1)
  })



