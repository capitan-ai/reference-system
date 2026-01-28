#!/usr/bin/env node
/**
 * Check all order_line_items for NULL and missing values
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkNullAndMissing() {
  console.log('🔍 Checking Order Line Items for NULL and Missing Values\n')
  console.log('='.repeat(60))

  try {
    // Total line items
    const total = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM order_line_items
    `
    console.log(`\n📊 Total line items: ${total[0].count.toLocaleString()}\n`)

    // Check NULL values in critical fields
    console.log('❌ NULL Values in Critical Fields:\n')
    
    const nullChecks = await prisma.$queryRaw`
      SELECT 
        COUNT(*) FILTER (WHERE organization_id IS NULL)::int as null_organization_id,
        COUNT(*) FILTER (WHERE order_id IS NULL)::int as null_order_id,
        COUNT(*) FILTER (WHERE uid IS NULL)::int as null_uid,
        COUNT(*) FILTER (WHERE name IS NULL)::int as null_name,
        COUNT(*) FILTER (WHERE service_variation_id IS NULL)::int as null_service_variation_id,
        COUNT(*) FILTER (WHERE location_id IS NULL)::int as null_location_id,
        COUNT(*) FILTER (WHERE customer_id IS NULL)::int as null_customer_id,
        COUNT(*) FILTER (WHERE order_created_at IS NULL)::int as null_order_created_at,
        COUNT(*) FILTER (WHERE order_state IS NULL)::int as null_order_state,
        COUNT(*) FILTER (WHERE total_money_amount IS NULL)::int as null_total_money_amount,
        COUNT(*) FILTER (WHERE raw_json IS NULL)::int as null_raw_json
      FROM order_line_items
    `

    const nulls = nullChecks[0]
    console.log(`   organization_id: ${nulls.null_organization_id.toLocaleString()}`)
    console.log(`   order_id: ${nulls.null_order_id.toLocaleString()}`)
    console.log(`   uid: ${nulls.null_uid.toLocaleString()}`)
    console.log(`   name: ${nulls.null_name.toLocaleString()}`)
    console.log(`   service_variation_id: ${nulls.null_service_variation_id.toLocaleString()}`)
    console.log(`   location_id: ${nulls.null_location_id.toLocaleString()}`)
    console.log(`   customer_id: ${nulls.null_customer_id.toLocaleString()}`)
    console.log(`   order_created_at: ${nulls.null_order_created_at.toLocaleString()}`)
    console.log(`   order_state: ${nulls.null_order_state.toLocaleString()}`)
    console.log(`   total_money_amount: ${nulls.null_total_money_amount.toLocaleString()}`)
    console.log(`   raw_json: ${nulls.null_raw_json.toLocaleString()}`)

    // Check for line items with multiple NULL critical fields
    console.log('\n⚠️  Line Items with Multiple NULL Critical Fields:\n')
    
    const multipleNulls = await prisma.$queryRaw`
      SELECT 
        id,
        uid,
        name,
        order_id,
        organization_id,
        location_id,
        customer_id,
        service_variation_id,
        order_created_at,
        order_state,
        total_money_amount,
        (
          CASE WHEN organization_id IS NULL THEN 1 ELSE 0 END +
          CASE WHEN order_id IS NULL THEN 1 ELSE 0 END +
          CASE WHEN uid IS NULL THEN 1 ELSE 0 END +
          CASE WHEN name IS NULL THEN 1 ELSE 0 END +
          CASE WHEN order_created_at IS NULL THEN 1 ELSE 0 END +
          CASE WHEN order_state IS NULL THEN 1 ELSE 0 END
        )::int as null_count
      FROM order_line_items
      WHERE 
        organization_id IS NULL OR
        order_id IS NULL OR
        uid IS NULL OR
        name IS NULL OR
        order_created_at IS NULL OR
        order_state IS NULL
      ORDER BY null_count DESC
      LIMIT 20
    `

    if (multipleNulls.length > 0) {
      console.log(`   Found ${multipleNulls.length} line items with NULL critical fields:\n`)
      multipleNulls.forEach(item => {
        console.log(`   ID: ${item.id}`)
        console.log(`     UID: ${item.uid || 'NULL'}`)
        console.log(`     Name: ${item.name || 'NULL'}`)
        console.log(`     Order ID: ${item.order_id || 'NULL'}`)
        console.log(`     Organization ID: ${item.organization_id || 'NULL'}`)
        console.log(`     Location ID: ${item.location_id || 'NULL'}`)
        console.log(`     Customer ID: ${item.customer_id || 'NULL'}`)
        console.log(`     Service Variation ID: ${item.service_variation_id || 'NULL'}`)
        console.log(`     Order Created At: ${item.order_created_at || 'NULL'}`)
        console.log(`     Order State: ${item.order_state || 'NULL'}`)
        console.log(`     Total Money: ${item.total_money_amount || 'NULL'}`)
        console.log(`     NULL Count: ${item.null_count}`)
        console.log('')
      })
    } else {
      console.log('   ✅ No line items with multiple NULL critical fields')
    }

    // Check for orphaned line items (order_id doesn't exist in orders table)
    console.log('🔗 Orphaned Line Items (order_id not in orders table):\n')
    
    const orphaned = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM order_line_items oli
      LEFT JOIN orders o ON oli.order_id = o.id
      WHERE o.id IS NULL
    `
    
    console.log(`   Orphaned line items: ${orphaned[0].count.toLocaleString()}`)
    
    if (orphaned[0].count > 0) {
      const orphanedSamples = await prisma.$queryRaw`
        SELECT 
          oli.id,
          oli.uid,
          oli.name,
          oli.order_id,
          oli.organization_id,
          oli.order_created_at
        FROM order_line_items oli
        LEFT JOIN orders o ON oli.order_id = o.id
        WHERE o.id IS NULL
        LIMIT 10
      `
      
      console.log(`\n   Sample orphaned line items:\n`)
      orphanedSamples.forEach(item => {
        console.log(`     ID: ${item.id}, UID: ${item.uid || 'NULL'}, Name: ${item.name || 'NULL'}, Order ID: ${item.order_id}`)
      })
    }

    // Check for line items with zero or negative amounts
    console.log('\n💰 Line Items with Zero or Negative Amounts:\n')
    
    const zeroAmounts = await prisma.$queryRaw`
      SELECT 
        COUNT(*) FILTER (WHERE total_money_amount IS NULL OR total_money_amount = 0)::int as zero_or_null,
        COUNT(*) FILTER (WHERE total_money_amount < 0)::int as negative,
        COUNT(*) FILTER (WHERE total_money_amount > 0)::int as positive
      FROM order_line_items
    `
    
    const amounts = zeroAmounts[0]
    console.log(`   Zero or NULL amounts: ${amounts.zero_or_null.toLocaleString()}`)
    console.log(`   Negative amounts: ${amounts.negative.toLocaleString()}`)
    console.log(`   Positive amounts: ${amounts.positive.toLocaleString()}`)

    // Check for missing money fields
    console.log('\n💵 Missing Money Fields:\n')
    
    const missingMoney = await prisma.$queryRaw`
      SELECT 
        COUNT(*) FILTER (WHERE base_price_money_amount IS NULL)::int as null_base_price,
        COUNT(*) FILTER (WHERE gross_sales_money_amount IS NULL)::int as null_gross_sales,
        COUNT(*) FILTER (WHERE total_tax_money_amount IS NULL)::int as null_tax,
        COUNT(*) FILTER (WHERE total_discount_money_amount IS NULL)::int as null_discount,
        COUNT(*) FILTER (WHERE variation_total_price_money_amount IS NULL)::int as null_variation_price
      FROM order_line_items
    `
    
    const money = missingMoney[0]
    console.log(`   base_price_money_amount: ${money.null_base_price.toLocaleString()} NULL`)
    console.log(`   gross_sales_money_amount: ${money.null_gross_sales.toLocaleString()} NULL`)
    console.log(`   total_tax_money_amount: ${money.null_tax.toLocaleString()} NULL`)
    console.log(`   total_discount_money_amount: ${money.null_discount.toLocaleString()} NULL`)
    console.log(`   variation_total_price_money_amount: ${money.null_variation_price.toLocaleString()} NULL`)

    // Check for missing technician/administrator assignments
    console.log('\n👤 Missing Team Member Assignments:\n')
    
    const missingTeam = await prisma.$queryRaw`
      SELECT 
        COUNT(*) FILTER (WHERE technician_id IS NULL)::int as null_technician,
        COUNT(*) FILTER (WHERE administrator_id IS NULL)::int as null_administrator,
        COUNT(*) FILTER (WHERE technician_id IS NULL AND administrator_id IS NULL)::int as null_both
      FROM order_line_items
    `
    
    const team = missingTeam[0]
    console.log(`   Missing technician_id: ${team.null_technician.toLocaleString()}`)
    console.log(`   Missing administrator_id: ${team.null_administrator.toLocaleString()}`)
    console.log(`   Missing both: ${team.null_both.toLocaleString()}`)

    // Summary by year
    console.log('\n📅 NULL Values by Year:\n')
    
    const byYear = await prisma.$queryRaw`
      SELECT 
        EXTRACT(YEAR FROM order_created_at)::int as year,
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE uid IS NULL)::int as null_uid,
        COUNT(*) FILTER (WHERE name IS NULL)::int as null_name,
        COUNT(*) FILTER (WHERE service_variation_id IS NULL)::int as null_service_id,
        COUNT(*) FILTER (WHERE location_id IS NULL)::int as null_location,
        COUNT(*) FILTER (WHERE customer_id IS NULL)::int as null_customer,
        COUNT(*) FILTER (WHERE order_state IS NULL)::int as null_state
      FROM order_line_items
      WHERE order_created_at IS NOT NULL
      GROUP BY EXTRACT(YEAR FROM order_created_at)
      ORDER BY year DESC
    `
    
    byYear.forEach(row => {
      console.log(`   ${row.year}:`)
      console.log(`     Total: ${row.total.toLocaleString()}`)
      console.log(`     NULL uid: ${row.null_uid.toLocaleString()}`)
      console.log(`     NULL name: ${row.null_name.toLocaleString()}`)
      console.log(`     NULL service_variation_id: ${row.null_service_id.toLocaleString()}`)
      console.log(`     NULL location_id: ${row.null_location.toLocaleString()}`)
      console.log(`     NULL customer_id: ${row.null_customer.toLocaleString()}`)
      console.log(`     NULL order_state: ${row.null_state.toLocaleString()}`)
    })

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('\n📊 SUMMARY:\n')
    console.log(`   Total line items: ${total[0].count.toLocaleString()}`)
    console.log(`   Critical NULLs:`)
    console.log(`     - Missing organization_id: ${nulls.null_organization_id.toLocaleString()}`)
    console.log(`     - Missing order_id: ${nulls.null_order_id.toLocaleString()}`)
    console.log(`     - Missing uid: ${nulls.null_uid.toLocaleString()}`)
    console.log(`     - Missing name: ${nulls.null_name.toLocaleString()}`)
    console.log(`     - Missing order_created_at: ${nulls.null_order_created_at.toLocaleString()}`)
    console.log(`     - Missing order_state: ${nulls.null_order_state.toLocaleString()}`)
    console.log(`   Orphaned line items: ${orphaned[0].count.toLocaleString()}`)
    console.log(`   Zero/NULL amounts: ${amounts.zero_or_null.toLocaleString()}`)

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

checkNullAndMissing()
  .then(() => {
    console.log('\n✅ Check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Check failed:', error)
    process.exit(1)
  })



