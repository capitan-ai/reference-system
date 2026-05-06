#!/usr/bin/env node
/**
 * Set square_existing_clients.first_visit_at when NULL from first ACCEPTED/COMPLETED booking.
 * Aligns analytics new_customers with webhook-set first_visit_at after historical gaps.
 *
 * Usage:
 *   node scripts/backfill-square-existing-clients-first-visit-at.js --dry-run
 *   node scripts/backfill-square-existing-clients-first-visit-at.js [--org <uuid>]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const prisma = require('../lib/prisma-client')

function parseArgs() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const oi = argv.indexOf('--org')
  const org = oi >= 0 ? argv[oi + 1] : null
  return { dryRun, org }
}

async function main() {
  const { dryRun, org } = parseArgs()
  if (org && !/^[0-9a-f-]{36}$/i.test(org)) {
    console.error('Invalid --org UUID')
    process.exit(1)
  }

  const preview = org
    ? await prisma.$queryRaw`
    SELECT COUNT(*)::bigint AS n
    FROM square_existing_clients sec
    WHERE sec.first_visit_at IS NULL
      AND sec.organization_id = ${org}::uuid
      AND EXISTS (
        SELECT 1
        FROM bookings b
        WHERE b.organization_id = sec.organization_id
          AND b.customer_id = sec.square_customer_id
          AND b.status IN ('ACCEPTED', 'COMPLETED')
      )
  `
    : await prisma.$queryRaw`
    SELECT COUNT(*)::bigint AS n
    FROM square_existing_clients sec
    WHERE sec.first_visit_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM bookings b
        WHERE b.organization_id = sec.organization_id
          AND b.customer_id = sec.square_customer_id
          AND b.status IN ('ACCEPTED', 'COMPLETED')
      )
  `

  const n = Number(preview[0]?.n || 0)
  console.log(
    dryRun
      ? `[dry-run] Would update up to ${n} rows (first_visit_at IS NULL, has qualifying booking).`
      : `Updating up to ${n} rows...`
  )

  if (n === 0) {
    await prisma.$disconnect()
    return
  }

  if (dryRun) {
    const sample = org
      ? await prisma.$queryRaw`
      SELECT sec.square_customer_id, sub.first_at
      FROM square_existing_clients sec
      INNER JOIN (
        SELECT b.organization_id, b.customer_id, MIN(b.start_at) AS first_at
        FROM bookings b
        WHERE b.customer_id IS NOT NULL
          AND b.status IN ('ACCEPTED', 'COMPLETED')
        GROUP BY b.organization_id, b.customer_id
      ) sub ON sub.organization_id = sec.organization_id
        AND sub.customer_id = sec.square_customer_id
      WHERE sec.first_visit_at IS NULL
        AND sec.organization_id = ${org}::uuid
      LIMIT 15
    `
      : await prisma.$queryRaw`
      SELECT sec.square_customer_id, sub.first_at
      FROM square_existing_clients sec
      INNER JOIN (
        SELECT b.organization_id, b.customer_id, MIN(b.start_at) AS first_at
        FROM bookings b
        WHERE b.customer_id IS NOT NULL
          AND b.status IN ('ACCEPTED', 'COMPLETED')
        GROUP BY b.organization_id, b.customer_id
      ) sub ON sub.organization_id = sec.organization_id
        AND sub.customer_id = sec.square_customer_id
      WHERE sec.first_visit_at IS NULL
      LIMIT 15
    `
    console.log('Sample:', sample)
    await prisma.$disconnect()
    return
  }

  const result = org
    ? await prisma.$executeRaw`
    UPDATE square_existing_clients sec
    SET
      first_visit_at = sub.first_at,
      updated_at = NOW()
    FROM (
      SELECT b.organization_id, b.customer_id, MIN(b.start_at) AS first_at
      FROM bookings b
      WHERE b.customer_id IS NOT NULL
        AND b.status IN ('ACCEPTED', 'COMPLETED')
      GROUP BY b.organization_id, b.customer_id
    ) sub
    WHERE sec.organization_id = sub.organization_id
      AND sec.square_customer_id = sub.customer_id
      AND sec.first_visit_at IS NULL
      AND sec.organization_id = ${org}::uuid
  `
    : await prisma.$executeRaw`
    UPDATE square_existing_clients sec
    SET
      first_visit_at = sub.first_at,
      updated_at = NOW()
    FROM (
      SELECT b.organization_id, b.customer_id, MIN(b.start_at) AS first_at
      FROM bookings b
      WHERE b.customer_id IS NOT NULL
        AND b.status IN ('ACCEPTED', 'COMPLETED')
      GROUP BY b.organization_id, b.customer_id
    ) sub
    WHERE sec.organization_id = sub.organization_id
      AND sec.square_customer_id = sub.customer_id
      AND sec.first_visit_at IS NULL
  `

  console.log(`Done. Rows updated: ${result}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
