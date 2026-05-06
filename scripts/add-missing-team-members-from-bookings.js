#!/usr/bin/env node
/**
 * Find Square team_member_ids that appear in bookings (creator_details) but are
 * missing from team_members; fetch each from Square API, insert into team_members,
 * then set bookings.administrator_id for those creators.
 *
 * Usage: node scripts/add-missing-team-members-from-bookings.js [--dry-run]
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { getSquareClient } = require('../lib/utils/square-client')

const prisma = new PrismaClient()
const dryRun = process.argv.includes('--dry-run')
const SQUARE_REQUEST_TIMEOUT_MS = 20000

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label || 'Request'} timed out after ${ms}ms`)), ms)
    ),
  ])
}

function cleanValue(value) {
  if (value === undefined || value === null) return null
  const trimmed = String(value).trim()
  return trimmed.length > 0 ? trimmed : null
}

function locationCodeFromSquare(firstLocId) {
  if (!firstLocId) return 'UNKNOWN_LOC'
  if (firstLocId === 'LNQKVBTQZN3EZ') return 'PACIFIC_AVE'
  if (firstLocId === 'LT4ZHFBQQYB2N') return 'UNION_ST'
  return 'UNKNOWN_LOC'
}

async function getMissingCreatorPairs() {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT
      b.organization_id,
      b.raw_json->'creator_details'->>'team_member_id' AS square_team_member_id
    FROM bookings b
    WHERE b.administrator_id IS NULL
      AND (b.creator_type = 'TEAM_MEMBER' OR b.raw_json->'creator_details'->>'creator_type' = 'TEAM_MEMBER')
      AND b.raw_json->'creator_details'->>'team_member_id' IS NOT NULL
      AND b.raw_json->'creator_details'->>'team_member_id' <> ''
  `
  const pairs = rows.map((r) => ({ organization_id: r.organization_id, square_team_member_id: r.square_team_member_id }))
  if (pairs.length === 0) return []

  const existing = await prisma.teamMember.findMany({
    where: {
      OR: pairs.map((p) => ({
        organization_id: p.organization_id,
        square_team_member_id: p.square_team_member_id,
      })),
    },
    select: { organization_id: true, square_team_member_id: true },
  })
  const existingSet = new Set(existing.map((e) => `${e.organization_id}:${e.square_team_member_id}`))
  return pairs.filter((p) => !existingSet.has(`${p.organization_id}:${p.square_team_member_id}`))
}

async function main() {
  console.log('\n=== Add missing team members from bookings (Square API) ===\n')
  if (dryRun) console.log('DRY RUN — no DB writes.\n')

  const missing = await getMissingCreatorPairs()
  if (missing.length === 0) {
    console.log('No missing (org, square_team_member_id) pairs. All creators are in team_members.')
    console.log('You can run: node scripts/deep-fix-admins.js to set administrator_id from existing team_members.')
    return
  }

  console.log(`Found ${missing.length} Square team member ID(s) in bookings but not in team_members:\n`)
  missing.forEach((p) => console.log(`  Org: ${p.organization_id}  Square ID: ${p.square_team_member_id}`))

  const square = getSquareClient()
  let added = 0
  let failed = 0

  for (const { organization_id, square_team_member_id } of missing) {
    try {
      const response = await withTimeout(
        square.teamApi.retrieveTeamMember(square_team_member_id),
        SQUARE_REQUEST_TIMEOUT_MS,
        `Square retrieveTeamMember(${square_team_member_id})`
      )
      const member = response.result?.teamMember
      if (!member) {
        console.log(`  ⚠ ${square_team_member_id}: not found in Square (deleted or wrong merchant)`)
        failed++
        continue
      }

      const firstLoc = (member.assignedLocations?.locationIds || [])[0] || null
      const locationCode = locationCodeFromSquare(firstLoc)

      if (!dryRun) {
        await prisma.teamMember.upsert({
          where: {
            organization_id_square_team_member_id: {
              organization_id,
              square_team_member_id: member.id,
            },
          },
          update: {
            given_name: cleanValue(member.givenName),
            family_name: cleanValue(member.familyName),
            email_address: cleanValue(member.emailAddress),
            phone_number: cleanValue(member.phoneNumber),
            status: member.status || 'ACTIVE',
            location_code: locationCode,
            updated_at: new Date(),
          },
          create: {
            organization_id,
            square_team_member_id: member.id,
            given_name: cleanValue(member.givenName),
            family_name: cleanValue(member.familyName),
            email_address: cleanValue(member.emailAddress),
            phone_number: cleanValue(member.phoneNumber),
            status: member.status || 'ACTIVE',
            location_code: locationCode,
            is_system: false,
          },
        })
      }

      console.log(`  ✅ ${member.id}  ${(member.givenName || '')} ${(member.familyName || '')}`.trim())
      added++
    } catch (err) {
      if (err.statusCode === 404) {
        console.log(`  ⚠ ${square_team_member_id}: 404 in Square`)
      } else {
        console.log(`  ❌ ${square_team_member_id}: ${err.message}`)
      }
      failed++
    }
  }

  console.log(`\nAdded to team_members: ${added}  Failed/not found: ${failed}`)

  if (added > 0 && !dryRun) {
    console.log('\nUpdating bookings.administrator_id from raw_json where team_member now exists...')
    const updated = await prisma.$executeRaw`
      UPDATE bookings b
      SET administrator_id = tm.id, updated_at = NOW()
      FROM team_members tm
      WHERE b.administrator_id IS NULL
        AND (b.creator_type = 'TEAM_MEMBER' OR b.raw_json->'creator_details'->>'creator_type' = 'TEAM_MEMBER')
        AND tm.square_team_member_id = b.raw_json->'creator_details'->>'team_member_id'
        AND tm.organization_id = b.organization_id
    `
    console.log(`  Updated ${updated} bookings.`)
    console.log('\nRun admin analytics refresh to recompute scorecards (e.g. cron or POST /api/admin/analytics/refresh-admin).')
  }

  if (dryRun && added > 0) {
    console.log('\nRe-run without --dry-run to insert team members and update bookings.')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
