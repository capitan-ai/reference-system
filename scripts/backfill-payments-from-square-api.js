#!/usr/bin/env node
/**
 * Backfill missing payments by fetching from Square API
 * For orders that have tenders but no paymentId in raw_json
 * 
 * Usage: node scripts/backfill-payments-from-square-api.js [--limit N]
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

// Initialize Square client
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: process.env.SQUARE_ENVIRONMENT === 'sandbox' 
    ? Environment.Sandbox 
    : Environment.Production
})

const ordersApi = squareClient.ordersApi

async function backfillFromSquareApi(limit = 50) {
  console.log(`\n🔄 Backfilling payments from Square API (limit ${limit})...\n`)
  
  // Get orders with tenders but no paymentId
  const orders = await prisma.$queryRawUnsafe(`
    SELECT 
      o.order_id, 
      o.id as order_uuid, 
      o.organization_id, 
      o.location_id, 
      o.customer_id,
      o.raw_json
    FROM orders o
    WHERE o.state = 'COMPLETED'
    AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id)
    AND jsonb_array_length(COALESCE(o.raw_json->'tenders', '[]'::jsonb)) > 0
    AND (o.raw_json->'tenders'->0->>'paymentId' IS NULL 
         AND o.raw_json->'tenders'->0->>'payment_id' IS NULL)
    ORDER BY o.created_at DESC
    LIMIT ${limit}
  `)
  
  console.log('Orders to process:', orders.length)
  
  let inserted = 0, skipped = 0, errors = 0, apiCalls = 0
  
  for (const order of orders) {
    try {
      // Call Square API to get full order details
      console.log(`\n📡 Fetching order ${order.order_id.substring(0, 20)}...`)
      apiCalls++
      
      const response = await ordersApi.retrieveOrder(order.order_id)
      const squareOrder = response.result?.order
      
      if (!squareOrder) {
        console.log(`  ⚠️ Order not found in Square`)
        skipped++
        continue
      }
      
      const tenders = squareOrder.tenders || []
      if (tenders.length === 0) {
        console.log(`  ⚠️ No tenders in Square order`)
        skipped++
        continue
      }
      
      // Get location UUID
      let locationUuid = null
      if (order.location_id) {
        const loc = await prisma.$queryRaw`
          SELECT id FROM locations 
          WHERE square_location_id = ${order.location_id} 
          LIMIT 1
        `
        if (loc.length > 0) locationUuid = loc[0].id
      }
      
      if (!locationUuid) {
        console.log(`  ⚠️ No location found`)
        skipped++
        continue
      }
      
      // Ensure customer exists
      if (order.customer_id) {
        const customerExists = await prisma.$queryRaw`
          SELECT square_customer_id FROM square_existing_clients 
          WHERE square_customer_id = ${order.customer_id} LIMIT 1
        `
        if (customerExists.length === 0) {
          await prisma.$executeRaw`
            INSERT INTO square_existing_clients (
              organization_id, square_customer_id, got_signup_bonus, created_at, updated_at
            )
            VALUES (
              ${order.organization_id}::uuid, ${order.customer_id}, false, NOW(), NOW()
            )
            ON CONFLICT (organization_id, square_customer_id) DO NOTHING
          `
        }
      }
      
      // Process each tender
      for (const tender of tenders) {
        const paymentId = tender.paymentId || tender.id
        if (!paymentId) {
          console.log(`  ⚠️ Tender has no paymentId`)
          skipped++
          continue
        }
        
        // Check if payment already exists
        const existing = await prisma.$queryRaw`
          SELECT id FROM payments WHERE payment_id = ${paymentId} LIMIT 1
        `
        if (existing.length > 0) {
          console.log(`  ℹ️ Payment ${paymentId.substring(0, 15)}... already exists`)
          skipped++
          continue
        }
        
        // Parse amounts
        const amountMoney = tender.amountMoney || {}
        const tipMoney = tender.tipMoney || {}
        const amount = parseInt(amountMoney.amount) || 0
        const tip = parseInt(tipMoney.amount) || 0
        const total = amount + tip
        const currency = amountMoney.currency || 'USD'
        
        await prisma.$executeRaw`
          INSERT INTO payments (
            id, payment_id, organization_id, order_id, customer_id, location_id,
            event_type, status, 
            amount_money_amount, amount_money_currency,
            tip_money_amount, tip_money_currency,
            total_money_amount, total_money_currency,
            source_type, created_at, updated_at
          ) VALUES (
            gen_random_uuid(),
            ${paymentId},
            ${order.organization_id}::uuid,
            ${order.order_uuid}::uuid,
            ${order.customer_id},
            ${locationUuid}::uuid,
            'payment.backfilled_api',
            'COMPLETED',
            ${amount}::integer,
            ${currency},
            ${tip}::integer,
            ${currency},
            ${total}::integer,
            'USD',
            ${tender.type || 'CARD'},
            NOW(),
            NOW()
          )
        `
        
        console.log(`  ✅ ${paymentId.substring(0, 20)}... $${(total / 100).toFixed(2)}`)
        inserted++
      }
      
      // Rate limiting - wait 200ms between API calls
      await new Promise(resolve => setTimeout(resolve, 200))
      
    } catch (err) {
      if (err.statusCode === 429) {
        console.log(`  ⏳ Rate limited, waiting 5 seconds...`)
        await new Promise(resolve => setTimeout(resolve, 5000))
        continue
      }
      console.log(`  ❌ ${order.order_id.substring(0, 15)}: ${err.message?.substring(0, 60) || err}`)
      errors++
    }
  }
  
  console.log(`\n${'='.repeat(60)}`)
  console.log(`📊 Results:`)
  console.log(`   API calls:  ${apiCalls}`)
  console.log(`   Inserted:   ${inserted}`)
  console.log(`   Skipped:    ${skipped}`)
  console.log(`   Errors:     ${errors}`)
  console.log(`${'='.repeat(60)}\n`)
  
  return { apiCalls, inserted, skipped, errors }
}

// Parse args
const args = process.argv.slice(2)
let limit = 50

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) {
    limit = parseInt(args[i + 1])
  }
}

backfillFromSquareApi(limit)
  .then(() => {
    console.log('✅ Backfill complete')
    process.exit(0)
  })
  .catch(err => {
    console.error('❌ Backfill failed:', err.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

