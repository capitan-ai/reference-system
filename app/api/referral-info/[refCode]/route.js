import prisma from '../../../../lib/prisma-client'

export async function GET(request, { params }) {
  try {
    const { refCode } = params

    if (!refCode) {
      return Response.json({ error: 'Referral code is required' }, { status: 400 })
    }

    // Find the referrer by their personal code
    const referrer = await prisma.$queryRaw`
      SELECT 
        given_name,
        family_name,
        email_address,
        personal_code,
        square_customer_id
      FROM square_existing_clients
      WHERE personal_code = ${refCode}
      LIMIT 1
    `

    if (!referrer || referrer.length === 0) {
      return Response.json({ 
        referrerName: null,
        found: false
      }, { status: 200 }) // Return 200 but with found: false so page can still show generic message
    }

    const customer = referrer[0]
    const referrerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || null

    return Response.json({
      referrerName: referrerName,
      found: true,
      code: refCode
    })

  } catch (error) {
    console.error('Error fetching referrer info:', error)
    return Response.json({ 
      error: 'Failed to fetch referrer information',
      referrerName: null,
      found: false
    }, { status: 500 })
  }
}
