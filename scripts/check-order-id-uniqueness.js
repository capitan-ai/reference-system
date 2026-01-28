#!/usr/bin/env node
/**
 * Check order_id uniqueness in the database
 * Verify that each order_id from Square is unique
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Import Square SDK
let squareClient
let ordersApi
try {
  const squareModule = require('square')
  const { Client, Environment } = squareModule
  
  const { getSquareEnvironmentName } = require('../lib/utils/square-env')
  const squareEnvName = getSquareEnvironmentName()
  const resolvedEnvironment = squareEnvName === 'sandbox' ? Environment.Sandbox : Environment.Production
  
  squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
    environment: resolvedEnvironment,
  })
  ordersApi = squareClient.ordersApi
  
  console.log(`🔑 Using Square ${squareEnvName} environment`)
} catch (error) {
  console.error('Failed to initialize Square SDK:', error.message)
  process.exit(1)
}

async function checkUniqueness() {
  console.log('🔍 Checking Order ID Uniqueness\n')
  console.log('='.repeat(60))

  try {
    // Check for duplicate order_ids in database
    console.log('\n📊 Checking for duplicate order_ids in database...\n')
    
    const duplicates = await prisma.$queryRaw`
      SELECT 
        order_id,
        COUNT(*)::int as count,
        array_agg(id::text) as order_uuids,
        array_agg(organization_id::text) as organization_ids,
        array_agg(state) as states
      FROM orders
      WHERE order_id IS NOT NULL
      GROUP BY order_id
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 20
    `

    if (duplicates.length === 0) {
      console.log('✅ No duplicate order_ids found in database')
    } else {
      console.log(`⚠️  Found ${duplicates.length} duplicate order_ids:\n`)
      duplicates.forEach(dup => {
        console.log(`   Order ID: ${dup.order_id}`)
        console.log(`   Count: ${dup.count}`)
        console.log(`   Order UUIDs: ${dup.order_uuids.join(', ')}`)
        console.log(`   Organization IDs: ${dup.organization_ids.join(', ')}`)
        console.log(`   States: ${dup.states.join(', ')}`)
        console.log('')
      })
    }

    // Check total unique order_ids
    const uniqueCount = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT order_id)::int as count
      FROM orders
      WHERE order_id IS NOT NULL
    `
    const totalCount = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM orders
      WHERE order_id IS NOT NULL
    `

    console.log(`📊 Order Statistics:`)
    console.log(`   Total orders: ${totalCount[0].count.toLocaleString()}`)
    console.log(`   Unique order_ids: ${uniqueCount[0].count.toLocaleString()}`)
    console.log(`   Duplicates: ${(totalCount[0].count - uniqueCount[0].count).toLocaleString()}`)

    // Check for orders with same order_id but different organizations
    const crossOrgDuplicates = await prisma.$queryRaw`
      SELECT 
        order_id,
        COUNT(DISTINCT organization_id)::int as org_count,
        array_agg(DISTINCT organization_id::text) as organization_ids
      FROM orders
      WHERE order_id IS NOT NULL
      GROUP BY order_id
      HAVING COUNT(DISTINCT organization_id) > 1
      LIMIT 10
    `

    if (crossOrgDuplicates.length > 0) {
      console.log(`\n⚠️  Orders with same order_id across different organizations:`)
      crossOrgDuplicates.forEach(dup => {
        console.log(`   Order ID: ${dup.order_id}`)
        console.log(`   Organizations: ${dup.organization_ids.join(', ')}`)
      })
    } else {
      console.log(`\n✅ No orders with same order_id across different organizations`)
    }

    // Test retrieving a few orders from Square to verify order_id uniqueness
    console.log(`\n📡 Testing order retrieval from Square API...\n`)
    
    const testOrders = await prisma.$queryRaw`
      SELECT order_id
      FROM (
        SELECT DISTINCT order_id
        FROM orders
        WHERE order_id IS NOT NULL
      ) sub
      ORDER BY RANDOM()
      LIMIT 5
    `

    const squareOrderIds = new Set()
    let foundInSquare = 0
    let notFoundInSquare = 0
    let errors = 0

    for (const testOrder of testOrders) {
      const orderId = testOrder.order_id
      try {
        const orderResponse = await ordersApi.retrieveOrder(orderId)
        const squareOrder = orderResponse.result?.order
        
        if (squareOrder) {
          foundInSquare++
          squareOrderIds.add(squareOrder.id)
          
          // Verify order_id matches
          if (squareOrder.id !== orderId) {
            console.log(`   ⚠️  Order ID mismatch: DB=${orderId}, Square=${squareOrder.id}`)
          }
        } else {
          notFoundInSquare++
        }
      } catch (apiError) {
        errors++
        if (errors <= 3) {
          console.log(`   ❌ Error retrieving ${orderId}: ${apiError.message}`)
        }
      }
    }

    console.log(`\n📊 Square API Test Results:`)
    console.log(`   Found in Square: ${foundInSquare}`)
    console.log(`   Not found: ${notFoundInSquare}`)
    console.log(`   Errors: ${errors}`)
    console.log(`   Unique Square IDs: ${squareOrderIds.size}`)

    // Check constraint on orders table
    console.log(`\n📋 Checking database constraints...\n`)
    
    const constraints = await prisma.$queryRaw`
      SELECT 
        conname as constraint_name,
        contype as constraint_type,
        pg_get_constraintdef(oid) as definition
      FROM pg_constraint
      WHERE conrelid = 'orders'::regclass
        AND contype IN ('u', 'p')
    `

    console.log(`   Constraints on orders table:`)
    constraints.forEach(con => {
      console.log(`     ${con.constraint_name} (${con.constraint_type}): ${con.definition}`)
    })

    // Check if there's a unique constraint on (organization_id, order_id)
    const orgOrderConstraint = constraints.find(c => 
      c.definition && c.definition.includes('organization_id') && c.definition.includes('order_id')
    )

    if (orgOrderConstraint) {
      console.log(`\n✅ Found unique constraint: ${orgOrderConstraint.constraint_name}`)
      console.log(`   This ensures order_id is unique per organization`)
    } else {
      console.log(`\n⚠️  No unique constraint found on (organization_id, order_id)`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

checkUniqueness()
  .then(() => {
    console.log('\n✅ Check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Check failed:', error)
    process.exit(1)
  })

