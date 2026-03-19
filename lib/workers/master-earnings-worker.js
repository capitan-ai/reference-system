import prisma from '../prisma-client.js'

/**
 * Master Earnings Worker
 * Processes completed bookings and calculates earnings into the Ledger.
 * Logic: Always uses Snapshot Price for commission, aggregates all tips from order.
 * @param {string} organizationId
 * @param {number} [batchSize=50] - Cron: 50. Backfill: 1500+ (env EARNINGS_BATCH_SIZE)
 */
export async function processMasterEarnings(organizationId, batchSize = 50) {
  console.log(`[EARNINGS-WORKER] Starting processing for org: ${organizationId} (batch=${batchSize})`)

  try {
    // Fetch processable snapshots first (have order+payment+technician)
    // findMany without filter returns arbitrary order — most pending lack orders, so we'd get 98% unprocessable
    const processableIds = await prisma.$queryRawUnsafe(
      `SELECT bs.booking_id
       FROM booking_snapshots bs
       JOIN bookings b ON b.id = bs.booking_id
       JOIN orders o ON o.booking_id = b.id AND o.state = 'COMPLETED'
       JOIN payments p ON p.order_id = o.id AND p.status = 'COMPLETED'
       WHERE bs.organization_id = $1::uuid
         AND bs.base_processed = false
         AND bs.status = 'ACCEPTED'
         AND (bs.technician_id IS NOT NULL OR b.technician_id IS NOT NULL)
       LIMIT $2`,
      organizationId,
      batchSize
    )
    const ids = processableIds.map((r) => r.booking_id)
    if (ids.length === 0) {
      console.log('[EARNINGS-WORKER] No processable snapshots found.')
      return
    }

    const pendingSnapshots = await prisma.bookingSnapshot.findMany({
      where: {
        organization_id: organizationId,
        status: 'ACCEPTED',
        base_processed: false,
        booking_id: { in: ids }
      },
      include: {
        booking: {
          include: {
            orders: {
              where: { state: 'COMPLETED' }
            }
          }
        }
      }
    })

    console.log(`[EARNINGS-WORKER] Found ${pendingSnapshots.length} processable snapshots.`)

    const orderIds = pendingSnapshots
      .map((s) => s.booking?.orders?.[0]?.id)
      .filter(Boolean)
    const paymentsByOrderId = new Map()
    const lineItemsByOrderId = new Map()
    if (orderIds.length > 0) {
      const [allPayments, allLineItems] = await Promise.all([
        prisma.payment.findMany({
          where: { order_id: { in: orderIds }, status: 'COMPLETED' }
        }),
        prisma.orderLineItem.findMany({ where: { order_id: { in: orderIds } } })
      ])
      for (const pay of allPayments) {
        const list = paymentsByOrderId.get(pay.order_id) || []
        list.push(pay)
        paymentsByOrderId.set(pay.order_id, list)
      }
      for (const li of allLineItems) {
        if (!li.order_id) continue
        const list = lineItemsByOrderId.get(li.order_id) || []
        list.push(li)
        lineItemsByOrderId.set(li.order_id, list)
      }
    }

    const ctx = { paymentsByOrderId, lineItemsByOrderId }
    const concurrency = parseInt(process.env.EARNINGS_CONCURRENCY || '1', 10)
    if (concurrency > 1) {
      for (let i = 0; i < pendingSnapshots.length; i += concurrency) {
        const chunk = pendingSnapshots.slice(i, i + concurrency)
        await Promise.all(chunk.map((s) => processSingleSnapshot(s, ctx)))
      }
    } else {
      for (const snapshot of pendingSnapshots) {
        await processSingleSnapshot(snapshot, ctx)
      }
    }

  } catch (error) {
    console.error('[EARNINGS-WORKER] ❌ Error in worker:', error.message)
  }
}

async function processSingleSnapshot(snapshot, ctx = {}) {
  const { booking_id, booking } = snapshot

  const technicianId = snapshot.technician_id || booking?.technician_id
  if (!technicianId) return

  const order = booking.orders[0]
  if (!order) return

  const payments =
    ctx.paymentsByOrderId?.get(order.id) ||
    (await prisma.payment.findMany({
      where: { order_id: order.id, status: 'COMPLETED' }
    }))

  if (payments.length === 0) return

  if (process.env.EARNINGS_VERBOSE) {
    console.log(`[EARNINGS-WORKER] Processing booking ${booking_id}...`)
  }

  try {
    await prisma.$transaction(async (tx) => {
      const ledgerEntries = []
      
      // 1. COMMISSION CALCULATION (ALWAYS FROM SNAPSHOT PRICE)
      // This ensures master gets full pay even for Packages (--) or Discounts
      const basePrice = snapshot.price_snapshot_amount
      const commissionRate = snapshot.commission_rate_snapshot / 100
      const commissionAmount = Math.round(basePrice * commissionRate)

      if (commissionAmount > 0) {
        ledgerEntries.push({
          organization_id: snapshot.organization_id,
          team_member_id: technicianId,
          booking_id: snapshot.booking_id,
          entry_type: 'SERVICE_COMMISSION',
          amount_amount: commissionAmount,
          source_engine: 'MASTER_ENGINE',
          meta_json: { 
            calculation_base: 'SNAPSHOT_PRICE',
            price_used: basePrice, 
            rate: snapshot.commission_rate_snapshot,
            is_fix: snapshot.is_fix
          }
        })
      }

      // 2. TIPS CALCULATION (AGGREGATE FROM ALL PAYMENTS)
      const totalTips = payments.reduce((sum, p) => sum + (p.tip_money_amount || 0), 0)
      if (totalTips > 0) {
        ledgerEntries.push({
          organization_id: snapshot.organization_id,
          team_member_id: technicianId,
          booking_id: snapshot.booking_id,
          entry_type: 'TIP',
          amount_amount: totalTips,
          source_engine: 'MASTER_ENGINE',
          meta_json: { 
            order_id: order.order_id,
            payment_ids: payments.map(p => p.payment_id)
          }
        })
      }

      // 3. PACKAGE USAGE TRACKING (Logic only, no price impact for master)
      const lineItems =
        ctx.lineItemsByOrderId?.get(order.id) ||
        (await tx.orderLineItem.findMany({ where: { order_id: order.id } }))
      const hasPackage = lineItems.some(item => 
        item.discount_name?.toLowerCase().includes('package') || 
        (item.total_money_amount === 0 && !snapshot.is_fix)
      )

      if (hasPackage && booking.customer_id) {
        const activePackage = await tx.customerPackage.findFirst({
          where: {
            customer_id: booking.customer_id,
            organization_id: snapshot.organization_id,
            category: snapshot.category_snapshot,
            units_remaining: { gt: 0 },
            status: 'ACTIVE'
          }
        })

        if (activePackage) {
          await tx.packageUsage.create({
            data: {
              package_id: activePackage.id,
              booking_id: snapshot.booking_id,
              used_at: new Date()
            }
          })

          const newUnits = activePackage.units_remaining - 1
          await tx.customerPackage.update({
            where: { id: activePackage.id },
            data: { 
              units_remaining: newUnits,
              status: newUnits === 0 ? 'USED' : 'ACTIVE'
            }
          })
        }
      }

      // 4. WRITE TO LEDGER
      if (ledgerEntries.length > 0) {
        await tx.masterEarningsLedger.createMany({
          data: ledgerEntries
        })
      }

      // 5. MARK AS PROCESSED
      await tx.bookingSnapshot.update({
        where: { booking_id: snapshot.booking_id },
        data: { base_processed: true }
      })
    })

    if (process.env.EARNINGS_VERBOSE) {
      console.log(`[EARNINGS-WORKER] ✅ Booking ${booking_id} processed successfully.`)
    }
  } catch (error) {
    console.error(`[EARNINGS-WORKER] ❌ Error processing booking ${booking_id}:`, error.message)
  }
}
