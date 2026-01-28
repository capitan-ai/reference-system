#!/usr/bin/env node
/**
 * Check for duplicate orders in the database
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkDuplicateOrders() {
  console.log('🔍 Checking for Duplicate Orders\n')
  console.log('='.repeat(60))

  try {
    // Check for duplicate order_id within same organization (should be unique)
    const duplicatesByOrg = await prisma.$queryRaw`
      SELECT 
        organization_id,
        order_id,
        COUNT(*)::int as count,
        ARRAY_AGG(id::text) as order_uuids,
        ARRAY_AGG(state) as states,
        ARRAY_AGG(created_at) as created_dates
      FROM orders
      GROUP BY organization_id, order_id
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `

    console.log(`\n📊 Duplicate orders (same order_id + organization_id): ${duplicatesByOrg.length}\n`)

    if (duplicatesByOrg.length > 0) {
      console.log('⚠️  Found duplicates:\n')
      duplicatesByOrg.forEach((dup, idx) => {
        console.log(`   ${idx + 1}. Order ID: ${dup.order_id}`)
        console.log(`      Organization: ${dup.organization_id.substring(0, 8)}...`)
        console.log(`      Count: ${dup.count}`)
        console.log(`      States: ${dup.states.join(', ')}`)
        console.log(`      Order UUIDs: ${dup.order_uuids.join(', ')}`)
        console.log('')
      })
    } else {
      console.log('✅ No duplicates found (same order_id + organization_id)\n')
    }

    // Check for duplicate order_id across different organizations (might be valid)
    const duplicatesAcrossOrgs = await prisma.$queryRaw`
      SELECT 
        order_id,
        COUNT(DISTINCT organization_id)::int as org_count,
        COUNT(*)::int as total_count,
        ARRAY_AGG(DISTINCT organization_id::text) as organization_ids
      FROM orders
      GROUP BY order_id
      HAVING COUNT(DISTINCT organization_id) > 1
      ORDER BY org_count DESC
    `

    console.log(`\n📊 Orders with same order_id across different organizations: ${duplicatesAcrossOrgs.length}\n`)

    if (duplicatesAcrossOrgs.length > 0) {
      console.log('⚠️  Found orders shared across organizations:\n')
      duplicatesAcrossOrgs.slice(0, 10).forEach((dup, idx) => {
        console.log(`   ${idx + 1}. Order ID: ${dup.order_id}`)
        console.log(`      Organizations: ${dup.org_count}`)
        console.log(`      Total records: ${dup.total_count}`)
        console.log(`      Org IDs: ${dup.organization_ids.join(', ')}`)
        console.log('')
      })
      if (duplicatesAcrossOrgs.length > 10) {
        console.log(`   ... and ${duplicatesAcrossOrgs.length - 10} more\n`)
      }
    } else {
      console.log('✅ No orders shared across organizations\n')
    }

    // Check for orders with same order_id but different states
    const sameOrderDifferentStates = await prisma.$queryRaw`
      SELECT 
        order_id,
        COUNT(DISTINCT state)::int as state_count,
        ARRAY_AGG(DISTINCT state) as states,
        COUNT(*)::int as total_count
      FROM orders
      WHERE order_id IN (
        SELECT order_id 
        FROM orders 
        GROUP BY order_id 
        HAVING COUNT(DISTINCT state) > 1
      )
      GROUP BY order_id
      ORDER BY state_count DESC
    `

    console.log(`\n📊 Orders with same order_id but different states: ${sameOrderDifferentStates.length}\n`)

    if (sameOrderDifferentStates.length > 0) {
      console.log('⚠️  Found orders with conflicting states:\n')
      sameOrderDifferentStates.slice(0, 10).forEach((order, idx) => {
        console.log(`   ${idx + 1}. Order ID: ${order.order_id}`)
        console.log(`      States: ${order.states.join(', ')}`)
        console.log(`      Total records: ${order.total_count}`)
        console.log('')
      })
      if (sameOrderDifferentStates.length > 10) {
        console.log(`   ... and ${sameOrderDifferentStates.length - 10} more\n`)
      }
    } else {
      console.log('✅ No orders with conflicting states\n')
    }

    // Summary
    console.log('='.repeat(60))
    console.log('\n📊 SUMMARY:\n')
    console.log(`   Duplicate orders (same org + order_id): ${duplicatesByOrg.length}`)
    console.log(`   Orders across multiple orgs: ${duplicatesAcrossOrgs.length}`)
    console.log(`   Orders with conflicting states: ${sameOrderDifferentStates.length}`)

    if (duplicatesByOrg.length === 0 && sameOrderDifferentStates.length === 0) {
      console.log('\n✅ No duplicate issues found!')
    } else {
      console.log('\n⚠️  Action needed: Review duplicates above')
    }

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

checkDuplicateOrders()
  .then(() => {
    console.log('\n✅ Check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Check failed:', error)
    process.exit(1)
  })



