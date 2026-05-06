require('dotenv').config()
const fs = require('fs')
const path = require('path')
const prisma = require('../lib/prisma-client')

/**
 * Build a deterministic (organization_id, old_id, canonical_id) merge map for Square
 * customer-merge artifacts. Replicates the cron's `id_mapping` CTE logic
 * (app/api/cron/refresh-customer-analytics/route.js:42-90):
 *   - phone match > email match > self
 *   - earliest created_at = canonical
 *
 * READ-ONLY. Outputs:
 *   - CSV at tmp/customer-merge-map-{ISO}.csv
 *   - Console summary with bucket breakdown + sample pairs
 *
 * Usage:
 *   node scripts/build-customer-merge-map.js
 *   node scripts/build-customer-merge-map.js --org <uuid>
 *
 * (--verify-square deferred; not implemented in this revision.)
 */

function parseArgs(argv) {
  const args = { org: null }
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--org') args.org = argv[++i]
  }
  return args
}

function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function fmt(ts) {
  return ts == null ? '' : new Date(ts).toISOString()
}

async function main() {
  const args = parseArgs(process.argv)
  const startedAt = Date.now()

  console.log('\n🔍 Building Square customer-merge map')
  console.log('='.repeat(80))
  console.log(`mode: ${args.org ? `org=${args.org}` : 'all organizations'}\n`)

  // Single SQL: replicate the cron's id_mapping CTE, then join back to compute per-pair detail.
  // Filter to rows where canonical_id != square_customer_id (i.e. this row is an alias that
  // should collapse into another canonical row). Excludes self-canonical rows.
  const sql = args.org
    ? prisma.$queryRaw`
WITH
normalized_clients AS (
  SELECT
    square_customer_id,
    organization_id,
    created_at,
    email_address,
    CASE
      WHEN phone_number LIKE '+1%' THEN SUBSTRING(phone_number FROM 3)
      WHEN phone_number LIKE '1%' AND LENGTH(REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g')) = 11 THEN SUBSTRING(REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g') FROM 2)
      ELSE REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g')
    END AS normalized_phone
  FROM square_existing_clients
  WHERE organization_id = ${args.org}::uuid
    AND ((email_address IS NOT NULL AND email_address != '')
      OR (phone_number IS NOT NULL AND phone_number != ''))
),
phone_canonical AS (
  SELECT square_customer_id,
         FIRST_VALUE(square_customer_id) OVER (PARTITION BY normalized_phone, organization_id ORDER BY created_at ASC) AS phone_canonical_id
  FROM normalized_clients
  WHERE normalized_phone IS NOT NULL AND normalized_phone != ''
),
email_canonical AS (
  SELECT square_customer_id,
         FIRST_VALUE(square_customer_id) OVER (PARTITION BY email_address, organization_id ORDER BY created_at ASC) AS email_canonical_id
  FROM normalized_clients
  WHERE email_address IS NOT NULL AND email_address != ''
),
id_mapping AS (
  SELECT nc.square_customer_id, nc.organization_id,
         COALESCE(pc.phone_canonical_id, ec.email_canonical_id, nc.square_customer_id) AS canonical_id,
         CASE
           WHEN pc.phone_canonical_id IS NOT NULL AND pc.phone_canonical_id != nc.square_customer_id THEN 'phone'
           WHEN ec.email_canonical_id IS NOT NULL AND ec.email_canonical_id != nc.square_customer_id THEN 'email'
           ELSE NULL
         END AS match_signal
  FROM normalized_clients nc
  LEFT JOIN phone_canonical pc ON nc.square_customer_id = pc.square_customer_id
  LEFT JOIN email_canonical ec ON nc.square_customer_id = ec.square_customer_id
)
SELECT
  m.organization_id::text                                  AS organization_id,
  m.canonical_id,
  m.square_customer_id                                     AS old_id,
  c_can.given_name                                         AS canonical_given_name,
  c_can.family_name                                        AS canonical_family_name,
  c_can.email_address                                      AS canonical_email,
  c_can.phone_number                                       AS canonical_phone,
  c_can.created_at                                         AS canonical_created_at,
  c_old.given_name                                         AS old_given_name,
  c_old.family_name                                        AS old_family_name,
  c_old.email_address                                      AS old_email,
  c_old.phone_number                                       AS old_phone,
  c_old.created_at                                         AS old_created_at,
  m.match_signal,
  (SELECT COUNT(*)::int FROM bookings WHERE organization_id=m.organization_id AND customer_id=m.square_customer_id)         AS old_bookings,
  (SELECT COUNT(*)::int FROM bookings WHERE organization_id=m.organization_id AND customer_id=m.canonical_id)               AS canonical_bookings,
  (SELECT COUNT(*)::int FROM orders   WHERE organization_id=m.organization_id AND customer_id=m.square_customer_id)         AS old_orders,
  (SELECT COUNT(*)::int FROM payments WHERE organization_id=m.organization_id AND customer_id=m.square_customer_id)         AS old_payments,
  (SELECT COUNT(*)::int FROM order_line_items WHERE customer_id=m.square_customer_id)                                       AS old_line_items,
  (SELECT 1 FROM customer_analytics WHERE organization_id=m.organization_id AND square_customer_id=m.canonical_id LIMIT 1) IS NOT NULL AS canonical_has_customer_analytics,
  (SELECT 1 FROM customer_analytics WHERE organization_id=m.organization_id AND square_customer_id=m.square_customer_id LIMIT 1) IS NOT NULL AS old_has_customer_analytics,
  (SELECT 1 FROM referral_profiles WHERE organization_id=m.organization_id AND square_customer_id=m.canonical_id LIMIT 1) IS NOT NULL AS canonical_has_referral_profile,
  (SELECT 1 FROM referral_profiles WHERE organization_id=m.organization_id AND square_customer_id=m.square_customer_id LIMIT 1) IS NOT NULL AS old_has_referral_profile,
  (SELECT MIN(start_at) FROM bookings WHERE organization_id=m.organization_id AND customer_id=m.canonical_id AND status IN ('ACCEPTED','COMPLETED')) AS canonical_first_booking,
  (SELECT MIN(start_at) FROM bookings WHERE organization_id=m.organization_id AND customer_id=m.square_customer_id AND status IN ('ACCEPTED','COMPLETED')) AS old_first_booking
FROM id_mapping m
LEFT JOIN square_existing_clients c_can ON c_can.organization_id=m.organization_id AND c_can.square_customer_id=m.canonical_id
LEFT JOIN square_existing_clients c_old ON c_old.organization_id=m.organization_id AND c_old.square_customer_id=m.square_customer_id
WHERE m.canonical_id != m.square_customer_id
ORDER BY m.organization_id, m.canonical_id, m.square_customer_id
`
    : prisma.$queryRaw`
WITH
normalized_clients AS (
  SELECT
    square_customer_id,
    organization_id,
    created_at,
    email_address,
    CASE
      WHEN phone_number LIKE '+1%' THEN SUBSTRING(phone_number FROM 3)
      WHEN phone_number LIKE '1%' AND LENGTH(REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g')) = 11 THEN SUBSTRING(REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g') FROM 2)
      ELSE REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g')
    END AS normalized_phone
  FROM square_existing_clients
  WHERE (email_address IS NOT NULL AND email_address != '')
     OR (phone_number IS NOT NULL AND phone_number != '')
),
phone_canonical AS (
  SELECT square_customer_id,
         FIRST_VALUE(square_customer_id) OVER (PARTITION BY normalized_phone, organization_id ORDER BY created_at ASC) AS phone_canonical_id
  FROM normalized_clients
  WHERE normalized_phone IS NOT NULL AND normalized_phone != ''
),
email_canonical AS (
  SELECT square_customer_id,
         FIRST_VALUE(square_customer_id) OVER (PARTITION BY email_address, organization_id ORDER BY created_at ASC) AS email_canonical_id
  FROM normalized_clients
  WHERE email_address IS NOT NULL AND email_address != ''
),
id_mapping AS (
  SELECT nc.square_customer_id, nc.organization_id,
         COALESCE(pc.phone_canonical_id, ec.email_canonical_id, nc.square_customer_id) AS canonical_id,
         CASE
           WHEN pc.phone_canonical_id IS NOT NULL AND pc.phone_canonical_id != nc.square_customer_id THEN 'phone'
           WHEN ec.email_canonical_id IS NOT NULL AND ec.email_canonical_id != nc.square_customer_id THEN 'email'
           ELSE NULL
         END AS match_signal
  FROM normalized_clients nc
  LEFT JOIN phone_canonical pc ON nc.square_customer_id = pc.square_customer_id
  LEFT JOIN email_canonical ec ON nc.square_customer_id = ec.square_customer_id
)
SELECT
  m.organization_id::text                                  AS organization_id,
  m.canonical_id,
  m.square_customer_id                                     AS old_id,
  c_can.given_name                                         AS canonical_given_name,
  c_can.family_name                                        AS canonical_family_name,
  c_can.email_address                                      AS canonical_email,
  c_can.phone_number                                       AS canonical_phone,
  c_can.created_at                                         AS canonical_created_at,
  c_old.given_name                                         AS old_given_name,
  c_old.family_name                                        AS old_family_name,
  c_old.email_address                                      AS old_email,
  c_old.phone_number                                       AS old_phone,
  c_old.created_at                                         AS old_created_at,
  m.match_signal,
  (SELECT COUNT(*)::int FROM bookings WHERE organization_id=m.organization_id AND customer_id=m.square_customer_id)         AS old_bookings,
  (SELECT COUNT(*)::int FROM bookings WHERE organization_id=m.organization_id AND customer_id=m.canonical_id)               AS canonical_bookings,
  (SELECT COUNT(*)::int FROM orders   WHERE organization_id=m.organization_id AND customer_id=m.square_customer_id)         AS old_orders,
  (SELECT COUNT(*)::int FROM payments WHERE organization_id=m.organization_id AND customer_id=m.square_customer_id)         AS old_payments,
  (SELECT COUNT(*)::int FROM order_line_items WHERE customer_id=m.square_customer_id)                                       AS old_line_items,
  (SELECT 1 FROM customer_analytics WHERE organization_id=m.organization_id AND square_customer_id=m.canonical_id LIMIT 1) IS NOT NULL AS canonical_has_customer_analytics,
  (SELECT 1 FROM customer_analytics WHERE organization_id=m.organization_id AND square_customer_id=m.square_customer_id LIMIT 1) IS NOT NULL AS old_has_customer_analytics,
  (SELECT 1 FROM referral_profiles WHERE organization_id=m.organization_id AND square_customer_id=m.canonical_id LIMIT 1) IS NOT NULL AS canonical_has_referral_profile,
  (SELECT 1 FROM referral_profiles WHERE organization_id=m.organization_id AND square_customer_id=m.square_customer_id LIMIT 1) IS NOT NULL AS old_has_referral_profile,
  (SELECT MIN(start_at) FROM bookings WHERE organization_id=m.organization_id AND customer_id=m.canonical_id AND status IN ('ACCEPTED','COMPLETED')) AS canonical_first_booking,
  (SELECT MIN(start_at) FROM bookings WHERE organization_id=m.organization_id AND customer_id=m.square_customer_id AND status IN ('ACCEPTED','COMPLETED')) AS old_first_booking
FROM id_mapping m
LEFT JOIN square_existing_clients c_can ON c_can.organization_id=m.organization_id AND c_can.square_customer_id=m.canonical_id
LEFT JOIN square_existing_clients c_old ON c_old.organization_id=m.organization_id AND c_old.square_customer_id=m.square_customer_id
WHERE m.canonical_id != m.square_customer_id
ORDER BY m.organization_id, m.canonical_id, m.square_customer_id
`

  const rows = await sql
  console.log(`fetched ${rows.length} merge pairs in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`)

  // Detect chains: an old_id that is also a canonical_id for someone else
  const canonicalSet = new Set(rows.map((r) => `${r.organization_id}|${r.canonical_id}`))
  const oldSet = new Set(rows.map((r) => `${r.organization_id}|${r.old_id}`))

  // Bucket + flags
  const buckets = { both: [], one: [], neither: [] }
  for (const r of rows) {
    const flags = []

    // Chain detection: the canonical itself is also an "old" in another pair
    const canonicalIsAlsoOld = oldSet.has(`${r.organization_id}|${r.canonical_id}`)
    // Or our old is also canonical for another row (downstream chain)
    const oldIsAlsoCanonical = canonicalSet.has(`${r.organization_id}|${r.old_id}`)
    if (canonicalIsAlsoOld || oldIsAlsoCanonical) flags.push('MULTI_CANONICAL_CHAIN')

    if (r.canonical_first_booking && r.old_first_booking) {
      const dts = Math.abs(new Date(r.canonical_first_booking).getTime() - new Date(r.old_first_booking).getTime())
      if (dts < 7 * 86400 * 1000) flags.push('BOTH_HAVE_BOOKINGS_NEAR_DATES')
    }
    if (r.canonical_created_at && r.old_created_at) {
      const dts = new Date(r.old_created_at).getTime() - new Date(r.canonical_created_at).getTime()
      if (dts > 365 * 86400 * 1000) flags.push('OLD_NEWER_THAN_CANONICAL_BY_>365d')
    }
    if (!r.old_email && !r.old_phone) flags.push('OLD_HAS_NO_CONTACT')
    r._flags = flags

    const a = (r.old_bookings || 0) > 0
    const b = (r.canonical_bookings || 0) > 0
    if (a && b) buckets.both.push(r)
    else if (a || b) buckets.one.push(r)
    else buckets.neither.push(r)
  }

  console.log('--- bucket breakdown ---')
  console.log(`both have bookings:    ${buckets.both.length}`)
  console.log(`one has bookings:      ${buckets.one.length}`)
  console.log(`neither has bookings:  ${buckets.neither.length}`)
  console.log(`total pairs:           ${rows.length}`)

  const flagCounts = {}
  for (const r of rows) for (const f of r._flags) flagCounts[f] = (flagCounts[f] || 0) + 1
  console.log('\n--- flags ---')
  for (const [f, n] of Object.entries(flagCounts)) console.log(`${f}: ${n}`)

  console.log('\n--- aggregate row impact ---')
  const sumKey = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0)
  console.log(`bookings rows:         ${sumKey('old_bookings')}`)
  console.log(`orders rows:           ${sumKey('old_orders')}`)
  console.log(`payments rows:         ${sumKey('old_payments')}`)
  console.log(`order_line_items rows: ${sumKey('old_line_items')}`)
  console.log(`old customer_analytics rows to delete: ${rows.filter((r) => r.old_has_customer_analytics).length}`)
  console.log(`old referral_profiles rows to merge:   ${rows.filter((r) => r.old_has_referral_profile).length}`)
  console.log(`old square_existing_clients rows to delete: ${rows.length}`)

  for (const [name, list] of Object.entries(buckets)) {
    if (list.length === 0) continue
    console.log(`\n--- 10 sample pairs from "${name}" bucket ---`)
    console.log(['canonical_name', 'old_name', 'email|phone', 'match', 'cb', 'ob', 'oo', 'op', 'flags'].join(' | '))
    for (const r of list.slice(0, 10)) {
      const cn = `${r.canonical_given_name || ''} ${r.canonical_family_name || ''}`.trim() || '(unnamed)'
      const on = `${r.old_given_name || ''} ${r.old_family_name || ''}`.trim() || '(unnamed)'
      const contact = r.canonical_email || r.canonical_phone || ''
      console.log([cn, on, contact, r.match_signal, r.canonical_bookings, r.old_bookings, r.old_orders, r.old_payments, r._flags.join(',')].join(' | '))
    }
  }

  // Write CSV
  const tmpDir = path.join(__dirname, '..', 'tmp')
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const csvPath = path.join(tmpDir, `customer-merge-map-${stamp}.csv`)
  const headers = [
    'organization_id', 'canonical_id', 'old_id',
    'canonical_name', 'old_name',
    'canonical_email', 'old_email', 'canonical_phone', 'old_phone',
    'canonical_created_at', 'old_created_at',
    'match_signal',
    'canonical_bookings', 'old_bookings', 'old_orders', 'old_payments', 'old_line_items',
    'canonical_has_customer_analytics', 'old_has_customer_analytics',
    'canonical_has_referral_profile', 'old_has_referral_profile',
    'canonical_first_booking', 'old_first_booking',
    'flags',
  ]
  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push([
      r.organization_id,
      r.canonical_id,
      r.old_id,
      `${r.canonical_given_name || ''} ${r.canonical_family_name || ''}`.trim(),
      `${r.old_given_name || ''} ${r.old_family_name || ''}`.trim(),
      r.canonical_email,
      r.old_email,
      r.canonical_phone,
      r.old_phone,
      fmt(r.canonical_created_at),
      fmt(r.old_created_at),
      r.match_signal,
      r.canonical_bookings,
      r.old_bookings,
      r.old_orders,
      r.old_payments,
      r.old_line_items,
      r.canonical_has_customer_analytics,
      r.old_has_customer_analytics,
      r.canonical_has_referral_profile,
      r.old_has_referral_profile,
      fmt(r.canonical_first_booking),
      fmt(r.old_first_booking),
      r._flags.join('|'),
    ].map(csvEscape).join(','))
  }
  fs.writeFileSync(csvPath, lines.join('\n'))
  console.log(`\n💾 CSV written: ${csvPath}`)
  console.log(`Review the CSV before running scripts/apply-customer-merge.js. Remove any pairs you don't want to consolidate.`)
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
