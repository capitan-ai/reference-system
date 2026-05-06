require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { getPaymentsApi } = require('../lib/utils/square-client')
const prisma = new PrismaClient()

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'
const PAGE_LIMIT = 100

function moneyVal(obj) {
  if (!obj) return 0
  const n = parseInt(obj.amount)
  return isNaN(n) ? 0 : n
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  const paymentsApi = getPaymentsApi()
  const fromDate = new Date('2023-11-01')
  const toDate = new Date()

  // Build location map
  const dbLocations = await prisma.location.findMany({
    where: { organization_id: ORG_ID },
    select: { id: true, square_location_id: true, name: true },
  })
  const locationIds = dbLocations.map(l => l.square_location_id).filter(Boolean)
  console.log(`Locations: ${locationIds.length}`)

  // Build payment index from DB
  console.log('Loading DB payments...')
  const dbPayments = await prisma.$queryRaw`
    SELECT payment_id, customer_id,
      amount_money_amount, tip_money_amount, total_money_amount
    FROM payments
    WHERE organization_id = ${ORG_ID}::uuid
  `
  const dbMap = new Map(dbPayments.map(p => [p.payment_id, p]))
  console.log(`DB payments: ${dbMap.size}`)

  let totalFixed = { customer_id: 0, amount: 0, tip: 0, total: 0, raw_json: 0 }
  let processed = 0

  for (const locationId of locationIds) {
    let cursor = null
    do {
      await sleep(120) // rate limit
      const resp = await paymentsApi.list({
        beginTime: fromDate.toISOString(),
        endTime: toDate.toISOString(),
        locationId,
        limit: PAGE_LIMIT,
        cursor: cursor || undefined,
      })

      const payments = resp.data ?? []
      cursor = resp.response?.cursor ?? null

      for (const sq of payments) {
        const db = dbMap.get(sq.id)
        if (!db) continue

        const sqCustomerId = sq.customerId || sq.customer_id || null
        const sqAmount = moneyVal(sq.amountMoney || sq.amount_money)
        const sqTip = moneyVal(sq.tipMoney || sq.tip_money)
        const sqTotal = moneyVal(sq.totalMoney || sq.total_money)

        const updates = []
        const params = []

        if (sqCustomerId && sqCustomerId !== db.customer_id) {
          updates.push(`customer_id = $${params.length + 1}`)
          params.push(sqCustomerId)
          totalFixed.customer_id++
        }
        if (sqAmount && sqAmount !== Number(db.amount_money_amount || 0)) {
          updates.push(`amount_money_amount = $${params.length + 1}`)
          params.push(sqAmount)
          totalFixed.amount++
        }
        if (sqTip !== Number(db.tip_money_amount || 0)) {
          updates.push(`tip_money_amount = $${params.length + 1}`)
          params.push(sqTip)
          totalFixed.tip++
        }
        if (sqTotal && sqTotal !== Number(db.total_money_amount || 0)) {
          updates.push(`total_money_amount = $${params.length + 1}`)
          params.push(sqTotal)
          totalFixed.total++
        }

        // Always update raw_json with latest data
        if (updates.length > 0) {
          updates.push(`raw_json = $${params.length + 1}::jsonb`)
          params.push(JSON.stringify(sq, (_, v) => typeof v === 'bigint' ? String(v) : v))
          updates.push(`updated_at = NOW()`)
          totalFixed.raw_json++

          const idParam = params.length + 1
          params.push(sq.id)
          const orgParam = params.length + 1
          params.push(ORG_ID)

          const sql = `UPDATE payments SET ${updates.join(', ')} WHERE payment_id = $${idParam} AND organization_id = $${orgParam}::uuid`
          await prisma.$executeRawUnsafe(sql, ...params)
        }
      }

      processed += payments.length
      if (processed % 5000 === 0) {
        console.log(`  Processed ${processed}... fixes: ${JSON.stringify(totalFixed)}`)
      }
    } while (cursor)
  }

  console.log(`\nDone! Processed ${processed} payments.`)
  console.log(`Fixed:`)
  console.log(`  customer_id: ${totalFixed.customer_id}`)
  console.log(`  amount_money: ${totalFixed.amount}`)
  console.log(`  tip_money: ${totalFixed.tip}`)
  console.log(`  total_money: ${totalFixed.total}`)
  console.log(`  raw_json updated: ${totalFixed.raw_json}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
