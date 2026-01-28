#!/usr/bin/env node
/**
 * Fix NULL issues in order_line_items where possible
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

function convertBigIntToString(obj) {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'bigint') return obj.toString()
  if (Array.isArray(obj)) return obj.map(convertBigIntToString)
  if (typeof obj === 'object') {
    const result = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = convertBigIntToString(value)
    }
    return result
  }
  return obj
}

async function fixNullIssues() {
  console.log('🔧 Fixing NULL Issues in Order Line Items\n')
  console.log('='.repeat(60))

  try {
    // 1. Fix NULL names for CUSTOM_AMOUNT items
    console.log('\n1️⃣ Fixing NULL names for CUSTOM_AMOUNT items...\n')
    
    const customAmountFix = await prisma.$executeRaw`
      UPDATE order_line_items
      SET name = 'Custom Amount'
      WHERE name IS NULL 
        AND item_type = 'CUSTOM_AMOUNT'
    `
    
    console.log(`   ✅ Updated ${customAmountFix} CUSTOM_AMOUNT items with default name`)

    // 2. Fix zero/NULL amounts from raw_json where available
    console.log('\n2️⃣ Fixing zero/NULL amounts from raw_json...\n')
    
    const amountFixes = await prisma.$queryRaw`
      SELECT 
        id,
        uid,
        raw_json->>'totalMoney' as raw_total_money,
        raw_json->>'basePriceMoney' as raw_base_price,
        raw_json->>'grossSalesMoney' as raw_gross_sales
      FROM order_line_items
      WHERE (total_money_amount IS NULL OR total_money_amount = 0)
        AND raw_json IS NOT NULL
        AND raw_json->>'totalMoney' IS NOT NULL
      LIMIT 100
    `

    let fixedAmounts = 0
    for (const item of amountFixes) {
      try {
        const rawTotalMoney = item.raw_total_money ? JSON.parse(item.raw_total_money) : null
        const rawBasePrice = item.raw_base_price ? JSON.parse(item.raw_base_price) : null
        const rawGrossSales = item.raw_gross_sales ? JSON.parse(item.raw_gross_sales) : null

        const totalAmount = rawTotalMoney?.amount ? Number(rawTotalMoney.amount) : null
        const basePriceAmount = rawBasePrice?.amount ? Number(rawBasePrice.amount) : null
        const grossSalesAmount = rawGrossSales?.amount ? Number(rawGrossSales.amount) : null

        if (totalAmount !== null && totalAmount > 0) {
          await prisma.$executeRaw`
            UPDATE order_line_items
            SET 
              total_money_amount = ${totalAmount},
              total_money_currency = ${rawTotalMoney.currency || 'USD'},
              base_price_money_amount = COALESCE(${basePriceAmount}, base_price_money_amount),
              base_price_money_currency = COALESCE(${rawBasePrice?.currency || 'USD'}, base_price_money_currency),
              gross_sales_money_amount = COALESCE(${grossSalesAmount}, gross_sales_money_amount),
              gross_sales_money_currency = COALESCE(${rawGrossSales?.currency || 'USD'}, gross_sales_money_currency)
            WHERE id = ${item.id}::uuid
          `
          fixedAmounts++
        }
      } catch (error) {
        // Skip items with parsing errors
      }
    }

    console.log(`   ✅ Fixed ${fixedAmounts} items with amounts from raw_json`)

    // 3. Fetch and fix missing raw_json for recent items (from January 2026)
    console.log('\n3️⃣ Fetching missing raw_json from Square API...\n')
    
    const missingRawJson = await prisma.$queryRaw`
      SELECT 
        oli.id,
        oli.uid,
        oli.order_id,
        o.order_id as square_order_id
      FROM order_line_items oli
      INNER JOIN orders o ON oli.order_id = o.id
      WHERE oli.raw_json IS NULL
        AND oli.order_created_at >= '2026-01-15'
        AND oli.order_created_at < '2026-01-19'
      LIMIT 50
    `

    console.log(`   Found ${missingRawJson.length} items with missing raw_json from Jan 15-18, 2026`)
    console.log(`   Fetching from Square API...\n`)

    let fixedRawJson = 0
    let errors = 0

    for (const item of missingRawJson) {
      try {
        const orderResponse = await ordersApi.retrieveOrder(item.square_order_id)
        const squareOrder = orderResponse.result?.order
        
        if (!squareOrder) {
          errors++
          continue
        }

        const lineItems = squareOrder.lineItems || squareOrder.line_items || []
        const matchingItem = lineItems.find(li => li.uid === item.uid)

        if (matchingItem) {
          const rawJson = convertBigIntToString(matchingItem)
          
          await prisma.$executeRaw`
            UPDATE order_line_items
            SET raw_json = ${JSON.stringify(rawJson)}::jsonb
            WHERE id::text = ${item.id}
          `
          
          fixedRawJson++
        } else {
          errors++
        }
      } catch (apiError) {
        errors++
        if (errors <= 5) {
          console.log(`   ⚠️  Error fetching ${item.square_order_id}: ${apiError.message}`)
        }
      }

      // Small delay to avoid rate limiting
      if (fixedRawJson % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    console.log(`   ✅ Fixed ${fixedRawJson} items with raw_json from Square API`)
    console.log(`   ❌ Errors: ${errors}`)

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('\n📊 FIX SUMMARY:\n')
    console.log(`   ✅ Fixed CUSTOM_AMOUNT names: ${customAmountFix}`)
    console.log(`   ✅ Fixed amounts from raw_json: ${fixedAmounts}`)
    console.log(`   ✅ Fixed raw_json from Square API: ${fixedRawJson}`)
    console.log(`   ❌ Errors: ${errors}`)

    // Final check
    console.log('\n📊 Remaining Issues:\n')
    
    const remaining = await prisma.$queryRaw`
      SELECT 
        COUNT(*) FILTER (WHERE name IS NULL)::int as null_names,
        COUNT(*) FILTER (WHERE raw_json IS NULL)::int as null_raw_json,
        COUNT(*) FILTER (WHERE total_money_amount IS NULL OR total_money_amount = 0)::int as null_or_zero_amounts
      FROM order_line_items
    `

    console.log(`   NULL names: ${remaining[0].null_names}`)
    console.log(`   NULL raw_json: ${remaining[0].null_raw_json}`)
    console.log(`   NULL/zero amounts: ${remaining[0].null_or_zero_amounts}`)

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

fixNullIssues()
  .then(() => {
    console.log('\n✅ Fix complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Fix failed:', error)
    process.exit(1)
  })

