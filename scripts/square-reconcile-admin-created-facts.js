#!/usr/bin/env node
/**
 * Square Reconciliation для admin_created_booking_facts (СКЕЛЕТ).
 *
 * Ночной job: сверяет нашу классификацию NEW/REBOOK с Square.
 * Primary truth = наша БД; Square = audit layer.
 *
 * Для полной реализации нужно:
 * 1. Добавить в admin_created_booking_facts: square_classification, square_checked_at, square_mismatch_flag
 * 2. Интегрировать Square Customers/Bookings API
 * 3. Определить логику Square "first visit" для сопоставления
 *
 * Usage:
 *   node scripts/square-reconcile-admin-created-facts.js [--days=35] [--dry-run]
 *
 * @see docs/ADMIN_CREATED_BOOKINGS_SQUARE_RECONCILIATION.md
 */

const db = require('../lib/prisma-client')

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const daysParam = process.argv.find(arg => arg.startsWith('--days='))?.split('=')[1] || '35'
  const days = parseInt(daysParam, 10)

  console.log('\n--- Square Reconciliation (skeleton) ---')
  console.log(`Days: ${days}, Dry run: ${dryRun}`)

  // Check if square_checked_at column exists (migration may not be applied)
  try {
    const countResult = await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int as cnt
      FROM admin_created_booking_facts
      WHERE created_day_pacific >= CURRENT_DATE - $1::int
    `, days)
    const cnt = countResult[0]?.cnt ?? 0
    console.log(`Facts in range: ${cnt}`)
  } catch (e) {
    console.error('Error:', e.message)
    process.exit(1)
  }

  console.log('\nSkeleton complete. For full implementation:')
  console.log('1. Add square_classification, square_checked_at, square_mismatch_flag to schema')
  console.log('2. Implement Square API calls for customer booking history')
  console.log('3. Map Square first-visit logic to our NEW/REBOOK')
  console.log('4. Update facts and log mismatches')
  console.log('')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
