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
        location_name: true,
        rating: true,
        source: true,
        issues: true,
        improve_text: true,
        submitted_at: true
      },
      orderBy: { submitted_at: 'desc' }
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
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 40px 30px;
      text-align: center;
    }
    .header h1 {
      font-size: 2.5em;
      margin-bottom: 10px;
      font-weight: 700;
    }
    .header p {
      font-size: 1.2em;
      opacity: 0.9;
    }
    .content {
      padding: 40px 30px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    .stat-card {
      background: #f8f9fa;
      padding: 25px;
      border-radius: 15px;
      text-align: center;
      border-left: 5px solid #667eea;
    }
    .stat-card h3 {
      color: #666;
      font-size: 0.9em;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .stat-card .value {
      font-size: 2.5em;
      font-weight: 700;
      color: #667eea;
    }
    .section {
      margin-bottom: 40px;
    }
    .section-title {
      font-size: 1.5em;
      color: #667eea;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 3px solid #667eea;
      font-weight: 700;
    }
    .rating-bars {
      display: space-between;
    }
    .rating-bar {
      display: flex;
      align-items: center;
      margin-bottom: 15px;
      gap: 15px;
    }
    .rating-label {
      font-weight: 600;
      width: 60px;
      color: #333;
    }
    .rating-bar-fill {
      flex: 1;
      height: 30px;
      background: #f0f0f0;
      border-radius: 8px;
      overflow: hidden;
      position: relative;
    }
    .rating-bar-fill.star5 { background: linear-gradient(90deg, #FFD700 0%, #FFA500 100%); }
    .rating-bar-fill.star4 { background: linear-gradient(90deg, #90EE90 0%, #32CD32 100%); }
    .rating-bar-fill.star3 { background: linear-gradient(90deg, #87CEEB 0%, #4169E1 100%); }
    .rating-bar-fill.star2 { background: linear-gradient(90deg, #FFB6C1 0%, #FF69B4 100%); }
    .rating-bar-fill.star1 { background: linear-gradient(90deg, #FF6347 0%, #DC143C 100%); }
    .rating-bar-fill.fill {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 10px;
      color: white;
      font-weight: 600;
      font-size: 0.9em;
    }
    .masters-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 15px;
    }
    .master-card {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      border-radius: 12px;
      text-align: center;
    }
    .master-card .rank {
      font-size: 2em;
      margin-bottom: 10px;
    }
    .master-card h4 {
      font-size: 1.1em;
      margin-bottom: 8px;
    }
    .master-card p {
      opacity: 0.9;
      font-size: 0.95em;
    }
    .issues-list {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .issue-tag {
      background: #f0f0f0;
      padding: 8px 15px;
      border-radius: 20px;
      font-size: 0.95em;
      color: #667eea;
      font-weight: 600;
    }
    .feedback-list {
      display: grid;
      gap: 15px;
    }
    .feedback-item {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 12px;
      border-left: 5px solid #667eea;
    }
    .feedback-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .feedback-header h4 {
      color: #333;
      font-size: 1.1em;
    }
    .feedback-time {
      color: #999;
      font-size: 0.9em;
    }
    .feedback-rating {
      color: #FFD700;
      font-size: 1.2em;
      letter-spacing: 2px;
    }
    .feedback-meta {
      color: #666;
      font-size: 0.95em;
      margin: 8px 0;
    }
    .feedback-comment {
      color: #333;
      font-style: italic;
      margin-top: 10px;
      padding: 10px;
      background: white;
      border-radius: 8px;
      border-left: 3px solid #667eea;
    }
    .footer {
      text-align: center;
      color: #999;
      font-size: 0.9em;
      padding-top: 20px;
      border-top: 1px solid #eee;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Daily Feedback Report</h1>
      <p>${dateStr}</p>
    </div>

    <div class="content">
      <!-- Key Stats -->
      <div class="stats-grid">
        <div class="stat-card">
          <h3>📝 Total Feedback</h3>
          <div class="value">${feedback.length}</div>
        </div>
        <div class="stat-card">
          <h3>⭐ Average Rating</h3>
          <div class="value">${avgRating}</div>
        </div>
        <div class="stat-card">
          <h3>😊 Positive Rate</h3>
          <div class="value">${positiveRate}%</div>
        </div>
      </div>

      <!-- Rating Distribution -->
      <div class="section">
        <h2 class="section-title">Rating Distribution</h2>
        <div class="rating-bars">
          <div class="rating-bar">
            <span class="rating-label">5⭐</span>
            <div class="rating-bar-fill star5">
              <div class="fill" style="width: ${(ratingDist[5] / feedback.length) * 100}%">${ratingDist[5]}</div>
            </div>
          </div>
          <div class="rating-bar">
            <span class="rating-label">4⭐</span>
            <div class="rating-bar-fill star4">
              <div class="fill" style="width: ${(ratingDist[4] / feedback.length) * 100}%">${ratingDist[4]}</div>
            </div>
          </div>
          <div class="rating-bar">
            <span class="rating-label">3⭐</span>
            <div class="rating-bar-fill star3">
              <div class="fill" style="width: ${(ratingDist[3] / feedback.length) * 100}%">${ratingDist[3]}</div>
            </div>
          </div>
          <div class="rating-bar">
            <span class="rating-label">2⭐</span>
            <div class="rating-bar-fill star2">
              <div class="fill" style="width: ${(ratingDist[2] / feedback.length) * 100}%">${ratingDist[2]}</div>
            </div>
          </div>
          <div class="rating-bar">
            <span class="rating-label">1⭐</span>
            <div class="rating-bar-fill star1">
              <div class="fill" style="width: ${(ratingDist[1] / feedback.length) * 100}%">${ratingDist[1]}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Top Masters -->
      ${topMasters.length > 0 ? `
      <div class="section">
        <h2 class="section-title">👑 Top Masters</h2>
        <div class="masters-grid">
          ${topMasters.map((master, i) => {
            const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣']
            return `
            <div class="master-card">
              <div class="rank">${medals[i]}</div>
              <h4>${master.name}</h4>
              <p>${master.count} feedback • ${master.avgRating}⭐</p>
            </div>
            `
          }).join('')}
        </div>
      </div>
      ` : ''}

      <!-- Top Issues -->
      ${topIssues.length > 0 ? `
      <div class="section">
        <h2 class="section-title">🎯 Top Feedback Topics</h2>
        <div class="issues-list">
          ${topIssues.map(([issue, count]) =>
            `<div class="issue-tag">${issue}: ${count}</div>`
          ).join('')}
        </div>
      </div>
      ` : ''}

      <!-- Recent Feedback -->
      <div class="section">
        <h2 class="section-title">Recent Submissions</h2>
        <div class="feedback-list">
          ${feedback.slice(0, 8).map(f => {
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
                👨‍💼 <strong>${f.master_name}</strong>
                ${f.admin_name ? ` • Admin: <strong>${f.admin_name}</strong>` : ''}
                ${f.location_name ? ` • ${f.location_name}` : ''}
              </div>
              ${f.improve_text ? `<div class="feedback-comment">"${f.improve_text}"</div>` : ''}
            </div>
            `
          }).join('')}
        </div>
        ${feedback.length > 8 ? `<p style="text-align: center; margin-top: 20px; color: #999;">... and ${feedback.length - 8} more</p>` : ''}
      </div>

      <div class="footer">
        <p>Generated at ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' })} PDT</p>
      </div>
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
