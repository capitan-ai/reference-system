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
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] Daily report triggered`)

  try {
    const orgId = process.env.ZORINA_ORG_ID
    if (!orgId) {
      console.error(`[${timestamp}] ZORINA_ORG_ID not configured`)
      return Response.json({ error: 'ZORINA_ORG_ID not configured' }, { status: 500 })
    }

    // Get today's date in Pacific timezone
    const now = new Date()
    const pstDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
    const startOfDay = new Date(pstDate.getFullYear(), pstDate.getMonth(), pstDate.getDate())
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000)

    console.log(`[${timestamp}] Fetching feedback for: ${pstDate.toLocaleDateString('en-US')} Pacific`)
    console.log(`[${timestamp}] Date range: ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`)

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

    console.log(`[${timestamp}] Found ${feedback.length} feedback entries`)

    if (feedback.length === 0) {
      const msg = `📊 <b>Daily Feedback Report</b>\n\n📅 ${startOfDay.toLocaleDateString('en-US')}\n\n❌ No feedback received today`
      console.log(`[${timestamp}] Sending "no feedback" message to Telegram`)
      const sent = await sendTelegramMessage(msg)
      console.log(`[${timestamp}] Telegram send result: ${sent}`)
      return Response.json({ message: 'No feedback today', count: 0, telegramSent: sent })
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

    // Calculate top masters
    const masterStats = {}
    feedback.forEach(f => {
      if (f.master_name) {
        if (!masterStats[f.master_name]) {
          masterStats[f.master_name] = { count: 0, avgRating: 0, totalRating: 0 }
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
      .slice(0, 3)

    // Build beautiful report
    let table = '═══════════════════════════════════\n'
    table += '<b>📊 DAILY FEEDBACK REPORT</b>\n'
    table += `<b>${startOfDay.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</b>\n`
    table += '═══════════════════════════════════\n\n'

    // Key metrics
    table += '<b>KEY METRICS</b>\n'
    table += `📝 Total Feedback: <b>${feedback.length}</b>\n`
    table += `⭐ Average Rating: <b>${avgRating}</b>/5\n`
    table += `😊 Positive (4-5★): <b>${ratingDist[5] + ratingDist[4]}</b> (${Math.round(((ratingDist[5] + ratingDist[4]) / feedback.length) * 100)}%)\n\n`

    // Rating distribution with visual
    table += '<b>RATING BREAKDOWN</b>\n'
    table += `5⭐ ${ratingDist[5].toString().padStart(2)} ${generateBar(ratingDist[5], Math.max(...Object.values(ratingDist)))}\n`
    table += `4⭐ ${ratingDist[4].toString().padStart(2)} ${generateBar(ratingDist[4], Math.max(...Object.values(ratingDist)))}\n`
    table += `3⭐ ${ratingDist[3].toString().padStart(2)} ${generateBar(ratingDist[3], Math.max(...Object.values(ratingDist)))}\n`
    table += `2⭐ ${ratingDist[2].toString().padStart(2)} ${generateBar(ratingDist[2], Math.max(...Object.values(ratingDist)))}\n`
    table += `1⭐ ${ratingDist[1].toString().padStart(2)} ${generateBar(ratingDist[1], Math.max(...Object.values(ratingDist)))}\n\n`

    // Top issues
    table += '<b>TOP FEEDBACK</b>\n'
    table += `🎯 Main Theme: <b>${topIssues}</b>\n\n`

    // Top masters
    if (topMasters.length > 0) {
      table += '<b>👑 TOP MASTERS</b>\n'
      topMasters.forEach((master, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'
        table += `${medal} ${master.name}: ${master.count} feedback • ${master.avgRating}⭐\n`
      })
      table += '\n'
    }

    // Recent feedback
    table += '<b>RECENT SUBMISSIONS</b>\n'
    const recentFeedback = feedback.slice(0, 5)
    recentFeedback.forEach((f, i) => {
      const star = f.rating ? '⭐'.repeat(f.rating) : '❓'
      const time = new Date(f.submitted_at).toLocaleTimeString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit'
      })
      const admin = f.admin_name ? ` • Admin: ${f.admin_name}` : ''
      table += `\n${i + 1}. <b>${f.customer_name}</b> ${star}\n`
      table += `   👨‍💼 ${f.master_name}${admin}\n`
      if (f.improve_text) {
        table += `   💬 "${f.improve_text.substring(0, 40)}${f.improve_text.length > 40 ? '...' : ''}"\n`
      }
    })

    if (feedback.length > 5) {
      table += `\n<i>... and ${feedback.length - 5} more feedback entries</i>`
    }

    table += '\n\n═══════════════════════════════════'

    function generateBar(value, max) {
      const barLength = 10
      const filled = Math.round((value / max) * barLength)
      return '█'.repeat(filled) + '░'.repeat(barLength - filled)
    }

    console.log(`[${timestamp}] Sending report to Telegram...`)

    // Send link to HTML report instead of text
    const reportUrl = 'https://zorinastudio-referral.com/feedback/today'
    const telegramMessage = `<b>📊 Daily Feedback Report</b>\n\n<a href="${reportUrl}">📋 View Full Report</a>\n\n<b>Quick Stats:</b>\n✅ Total: ${feedback.length}\n⭐ Avg Rating: ${avgRating}\n😊 Positive: ${Math.round(((ratingDist[5] + ratingDist[4]) / feedback.length) * 100)}%`

    const success = await sendTelegramMessage(telegramMessage)
    console.log(`[${timestamp}] Telegram send result: ${success}`)

    return Response.json({
      success,
      count: feedback.length,
      avgRating,
      topIssues: issueCount,
      telegramSent: success
    }, { status: 200 })
  } catch (err) {
    console.error(`[${timestamp}] ERROR: ${err.message}`)
    console.error(`[${timestamp}] Stack:`, err.stack)
    return Response.json({ error: err.message, stack: err.stack }, { status: 500 })
  }
}
