#!/usr/bin/env node
/**
 * FAST batch backfill using Square's batchRetrieveOrders API
 * Fetches 100 orders per API call instead of 1
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: process.env.SQUARE_ENVIRONMENT === 'sandbox' 
    ? Environment.Sandbox 
    : Environment.Production
})

const ordersApi = squareClient.ordersApi

async function backfillBatch() {
  console.log(`\n🚀 FAST Batch Backfill from Square API\n`)
  
  // Get ALL orders needing backfill
  const orders = await prisma.$queryRawUnsafe(`
    SELECT 
      o.order_id, 
      o.id as order_uuid, 
      o.organization_id, 
      o.location_id, 
      o.customer_id
    FROM orders o
    WHERE o.state = 'COMPLETED'
    AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id)
    AND jsonb_array_length(COALESCE(o.raw_json->'tenders', '[]'::jsonb)) > 0
    AND (o.raw_json->'tenders'->0->>'paymentId' IS NULL 
         AND o.raw_json->'tenders'->0->>'payment_id' IS NULL)
    LIMIT 300
  `)
  
  console.log('Orders to process:', orders.length)
  
  let inserted = 0, skipped = 0, errors = 0, batchCalls = 0
  
  // Process in batches of 100 (Square's limit)
  const batchSize = 100
  for (let i = 0; i < orders.length; i += batchSize) {
    const batch = orders.slice(i, i + batchSize)
    const orderIds = batch.map(o => o.order_id)
    
    console.log(`\n📡 Batch ${Math.floor(i/batchSize) + 1}: Fetching ${batch.length} orders...`)
    batchCalls++
    
    try {
      // Use batchRetrieveOrders for speed
      const response = await ordersApi.batchRetrieveOrders({
        locationId: batch[0].location_id,
        orderIds: orderIds
      })
      
      const squareOrders = response.result?.orders || []
      console.log(`   Got ${squareOrders.length} orders from Square`)
      
      // Create a map for quick lookup
      const orderMap = new Map(batch.map(o => [o.order_id, o]))
      
      for (const squareOrder of squareOrders) {
        const dbOrder = orderMap.get(squareOrder.id)
        if (!dbOrder) continue
        
        const tenders = squareOrder.tenders || []
        if (tenders.length === 0) {
          skipped++
          continue
        }
        
        // Get location UUID
        let locationUuid = null
        const loc = await prisma.$queryRaw`
          SELECT id FROM locations WHERE square_location_id = ${dbOrder.location_id} LIMIT 1
        `
        if (loc.length > 0) locationUuid = loc[0].id
        if (!locationUuid) { skipped++; continue }
        
        // Ensure customer exists
        if (dbOrder.customer_id) {
          await prisma.$executeRaw`
            INSERT INTO square_existing_clients (
              organization_id, square_customer_id, got_signup_bonus, created_at, updated_at
            ) VALUES (
              ${dbOrder.organization_id}::uuid, ${dbOrder.customer_id}, false, NOW(), NOW()
            ) ON CONFLICT (organization_id, square_customer_id) DO NOTHING
          `
        }
        
        // Process tenders
        for (const tender of tenders) {
          const paymentId = tender.paymentId || tender.id
          if (!paymentId) { skipped++; continue }
          
          const existing = await prisma.$queryRaw`
            SELECT id FROM payments WHERE payment_id = ${paymentId} LIMIT 1
          `
          if (existing.length > 0) { skipped++; continue }
          
          const amount = parseInt(tender.amountMoney?.amount) || 0
          const tip = parseInt(tender.tipMoney?.amount) || 0
          const total = amount + tip
          const currency = tender.amountMoney?.currency || 'USD'
          
          await prisma.$executeRaw`
            INSERT INTO payments (
              id, payment_id, organization_id, order_id, customer_id, location_id,
              event_type, status, 
              amount_money_amount, amount_money_currency,
              tip_money_amount, tip_money_currency,
              total_money_amount, total_money_currency,
              source_type, created_at, updated_at
            ) VALUES (
              gen_random_uuid(), ${paymentId}, ${dbOrder.organization_id}::uuid,
              ${dbOrder.order_uuid}::uuid, ${dbOrder.customer_id}, ${locationUuid}::uuid,
              'payment.backfilled_batch', 'COMPLETED',
              ${amount}::integer, ${currency}, ${tip}::integer, ${currency},
              ${total}::integer, 'USD', ${tender.type || 'CARD'}, NOW(), NOW()
            )
          `
          
          console.log(`   ✅ ${paymentId.substring(0,15)}... $${(total/100).toFixed(2)}`)
          inserted++
        }
      }
      
    } catch (err) {
      console.log(`   ❌ Batch error: ${err.message?.substring(0, 60) || err}`)
      errors += batch.length
    }
    
    // Small delay between batches
    await new Promise(r => setTimeout(r, 500))
  }
  
  console.log(`\n${'='.repeat(60)}`)
  console.log(`📊 Results:`)
  console.log(`   Batch API calls: ${batchCalls}`)
  console.log(`   Inserted: ${inserted}`)
  console.log(`   Skipped: ${skipped}`)
  console.log(`   Errors: ${errors}`)
  console.log(`${'='.repeat(60)}\n`)
}

backfillBatch()
  .then(() => { console.log('✅ Done'); process.exit(0) })
  .catch(err => { console.error('❌', err.message); process.exit(1) })
  .finally(() => prisma.$disconnect())

