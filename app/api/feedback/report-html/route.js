import db from '../../../../lib/prisma-client'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const orgId = process.env.ZORINA_ORG_ID
    if (!orgId) {
      return new Response('ZORINA_ORG_ID not configured', { status: 500 })
    }

    const now = new Date()
    const pstDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
    const startOfDay = new Date(pstDate.getFullYear(), pstDate.getMonth(), pstDate.getDate())
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(startOfDay.getTime() - 7 * 24 * 60 * 60 * 1000)

    const selectFields = {
      customer_name: true, master_name: true, admin_name: true,
      location_id: true, location_name: true, rating: true,
      source: true, issues: true, improve_text: true, submitted_at: true
    }

    const feedback = await db.customerFeedback.findMany({
      where: { organization_id: orgId, submitted_at: { gte: startOfDay, lt: endOfDay } },
      select: selectFields,
      orderBy: { submitted_at: 'desc' }
    })

    const priorFeedback = await db.customerFeedback.findMany({
      where: { organization_id: orgId, submitted_at: { gte: sevenDaysAgo, lt: startOfDay } },
      select: { rating: true }
    })

    const locations = await db.location.findMany({
      where: { organization_id: orgId },
      select: { id: true, name: true }
    })
    const locationMap = new Map(locations.map(l => [l.id, l.name]))
    feedback.forEach(f => { if (!f.location_name && f.location_id) f.location_name = locationMap.get(f.location_id) })

    const ratings = feedback.filter(f => f.rating).map(f => f.rating)
    const avgRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0
    const avgRatingStr = ratings.length > 0 ? avgRating.toFixed(1) : 'N/A'

    const ratingDist = {
      5: feedback.filter(f => f.rating === 5).length,
      4: feedback.filter(f => f.rating === 4).length,
      3: feedback.filter(f => f.rating === 3).length,
      2: feedback.filter(f => f.rating === 2).length,
      1: feedback.filter(f => f.rating === 1).length
    }
    const positiveRate = feedback.length > 0 ? Math.round(((ratingDist[5] + ratingDist[4]) / feedback.length) * 100) : 0
    const negativeCount = ratingDist[1] + ratingDist[2]

    const priorRatings = priorFeedback.filter(f => f.rating).map(f => f.rating)
    const priorAvg = priorRatings.length > 0 ? (priorRatings.reduce((a, b) => a + b, 0) / priorRatings.length) : 0
    const ratingDelta = priorAvg > 0 ? (avgRating - priorAvg) : 0
    const priorDailyAvgCount = priorRatings.length > 0 ? (priorFeedback.length / 7) : 0

    const masterStats = {}
    feedback.forEach(f => {
      if (!f.master_name) return
      if (!masterStats[f.master_name]) masterStats[f.master_name] = { count: 0, totalRating: 0, low: 0 }
      masterStats[f.master_name].count++
      masterStats[f.master_name].totalRating += f.rating || 0
      if (f.rating && f.rating <= 3) masterStats[f.master_name].low++
    })
    const masters = Object.entries(masterStats)
      .map(([name, s]) => ({ name, count: s.count, avgRating: (s.totalRating / s.count).toFixed(1), low: s.low }))
      .sort((a, b) => b.count - a.count)

    const sourceStats = {}
    feedback.forEach(f => {
      const src = f.source || 'Unknown'
      if (!sourceStats[src]) sourceStats[src] = { count: 0, totalRating: 0 }
      sourceStats[src].count++
      sourceStats[src].totalRating += f.rating || 0
    })
    const sources = Object.entries(sourceStats)
      .map(([name, s]) => ({ name, count: s.count, avgRating: (s.totalRating / s.count).toFixed(1), pct: feedback.length > 0 ? Math.round((s.count / feedback.length) * 100) : 0 }))
      .sort((a, b) => b.count - a.count)

    const locStats = {}
    feedback.forEach(f => {
      const loc = f.location_name || 'Unknown'
      if (!locStats[loc]) locStats[loc] = { count: 0, totalRating: 0 }
      locStats[loc].count++
      locStats[loc].totalRating += f.rating || 0
    })
    const locs = Object.entries(locStats)
      .map(([name, s]) => ({ name, count: s.count, avgRating: (s.totalRating / s.count).toFixed(1) }))
      .sort((a, b) => b.count - a.count)

    const issueCount = {}
    feedback.forEach(f => {
      if (f.issues && Array.isArray(f.issues)) f.issues.forEach(issue => { issueCount[issue] = (issueCount[issue] || 0) + 1 })
    })
    const topIssues = Object.entries(issueCount).sort((a, b) => b[1] - a[1])

    const needsAttention = feedback.filter(f => f.rating && f.rating <= 3).sort((a, b) => a.rating - b.rating)

    // All submissions that include a written comment
    const comments = feedback.filter(f => f.improve_text && f.improve_text.trim())

    const maxRating = Math.max(1, ...Object.values(ratingDist))
    const dateStr = startOfDay.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

    const fmtDelta = (d) => {
      if (Math.abs(d) < 0.05) return '<span class="delta flat">no change vs 7-day avg</span>'
      const arrow = d > 0 ? '&#9650;' : '&#9660;'
      const cls = d > 0 ? 'up' : 'down'
      return `<span class="delta ${cls}">${arrow} ${Math.abs(d).toFixed(1)} vs 7-day avg</span>`
    }

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Feedback Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --accent: #6366F1; --accent-soft: #EEF0FE; --bg: #F9FAFB; --card: #FFFFFF;
      --border: #EAECEF; --text: #111827; --muted: #6B7280; --faint: #9CA3AF;
      --green: #16A34A; --red: #DC2626; --amber: #D97706;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg); min-height: 100vh; padding: 32px 20px;
      color: var(--text); font-size: 15px; line-height: 1.45;
    }
    .container { max-width: 980px; margin: 0 auto; }
    .header { margin-bottom: 24px; }
    .header .eyebrow { font-size: 0.72em; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); margin-bottom: 6px; }
    .header h1 { font-size: 1.9em; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 4px; }
    .header p { color: var(--muted); }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin-bottom: 20px; }
    .stat-card { background: var(--card); padding: 18px 20px; border-radius: 14px; border: 1px solid var(--border); box-shadow: 0 1px 2px rgba(16,24,40,0.04); }
    .stat-card h3 { color: var(--muted); font-size: 0.7em; font-weight: 600; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
    .stat-card .value { font-size: 2em; font-weight: 700; letter-spacing: -0.02em; }
    .stat-card .sub { font-size: 0.78em; margin-top: 6px; color: var(--faint); }
    .delta { font-size: 0.92em; font-weight: 600; }
    .delta.up { color: var(--green); } .delta.down { color: var(--red); } .delta.flat { color: var(--faint); }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 22px; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(16,24,40,0.04); }
    .section-title { font-size: 1em; font-weight: 700; margin-bottom: 16px; }
    .section-title .note { font-weight: 400; color: var(--faint); font-size: 0.85em; margin-left: 6px; }
    .rating-bar { display: flex; align-items: center; margin-bottom: 10px; gap: 12px; }
    .rating-bar:last-child { margin-bottom: 0; }
    .rating-label { font-weight: 600; width: 52px; color: var(--muted); font-size: 0.85em; }
    .rating-track { flex: 1; height: 24px; background: #F3F4F6; border-radius: 6px; overflow: hidden; }
    .rating-fill { height: 100%; background: var(--accent); border-radius: 6px; display: flex; align-items: center; justify-content: flex-end; padding-right: 9px; color: #fff; font-weight: 600; font-size: 0.82em; min-width: 24px; }
    .rating-fill.low { background: #C7CBF5; }
    .rating-pct { width: 44px; text-align: right; color: var(--faint); font-size: 0.82em; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 0.72em; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; padding: 0 0 10px; border-bottom: 1px solid var(--border); }
    th.num, td.num { text-align: right; }
    td { padding: 11px 0; border-bottom: 1px solid var(--border); font-size: 0.95em; }
    tr:last-child td { border-bottom: none; }
    .name-cell { font-weight: 600; }
    .pill { display: inline-block; background: var(--accent-soft); color: var(--accent); padding: 2px 9px; border-radius: 12px; font-weight: 600; font-size: 0.85em; }
    .rating-good { color: var(--green); font-weight: 600; }
    .rating-mid { color: var(--amber); font-weight: 600; }
    .rating-bad { color: var(--red); font-weight: 600; }
    .flag { color: var(--red); font-weight: 600; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 700px) { .two-col { grid-template-columns: 1fr; } }
    .issues-list { display: flex; flex-wrap: wrap; gap: 8px; }
    .issue-tag { background: var(--accent-soft); padding: 6px 12px; border-radius: 8px; font-size: 0.9em; color: var(--accent); font-weight: 600; }
    .sub-item { padding: 14px 0; border-bottom: 1px solid var(--border); }
    .sub-item:last-child { border-bottom: none; padding-bottom: 0; }
    .sub-item:first-child { padding-top: 0; }
    .sub-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
    .sub-head h4 { font-size: 0.98em; font-weight: 600; }
    .sub-time { color: var(--faint); font-size: 0.82em; }
    .sub-rating { font-weight: 600; font-size: 0.9em; margin-bottom: 4px; }
    .sub-meta { color: var(--muted); font-size: 0.88em; }
    .sub-comment { color: var(--text); margin-top: 8px; padding: 10px 12px; background: var(--bg); border-radius: 8px; border-left: 3px solid var(--accent); font-size: 0.9em; }
    .sub-comment.neg { border-left-color: var(--red); }
    .comment-item { padding: 14px 0; border-bottom: 1px solid var(--border); }
    .comment-item:last-child { border-bottom: none; padding-bottom: 0; }
    .comment-item:first-child { padding-top: 0; }
    .comment-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px; }
    .comment-name { font-weight: 600; font-size: 0.95em; }
    .comment-rating { font-weight: 600; font-size: 0.85em; }
    .comment-meta { color: var(--faint); font-size: 0.82em; margin-bottom: 8px; }
    .comment-text { color: var(--text); padding: 10px 12px; background: var(--bg); border-radius: 8px; border-left: 3px solid var(--accent); font-size: 0.9em; }
    .comment-text.neg { border-left-color: var(--red); }
    .attention-banner { background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B; padding: 12px 16px; border-radius: 12px; margin-bottom: 16px; font-size: 0.92em; font-weight: 500; }
    .empty { text-align: center; color: var(--muted); padding: 40px 0; }
    .footer { text-align: center; color: var(--faint); font-size: 0.8em; padding: 14px 0 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="eyebrow">Studio Zorina</div>
      <h1>Daily Feedback Report</h1>
      <p>${dateStr}</p>
    </div>
    ${feedback.length === 0 ? `<div class="card empty">No feedback received today.</div>` : `
      ${negativeCount > 0 ? `<div class="attention-banner">${negativeCount} submission${negativeCount > 1 ? 's' : ''} rated 2 stars or below today &mdash; see "Needs Attention" below.</div>` : ''}
      <div class="stats-grid">
        <div class="stat-card"><h3>Total Feedback</h3><div class="value">${feedback.length}</div><div class="sub">${priorDailyAvgCount > 0 ? `${priorDailyAvgCount.toFixed(1)} avg/day last 7 days` : 'no prior data'}</div></div>
        <div class="stat-card"><h3>Average Rating</h3><div class="value">${avgRatingStr}</div><div class="sub">${priorAvg > 0 ? fmtDelta(ratingDelta) : 'no prior data'}</div></div>
        <div class="stat-card"><h3>Positive Rate</h3><div class="value">${positiveRate}%</div><div class="sub">${ratingDist[5] + ratingDist[4]} of ${feedback.length} rated 4&ndash;5</div></div>
        <div class="stat-card"><h3>Low Ratings</h3><div class="value">${negativeCount}</div><div class="sub">1&ndash;2 star submissions</div></div>
      </div>
      <div class="card">
        <h2 class="section-title">Rating Distribution</h2>
        ${[5, 4, 3, 2, 1].map(star => {
          const count = ratingDist[star]
          const width = (count / maxRating) * 100
          const pct = feedback.length > 0 ? Math.round((count / feedback.length) * 100) : 0
          return `<div class="rating-bar"><span class="rating-label">${star} star</span><div class="rating-track">${count > 0 ? `<div class="rating-fill ${star <= 3 ? 'low' : ''}" style="width: ${width}%">${count}</div>` : ''}</div><span class="rating-pct">${pct}%</span></div>`
        }).join('')}
      </div>
      <div class="two-col">
        ${masters.length > 0 ? `<div class="card"><h2 class="section-title">By Master</h2><table><thead><tr><th>Master</th><th class="num">Count</th><th class="num">Avg</th><th class="num">Low</th></tr></thead><tbody>${masters.map(m => {
          const r = parseFloat(m.avgRating)
          const rc = r >= 4.5 ? 'rating-good' : r >= 4 ? 'rating-mid' : 'rating-bad'
          return `<tr><td class="name-cell">${m.name}</td><td class="num">${m.count}</td><td class="num ${rc}">${m.avgRating}</td><td class="num ${m.low > 0 ? 'flag' : ''}">${m.low || '&mdash;'}</td></tr>`
        }).join('')}</tbody></table></div>` : ''}
        ${sources.length > 0 ? `<div class="card"><h2 class="section-title">By Source</h2><table><thead><tr><th>Source</th><th class="num">Count</th><th class="num">Share</th><th class="num">Avg</th></tr></thead><tbody>${sources.map(s => `<tr><td class="name-cell">${s.name}</td><td class="num">${s.count}</td><td class="num"><span class="pill">${s.pct}%</span></td><td class="num">${s.avgRating}</td></tr>`).join('')}</tbody></table></div>` : ''}
      </div>
      ${locs.length > 1 ? `<div class="card"><h2 class="section-title">By Location</h2><table><thead><tr><th>Location</th><th class="num">Count</th><th class="num">Avg Rating</th></tr></thead><tbody>${locs.map(l => `<tr><td class="name-cell">${l.name}</td><td class="num">${l.count}</td><td class="num">${l.avgRating}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${comments.length > 0 ? `<div class="card"><h2 class="section-title">Comments<span class="note">${comments.length} with written feedback</span></h2>${comments.map(f => {
        const r = f.rating || 0
        const rc = r >= 4 ? 'rating-good' : r === 3 ? 'rating-mid' : 'rating-bad'
        return `<div class="comment-item"><div class="comment-head"><span class="comment-name">${f.customer_name}</span><span class="comment-rating ${rc}">${f.rating ? f.rating + ' / 5' : 'No rating'}</span></div><div class="comment-meta">${f.master_name}${f.source ? ` &middot; ${f.source}` : ''}</div><div class="comment-text ${r > 0 && r <= 3 ? 'neg' : ''}">"${f.improve_text}"</div></div>`
      }).join('')}</div>` : ''}
      ${topIssues.length > 0 ? `<div class="card"><h2 class="section-title">Feedback Topics<span class="note">issues flagged by customers</span></h2><div class="issues-list">${topIssues.map(([issue, count]) => `<div class="issue-tag">${issue}: ${count}</div>`).join('')}</div></div>` : ''}
      ${needsAttention.length > 0 ? `<div class="card"><h2 class="section-title">Needs Attention<span class="note">rated 3 stars or below</span></h2>${needsAttention.map(f => {
        const time = new Date(f.submitted_at).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' })
        return `<div class="sub-item"><div class="sub-head"><h4>${f.customer_name}</h4><span class="sub-time">${time}</span></div><div class="sub-rating rating-bad">${f.rating} / 5</div><div class="sub-meta">${f.master_name}${f.admin_name ? ` &middot; Admin: ${f.admin_name}` : ''}${f.location_name ? ` &middot; ${f.location_name}` : ''}${f.source ? ` &middot; ${f.source}` : ''}</div>${f.improve_text ? `<div class="sub-comment neg">"${f.improve_text}"</div>` : ''}</div>`
      }).join('')}</div>` : ''}
      <div class="card"><h2 class="section-title">All Submissions<span class="note">${feedback.length} total</span></h2>${feedback.map(f => {
        const time = new Date(f.submitted_at).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' })
        const r = f.rating || 0
        const rc = r >= 4 ? 'rating-good' : r === 3 ? 'rating-mid' : 'rating-bad'
        return `<div class="sub-item"><div class="sub-head"><h4>${f.customer_name}</h4><span class="sub-time">${time}</span></div><div class="sub-rating ${rc}">${f.rating ? f.rating + ' / 5' : 'No rating'}</div><div class="sub-meta">${f.master_name}${f.admin_name ? ` &middot; Admin: ${f.admin_name}` : ''}${f.location_name ? ` &middot; ${f.location_name}` : ''}${f.source ? ` &middot; ${f.source}` : ''}</div>${f.improve_text ? `<div class="sub-comment">"${f.improve_text}"</div>` : ''}</div>`
      }).join('')}</div>
    `}
    <div class="footer">Generated ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</div>
  </div>
</body>
</html>
    `

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' }
    })
  } catch (err) {
    console.error('Error generating report:', err.message)
    return new Response(`Error: ${err.message}`, { status: 500 })
  }
}
