import { getUserFromRequest } from '../../../../../lib/auth/check-access'
import db from '../../../../../lib/prisma-client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/master-adjustments/[id]
 * Returns a single adjustment with its associated ledger entries.
 */
export async function GET(request, { params }) {
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

    // Fetch associated ledger entries
    let ledgerEntries = []
    if (adjustment.ledger_entry_ids.length > 0) {
      ledgerEntries = await db.masterEarningsLedger.findMany({
        where: { id: { in: adjustment.ledger_entry_ids } }
      })
    }

    // Fetch master names
    const masterIds = new Set()
    if (adjustment.fault_master_id) masterIds.add(adjustment.fault_master_id)
    if (adjustment.compensated_master_id) masterIds.add(adjustment.compensated_master_id)
    for (const entry of ledgerEntries) {
      if (entry.team_member_id) masterIds.add(entry.team_member_id)
    }

    const masters = masterIds.size > 0
      ? await db.teamMember.findMany({
          where: { id: { in: [...masterIds] } },
          select: { id: true, given_name: true, family_name: true }
        })
      : []
    const masterMap = Object.fromEntries(masters.map(m => [m.id, `${m.given_name || ''} ${m.family_name || ''}`.trim()]))

    return Response.json({
      adjustment: {
        ...adjustment,
        fault_master_name: adjustment.fault_master_id ? masterMap[adjustment.fault_master_id] : null,
        compensated_master_name: adjustment.compensated_master_id ? masterMap[adjustment.compensated_master_id] : null,
        amount_dollars: (adjustment.amount_cents / 100).toFixed(2)
      },
      ledger_entries: ledgerEntries.map(e => ({
        ...e,
        master_name: masterMap[e.team_member_id] || null,
        amount_dollars: (e.amount_amount / 100).toFixed(2)
      }))
    })
  } catch (error) {
    console.error('[MASTER-ADJUSTMENTS] Error fetching:', error.message)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
