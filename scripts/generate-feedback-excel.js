#!/usr/bin/env node

const { createWriteStream } = require('fs')
const path = require('path')
const XLSX = require('xlsx')
const { PrismaClient } = require('@prisma/client')

const db = new PrismaClient()

async function generateExcelReport() {
  try {
    const orgId = process.env.ZORINA_ORG_ID
    if (!orgId) {
      throw new Error('ZORINA_ORG_ID not set')
    }

    console.log('📊 Fetching feedback data...')

    // Fetch all feedback
    const feedback = await db.customerFeedback.findMany({
      where: { organization_id: orgId },
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
      throw new Error('No feedback data found')
    }

    console.log(`✅ Found ${feedback.length} feedback entries`)

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

    // Create workbook
    const wb = XLSX.utils.book_new()

    // Sheet 1: Summary
    const summaryData = [
      ['Feedback Daily Report'],
      [],
      ['Total Feedback', feedback.length],
      ['Average Rating', avgRating],
      [],
      ['Rating Distribution'],
      ['⭐ 5 Stars', ratingDist[5]],
      ['⭐⭐ 4 Stars', ratingDist[4]],
      ['⭐⭐⭐ 3 Stars', ratingDist[3]],
      ['⭐⭐⭐⭐ 2 Stars', ratingDist[2]],
      ['⭐⭐⭐⭐⭐ 1 Star', ratingDist[1]],
      [],
      ['Top Issues'],
      ...Object.entries(issueCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([issue, count]) => [issue, count])
    ]

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
    summarySheet['!cols'] = [{ wch: 20 }, { wch: 15 }]
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary')

    // Sheet 2: Detailed Feedback
    const feedbackData = [
      ['#', 'Customer', 'Master', 'Location', 'Rating', 'Date & Time', 'Comment', 'Source', 'Issues']
    ]

    feedback.forEach((f, i) => {
      const stars = '⭐'.repeat(f.rating || 0)
      const dateTime = new Date(f.submitted_at).toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })

      feedbackData.push([
        i + 1,
        f.customer_name || '',
        f.master_name || '',
        f.location_name || '',
        stars,
        dateTime,
        f.improve_text || '',
        f.source || '',
        (f.issues && f.issues.length > 0) ? f.issues.join(', ') : ''
      ])
    })

    const feedbackSheet = XLSX.utils.aoa_to_sheet(feedbackData)
    feedbackSheet['!cols'] = [
      { wch: 5 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 10 },
      { wch: 18 },
      { wch: 30 },
      { wch: 12 },
      { wch: 25 }
    ]

    // Freeze first row
    feedbackSheet['!freeze'] = { xSplit: 0, ySplit: 1 }

    XLSX.utils.book_append_sheet(wb, feedbackSheet, 'Detailed Feedback')

    // Save file
    const timestamp = new Date().toISOString().split('T')[0]
    const filename = path.join('/tmp', `feedback-report-${timestamp}.xlsx`)

    XLSX.writeFile(wb, filename)
    console.log(`✅ Excel file created: ${filename}`)

    return filename
  } catch (err) {
    console.error('❌ Error:', err.message)
    throw err
  } finally {
    await db.$disconnect()
  }
}

// Export for use in other scripts
if (require.main === module) {
  generateExcelReport()
    .then(file => {
      console.log(`📁 File ready: ${file}`)
      process.exit(0)
    })
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
}

module.exports = { generateExcelReport }
