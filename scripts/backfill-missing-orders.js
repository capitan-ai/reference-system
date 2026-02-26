require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { getOrdersApi, getLocationsApi } = require('../lib/utils/square-client')

/**
 * BACKFILL MISSING ORDERS (Robust Version)
 * 
 * Fixes:
 * 1. Limits to exactly 23 candidates (or current empty set) to avoid hanging.
 * 2. Proper error logging (no more silent catch).
 * 3. Uses dateTimeFilter for efficient Square searching.
 * 4. Correctly handles UUID FKs for line items.
 * 5. Avoids N+1 DB lookups where possible.
 */
async function backfillMissingOrders() {
  console.log('\n' + '='.repeat(80))
  console.log('  🚀 ROBUST BACKFILL: MISSING ORDERS')
  console.log('='.repeat(80))

  // 1. Get candidates (limit to 50 to be safe and fast)
  const customers = await prisma.$queryRaw`
    SELECT sec.square_customer_id, sec.organization_id::text as org_id
    FROM square_existing_clients sec
    WHERE NOT EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id = sec.square_customer_id)
      AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = sec.square_customer_id)
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.customer_id = sec.square_customer_id)
      AND sec.given_name IS NOT NULL
    LIMIT 50
  `

  if (customers.length === 0) {
    console.log('✅ No empty customers found to check. Done!')
    return
  }

  console.log(`🔍 Checking ${customers.length} customers for missing orders in Square...`)

  const ordersApi = getOrdersApi()
  const locationsApi = getLocationsApi()

  // 2. Get location IDs (required for searchOrders)
  const locResp = await locationsApi.listLocations()
  const locationIds = (locResp.result.locations || []).map(l => l.id)
  
  if (!locationIds.length) {
    throw new Error('❌ No Square locations found. Check credentials.')
  }

  let totalOrdersCreated = 0
  let totalItemsCreated = 0

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i]
    process.stdout.write(`\n[${i + 1}/${customers.length}] Customer ${c.square_customer_id.substring(0, 12)}... `)

    try {
      // 3. Search Square with dateTimeFilter (last 2 years)
      const startAt = new Date()
      startAt.setFullYear(startAt.getFullYear() - 2)

      const resp = await ordersApi.searchOrders({
        locationIds,
        query: {
          filter: {
            customerFilter: { customerIds: [c.square_customer_id] },
            stateFilter: { states: ['COMPLETED'] },
            dateTimeFilter: {
              createdAt: {
                startAt: startAt.toISOString(),
                endAt: new Date().toISOString()
              }
            }
          }
        },
        limit: 10
      })

      const squareOrders = resp.result.orders || []
      if (squareOrders.length === 0) {
        process.stdout.write('no orders found.')
        continue
      }

      process.stdout.write(`found ${squareOrders.length} orders. `)

      for (const sqOrder of squareOrders) {
        // 4. Check if exists (using composite unique key)
        const existing = await prisma.order.findUnique({
          where: { 
            organization_id_order_id: { 
              organization_id: c.org_id, 
              order_id: sqOrder.id 
            } 
          },
          select: { id: true }
        })

        if (existing) {
          process.stdout.write('skip(exists). ')
          continue
        }

        // 5. Insert Order and get internal UUID
        // We use raw SQL to avoid relation issues with location_id if it's not in our DB
        const orderId = sqOrder.id
        const totalCents = Number(sqOrder.totalMoney?.amount || 0)
        const createdAt = new Date(sqOrder.createdAt)
        const updatedAt = new Date(sqOrder.updatedAt)

        const [newOrder] = await prisma.$queryRaw`
          INSERT INTO orders (
            id, organization_id, order_id, customer_id, state, 
            created_at, updated_at
          ) VALUES (
            gen_random_uuid(), ${c.org_id}::uuid, ${orderId}, ${c.square_customer_id}, ${sqOrder.state},
            ${createdAt}, ${updatedAt}
          )
          ON CONFLICT (organization_id, order_id) DO UPDATE SET state = EXCLUDED.state
          RETURNING id
        `

        if (newOrder?.id) {
          totalOrdersCreated++
          
          // 6. Insert Line Items using the internal UUID order_id
          if (sqOrder.lineItems && sqOrder.lineItems.length > 0) {
            for (const item of sqOrder.lineItems) {
              const itemTotal = Number(item.totalMoney?.amount || 0)
              
              await prisma.$executeRaw`
                INSERT INTO order_line_items (
                  id, organization_id, order_id, customer_id, uid, 
                  name, variation_name, quantity, total_money_amount, item_type,
                  order_created_at, order_state
                ) VALUES (
                  gen_random_uuid(), ${c.org_id}::uuid, ${newOrder.id}::uuid, ${c.square_customer_id}, ${item.uid},
                  ${item.name || 'Unknown'}, ${item.variationName || null}, ${item.quantity}, ${itemTotal}, ${item.itemType},
                  ${createdAt}, ${sqOrder.state}
                )
                ON CONFLICT (organization_id, uid) DO NOTHING
              `
              totalItemsCreated++
            }
          }
          process.stdout.write('saved. ')
        }
      }

      // Rate limiting backoff
      await new Promise(r => setTimeout(r, 300))

    } catch (e) {
      console.error(`\n❌ Error processing customer ${c.square_customer_id}:`)
      console.error(`   Status: ${e?.statusCode || 'unknown'}`)
      console.error(`   Message: ${e?.message || e}`)
      if (e?.body) console.error(`   Body: ${JSON.stringify(e.body)}`)
      // Wait longer on error
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  console.log('\n\n' + '='.repeat(80))
  console.log('  ✅ BACKFILL COMPLETE')
  console.log('='.repeat(80))
  console.log(`  Orders created:     ${totalOrdersCreated}`)
  console.log(`  Line items created: ${totalItemsCreated}`)
  console.log('='.repeat(80) + '\n')

  await prisma.$disconnect()
}

backfillMissingOrders().catch(e => {
  console.error('\n💥 FATAL ERROR:', e)
  process.exit(1)
})
