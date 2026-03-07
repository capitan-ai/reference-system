import prisma from '../prisma-client.js'

/**
 * Master Earnings Worker
 * Processes completed bookings and calculates earnings into the Ledger.
 * Logic: Always uses Snapshot Price for commission, aggregates all tips from order.
 */
export async function processMasterEarnings(organizationId) {
  console.log(`[EARNINGS-WORKER] Starting processing for org: ${organizationId}`)

  try {
    const pendingSnapshots = await prisma.bookingSnapshot.findMany({
      where: {
        organization_id: organizationId,
        status: 'ACCEPTED',
        base_processed: false
      },
      include: {
        booking: {
          include: {
            orders: {
              where: { state: 'COMPLETED' }
            }
          }
        }
      },
      take: 50
    })

    console.log(`[EARNINGS-WORKER] Found ${pendingSnapshots.length} snapshots to process.`)

    for (const snapshot of pendingSnapshots) {
      await processSingleSnapshot(snapshot)
    }

  } catch (error) {
    console.error('[EARNINGS-WORKER] ❌ Error in worker:', error.message)
  }
}

async function processSingleSnapshot(snapshot) {
  const { booking_id, booking } = snapshot
  
  const order = booking.orders[0]
  if (!order) return

  // Fetch all payments for this order to aggregate tips
  const payments = await prisma.payment.findMany({ 
    where: { order_id: order.id, status: 'COMPLETED' } 
  })

  if (payments.length === 0) return

  console.log(`[EARNINGS-WORKER] Processing booking ${booking_id}...`)

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
          team_member_id: snapshot.technician_id,
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
          team_member_id: snapshot.technician_id,
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
      const lineItems = await tx.orderLineItem.findMany({ where: { order_id: order.id } })
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

    console.log(`[EARNINGS-WORKER] ✅ Booking ${booking_id} processed successfully.`)
  } catch (error) {
    console.error(`[EARNINGS-WORKER] ❌ Error processing booking ${booking_id}:`, error.message)
  }
}
