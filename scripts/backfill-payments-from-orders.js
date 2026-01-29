#!/usr/bin/env node
/**
 * Backfill missing payments from order raw_json tenders
 * 
 * Usage: node scripts/backfill-payments-from-orders.js [--days N] [--limit N]
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function backfillPayments(days = 7, limit = 100) {
  console.log(`\n🔄 Backfilling payments from order raw_json (last ${days} days, limit ${limit})...\n`)
  
  const intervalDays = `${days} days`
  const orders = await prisma.$queryRawUnsafe(`
    SELECT o.order_id, o.id as order_uuid, o.organization_id, o.location_id, o.customer_id, o.raw_json
    FROM orders o
    WHERE o.state = 'COMPLETED'
      AND o.created_at >= NOW() - INTERVAL '${intervalDays}'
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id)
    ORDER BY o.created_at DESC
    LIMIT ${limit}
  `)
  
  console.log('Orders without payments:', orders.length)
  
  let inserted = 0, skipped = 0, errors = 0
  
  for (const order of orders) {
    try {
      const rawJson = order.raw_json
      if (!rawJson?.tenders?.length) { 
        skipped++
        continue 
      }
      
      // Get location UUID from Square location ID
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
        console.log(`  ⚠️ No location found for ${order.order_id.substring(0, 15)}...`)
        skipped++
        continue
      }
      
      // Ensure customer exists (create if not)
      if (order.customer_id) {
        const customerExists = await prisma.$queryRaw`
          SELECT square_customer_id FROM square_existing_clients 
          WHERE square_customer_id = ${order.customer_id} LIMIT 1
        `
        if (customerExists.length === 0) {
          // Create the customer
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
      
      for (const tender of rawJson.tenders) {
        const paymentId = tender.paymentId || tender.payment_id
        if (!paymentId) { 
          skipped++
          continue 
        }
        
        // Check if payment already exists
        const existing = await prisma.$queryRaw`
          SELECT id FROM payments WHERE payment_id = ${paymentId} LIMIT 1
        `
        if (existing.length > 0) { 
          skipped++
          continue 
        }
        
        // Parse amounts (they come as strings from JSON)
        const amountMoney = tender.amountMoney || tender.amount_money || {}
        const tipMoney = tender.tipMoney || tender.tip_money || {}
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
            'payment.backfilled',
            'COMPLETED',
            ${amount}::integer,
            ${currency},
            ${tip}::integer,
            ${currency},
            ${total}::integer,
            'USD',
            'CARD',
            NOW(),
            NOW()
          )
        `
        
        console.log(`  ✅ ${paymentId.substring(0, 20)}... $${(total / 100).toFixed(2)}`)
        inserted++
      }
    } catch (err) {
      console.log(`  ❌ ${order.order_id.substring(0, 15)}: ${err.message.substring(0, 60)}`)
      errors++
    }
  }
  
  console.log(`\n${'='.repeat(60)}`)
  console.log(`📊 Results:`)
  console.log(`   Inserted: ${inserted}`)
  console.log(`   Skipped:  ${skipped}`)
  console.log(`   Errors:   ${errors}`)
  console.log(`${'='.repeat(60)}\n`)
  
  return { inserted, skipped, errors }
}

// Parse args
const args = process.argv.slice(2)
let days = 7
let limit = 100

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--days' && args[i + 1]) {
    days = parseInt(args[i + 1])
  }
  if (args[i] === '--limit' && args[i + 1]) {
    limit = parseInt(args[i + 1])
  }
}

backfillPayments(days, limit)
  .then(() => {
    console.log('✅ Backfill complete')
    process.exit(0)
  })
  .catch(err => {
    console.error('❌ Backfill failed:', err.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

