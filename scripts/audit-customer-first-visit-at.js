require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { Prisma } = require('@prisma/client')
const prisma = require('../lib/prisma-client')

/**
 * Audit `customer_analytics.first_visit_at` against the strict bookings-only definition:
 *   expected = MIN(bookings.start_at) WHERE status IN ('ACCEPTED','COMPLETED')
 *
 * Read-only. Outputs:
 *   - console summary (counts + percentages per category)
 *   - top 20 samples per non-OK category
 *   - tmp/audit-first-visit-{ISO timestamp}.csv with every row
 *   - per-category remediation suggestions
 *
 * Usage:
 *   node scripts/audit-customer-first-visit-at.js
 *   node scripts/audit-customer-first-visit-at.js --limit 1000
 *   node scripts/audit-customer-first-visit-at.js --org <uuid>
 */

const TOLERANCE_MS = 1

function parseArgs(argv) {
  const args = { limit: null, org: null }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--limit') args.limit = parseInt(argv[++i], 10)
    else if (a === '--org') args.org = argv[++i]
  }
  return args
}

function eqTimestamps(a, b) {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= TOLERANCE_MS
}

function classify(row) {
  const expected = row.expected_first_visit_at
  const actualCa = row.actual_ca_first_visit_at

  if (eqTimestamps(actualCa, expected)) return 'OK'

  if (expected != null && actualCa == null) return 'NULL_BUT_HAS_BOOKINGS'

  if (expected == null && actualCa != null) {
    const revenue = Number(row.total_revenue_cents || 0)
    const isRetailish = revenue > 0 && (row.customer_type === 'RETAIL' || row.customer_type === 'SALON_CLIENT' || row.customer_type === 'STUDENT')
    return isRetailish ? 'VALUE_BUT_NO_BOOKINGS_RETAIL' : 'VALUE_BUT_NO_BOOKINGS_ORPHAN'
  }

  const aMs = new Date(actualCa).getTime()
  const eMs = new Date(expected).getTime()
  if (aMs < eMs - TOLERANCE_MS) return 'EARLIER_THAN_EXPECTED'
  if (aMs > eMs + TOLERANCE_MS) return 'LATER_THAN_EXPECTED'
  return 'DIFFERENT_TIMESTAMP'
}

function fmt(ts) {
  return ts == null ? '' : new Date(ts).toISOString()
}

function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const REMEDIATION = {
  NULL_BUT_HAS_BOOKINGS: 'Trigger /api/cron/refresh-customer-analytics?mode=full and re-run audit. If sec_matches_expected is mostly true, this is a cron staleness only.',
  VALUE_BUT_NO_BOOKINGS_RETAIL: 'Order-derived value from current LEAST(booking, order) formula. Remediation requires changing the formula in lib/analytics/refresh-single-customer-analytics.js (separate plan).',
  VALUE_BUT_NO_BOOKINGS_ORPHAN: 'Stored value with no matching ACCEPTED/COMPLETED booking and no significant revenue. Likely orphaned/legacy data. Inspect manually.',
  EARLIER_THAN_EXPECTED: 'Earlier order/payment is the source of truth under current formula. Will only change if the formula moves to bookings-only.',
  LATER_THAN_EXPECTED: 'Real bug: a booking earlier than the stored value exists. Trigger full refresh, then check webhook_jobs for failed events on the affected customers.',
  DIFFERENT_TIMESTAMP: 'Edge case beyond OK tolerance but neither earlier nor later. Investigate manually.',
}

async function main() {
  const args = parseArgs(process.argv)
  const startedAt = Date.now()

  console.log('\n📊 customer_analytics.first_visit_at audit')
  console.log('='.repeat(80))
  console.log(`mode: ${args.org ? `org=${args.org}` : 'all organizations'}${args.limit ? `, limit=${args.limit}` : ''}`)

  const orgFilter = args.org ? Prisma.sql`AND ca.organization_id = ${args.org}::uuid` : Prisma.empty
  const limitClause = args.limit ? Prisma.sql`LIMIT ${args.limit}` : Prisma.empty

  const sql = prisma.$queryRaw`
    WITH expected AS (
      SELECT
        organization_id,
        customer_id AS square_customer_id,
        MIN(start_at) FILTER (WHERE status IN ('ACCEPTED','COMPLETED')) AS expected_first_visit_at,
        COUNT(*) FILTER (WHERE status IN ('ACCEPTED','COMPLETED'))      AS accepted_count,
        COUNT(*) FILTER (WHERE status NOT IN ('ACCEPTED','COMPLETED'))  AS non_accepted_count
      FROM bookings
      WHERE customer_id IS NOT NULL
      GROUP BY organization_id, customer_id
    )
    SELECT
      ca.organization_id::text                 AS organization_id,
      ca.square_customer_id,
      ca.given_name,
      ca.family_name,
      e.expected_first_visit_at,
      ca.first_visit_at                        AS actual_ca_first_visit_at,
      ca.first_booking_at                      AS actual_ca_first_booking_at,
      sec.first_visit_at                       AS actual_sec_first_visit_at,
      COALESCE(e.accepted_count, 0)::int       AS accepted_count,
      COALESCE(e.non_accepted_count, 0)::int   AS non_accepted_count,
      ca.total_revenue_cents::text             AS total_revenue_cents,
      ca.customer_type
    FROM customer_analytics ca
    LEFT JOIN expected e
      ON e.organization_id    = ca.organization_id
     AND e.square_customer_id = ca.square_customer_id
    LEFT JOIN square_existing_clients sec
      ON sec.organization_id    = ca.organization_id
     AND sec.square_customer_id = ca.square_customer_id
    WHERE 1=1
      ${orgFilter}
    ORDER BY ca.organization_id, ca.square_customer_id
    ${limitClause}
  `

  const rows = await sql

  console.log(`\nfetched ${rows.length} customers in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`)

  const buckets = {}
  for (const r of rows) {
    const cat = classify(r)
    r._category = cat
    r._sec_matches_expected = eqTimestamps(r.actual_sec_first_visit_at, r.expected_first_visit_at)
    buckets[cat] = buckets[cat] || []
    buckets[cat].push(r)
  }

  const total = rows.length
  console.log('--- summary ---')
  console.log('category'.padEnd(34) + 'count'.padStart(8) + '   pct')
  console.log('-'.repeat(50))
  const order = [
    'OK',
    'NULL_BUT_HAS_BOOKINGS',
    'LATER_THAN_EXPECTED',
    'EARLIER_THAN_EXPECTED',
    'VALUE_BUT_NO_BOOKINGS_RETAIL',
    'VALUE_BUT_NO_BOOKINGS_ORPHAN',
    'DIFFERENT_TIMESTAMP',
  ]
  for (const cat of order) {
    const n = (buckets[cat] || []).length
    const pct = total > 0 ? ((n / total) * 100).toFixed(1) : '0.0'
    console.log(cat.padEnd(34) + String(n).padStart(8) + '   ' + pct + '%')
  }
  const sumCats = order.reduce((acc, c) => acc + (buckets[c] || []).length, 0)
  console.log('-'.repeat(50))
  console.log('total'.padEnd(34) + String(total).padStart(8))
  if (sumCats !== total) {
    console.warn(`⚠️  category sum=${sumCats} != total=${total}; categorization gap`)
  }

  for (const cat of order) {
    if (cat === 'OK') continue
    const samples = (buckets[cat] || []).slice(0, 20)
    if (samples.length === 0) continue
    console.log(`\n--- top ${samples.length} samples in ${cat} ---`)
    console.log(['org', 'sq_customer_id', 'name', 'expected', 'actual_ca', 'actual_sec', 'accepted', 'revenue', 'sec_ok'].join(' | '))
    for (const r of samples) {
      const name = `${r.given_name || ''} ${r.family_name || ''}`.trim() || '(unnamed)'
      console.log([
        r.organization_id.slice(0, 8),
        r.square_customer_id,
        name,
        fmt(r.expected_first_visit_at),
        fmt(r.actual_ca_first_visit_at),
        fmt(r.actual_sec_first_visit_at),
        r.accepted_count,
        r.total_revenue_cents,
        r._sec_matches_expected ? 'Y' : 'N',
      ].join(' | '))
    }
  }

  const tmpDir = path.join(__dirname, '..', 'tmp')
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const csvPath = path.join(tmpDir, `audit-first-visit-${stamp}.csv`)
  const headers = [
    'category', 'organization_id', 'square_customer_id', 'given_name', 'family_name',
    'expected_first_visit_at', 'actual_ca_first_visit_at', 'actual_ca_first_booking_at',
    'actual_sec_first_visit_at', 'sec_matches_expected',
    'accepted_count', 'non_accepted_count', 'total_revenue_cents', 'customer_type',
  ]
  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push([
      r._category,
      r.organization_id,
      r.square_customer_id,
      r.given_name,
      r.family_name,
      fmt(r.expected_first_visit_at),
      fmt(r.actual_ca_first_visit_at),
      fmt(r.actual_ca_first_booking_at),
      fmt(r.actual_sec_first_visit_at),
      r._sec_matches_expected ? 'true' : 'false',
      r.accepted_count,
      r.non_accepted_count,
      r.total_revenue_cents,
      r.customer_type,
    ].map(csvEscape).join(','))
  }
  fs.writeFileSync(csvPath, lines.join('\n'))
  console.log(`\n💾 CSV written: ${csvPath}`)

  console.log('\n--- remediation suggestions ---')
  let any = false
  for (const cat of order) {
    if (cat === 'OK') continue
    const n = (buckets[cat] || []).length
    if (n === 0) continue
    any = true
    console.log(`• ${cat} (${n}): ${REMEDIATION[cat]}`)
  }
  if (!any) console.log('All customers in OK bucket. No remediation needed.')

  console.log(`\ndone in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
