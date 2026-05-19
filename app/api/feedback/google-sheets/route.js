import db from '../../../../lib/prisma-client'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const orgId = process.env.ZORINA_ORG_ID
    if (!orgId) {
      return Response.json({ error: 'ZORINA_ORG_ID not configured' }, { status: 500 })
    }

    // Fetch all feedback
    const feedback = await db.customerFeedback.findMany({
      where: { organization_id: orgId },
      select: {
        customer_name: true,
        master_name: true,
        admin_name: true,
        location_name: true,
        rating: true,
        source: true,
        source_other_detail: true,
        issues: true,
        improve_text: true,
        awareness: true,
        service_date: true,
        submitted_at: true
      },
      orderBy: { submitted_at: 'desc' }
    })

    // Calculate statistics
    const ratings = feedback.filter(f => f.rating).map(f => f.rating)
    const avgRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b) / ratings.length).toFixed(1) : 0

    const ratingDist = {
      5: feedback.filter(f => f.rating === 5).length,
      4: feedback.filter(f => f.rating === 4).length,
      3: feedback.filter(f => f.rating === 3).length,
      2: feedback.filter(f => f.rating === 2).length,
      1: feedback.filter(f => f.rating === 1).length
    }

    // Count issues
    const issueCount = {}
    feedback.forEach(f => {
      if (f.issues && Array.isArray(f.issues)) {
        f.issues.forEach(issue => {
          issueCount[issue] = (issueCount[issue] || 0) + 1
        })
      }
    })

    const topIssues = Object.entries(issueCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([issue, count]) => ({ issue, count }))

    // Count by technician
    const technicianCount = {}
    feedback.forEach(f => {
      if (f.master_name) {
        technicianCount[f.master_name] = (technicianCount[f.master_name] || 0) + 1
      }
    })

    const topTechnicians = Object.entries(technicianCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }))

    return Response.json({
      total: feedback.length,
      avgRating: parseFloat(avgRating),
      ratingDist,
      topIssues,
      topTechnicians,
      feedback: feedback.map(f => ({
        customer: f.customer_name,
        master: f.master_name,
        admin: f.admin_name,
        location: f.location_name,
        rating: f.rating,
        source: f.source,
        source_other_detail: f.source_other_detail,
        issues: f.issues ? f.issues.join(', ') : '',
        comment: f.improve_text,
        awareness: f.awareness,
        date: f.service_date,
        time: f.submitted_at
      }))
    }, { status: 200 })
  } catch (err) {
    console.error('Error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
