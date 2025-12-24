#!/usr/bin/env node

/**
 * Marks every legacy customer that already has a personal referral code as an
 * active referrer. This is a one-time helper so old records stop looking like
 * "new" customers to the webhook flow.
 *
 * Usage:
 *   node scripts/activate-existing-referrers.js        # dry run (default)
 *   node scripts/activate-existing-referrers.js --execute   # actually update
 *   node scripts/activate-existing-referrers.js --execute --limit 250
 */

require('dotenv').config()
const { PrismaClient, Prisma } = require('@prisma/client')

const prisma = new PrismaClient()
const args = process.argv.slice(2)
const shouldExecute = args.includes('--execute')
const limitArgIndex = args.indexOf('--limit')
const limitValue =
  limitArgIndex >= 0 && args[limitArgIndex + 1]
    ? parseInt(args[limitArgIndex + 1], 10)
    : null
const limit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : null

const BATCH_SIZE = 250

function chunk(list, size) {
  const output = []
  for (let i = 0; i < list.length; i += size) {
    output.push(list.slice(i, i + size))
  }
  return output
}

async function fetchCandidates() {
  return prisma.$queryRaw`
    SELECT square_customer_id,
           given_name,
           family_name,
           email_address,
           personal_code,
           activated_as_referrer,
           referral_email_sent,
           updated_at
    FROM square_existing_clients
    WHERE personal_code IS NOT NULL
      AND TRIM(personal_code) <> ''
      AND UPPER(TRIM(personal_code)) <> 'NULL'
      AND COALESCE(activated_as_referrer, FALSE) = FALSE
    ORDER BY created_at ASC
  `
}

async function activateBatch(customerIds) {
  if (!customerIds.length) return 0
  const idList = Prisma.join(customerIds.map(id => Prisma.sql`${id}`))
  const result = await prisma.$executeRaw`
    UPDATE square_existing_clients
    SET activated_as_referrer = TRUE,
        updated_at = NOW()
    WHERE square_customer_id IN (${idList})
  `
  return result?.rowCount ?? customerIds.length
}

async function main() {
  try {
    console.log('🔍 Locating legacy customers without activated_as_referrer...')
    const allCandidates = await fetchCandidates()
    const candidates = limit ? allCandidates.slice(0, limit) : allCandidates

    if (!candidates.length) {
      console.log('✅ Nothing to do — every customer is already marked as a referrer.')
      return
    }

    console.log(`📊 Found ${candidates.length} customers to activate.`)
    console.log(`   (Previewing up to 5 rows below)`)
    candidates.slice(0, 5).forEach((customer, idx) => {
      const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
      console.log(
        `   ${idx + 1}. ${name} — code: ${customer.personal_code} — email: ${
          customer.email_address || 'none'
        }`
      )
    })

    if (!shouldExecute) {
      console.log('\nℹ️ Dry run complete. Pass --execute to persist these changes.')
      return
    }

    console.log('\n🚀 Activating customers...')
    let totalUpdated = 0
    for (const batch of chunk(
      candidates.map(c => c.square_customer_id),
      BATCH_SIZE
    )) {
      const updated = await activateBatch(batch)
      totalUpdated += updated
      console.log(`   ✅ Activated ${updated} customers (running total: ${totalUpdated})`)
    }

    console.log('\n🎉 Done!')
    console.log(`   Total customers updated: ${totalUpdated}`)
  } catch (error) {
    console.error('❌ Failed to activate existing referrers:', error)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()


