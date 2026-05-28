import db from '../../../../lib/prisma-client'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const orgId = process.env.ZORINA_ORG_ID
    if (!orgId) {
      return new Response('ZORINA_ORG_ID not configured', { status: 500 })
    }

    // Get today's date in Pacific timezone
    const now = new Date()
    const pstDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
    const startOfDay = new Date(pstDate.getFullYear(), pstDate.getMonth(), pstDate.getDate())
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000)

    // Fetch today's feedback
    const feedback = await db.customerFeedback.findMany({
      where: {
        organization_id: orgId,
        submitted_at: {
          gte: startOfDay,
          lt: endOfDay
        }
      },
      select: {
        customer_name: true,
        master_name: true,
        admin_name: true,
        location_id: true,
        location_name: true,
        rating: true,
        source: true,
        issues: true,
        improve_text: true,
        submitted_at: true
      },
      orderBy: { submitted_at: 'desc' }
    })

    // Fetch all locations to map IDs to names (for entries where location_name is NULL)
    const locations = await db.location.findMany({
      where: { organization_id: orgId },
      select: { id: true, name: true }
    })
    const locationMap = new Map(locations.map(l => [l.id, l.name]))

    // Ensure all feedback entries have location names
    feedback.forEach(f => {
      if (!f.location_name && f.location_id) {
        f.location_name = locationMap.get(f.location_id)
      }
    })

    // Calculate statistics
    const ratings = feedback.filter(f => f.rating).map(f => f.rating)
    const avgRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b) / ratings.length).toFixed(1) : 'N/A'

    const ratingDist = {
      5: feedback.filter(f => f.rating === 5).length,
      4: feedback.filter(f => f.rating === 4).length,
      3: feedback.filter(f => f.rating === 3).length,
      2: feedback.filter(f => f.rating === 2).length,
      1: feedback.filter(f => f.rating === 1).length
    }

    const positiveRate = feedback.length > 0 ? Math.round(((ratingDist[5] + ratingDist[4]) / feedback.length) * 100) : 0

    // Calculate top masters
    const masterStats = {}
    feedback.forEach(f => {
      if (f.master_name) {
        if (!masterStats[f.master_name]) {
          masterStats[f.master_name] = { count: 0, totalRating: 0 }
        }
        masterStats[f.master_name].count++
        masterStats[f.master_name].totalRating += f.rating || 0
      }
    })

    const topMasters = Object.entries(masterStats)
      .map(([name, stats]) => ({
        name,
        count: stats.count,
        avgRating: (stats.totalRating / stats.count).toFixed(1)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    // Calculate source breakdown
    const sourceStats = {}
    feedback.forEach(f => {
      const src = f.source || 'Unknown'
      if (!sourceStats[src]) {
        sourceStats[src] = { count: 0, totalRating: 0 }
      }
      sourceStats[src].count++
      sourceStats[src].totalRating += f.rating || 0
    })

    const topSources = Object.entries(sourceStats)
      .map(([name, stats]) => ({
        name,
        count: stats.count,
        avgRating: (stats.totalRating / stats.count).toFixed(1),
        pct: feedback.length > 0 ? Math.round((stats.count / feedback.length) * 100) : 0
      }))
      .sort((a, b) => b.count - a.count)

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
      .slice(0, 5)

    const maxRating = Math.max(1, ...Object.values(ratingDist))

    // Build HTML
    const dateStr = startOfDay.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Feedback Report</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    :root {
      --accent: #6366F1;
      --accent-soft: #EEF0FE;
      --bg: #F9FAFB;
      --card: #FFFFFF;
      --border: #EAECEF;
      --text: #111827;
      --muted: #6B7280;
      --green: #16A34A;
      --green-soft: #DCFCE7;
      --amber: #D97706;
      --red: #DC2626;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: var(--bg);
      min-height: 100vh;
      padding: 32px 20px;
      color: var(--text);
    }
    .container {
      max-width: 960px;
      margin: 0 auto;
    }
    .header {
      margin-bottom: 28px;
    }
    .header .eyebrow {
      font-size: 0.8em;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 6px;
    }
    .header h1 {
      font-size: 2em;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 4px;
    }
    .header p {
      color: var(--muted);
      font-size: 1em;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .stat-card {
      background: var(--card);
      padding: 22px;
      border-radius: 16px;
      border: 1px solid var(--border);
      box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
    }
    .stat-card h3 {
      color: var(--muted);
      font-size: 0.72em;
      font-weight: 600;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .stat-card .value {
      font-size: 2.2em;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text);
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
    }
    .section-title {
      font-size: 1.05em;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin-bottom: 18px;
      color: var(--text);
    }
    /* Rating bars */
    .rating-bar {
      display: flex;
      align-items: center;
      margin-bottom: 12px;
      gap: 14px;
    }
    .rating-bar:last-child { margin-bottom: 0; }
    .rating-label {
      font-weight: 600;
      width: 42px;
      color: var(--muted);
      font-size: 0.9em;
    }
    .rating-track {
      flex: 1;
      height: 28px;
      background: #F3F4F6;
      border-radius: 8px;
      overflow: hidden;
    }
    .rating-fill {
      height: 100%;
      background: var(--accent);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 10px;
      color: white;
      font-weight: 600;
      font-size: 0.85em;
      min-width: 28px;
      transition: width 0.3s ease;
    }
    .rating-fill.zero {
      background: transparent;
      color: var(--muted);
      justify-content: flex-start;
      padding-left: 10px;
      padding-right: 0;
    }
    /* Masters */
    .masters-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
    }
    .master-card {
      background: var(--bg);
      border: 1px solid var(--border);
      padding: 18px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .master-rank {
      font-size: 1.5em;
      flex-shrink: 0;
    }
    .master-info h4 {
      font-size: 1em;
      font-weight: 600;
      margin-bottom: 3px;
    }
    .master-info p {
      color: var(--muted);
      font-size: 0.88em;
    }
    /* Source table */
    .source-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid var(--border);
    }
    .source-row:last-child { border-bottom: none; }
    .source-name {
      font-weight: 600;
      font-size: 0.95em;
    }
    .source-meta {
      display: flex;
      align-items: center;
      gap: 16px;
      color: var(--muted);
      font-size: 0.9em;
    }
    .source-pill {
      background: var(--accent-soft);
      color: var(--accent);
      padding: 3px 10px;
      border-radius: 20px;
      font-weight: 600;
      font-size: 0.85em;
    }
    /* Issues */
    .issues-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .issue-tag {
      background: var(--accent-soft);
      padding: 7px 14px;
      border-radius: 8px;
      font-size: 0.9em;
      color: var(--accent);
      font-weight: 600;
    }
    /* Feedback list */
    .feedback-item {
      padding: 16px 0;
      border-bottom: 1px solid var(--border);
    }
    .feedback-item:last-child { border-bottom: none; padding-bottom: 0; }
    .feedback-item:first-child { padding-top: 0; }
    .feedback-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .feedback-header h4 {
      font-size: 1em;
      font-weight: 600;
    }
    .feedback-time {
      color: var(--muted);
      font-size: 0.85em;
    }
    .feedback-rating {
      font-size: 0.95em;
      letter-spacing: 1px;
      margin-bottom: 6px;
    }
    .feedback-meta {
      color: var(--muted);
      font-size: 0.9em;
    }
    .feedback-comment {
      color: var(--text);
      margin-top: 10px;
      padding: 12px 14px;
      background: var(--bg);
      border-radius: 10px;
      border-left: 3px solid var(--accent);
      font-size: 0.92em;
    }
    .empty {
      text-align: center;
      color: var(--muted);
      padding: 40px 0;
    }
    .footer {
      text-align: center;
      color: var(--muted);
      font-size: 0.82em;
      padding: 16px 0 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="eyebrow">Studio Zorina</div>
      <h1>Daily Feedback Report</h1>
      <p>${dateStr}</p>
    </div>

    ${feedback.length === 0 ? `
      <div class="card empty">No feedback received today.</div>
    ` : `
      <!-- Key Stats -->
      <div class="stats-grid">
        <div class="stat-card">
          <h3>Total Feedback</h3>
          <div class="value">${feedback.length}</div>
        </div>
        <div class="stat-card">
          <h3>Average Rating</h3>
          <div class="value">${avgRating}</div>
        </div>
        <div class="stat-card">
          <h3>Positive Rate</h3>
          <div class="value">${positiveRate}%</div>
        </div>
      </div>

      <!-- Rating Distribution -->
      <div class="card">
        <h2 class="section-title">Rating Distribution</h2>
        ${[5, 4, 3, 2, 1].map(star => {
          const count = ratingDist[star]
          const width = (count / maxRating) * 100
          return `
          <div class="rating-bar">
            <span class="rating-label">${star}★</span>
            <div class="rating-track">
              <div class="rating-fill ${count === 0 ? 'zero' : ''}" style="width: ${count === 0 ? 100 : width}%">${count}</div>
            </div>
          </div>
          `
        }).join('')}
      </div>

      ${topMasters.length > 0 ? `
      <div class="card">
        <h2 class="section-title">Top Masters</h2>
        <div class="masters-grid">
          ${topMasters.map((master, i) => {
            const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣']
            return `
            <div class="master-card">
              <div class="master-rank">${medals[i]}</div>
              <div class="master-info">
                <h4>${master.name}</h4>
                <p>${master.count} feedback • ${master.avgRating}★</p>
              </div>
            </div>
            `
          }).join('')}
        </div>
      </div>
      ` : ''}

      ${topSources.length > 0 ? `
      <div class="card">
        <h2 class="section-title">By Source</h2>
        ${topSources.map(s => `
          <div class="source-row">
            <span class="source-name">${s.name}</span>
            <div class="source-meta">
              <span>${s.avgRating}★ avg</span>
              <span>${s.count}</span>
              <span class="source-pill">${s.pct}%</span>
            </div>
          </div>
        `).join('')}
      </div>
      ` : ''}

      ${topIssues.length > 0 ? `
      <div class="card">
        <h2 class="section-title">Top Feedback Topics</h2>
        <div class="issues-list">
          ${topIssues.map(([issue, count]) =>
            `<div class="issue-tag">${issue}: ${count}</div>`
          ).join('')}
        </div>
      </div>
      ` : ''}

      <div class="card">
        <h2 class="section-title">All Submissions (${feedback.length})</h2>
        ${feedback.map(f => {
          const time = new Date(f.submitted_at).toLocaleTimeString('en-US', {
            timeZone: 'America/Los_Angeles',
            hour: '2-digit',
            minute: '2-digit'
          })
          const stars = f.rating ? '⭐'.repeat(f.rating) : '❓'
          return `
          <div class="feedback-item">
            <div class="feedback-header">
              <h4>${f.customer_name}</h4>
              <div class="feedback-time">${time}</div>
            </div>
            <div class="feedback-rating">${stars}</div>
            <div class="feedback-meta">
              ${f.master_name}${f.admin_name ? ` • Admin: ${f.admin_name}` : ''}${f.location_name ? ` • ${f.location_name}` : ''}
            </div>
            ${f.improve_text ? `<div class="feedback-comment">"${f.improve_text}"</div>` : ''}
          </div>
          `
        }).join('')}
      </div>
    `}

    <div class="footer">
      Generated at ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' })} PT
    </div>
  </div>
</body>
</html>
    `

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    })
  } catch (err) {
    console.error('Error generating report:', err.message)
    return new Response(`Error: ${err.message}`, { status: 500 })
  }
}
