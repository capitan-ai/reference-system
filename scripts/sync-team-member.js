#!/usr/bin/env node
/**
 * Sync a specific team member from Square to database
 * 
 * Usage:
 *   node scripts/sync-team-member.js <square_team_member_id>
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()
const teamMemberId = process.argv[2] || 'TMqru6XrVpKIiYYS'
const organizationId = 'd0e24178-2f94-4033-bc91-41f22df58278'

const squareEnv = (process.env.SQUARE_ENV || 'production').toLowerCase()
const environment = squareEnv === 'sandbox' ? Environment.Sandbox : Environment.Production
let token = process.env.SQUARE_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN_2
if (!token) {
  console.error('❌ Missing SQUARE_ACCESS_TOKEN')
  process.exit(1)
}
if (token.startsWith('Bearer ')) token = token.slice(7)

const square = new Client({ accessToken: token.trim(), environment })
const teamApi = square.teamApi

function cleanValue(value) {
  if (value === undefined || value === null) return null
  const trimmed = value.toString().trim()
  return trimmed.length > 0 ? trimmed : null
}

async function syncTeamMember() {
  console.log('🔍 Fetching team member from Square:')
  console.log('='.repeat(100))
  console.log(`   Team Member ID: ${teamMemberId}`)
  console.log(`   Environment: ${squareEnv}`)
  console.log('')
  
  try {
    const response = await teamApi.retrieveTeamMember(teamMemberId)
    
    if (!response.result || !response.result.teamMember) {
      console.log('❌ Team member not found in Square')
      return false
    }
    
    const member = response.result.teamMember
    
    console.log('✅ Team member found in Square!')
    console.log('')
    console.log('📋 Team Member Details:')
    console.log('='.repeat(100))
    console.log(`   ID: ${member.id}`)
    console.log(`   Given Name: ${member.givenName || 'N/A'}`)
    console.log(`   Family Name: ${member.familyName || 'N/A'}`)
    console.log(`   Email: ${member.emailAddress || 'N/A'}`)
    console.log(`   Phone: ${member.phoneNumber || 'N/A'}`)
    console.log(`   Status: ${member.status || 'N/A'}`)
    console.log(`   Assigned Locations: ${(member.assignedLocations?.locationIds || []).join(', ') || 'N/A'}`)
    console.log('')
    
    // Determine location code
    const firstLoc = (member.assignedLocations?.locationIds || [])[0] || null
    const locationCode =
      firstLoc === 'LNQKVBTQZN3EZ'
        ? 'PACIFIC_AVE'
        : firstLoc === 'LT4ZHFBQQYB2N'
        ? 'UNION_ST'
        : 'UNKNOWN_LOC'
    
    console.log('💾 Syncing to database...')
    console.log('')
    
    // Insert or update team member
    await prisma.$executeRaw`
      INSERT INTO team_members (
        id,
        organization_id,
        square_team_member_id,
        given_name,
        family_name,
        email_address,
        phone_number,
        status,
        location_code,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        ${organizationId}::uuid,
        ${member.id},
        ${cleanValue(member.givenName)},
        ${cleanValue(member.familyName)},
        ${cleanValue(member.emailAddress)},
        ${cleanValue(member.phoneNumber)},
        ${member.status || 'ACTIVE'},
        ${locationCode},
        NOW(),
        NOW()
      )
      ON CONFLICT (organization_id, square_team_member_id) DO UPDATE SET
        given_name = EXCLUDED.given_name,
        family_name = EXCLUDED.family_name,
        email_address = EXCLUDED.email_address,
        phone_number = EXCLUDED.phone_number,
        status = EXCLUDED.status,
        location_code = EXCLUDED.location_code,
        updated_at = NOW()
    `
    
    // Get the UUID
    const tm = await prisma.$queryRaw`
      SELECT id, given_name, family_name, email_address, location_code
      FROM team_members
      WHERE square_team_member_id = ${teamMemberId}
        AND organization_id = ${organizationId}::uuid
      LIMIT 1
    `
    
    console.log('✅ Team member synced to database!')
    console.log('='.repeat(100))
    console.log(`   UUID: ${tm[0].id}`)
    console.log(`   Name: ${(tm[0].given_name || '') + ' ' + (tm[0].family_name || '')}`.trim() || 'N/A')
    console.log(`   Email: ${tm[0].email_address || 'N/A'}`)
    console.log(`   Location Code: ${tm[0].location_code || 'N/A'}`)
    console.log('='.repeat(100))
    
    return true
  } catch (error) {
    if (error.statusCode === 404) {
      console.log('❌ Team member not found in Square (404)')
      console.log('   This team member may have been deleted or never existed.')
      return false
    }
    console.error('❌ Error:', error.message)
    if (error.errors) {
      console.error('   Details:', JSON.stringify(error.errors, null, 2))
    }
    return false
  }
}

syncTeamMember()
  .then((success) => {
    if (success) {
      console.log('\n✅ Sync completed successfully')
    } else {
      console.log('\n⚠️  Sync completed with warnings')
    }
    process.exit(success ? 0 : 1)
  })
  .catch((error) => {
    console.error('\n❌ Sync failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

