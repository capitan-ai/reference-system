#!/usr/bin/env node
/**
 * Fix bookings missing technician_id
 *
 * Problem 1: 28 bookings exist in DB but technician_id is NULL.
 *   Square bookings ALWAYS have a team member — our backfill missed it.
 *   Fix: call Square Bookings API → extract teamMemberId → update booking + payment.
 *
 * Problem 3: 3 payments have booking_id + booking has technician, but payment.technician_id is NULL.
 *   Fix: simple SQL update.
 *
 * Usage:
 *   node scripts/fix-bookings-without-technician.js [--dry-run]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const prisma = require('../lib/prisma-client')
const https = require('https')

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'
const DRY_RUN = process.argv.includes('--dry-run')

function getSquareToken() {
  let token = process.env.SQUARE_ACCESS_TOKEN?.trim()
  if (token?.startsWith('Bearer ')) token = token.slice(7)
  return token
}

// Fetch team member from Square REST API (SDK hangs in some envs)
async function fetchSquareTeamMember(squareTeamMemberId) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://connect.squareup.com/v2/team-members/${squareTeamMemberId}`,
      { headers: { Authorization: `Bearer ${getSquareToken()}`, 'Content-Type': 'application/json' }, timeout: 15000 },
      (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch { resolve(null) }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function resolveOrCreateTeamMember(squareTeamMemberId) {
  if (!squareTeamMemberId) return null

  // Try to find existing
  const existing = await prisma.teamMember.findFirst({
    where: { square_team_member_id: squareTeamMemberId, organization_id: ORG_ID },
    select: { id: true, given_name: true, family_name: true },
  })
  if (existing) return existing

  // Fetch from Square and create
  console.log(`    Creating missing team member ${squareTeamMemberId}...`)
  try {
    const data = await fetchSquareTeamMember(squareTeamMemberId)
    const tm = data?.team_member
    if (!tm) {
      console.log(`    Could not fetch from Square`)
      return null
    }

    if (DRY_RUN) {
      console.log(`    Would create: ${tm.given_name} ${tm.family_name} (${tm.status})`)
      return { id: 'DRY_RUN', given_name: tm.given_name, family_name: tm.family_name }
    }

    const created = await prisma.teamMember.create({
      data: {
        organization_id: ORG_ID,
        square_team_member_id: squareTeamMemberId,
        given_name: tm.given_name || '',
        family_name: tm.family_name || '',
        email_address: tm.email_address || null,
        phone_number: tm.phone_number || null,
        status: tm.status || 'ACTIVE',
      },
      select: { id: true, given_name: true, family_name: true },
    })
    console.log(`    Created: ${created.given_name} ${created.family_name} (${created.id})`)
    return created
  } catch (err) {
    console.error(`    Error creating team member: ${err.message}`)
    return null
  }
}

async function fixProblem3() {
  console.log('\n=== Problem 3: Payments with booking+technician but missing payment.technician_id ===\n')

  const orphanPayments = await prisma.$queryRawUnsafe(`
    SELECT p.id, p.payment_id, p.booking_id, p.amount_money_amount,
           b.technician_id AS booking_tech_id,
           TRIM(COALESCE(tm.given_name, '') || ' ' || COALESCE(tm.family_name, '')) AS tech_name
    FROM payments p
    JOIN bookings b ON b.id = p.booking_id
    JOIN team_members tm ON tm.id = b.technician_id
    WHERE p.organization_id = $1::uuid
      AND p.technician_id IS NULL
      AND b.technician_id IS NOT NULL
  `, ORG_ID)

  console.log(`Found ${orphanPayments.length} payments to fix`)

  if (orphanPayments.length === 0) {
    console.log('Nothing to fix.')
    return 0
  }

  for (const p of orphanPayments) {
    console.log(`  ${p.tech_name}: $${(Number(p.amount_money_amount) / 100).toFixed(2)} — setting technician_id = ${p.booking_tech_id}`)
  }

  if (DRY_RUN) {
    console.log('\n(dry-run, no changes)')
    return orphanPayments.length
  }

  const result = await prisma.$queryRawUnsafe(`
    UPDATE payments p
    SET technician_id = b.technician_id, updated_at = NOW()
    FROM bookings b
    WHERE p.booking_id = b.id
      AND p.organization_id = $1::uuid
      AND p.technician_id IS NULL
      AND b.technician_id IS NOT NULL
  `, ORG_ID)

  console.log(`Updated ${orphanPayments.length} payments`)
  return orphanPayments.length
}

// Fetch booking from Square REST API directly
async function fetchSquareBooking(squareBookingId) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://connect.squareup.com/v2/bookings/${squareBookingId}`,
      { headers: { Authorization: `Bearer ${getSquareToken()}`, 'Content-Type': 'application/json' }, timeout: 15000 },
      (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch { resolve(null) }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function fixProblem1() {
  console.log('\n=== Problem 1: Bookings missing technician_id — fetch from Square API ===\n')

  // Find bookings with no technician_id that have payments
  const bookingsWithoutTech = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT ON (b.id)
      b.id AS booking_uuid,
      b.booking_id AS square_booking_id,
      b.start_at,
      b.status,
      p.amount_money_amount,
      p.tip_money_amount,
      p.id AS payment_uuid
    FROM bookings b
    JOIN payments p ON p.booking_id = b.id
    WHERE b.organization_id = $1::uuid
      AND b.technician_id IS NULL
      AND p.status = 'COMPLETED'
    ORDER BY b.id, b.start_at
  `, ORG_ID)

  console.log(`Found ${bookingsWithoutTech.length} bookings without technician_id that have payments`)

  if (bookingsWithoutTech.length === 0) {
    console.log('Nothing to fix.')
    return 0
  }

  // First try: resolve from booking_segments (already fetched from Square)
  let fixed = 0, failed = 0, skipped = 0

  for (const row of bookingsWithoutTech) {
    const sqId = row.square_booking_id
    const baseId = sqId?.includes('-') ? sqId.split('-')[0] : sqId

    if (!baseId) {
      console.log(`  SKIP: booking ${row.booking_uuid} has no square_booking_id`)
      skipped++
      continue
    }

    try {
      // First check booking_segments for the team member
      const segData = await prisma.$queryRawUnsafe(`
        SELECT square_team_member_id
        FROM booking_segments
        WHERE booking_id = $1::uuid AND is_active = true AND square_team_member_id IS NOT NULL
        LIMIT 1
      `, row.booking_uuid)

      let squareTeamMemberId = segData[0]?.square_team_member_id

      // If not in segments, fetch from Square API
      if (!squareTeamMemberId) {
        const data = await fetchSquareBooking(baseId)
        const booking = data?.booking
        if (!booking) {
          console.log(`  SKIP: Square returned no data for ${baseId}`)
          skipped++
          continue
        }
        const segments = booking.appointment_segments || booking.appointmentSegments || []
        const seg = segments[0]
        squareTeamMemberId = seg?.team_member_id || seg?.teamMemberId
      }

      if (!squareTeamMemberId) {
        console.log(`  SKIP: ${baseId} — no teamMemberId found`)
        skipped++
        continue
      }

      const tm = await resolveOrCreateTeamMember(squareTeamMemberId)
      if (!tm) {
        console.log(`  SKIP: ${baseId} — could not resolve team member ${squareTeamMemberId}`)
        skipped++
        continue
      }

      const name = `${tm.given_name || ''} ${tm.family_name || ''}`.trim()
      console.log(`  FIX: ${baseId} → ${name} (${tm.id}), gross $${(Number(row.amount_money_amount) / 100).toFixed(2)}`)

      if (!DRY_RUN) {
        // Update booking
        await prisma.booking.update({
          where: { id: row.booking_uuid },
          data: { technician_id: tm.id },
        })

        // Update all payments linked to this booking that have no technician
        await prisma.$queryRawUnsafe(`
          UPDATE payments
          SET technician_id = $1::uuid, updated_at = NOW()
          WHERE booking_id = $2::uuid AND technician_id IS NULL
        `, tm.id, row.booking_uuid)
      }

      fixed++
    } catch (err) {
      console.error(`  ERROR: ${baseId} — ${err.message}`)
      failed++
    }

    // Rate limit: Square allows 10 req/sec
    await new Promise(r => setTimeout(r, 150))
  }

  console.log(`\nResults: ${fixed} fixed, ${skipped} skipped, ${failed} failed`)
  if (DRY_RUN) console.log('(dry-run, no changes were made)')
  return fixed
}

async function main() {
  console.log('=== Fix Bookings Without Technician ===')
  console.log(`Organization: ${ORG_ID}`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`)

  const p3Fixed = await fixProblem3()
  const p1Fixed = await fixProblem1()

  console.log(`\n=== Summary ===`)
  console.log(`Problem 3 (payment.technician_id from booking): ${p3Fixed}`)
  console.log(`Problem 1 (booking.technician_id from Square API): ${p1Fixed}`)
}

main()
  .catch(err => {
    console.error('Fatal:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
