import { getUserFromRequest } from '../../../../lib/auth/check-access'
import db from '../../../../lib/prisma-client'

export const dynamic = 'force-dynamic'

const FIX_TRANSFER_AMOUNT = 1500 // $15 in cents

function json(body, status = 200) {
  return Response.json(body, { status })
}

/**
 * Authorize admin/owner access, return { user, orgUser } or Response error.
 */
async function authorizeAdmin(request) {
  const user = await getUserFromRequest(request)
  if (!user || user.error) {
    return { error: json({ error: 'Unauthorized' }, 401) }
  }
  const orgUser = await db.organizationUser.findFirst({
    where: {
      user_id: user.id,
      role: { in: ['owner', 'admin', 'super_admin'] }
    }
  })
  if (!orgUser) {
    return { error: json({ error: 'Admin access required' }, 403) }
  }
  return { user, orgUser }
}

/**
 * POST /api/admin/master-adjustments
 * Creates a master adjustment and writes ledger entries in a single transaction.
 */
export async function POST(request) {
  const auth = await authorizeAdmin(request)
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const {
      organization_id,
      adjustment_type,
      booking_id,
      original_booking_id,
      fault_master_id,
      compensated_master_id,
      amount_cents,
      reason
    } = body

    // Validation
    if (!organization_id) return json({ error: 'organization_id is required' }, 400)
    if (!adjustment_type) return json({ error: 'adjustment_type is required' }, 400)

    const validTypes = [
      'FIX_CROSS_MASTER', 'FIX_SAME_MASTER', 'COMPLAINT_FAULT',
      'HELP_COMPENSATION', 'REASSIGNMENT_BONUS', 'MASTER_DELAY',
      'REFUND_REVERSAL', 'MANUAL_BONUS', 'MANUAL_DEDUCTION'
    ]
    if (!validTypes.includes(adjustment_type)) {
      return json({ error: `Invalid adjustment_type. Must be one of: ${validTypes.join(', ')}` }, 400)
    }

    // Type-specific validation
    const finalAmount = amount_cents || FIX_TRANSFER_AMOUNT
    if (finalAmount <= 0) return json({ error: 'amount_cents must be positive' }, 400)

    if (adjustment_type === 'FIX_CROSS_MASTER') {
      if (!fault_master_id || !compensated_master_id) {
        return json({ error: 'FIX_CROSS_MASTER requires both fault_master_id and compensated_master_id' }, 400)
      }
      if (fault_master_id === compensated_master_id) {
        return json({ error: 'FIX_CROSS_MASTER: fault and compensated masters must differ. Use FIX_SAME_MASTER instead.' }, 400)
      }
    }

    if (adjustment_type === 'COMPLAINT_FAULT' && !fault_master_id) {
      return json({ error: 'COMPLAINT_FAULT requires fault_master_id' }, 400)
    }

    if (adjustment_type === 'REFUND_REVERSAL' && !booking_id) {
      return json({ error: 'REFUND_REVERSAL requires booking_id to look up original commission' }, 400)
    }

    if (['MANUAL_BONUS', 'HELP_COMPENSATION', 'REASSIGNMENT_BONUS'].includes(adjustment_type) && !compensated_master_id) {
      return json({ error: `${adjustment_type} requires compensated_master_id` }, 400)
    }

    if (['MANUAL_DEDUCTION', 'MASTER_DELAY'].includes(adjustment_type) && !fault_master_id) {
      return json({ error: `${adjustment_type} requires fault_master_id` }, 400)
    }

    // Validate referenced entities exist
    if (fault_master_id) {
      const exists = await db.teamMember.findUnique({ where: { id: fault_master_id } })
      if (!exists) return json({ error: `fault_master_id ${fault_master_id} not found` }, 404)
    }
    if (compensated_master_id) {
      const exists = await db.teamMember.findUnique({ where: { id: compensated_master_id } })
      if (!exists) return json({ error: `compensated_master_id ${compensated_master_id} not found` }, 404)
    }

    // Execute in transaction
    const result = await db.$transaction(async (tx) => {
      // 1. Create adjustment record
      const adjustment = await tx.masterAdjustment.create({
        data: {
          organization_id,
          adjustment_type,
          booking_id: booking_id || null,
          original_booking_id: original_booking_id || null,
          fault_master_id: fault_master_id || null,
          compensated_master_id: compensated_master_id || null,
          amount_cents: finalAmount,
          reason: reason || null,
          created_by: auth.user.id,
          status: 'PENDING'
        }
      })

      // 2. Build ledger entries based on type
      const ledgerEntries = []
      const metaBase = {
        adjustment_id: adjustment.id,
        adjustment_type,
        reason: reason || null
      }

      switch (adjustment_type) {
        case 'FIX_CROSS_MASTER': {
          // Penalize original master
          ledgerEntries.push({
            organization_id,
            team_member_id: fault_master_id,
            booking_id: booking_id || null,
            entry_type: 'FIX_PENALTY',
            amount_amount: -finalAmount,
            source_engine: 'ADMIN_MANUAL',
            meta_json: { ...metaBase, original_booking_id, compensated_master_id }
          })
          // Compensate fix master
          ledgerEntries.push({
            organization_id,
            team_member_id: compensated_master_id,
            booking_id: booking_id || null,
            entry_type: 'FIX_COMPENSATION',
            amount_amount: finalAmount,
            source_engine: 'ADMIN_MANUAL',
            meta_json: { ...metaBase, original_booking_id, fault_master_id }
          })
          // Update snapshot if booking provided
          if (booking_id) {
            await tx.bookingSnapshot.updateMany({
              where: { booking_id },
              data: { is_fix: true, original_booking_id: original_booking_id || null }
            })
          }
          break
        }

        case 'FIX_SAME_MASTER': {
          // No financial transfer, just flag the snapshot
          if (booking_id) {
            await tx.bookingSnapshot.updateMany({
              where: { booking_id },
              data: { is_fix: true, original_booking_id: original_booking_id || null }
            })
          }
          break
        }

        case 'COMPLAINT_FAULT': {
          // Charge the at-fault master
          ledgerEntries.push({
            organization_id,
            team_member_id: fault_master_id,
            booking_id: booking_id || null,
            entry_type: 'DISCOUNT_ADJUSTMENT',
            amount_amount: -finalAmount,
            source_engine: 'ADMIN_MANUAL',
            meta_json: { ...metaBase, type: 'complaint_fault' }
          })
          // If a different master was already charged by the discount engine for this booking,
          // compensate them
          if (compensated_master_id && compensated_master_id !== fault_master_id) {
            ledgerEntries.push({
              organization_id,
              team_member_id: compensated_master_id,
              booking_id: booking_id || null,
              entry_type: 'MANUAL_ADJUSTMENT',
              amount_amount: finalAmount,
              source_engine: 'ADMIN_MANUAL',
              meta_json: { ...metaBase, type: 'complaint_reversal_for_innocent_master' }
            })
          }
          break
        }

        case 'HELP_COMPENSATION':
        case 'REASSIGNMENT_BONUS':
        case 'MANUAL_BONUS': {
          ledgerEntries.push({
            organization_id,
            team_member_id: compensated_master_id,
            booking_id: booking_id || null,
            entry_type: 'MANUAL_ADJUSTMENT',
            amount_amount: finalAmount,
            source_engine: 'ADMIN_MANUAL',
            meta_json: metaBase
          })
          break
        }

        case 'MASTER_DELAY':
        case 'MANUAL_DEDUCTION': {
          ledgerEntries.push({
            organization_id,
            team_member_id: fault_master_id,
            booking_id: booking_id || null,
            entry_type: adjustment_type === 'MASTER_DELAY' ? 'DISCOUNT_ADJUSTMENT' : 'MANUAL_ADJUSTMENT',
            amount_amount: -finalAmount,
            source_engine: 'ADMIN_MANUAL',
            meta_json: metaBase
          })
          break
        }

        case 'REFUND_REVERSAL': {
          // Find original commission entries for this booking
          const originalEntries = await tx.masterEarningsLedger.findMany({
            where: {
              booking_id,
              entry_type: { in: ['SERVICE_COMMISSION', 'TIP'] }
            }
          })

          if (originalEntries.length === 0) {
            throw new Error(`No SERVICE_COMMISSION or TIP entries found for booking ${booking_id}`)
          }

          const technicianId = originalEntries[0].team_member_id

          // Create reversal entries for each original entry
          for (const original of originalEntries) {
            ledgerEntries.push({
              organization_id,
              team_member_id: original.team_member_id,
              booking_id,
              entry_type: 'REVERSAL',
              amount_amount: -original.amount_amount,
              source_engine: 'ADMIN_MANUAL',
              meta_json: {
                ...metaBase,
                reversed_entry_id: original.id,
                reversed_entry_type: original.entry_type,
                reversed_amount: original.amount_amount
              }
            })
          }

          // Also reverse any discount adjustments
          const discountEntries = await tx.masterEarningsLedger.findMany({
            where: { booking_id, entry_type: 'DISCOUNT_ADJUSTMENT' }
          })
          for (const disc of discountEntries) {
            ledgerEntries.push({
              organization_id,
              team_member_id: disc.team_member_id,
              booking_id,
              entry_type: 'REVERSAL',
              amount_amount: -disc.amount_amount,
              source_engine: 'ADMIN_MANUAL',
              meta_json: {
                ...metaBase,
                reversed_entry_id: disc.id,
                reversed_entry_type: disc.entry_type,
                reversed_amount: disc.amount_amount
              }
            })
          }
          break
        }
      }

      // 3. Write ledger entries
      let createdEntryIds = []
      if (ledgerEntries.length > 0) {
        // createMany doesn't return IDs, so create individually for traceability
        for (const entry of ledgerEntries) {
          const created = await tx.masterEarningsLedger.create({ data: entry })
          createdEntryIds.push(created.id)
        }
      }

      // 4. Update adjustment with ledger entry IDs and status
      const updated = await tx.masterAdjustment.update({
        where: { id: adjustment.id },
        data: {
          ledger_entry_ids: createdEntryIds,
          status: 'APPLIED'
        }
      })

      return { adjustment: updated, ledger_entries_count: createdEntryIds.length }
    })

    return json({
      success: true,
      adjustment_id: result.adjustment.id,
      status: result.adjustment.status,
      ledger_entries_created: result.ledger_entries_count,
      adjustment: result.adjustment
    }, 201)

  } catch (error) {
    console.error('[MASTER-ADJUSTMENTS] Error creating adjustment:', error.message)
    return json({ error: error.message || 'Internal server error' }, 500)
  }
}

/**
 * GET /api/admin/master-adjustments
 * List adjustments with optional filters.
 */
export async function GET(request) {
  const auth = await authorizeAdmin(request)
  if (auth.error) return auth.error

  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organization_id')
    const masterId = searchParams.get('master_id')
    const type = searchParams.get('type')
    const status = searchParams.get('status')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    if (!organizationId) return json({ error: 'organization_id is required' }, 400)

    const where = { organization_id: organizationId }

    if (masterId) {
      where.OR = [
        { fault_master_id: masterId },
        { compensated_master_id: masterId }
      ]
    }
    if (type) where.adjustment_type = type
    if (status) where.status = status
    if (from || to) {
      where.created_at = {}
      if (from) where.created_at.gte = new Date(from)
      if (to) where.created_at.lte = new Date(to + 'T23:59:59Z')
    }

    const [adjustments, total] = await Promise.all([
      db.masterAdjustment.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: offset
      }),
      db.masterAdjustment.count({ where })
    ])

    // Enrich with master names
    const masterIds = new Set()
    for (const adj of adjustments) {
      if (adj.fault_master_id) masterIds.add(adj.fault_master_id)
      if (adj.compensated_master_id) masterIds.add(adj.compensated_master_id)
    }

    const masters = masterIds.size > 0
      ? await db.teamMember.findMany({
          where: { id: { in: [...masterIds] } },
          select: { id: true, given_name: true, family_name: true }
        })
      : []
    const masterMap = Object.fromEntries(masters.map(m => [m.id, `${m.given_name || ''} ${m.family_name || ''}`.trim()]))

    const enriched = adjustments.map(adj => ({
      ...adj,
      fault_master_name: adj.fault_master_id ? (masterMap[adj.fault_master_id] || null) : null,
      compensated_master_name: adj.compensated_master_id ? (masterMap[adj.compensated_master_id] || null) : null,
      amount_dollars: (adj.amount_cents / 100).toFixed(2)
    }))

    return json({ adjustments: enriched, total, limit, offset })
  } catch (error) {
    console.error('[MASTER-ADJUSTMENTS] Error listing:', error.message)
    return json({ error: 'Internal server error' }, 500)
  }
}
