#!/usr/bin/env node
/**
 * Investigate NULL issues in order_line_items
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function investigate() {
  console.log('🔍 Investigating NULL Issues in Order Line Items\n')
  console.log('='.repeat(60))

  try {
    // 1. Investigate NULL names - check raw_json
    console.log('\n1️⃣ Investigating NULL Names (52 items):\n')
    
    const nullNames = await prisma.$queryRaw`
      SELECT 
        id,
        uid,
        name,
        item_type,
        service_variation_id,
        total_money_amount,
        order_created_at,
        raw_json->>'name' as raw_name,
        raw_json->>'itemType' as raw_item_type,
        raw_json->>'catalogObjectId' as raw_catalog_id
      FROM order_line_items
      WHERE name IS NULL
      LIMIT 10
    `

    console.log(`   Sample of ${nullNames.length} items with NULL names:\n`)
    nullNames.forEach(item => {
      console.log(`   ID: ${item.id}`)
      console.log(`     UID: ${item.uid}`)
      console.log(`     Name (DB): ${item.name || 'NULL'}`)
      console.log(`     Name (raw_json): ${item.raw_name || 'NULL'}`)
      console.log(`     Item Type: ${item.item_type || 'NULL'}`)
      console.log(`     Item Type (raw_json): ${item.raw_item_type || 'NULL'}`)
      console.log(`     Service Variation ID: ${item.service_variation_id || 'NULL'}`)
      console.log(`     Catalog ID (raw_json): ${item.raw_catalog_id || 'NULL'}`)
      console.log(`     Total Money: ${item.total_money_amount || 'NULL'}`)
      console.log(`     Created: ${item.order_created_at}`)
      console.log('')
    })

    // 2. Investigate missing raw_json
    console.log('\n2️⃣ Investigating Missing raw_json (371 items):\n')
    
    const missingRawJson = await prisma.$queryRaw`
      SELECT 
        id,
        uid,
        name,
        order_id,
        order_created_at,
        created_at
      FROM order_line_items
      WHERE raw_json IS NULL
      ORDER BY order_created_at DESC
      LIMIT 10
    `

    console.log(`   Sample of ${missingRawJson.length} items with NULL raw_json:\n`)
    missingRawJson.forEach(item => {
      console.log(`   ID: ${item.id}`)
      console.log(`     UID: ${item.uid}`)
      console.log(`     Name: ${item.name || 'NULL'}`)
      console.log(`     Order ID: ${item.order_id}`)
      console.log(`     Order Created: ${item.order_created_at}`)
      console.log(`     DB Created: ${item.created_at}`)
      console.log('')
    })

    // 3. Investigate zero/NULL amounts
    console.log('\n3️⃣ Investigating Zero/NULL Amounts (704 items):\n')
    
    const zeroAmounts = await prisma.$queryRaw`
      SELECT 
        id,
        uid,
        name,
        item_type,
        total_money_amount,
        base_price_money_amount,
        gross_sales_money_amount,
        order_state,
        raw_json->>'itemType' as raw_item_type,
        raw_json->>'totalMoney' as raw_total_money
      FROM order_line_items
      WHERE total_money_amount IS NULL OR total_money_amount = 0
      ORDER BY order_created_at DESC
      LIMIT 10
    `

    console.log(`   Sample of ${zeroAmounts.length} items with zero/NULL amounts:\n`)
    zeroAmounts.forEach(item => {
      console.log(`   ID: ${item.id}`)
      console.log(`     UID: ${item.uid}`)
      console.log(`     Name: ${item.name || 'NULL'}`)
      console.log(`     Item Type: ${item.item_type || 'NULL'}`)
      console.log(`     Total Money: ${item.total_money_amount || 'NULL'}`)
      console.log(`     Base Price: ${item.base_price_money_amount || 'NULL'}`)
      console.log(`     Gross Sales: ${item.gross_sales_money_amount || 'NULL'}`)
      console.log(`     Order State: ${item.order_state || 'NULL'}`)
      console.log(`     Raw Item Type: ${item.raw_item_type || 'NULL'}`)
      console.log(`     Raw Total Money: ${item.raw_total_money || 'NULL'}`)
      console.log('')
    })

    // 4. Check if technician_id should be populated from raw_json
    console.log('\n4️⃣ Investigating Missing technician_id:\n')
    
    const withRawJson = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE raw_json IS NOT NULL)::int as with_raw_json,
        COUNT(*) FILTER (WHERE raw_json->>'appliedServiceCharges' IS NOT NULL)::int as with_service_charges,
        COUNT(*) FILTER (WHERE raw_json->'appliedServiceCharges' @> '[{"uid": "technician"}]')::int as with_technician_charge
      FROM order_line_items
    `

    console.log(`   Total line items: ${withRawJson[0].total.toLocaleString()}`)
    console.log(`   With raw_json: ${withRawJson[0].with_raw_json.toLocaleString()}`)
    console.log(`   With service charges in raw_json: ${withRawJson[0].with_service_charges.toLocaleString()}`)

    // Check if technician info is in the order or line item
    const technicianCheck = await prisma.$queryRaw`
      SELECT 
        oli.id,
        oli.uid,
        oli.name,
        o.raw_json->'lineItems'->0->'appliedServiceCharges' as order_service_charges,
        oli.raw_json->'appliedServiceCharges' as line_item_service_charges
      FROM order_line_items oli
      INNER JOIN orders o ON oli.order_id = o.id
      WHERE o.raw_json IS NOT NULL
        AND oli.raw_json IS NOT NULL
      LIMIT 5
    `

    console.log(`\n   Sample check for technician info in raw_json:\n`)
    technicianCheck.forEach(item => {
      console.log(`   Line Item ID: ${item.id}`)
      console.log(`     Order service charges: ${item.order_service_charges ? 'Present' : 'NULL'}`)
      console.log(`     Line item service charges: ${item.line_item_service_charges ? 'Present' : 'NULL'}`)
    })

    // 5. Check administrator_id source
    console.log('\n5️⃣ Investigating Missing administrator_id:\n')
    
    const adminCheck = await prisma.$queryRaw`
      SELECT 
        COUNT(*) FILTER (WHERE administrator_id IS NOT NULL)::int as with_admin,
        COUNT(*) FILTER (WHERE administrator_id IS NULL)::int as without_admin
      FROM order_line_items
    `

    console.log(`   With administrator_id: ${adminCheck[0].with_admin.toLocaleString()}`)
    console.log(`   Without administrator_id: ${adminCheck[0].without_admin.toLocaleString()}`)

    // Check if admin info is in raw_json or order
    const adminSource = await prisma.$queryRaw`
      SELECT 
        oli.id,
        oli.administrator_id,
        o.raw_json->'tenders'->0->'payment_id' as order_payment_id,
        oli.raw_json->'appliedServiceCharges' as line_item_charges
      FROM order_line_items oli
      INNER JOIN orders o ON oli.order_id = o.id
      WHERE oli.administrator_id IS NOT NULL
      LIMIT 5
    `

    console.log(`\n   Sample items WITH administrator_id:\n`)
    adminSource.forEach(item => {
      console.log(`   Line Item ID: ${item.id}`)
      console.log(`     Administrator ID: ${item.administrator_id}`)
    })

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

investigate()
  .then(() => {
    console.log('\n✅ Investigation complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Investigation failed:', error)
    process.exit(1)
  })



