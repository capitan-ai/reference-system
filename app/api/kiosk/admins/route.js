// Public kiosk endpoint: returns active front desk administrators for staff selector.
// Used by public/feedback/index.html admin form to show "Who are you today?" pills.

import db from '../../../../lib/prisma-client'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const orgId = process.env.ZORINA_ORG_ID
    if (!orgId) {
      return Response.json({ error: 'ZORINA_ORG_ID not configured' }, { status: 500 })
    }

    const admins = await db.teamMember.findMany({
      where: {
        organization_id: orgId,
        role: {
          in: ['ADMIN', 'MANAGER', 'TOP_MASTER'],
        },
        status: 'ACTIVE',
        is_system: false,
      },
      select: {
        id: true,
        given_name: true,
        family_name: true,
      },
      orderBy: [{ given_name: 'asc' }],
    })

    return Response.json({ admins })
  } catch (err) {
    console.error('Error loading admins:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
