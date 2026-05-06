#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const path = require('path')

// Load .env manually
const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8')
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=')
    if (key && !process.env[key.trim()]) {
      process.env[key.trim()] = valueParts.join('=').trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
    }
  })
}

const db = new PrismaClient()

async function sendTelegramMessage(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!botToken || !chatId) {
    console.error('❌ Telegram credentials not configured')
    console.error('  TELEGRAM_BOT_TOKEN:', botToken ? '✓' : '✗')
    console.error('  TELEGRAM_CHAT_ID:', chatId ? '✓' : '✗')
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
      console.error('❌ Telegram API error:', await response.text())
      return false
    }
    console.log('✅ Message sent to Telegram!')
    return true
  } catch (err) {
    console.error('❌ Error sending Telegram message:', err.message)
    return false
  }
}

async function generateReport() {
  try {
    const orgId = process.env.ZORINA_ORG_ID
    if (!orgId) {
      console.error('❌ ZORINA_ORG_ID not configured')
      return
    }

    console.log('📊 Fetching all feedback data...')

    // Fetch ALL feedback (not just today)
    const feedback = await db.customerFeedback.findMany({
      where: {
        organization_id: orgId
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
      console.log('❌ No feedback found in database')
      await sendTelegramMessage('❌ No feedback data in database')
      return
    }

    console.log(`✅ Found ${feedback.length} feedback entries`)

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
    let table = '<b>📊 All Feedback Data (TEST REPORT)</b>\n'
    table += `Total: ${feedback.length} | ⭐ Avg: ${avgRating}\n\n`
    table += '<b>Rating Distribution:</b>\n'
    table += `5⭐ ${ratingDist[5]} | 4⭐ ${ratingDist[4]} | 3⭐ ${ratingDist[3]} | 2⭐ ${ratingDist[2]} | 1⭐ ${ratingDist[1]}\n\n`
    table += `<b>Top Issues:</b> ${topIssues}\n\n`
    table += '<b>Detailed Feedback:</b>\n'

    // Add individual feedback (limit to 15)
    const recentFeedback = feedback.slice(0, 15)
    recentFeedback.forEach((f, i) => {
      const star = f.rating ? '⭐'.repeat(f.rating) : '?'
      const time = new Date(f.submitted_at).toLocaleTimeString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit'
      })
      const date = new Date(f.submitted_at).toLocaleDateString('en-US')
      table += `${i + 1}. ${f.customer_name} @ ${f.location_name || '?'} [${date} ${time}]\n`
      table += `   ${star} by ${f.master_name}\n`
      if (f.improve_text) {
        const text = f.improve_text.substring(0, 60)
        table += `   💬 "${text}${f.improve_text.length > 60 ? '...' : ''}"\n`
      }
      if (f.issues && f.issues.length > 0) {
        table += `   ⚠️ Issues: ${f.issues.join(', ')}\n`
      }
    })

    if (feedback.length > 15) {
      table += `\n... and ${feedback.length - 15} more entries`
    }

    console.log('\n📝 Report content:')
    console.log(table)
    console.log('\n📤 Sending to Telegram...')

    await sendTelegramMessage(table)
  } catch (err) {
    console.error('❌ Error:', err.message)
    console.error(err)
  } finally {
    await db.$disconnect()
  }
}

generateReport()
