const { authorizeAdminRequest } = require('../../../../../lib/admin-auth')
const { fetchReferralSummary } = require('../../../../../lib/analytics-dashboard')

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function formatCurrency(cents = 0) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`
}

function buildAnswer(question, summary) {
  const text = (question || '').toLowerCase()
  if (!text) {
    return {
      answer: 'Ask me something like “how many new customers this month?” or “what is our referral revenue?”.',
      data: summary.metrics,
    }
  }

  if (text.includes('new customer')) {
    return {
      answer: `In the last ${summary.rangeDays} days we onboarded ${summary.metrics.newCustomers} new referral customers.`,
      data: { newCustomers: summary.metrics.newCustomers },
    }
  }

  if (text.includes('code') || text.includes('redeem')) {
    return {
      answer: `${summary.metrics.codesRedeemedTotal} referral codes were redeemed in the last ${summary.rangeDays} days.`,
      data: { codesRedeemed: summary.metrics.codesRedeemedTotal },
    }
  }

  if (text.includes('revenue') || text.includes('money')) {
    return {
      answer: `Referred customers generated ${formatCurrency(summary.metrics.revenueCents)} in the last ${summary.rangeDays} days.`,
      data: { revenueCents: summary.metrics.revenueCents },
    }
  }

  if (text.includes('sms')) {
    const sms = summary.metrics.sms
    return {
      answer: `We sent ${sms.sent} SMS (delivered ${sms.delivered}, failed ${sms.failed}) in the last ${summary.rangeDays} days.`,
      data: sms,
    }
  }

  if (text.includes('email')) {
    const emails = summary.metrics.emails
    return {
      answer: `We sent ${emails.sent} referral emails (delivered ${emails.delivered}, failed ${emails.failed}) in the last ${summary.rangeDays} days.`,
      data: emails,
    }
  }

  if (text.includes('reward') || text.includes('$10') || text.includes('payout')) {
    return {
      answer: `Rewards granted in the last ${summary.rangeDays} days: ${formatCurrency(summary.metrics.rewardsNewCents)} to new customers and ${formatCurrency(summary.metrics.rewardsReferrerCents)} to referrers.`,
      data: {
        newRewardsCents: summary.metrics.rewardsNewCents,
        referrerRewardsCents: summary.metrics.rewardsReferrerCents,
      },
    }
  }

  if (text.includes('issue') || text.includes('error')) {
    return {
      answer: `There are ${summary.issues.failedNotifications} failed notifications and ${summary.issues.deadLetters} items waiting in the dead-letter queue.`,
      data: summary.issues,
    }
  }

  return {
    answer: `Over the last ${summary.rangeDays} days: ${summary.metrics.newCustomers} new customers, ${summary.metrics.codesRedeemedTotal} codes redeemed, and ${formatCurrency(summary.metrics.revenueCents)} in referred revenue.`,
    data: summary.metrics,
  }
}

export async function POST(request) {
  const auth = await authorizeAdminRequest(request)
  if (!auth.authorized) {
    return json({ error: auth.error || 'Unauthorized' }, auth.status || 401)
  }

  let body = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  try {
    const summary = await fetchReferralSummary({ rangeDays: body.rangeDays || 30 })
    const result = buildAnswer(body.question || '', summary)
    return json({
      answer: result.answer,
      data: result.data,
      rangeDays: summary.rangeDays,
    })
  } catch (error) {
    console.error('Chatbot failed to answer question:', error)
    return json({ error: 'Failed to generate summary' }, 500)
  }
}

export async function GET(request) {
  const auth = await authorizeAdminRequest(request)
  if (!auth.authorized) {
    return json({ error: auth.error || 'Unauthorized' }, auth.status || 401)
  }
  const url = new URL(request.url)
  const question = url.searchParams.get('q') || ''
  const rangeDays = Number(url.searchParams.get('rangeDays') || 30)
  try {
    const summary = await fetchReferralSummary({ rangeDays })
    const result = buildAnswer(question, summary)
    return json({
      answer: result.answer,
      data: result.data,
      rangeDays: summary.rangeDays,
    })
  } catch (error) {
    console.error('Chatbot failed to answer question:', error)
    return json({ error: 'Failed to generate summary' }, 500)
  }
}

