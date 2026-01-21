#!/usr/bin/env node
/**
 * Fetch all team members from Square and store in database
 * 
 * Usage:
 *   node scripts/fetch-square-team-members.js
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

// Initialize Square client
const squareEnv = process.env.SQUARE_ENV?.trim()?.toLowerCase()
const environment = squareEnv === 'sandbox' ? Environment.Sandbox : Environment.Production
// Prefer token with team scope; fall back to default
let accessToken =
  process.env.SQUARE_ACCESS_TOKEN_2?.trim() ||
  process.env.SQUARE_ACCESS_TOKEN?.trim()

if (!accessToken) {
  console.error('❌ SQUARE_ACCESS_TOKEN_2 or SQUARE_ACCESS_TOKEN is not set in environment variables')
  process.exit(1)
}

// Remove "Bearer " prefix if present
if (accessToken.startsWith('Bearer ')) {
  accessToken = accessToken.substring(7)
}

console.log(`🔑 Using Square ${environment === Environment.Production ? 'Production' : 'Sandbox'} environment`)

const squareClient = new Client({
  accessToken: accessToken,
  environment,
})

const teamApi = squareClient.teamApi

function clean(value) {
  if (value === undefined || value === null) return null
  const trimmed = value.toString().trim()
  return trimmed.length > 0 ? trimmed : null
}

async function fetchAllTeamMembers() {
  try {
    console.log('\n📡 Fetching all team members from Square API...')
    console.log('='.repeat(60))
    
    // First, check if teamApi is available
    if (!teamApi) {
      throw new Error('Team API is not available. Check if teamApi is accessible.')
    }
    
    console.log('   Team API initialized successfully')
    
    console.log('\n   Fetching first page (single call, all statuses)...')
    const request = {
      query: {
        // No status filter → fetch all (active + inactive)
      }
    }
    console.log(`   Making API request with request:`, JSON.stringify(request, null, 2))
    
    const startTime = Date.now()
    const response = await Promise.race([
      teamApi.searchTeamMembers(request),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('API call timeout after 30 seconds')), 30000)
      )
    ])
    const duration = Date.now() - startTime
    console.log(`   ✅ API call completed in ${duration}ms`)
    
    const teamMembers = response.result?.teamMembers || []
    console.log(`   ✅ Received ${teamMembers.length} member(s) in first page`)
    
    if (teamMembers.length === 0) {
      console.log('\n⚠️  No team members found in Square')
      return
    }
    
    const first = teamMembers[0]
    console.log('   First member sample:', {
      id: first.id,
      givenName: first.givenName,
      familyName: first.familyName,
      email: first.emailAddress,
      phone: first.phoneNumber,
      status: first.status,
      assignedLocations: first.assignedLocations?.locationIds || []
    })
    
    // Step 2: Store all members (location_id kept null to avoid FK issues)
    console.log('\n💾 Upserting all members into database...')
    console.log('='.repeat(60))
    
    let created = 0
    let updated = 0
    let skipped = 0
    let errors = 0
    
    for (const member of teamMembers) {
      try {
        const squareTeamMemberId = member.id
        if (!squareTeamMemberId) {
          skipped++
          continue
        }
        // Set location_code if recognized; otherwise UNKNOWN
        const firstLoc = (member.assignedLocations?.locationIds || [])[0] || null
        const locationCode =
          firstLoc === 'LNQKVBTQZN3EZ'
            ? 'PACIFIC_AVE'
            : firstLoc === 'LT4ZHFBQQYB2N'
            ? 'UNION_ST'
            : 'UNKNOWN_LOC'
        const givenName = clean(member.givenName)
        const familyName = clean(member.familyName)
        const emailAddress = clean(member.emailAddress)
        const phoneNumber = clean(member.phoneNumber)
        const status = member.status || 'ACTIVE'
        
        const existing = await prisma.teamMember.findUnique({
          where: { square_team_member_id: squareTeamMemberId }
        })
        
        if (existing) {
          await prisma.teamMember.update({
            where: { square_team_member_id: squareTeamMemberId },
            data: {
              given_name: givenName,
              family_name: familyName,
              email_address: emailAddress,
              phone_number: phoneNumber,
              status: status,
              location_code: locationCode,
              updated_at: new Date()
            }
          })
          updated++
        } else {
          await prisma.teamMember.create({
            data: {
              square_team_member_id: squareTeamMemberId,
              given_name: givenName,
              family_name: familyName,
              email_address: emailAddress,
              phone_number: phoneNumber,
              status: status,
              location_code: locationCode
            }
          })
          created++
        }
      } catch (error) {
        errors++
        console.error(`   ❌ Error processing team member ${member.id}: ${error.message}`)
      }
    }
    
    console.log('\n' + '='.repeat(60))
    console.log('📊 Summary:')
    console.log(`   Created: ${created}`)
    console.log(`   Updated: ${updated}`)
    console.log(`   Skipped: ${skipped}`)
    console.log(`   Errors: ${errors}`)
    console.log(`   Total processed: ${teamMembers.length}`)
    
  } catch (error) {
    console.error('\n❌ Error fetching team members:', error.message)
    if (error.errors) {
      console.error('Error details:', JSON.stringify(error.errors, null, 2))
    }
    throw error
  }
}

async function main() {
  try {
    await fetchAllTeamMembers()
  } catch (error) {
    console.error('Fatal error:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main()
}

