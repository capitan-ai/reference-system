import db from '../../../../lib/prisma-client'

export const dynamic = 'force-dynamic'

async function sendTelegramMessage(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!botToken || !chatId) {
    console.error('Telegram credentials not configured')
    return false
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
      })
    })

    if (!response.ok) {
      console.error('Telegram API error:', await response.text())
      return false
    }
    return true
  } catch (err) {
    console.error('Error sending Telegram message:', err.message)
    return false
  }
}

export async function POST(request) {
  try {
    const orgId = process.env.ZORINA_ORG_ID
    if (!orgId) {
      return Response.json({ error: 'ZORINA_ORG_ID not configured' }, { status: 500 })
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
        location_name: true,
        rating: true,
        source: true,
        issues: true,
        improve_text: true,
        submitted_at: true
      },
      orderBy: { submitted_at: 'desc' }
    })

    if (feedback.length === 0) {
      const msg = `📊 <b>Daily Feedback Report</b>\n\n📅 ${startOfDay.toLocaleDateString('en-US')}\n\n❌ No feedback received today`
      await sendTelegramMessage(msg)
      return Response.json({ message: 'No feedback today', count: 0 })
    }

    // Calculate statistics
    const ratings = feedback.filter(f => f.rating).map(f => f.rating)
    const avgRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b) / ratings.length).toFixed(1) : 'N/A'

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
      .map(([issue, count]) => `${issue}: ${count}`)
      .join(', ') || 'None'

    // Count ratings distribution
    const ratingDist = {
      5: feedback.filter(f => f.rating === 5).length,
      4: feedback.filter(f => f.rating === 4).length,
      3: feedback.filter(f => f.rating === 3).length,
      2: feedback.filter(f => f.rating === 2).length,
      1: feedback.filter(f => f.rating === 1).length
    }

    // Build table
    let table = '<b>Today\'s Feedback Summary</b>\n'
    table += `📊 Total: ${feedback.length} | ⭐ Avg: ${avgRating}\n\n`
    table += '<b>Rating Distribution:</b>\n'
    table += `5⭐ ${ratingDist[5]} | 4⭐ ${ratingDist[4]} | 3⭐ ${ratingDist[3]} | 2⭐ ${ratingDist[2]} | 1⭐ ${ratingDist[1]}\n\n`
    table += `<b>Top Issues:</b> ${topIssues}\n\n`
    table += '<b>Detailed Feedback:</b>\n'

    // Add individual feedback (limit to last 10)
    const recentFeedback = feedback.slice(0, 10)
    recentFeedback.forEach((f, i) => {
      const star = f.rating ? '⭐'.repeat(f.rating) : '?'
      const time = new Date(f.submitted_at).toLocaleTimeString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit'
      })
      table += `${i + 1}. ${f.customer_name} @ ${f.location_name || '?'} [${time}]\n`
      table += `   ${star} ${f.master_name}\n`
      if (f.improve_text) {
        table += `   💬 ${f.improve_text.substring(0, 50)}\n`
      }
    })

    if (feedback.length > 10) {
      table += `\n... and ${feedback.length - 10} more`
    }

    const success = await sendTelegramMessage(table)

    return Response.json({
      success,
      count: feedback.length,
      avgRating,
      topIssues: issueCount
    }, { status: 200 })
  } catch (err) {
    console.error('Error generating daily report:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
