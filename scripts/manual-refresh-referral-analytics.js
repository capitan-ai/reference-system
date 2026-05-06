#!/usr/bin/env node
/**
 * Manual refresh of referral_analytics_daily
 *
 * Usage:
 *   node scripts/manual-refresh-referral-analytics.js
 *   node scripts/manual-refresh-referral-analytics.js --from=2026-03-01 --to=2026-03-31
 *   node scripts/manual-refresh-referral-analytics.js --days=35
 */
const { PrismaClient } = require('@prisma/client')
const { refreshReferralAnalytics } = require('../lib/analytics/referral-analytics-refresh')

const prisma = new PrismaClient()

async function main() {
  const daysParam = process.argv.find((arg) => arg.startsWith('--days='))?.split('=')[1] || '35'
  const fromParam = process.argv.find((arg) => arg.startsWith('--from='))?.split('=')[1]
  const toParam = process.argv.find((arg) => arg.startsWith('--to='))?.split('=')[1]

  let dateFrom, dateTo
  if (fromParam && toParam) {
    dateFrom = `'${fromParam} 00:00:00'`
    dateTo = `'${toParam}'::date + interval '1 day'`
  } else {
    const days = parseInt(daysParam)
    dateFrom = `NOW() - interval '${days} days'`
    dateTo = `NOW() + interval '1 day'`
  }

  console.log(`\n--- Refreshing Referral Analytics from ${dateFrom} to ${dateTo} ---`)

  const result = await refreshReferralAnalytics(prisma, dateFrom, dateTo)
  console.log(`\nRows written: ${result.rowsWritten}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
