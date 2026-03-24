import { getUserFromRequest } from '../../../../../../lib/auth/check-access'
import db from '../../../../../../lib/prisma-client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/master-adjustments/[id]/void
 * Voids an adjustment by creating compensating REVERSAL entries (never deletes ledger rows).
 */
export async function POST(request, { params }) {
  const user = await getUserFromRequest(request)
  if (!user || user.error) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const orgUser = await db.organizationUser.findFirst({
    where: { user_id: user.id, role: { in: ['owner', 'admin', 'super_admin'] } }
  })
  if (!orgUser) {
    return Response.json({ error: 'Admin access required' }, { status: 403 })
  }

  try {
    const { id } = await params
    const adjustment = await db.masterAdjustment.findUnique({ where: { id } })

    if (!adjustment) {
      return Response.json({ error: 'Adjustment not found' }, { status: 404 })
    }

    if (adjustment.status === 'VOIDED') {
      return Response.json({ error: 'Adjustment is already voided' }, { status: 400 })
    }

    if (adjustment.status !== 'APPLIED') {
      return Response.json({ error: 'Only APPLIED adjustments can be voided' }, { status: 400 })
    }

    // Get the original ledger entries
    const originalEntries = adjustment.ledger_entry_ids.length > 0
      ? await db.masterEarningsLedger.findMany({
          where: { id: { in: adjustment.ledger_entry_ids } }
        })
      : []

    const result = await db.$transaction(async (tx) => {
      const reversalIds = []

      // Create compensating reversal entries
      for (const entry of originalEntries) {
        const reversal = await tx.masterEarningsLedger.create({
          data: {
            organization_id: entry.organization_id,
            team_member_id: entry.team_member_id,
            booking_id: entry.booking_id,
            entry_type: 'REVERSAL',
            amount_amount: -entry.amount_amount,
            source_engine: 'ADMIN_VOID',
            meta_json: {
              voided_adjustment_id: adjustment.id,
              voided_entry_id: entry.id,
              voided_entry_type: entry.entry_type,
              voided_amount: entry.amount_amount,
              voided_by: user.id
            }
          }
        })
        reversalIds.push(reversal.id)
      }

      // Mark adjustment as voided
      const updated = await tx.masterAdjustment.update({
        where: { id: adjustment.id },
        data: { status: 'VOIDED' }
      })

      return { adjustment: updated, reversals_created: reversalIds.length }
    })

    return Response.json({
      success: true,
      message: 'Adjustment voided successfully',
      adjustment_id: result.adjustment.id,
      reversals_created: result.reversals_created
    })
  } catch (error) {
    console.error('[MASTER-ADJUSTMENTS] Error voiding:', error.message)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
