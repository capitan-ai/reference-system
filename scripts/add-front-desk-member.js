#!/usr/bin/env node
/**
 * Add Anastasia Shpakovskaia as a FRONT_DESK team member
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const organizationId = 'd0e24178-2f94-4033-bc91-41f22df58278'

async function addFrontDeskMember() {
  console.log('Adding front desk team member...\n')

  const result = await prisma.$executeRaw`
    INSERT INTO team_members (
      id,
      organization_id,
      square_team_member_id,
      given_name,
      family_name,
      phone_number,
      status,
      location_code,
      role,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      ${organizationId}::uuid,
      'FRONT_DESK_ANASTASIA',
      'Anastasia',
      'Shpakovskaia',
      '+12136364590',
      'ACTIVE',
      'PACIFIC_AVE',
      'FRONT_DESK',
      NOW(),
      NOW()
    )
    ON CONFLICT (organization_id, square_team_member_id) DO UPDATE SET
      given_name = EXCLUDED.given_name,
      family_name = EXCLUDED.family_name,
      phone_number = EXCLUDED.phone_number,
      status = EXCLUDED.status,
      role = 'FRONT_DESK',
      updated_at = NOW()
  `

  const member = await prisma.$queryRaw`
    SELECT id, given_name, family_name, phone_number, role, location_code, status
    FROM team_members
    WHERE square_team_member_id = 'FRONT_DESK_ANASTASIA'
      AND organization_id = ${organizationId}::uuid
    LIMIT 1
  `

  if (member.length > 0) {
    const m = member[0]
    console.log('Done!\n')
    console.log(`  UUID:     ${m.id}`)
    console.log(`  Name:     ${m.given_name} ${m.family_name}`)
    console.log(`  Phone:    ${m.phone_number}`)
    console.log(`  Role:     ${m.role}`)
    console.log(`  Location: ${m.location_code}`)
    console.log(`  Status:   ${m.status}`)
  }
}

addFrontDeskMember()
  .catch((err) => {
    console.error('Error:', err.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
