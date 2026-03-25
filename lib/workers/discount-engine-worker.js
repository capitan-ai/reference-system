import prisma from '../prisma-client.js'

/**
 * Discount Engine Worker
 * Processes discounts on completed orders and creates DISCOUNT_ADJUSTMENT entries in the Ledger.
 */
export async function processDiscountAdjustments(organizationId) {
  const batchSize = parseInt(process.env.DISCOUNT_BATCH_SIZE || '400', 10)
  const concurrency = parseInt(process.env.DISCOUNT_CONCURRENCY || '10', 10)

  console.log(
    `[DISCOUNT-ENGINE] Starting for org: ${organizationId} (batch=${batchSize}, concurrency=${concurrency})`
  )

  try {
    const rules = await prisma.discountAllocationRule.findMany({
      where: { organization_id: organizationId, is_active: true }
    })
    // Exact match index (lowercased)
    const ruleByExact = Object.fromEntries(
      rules.filter((r) => r.discount_name).map((r) => [r.discount_name.toLowerCase().trim(), r])
    )
    // Pattern-based fallback: master pays for complaints/delays, owner pays everything else
    const MASTER_PAYS_PATTERNS = ['complaint', 'delay', 'late', 'waiting']
    const DEFAULT_OWNER_RULE = { master_share_percent: 0, salon_share_percent: 100 }

    function resolveRule(discountName) {
      const key = discountName.toLowerCase().trim()
      // 1. Exact match
      if (ruleByExact[key]) return ruleByExact[key]
      // 2. Pattern match for master-pays discounts
      if (MASTER_PAYS_PATTERNS.some((p) => key.includes(p))) {
        return { master_share_percent: 100, salon_share_percent: 0 }
      }
      // 3. Default: owner pays (no DISCOUNT_ADJUSTMENT needed)
      return DEFAULT_OWNER_RULE
    }
    // Keep old name for compat
    const ruleByDiscount = { _resolveRule: resolveRule }

    const pendingSnapshots = await prisma.bookingSnapshot.findMany({
      where: {
        organization_id: organizationId,
        status: 'ACCEPTED',
        base_processed: true,
        discount_processed: false
      },
      include: {
        booking: {
          include: {
            orders: { where: { state: 'COMPLETED' } }
          }
        }
      },
      take: batchSize
    })

    if (pendingSnapshots.length === 0) {
      return
    }

    console.log(`[DISCOUNT-ENGINE] Found ${pendingSnapshots.length} snapshots with unprocessed discounts.`)

    const orderIds = pendingSnapshots
      .map((s) => s.booking?.orders?.[0]?.id)
      .filter(Boolean)
    const lineItemsByOrderId = new Map()
    if (orderIds.length > 0) {
      const allLineItems = await prisma.orderLineItem.findMany({
        where: {
          order_id: { in: orderIds },
          organization_id: organizationId,
          total_discount_money_amount: { gt: 0 }
        }
      })
      for (const li of allLineItems) {
        if (!li.order_id) continue
        const list = lineItemsByOrderId.get(li.order_id) || []
        list.push(li)
        lineItemsByOrderId.set(li.order_id, list)
      }
    }

    const ctx = { ruleByDiscount, lineItemsByOrderId }
    if (concurrency > 1) {
      for (let i = 0; i < pendingSnapshots.length; i += concurrency) {
        const chunk = pendingSnapshots.slice(i, i + concurrency)
        await Promise.all(chunk.map((s) => processSingleSnapshotDiscounts(s, ctx)))
      }
    } else {
      for (const snapshot of pendingSnapshots) {
        await processSingleSnapshotDiscounts(snapshot, ctx)
      }
    }
  } catch (error) {
    console.error('[DISCOUNT-ENGINE] ❌ Error:', error.message)
  }
}

async function processSingleSnapshotDiscounts(snapshot, ctx) {
  const { booking_id, booking, technician_id: snapshotTechnicianId } = snapshot
  const order = booking?.orders?.[0]
  if (!order) {
    await prisma.bookingSnapshot.update({
      where: { booking_id },
      data: { discount_processed: true }
    })
    return
  }

  const lineItems =
    ctx.lineItemsByOrderId?.get(order.id) ||
    (await prisma.orderLineItem.findMany({
      where: {
        order_id: order.id,
        organization_id: snapshot.organization_id,
        total_discount_money_amount: { gt: 0 }
      }
    }))

  const itemsWithDiscount = lineItems.filter(
    (li) => li.discount_name && (li.total_discount_money_amount || 0) > 0
  )
  if (itemsWithDiscount.length === 0) {
    await prisma.bookingSnapshot.update({
      where: { booking_id },
      data: { discount_processed: true }
    })
    return
  }

  const resolveRule = ctx.ruleByDiscount?._resolveRule || (() => ({ master_share_percent: 0 }))
  const ledgerEntries = []
  for (const item of itemsWithDiscount) {
    const discountName = item.discount_name?.trim?.()
    if (!discountName) continue

    const rule = resolveRule(discountName)
    if (!rule || rule.master_share_percent <= 0) continue

    const technicianId = item.technician_id || snapshotTechnicianId
    if (!technicianId) continue

    const discountCents = item.total_discount_money_amount || 0
    const masterShareCents = Math.round(discountCents * (rule.master_share_percent / 100))
    if (masterShareCents <= 0) continue

    ledgerEntries.push({
      organization_id: snapshot.organization_id,
      team_member_id: technicianId,
      booking_id,
      entry_type: 'DISCOUNT_ADJUSTMENT',
      amount_amount: -masterShareCents,
      source_engine: 'DISCOUNT_ENGINE',
      meta_json: {
        discount_name: discountName,
        discount_cents: discountCents,
        master_share_percent: rule.master_share_percent,
        order_line_item_id: item.id
      }
    })
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (ledgerEntries.length > 0) {
        await tx.masterEarningsLedger.createMany({ data: ledgerEntries })
      }
      await tx.bookingSnapshot.update({
        where: { booking_id },
        data: { discount_processed: true }
      })
    })
    if (ledgerEntries.length > 0 && process.env.DISCOUNT_VERBOSE) {
      console.log(
        `[DISCOUNT-ENGINE] ✅ Booking ${booking_id}: ${ledgerEntries.length} discount adjustment(s)`
      )
    }
  } catch (error) {
    console.error(`[DISCOUNT-ENGINE] ❌ Error processing booking ${booking_id}:`, error.message)
  }
}
