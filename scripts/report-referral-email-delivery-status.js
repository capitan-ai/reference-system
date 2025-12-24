#!/usr/bin/env node
/**
 * Compare referral email delivery state between Postgres and SendGrid.
 * - Counts ready / sent / pending customers in square_existing_clients
 * - Pulls recent suppression lists (blocks, bounces, spam reports) from SendGrid
 * - Highlights customers marked as sent in DB but suppressed/blocked by SendGrid
 * - Writes full discrepancy list to reports/referral-email-discrepancies.json
 */

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')
const sendgridClient = require('@sendgrid/client')

const prisma = new PrismaClient()

const LOOKBACK_DAYS = Number(process.env.SENDGRID_SUPPRESSION_LOOKBACK_DAYS || 14)
const SUPPRESSION_LIMIT = Number(process.env.SENDGRID_SUPPRESSION_BATCH || 500)
const SINCE_EPOCH = Math.max(
  0,
  Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 24 * 60 * 60
)
const REPORT_DIR = path.join(__dirname, '..', 'reports')
const REPORT_PATH = path.join(REPORT_DIR, 'referral-email-discrepancies.json')

function requireEnv(key) {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

async function fetchSuppressionList(endpoint) {
  const items = []
  let offset = 0
  while (true) {
    const request = {
      method: 'GET',
      url: `/v3/suppression/${endpoint}`,
      qs: {
        start_time: SINCE_EPOCH,
        limit: SUPPRESSION_LIMIT,
        offset
      }
    }
    const [response, body] = await sendgridClient.request(request)
    if (response.statusCode !== 200) {
      throw new Error(
        `SendGrid ${endpoint} responded with ${response.statusCode}`
      )
    }
    if (!Array.isArray(body) || body.length === 0) {
      break
    }
    items.push(...body)
    if (body.length < SUPPRESSION_LIMIT) {
      break
    }
    offset += SUPPRESSION_LIMIT
  }
  return items
}

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase()
}

function formatDate(epochSeconds) {
  if (!epochSeconds) return null
  try {
    return new Date(epochSeconds * 1000).toISOString()
  } catch (_err) {
    return null
  }
}

async function gatherDatabaseStats() {
  const [statsRow] = await prisma.$queryRaw`
    SELECT
      COUNT(*) AS total_customers,
      SUM(CASE WHEN email_address IS NOT NULL AND email_address != '' THEN 1 ELSE 0 END) AS customers_with_email,
      SUM(CASE WHEN personal_code IS NOT NULL AND personal_code != '' THEN 1 ELSE 0 END) AS customers_with_code,
      SUM(CASE WHEN personal_code IS NOT NULL AND personal_code != '' AND email_address IS NOT NULL AND email_address != '' THEN 1 ELSE 0 END) AS ready_for_email,
      SUM(CASE WHEN personal_code IS NOT NULL AND personal_code != '' AND email_address IS NOT NULL AND email_address != '' AND COALESCE(referral_email_sent, FALSE) = TRUE THEN 1 ELSE 0 END) AS marked_sent,
      SUM(CASE WHEN personal_code IS NOT NULL AND personal_code != '' AND email_address IS NOT NULL AND email_address != '' AND COALESCE(referral_email_sent, FALSE) = FALSE THEN 1 ELSE 0 END) AS pending_send
    FROM square_existing_clients
  `

  const sentCustomers = await prisma.$queryRaw`
    SELECT
      square_customer_id,
      given_name,
      family_name,
      email_address,
      personal_code,
      referral_url,
      updated_at
    FROM square_existing_clients
    WHERE COALESCE(referral_email_sent, FALSE) = TRUE
      AND email_address IS NOT NULL
      AND email_address != ''
  `

  return { statsRow, sentCustomers }
}

function buildCustomerMap(customers) {
  const map = new Map()
  for (const customer of customers) {
    const emailKey = normalizeEmail(customer.email_address)
    if (!emailKey) continue
    map.set(emailKey, {
      email: customer.email_address.trim(),
      personalCode: customer.personal_code,
      referralUrl: customer.referral_url,
      name: `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown',
      updatedAt: customer.updated_at
        ? new Date(customer.updated_at).toISOString()
        : null,
      squareCustomerId: customer.square_customer_id
    })
  }
  return map
}

function mergeSuppressionIssues(source, type, issueMap) {
  for (const entry of source) {
    const emailKey = normalizeEmail(entry.email)
    if (!emailKey) continue
    if (!issueMap.has(emailKey)) {
      issueMap.set(emailKey, {
        email: entry.email,
        events: []
      })
    }
    issueMap.get(emailKey).events.push({
      type,
      status: entry.status || null,
      reason: entry.reason || null,
      timestamp: formatDate(entry.created)
    })
  }
}

async function run() {
  console.log('🔍 Comparing database state with SendGrid suppression data...\n')
  const sendgridKey = requireEnv('SENDGRID_API_KEY')
  sendgridClient.setApiKey(sendgridKey)

  await prisma.$connect()

  try {
    const { statsRow, sentCustomers } = await gatherDatabaseStats()
    const sentCustomerMap = buildCustomerMap(sentCustomers)

    console.log('📊 Database (square_existing_clients) overview:')
    console.log(
      `   Total customers: ${Number(statsRow.total_customers).toLocaleString()}`
    )
    console.log(
      `   With email: ${Number(statsRow.customers_with_email).toLocaleString()}`
    )
    console.log(
      `   With referral code: ${Number(statsRow.customers_with_code).toLocaleString()}`
    )
    console.log(
      `   Ready for email: ${Number(statsRow.ready_for_email).toLocaleString()}`
    )
    console.log(
      `   Marked as sent: ${Number(statsRow.marked_sent).toLocaleString()}`
    )
    console.log(
      `   Pending send: ${Number(statsRow.pending_send).toLocaleString()}\n`
    )

    console.log(
      `📨 Fetching SendGrid suppression lists for the last ${LOOKBACK_DAYS} days (since ${new Date(
        SINCE_EPOCH * 1000
      ).toISOString()})...`
    )

    const [blocks, bounces, spamReports] = await Promise.all([
      fetchSuppressionList('blocks'),
      fetchSuppressionList('bounces'),
      fetchSuppressionList('spam_reports')
    ])

    console.log(
      `   ➤ Blocks: ${blocks.length.toLocaleString()}, Bounces: ${bounces.length.toLocaleString()}, Spam reports: ${spamReports.length.toLocaleString()}`
    )

    const suppressionIssues = new Map()
    mergeSuppressionIssues(blocks, 'block', suppressionIssues)
    mergeSuppressionIssues(bounces, 'bounce', suppressionIssues)
    mergeSuppressionIssues(spamReports, 'spam_report', suppressionIssues)

    const discrepancies = []
    for (const [emailKey, issue] of suppressionIssues.entries()) {
      if (!sentCustomerMap.has(emailKey)) continue
      const customer = sentCustomerMap.get(emailKey)
      discrepancies.push({
        email: customer.email,
        personalCode: customer.personalCode,
        referralUrl: customer.referralUrl,
        name: customer.name,
        squareCustomerId: customer.squareCustomerId,
        markedSentAt: customer.updatedAt,
        issues: issue.events
      })
    }

    console.log(
      `\n⚠️ Customers marked as sent in DB but present on SendGrid suppression lists: ${discrepancies.length.toLocaleString()}`
    )

    if (discrepancies.length > 0) {
      const preview = discrepancies.slice(0, 20)
      preview.forEach((item, index) => {
        console.log(
          `   ${index + 1}. ${item.email} (${item.personalCode}) – ${item.issues
            .map((evt) => `${evt.type}${evt.status ? ` [${evt.status}]` : ''}`)
            .join(', ')}`
        )
      })
      if (discrepancies.length > preview.length) {
        console.log(
          `   ...and ${discrepancies.length - preview.length} more entries`
        )
      }

      fs.mkdirSync(REPORT_DIR, { recursive: true })
      fs.writeFileSync(REPORT_PATH, JSON.stringify(discrepancies, null, 2))
      console.log(`\n📁 Full report written to: ${REPORT_PATH}`)
    } else {
      console.log('   No suppression conflicts detected 🎉')
    }

    console.log('\n✅ Comparison complete.')
  } catch (error) {
    console.error('❌ Error while generating report:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

run()


