#!/usr/bin/env node
/**
 * Compare stored booking fields with raw_json values
 * Checks: service_variation_id, service_variation_version, technician_id
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function compareBookingFields() {
  console.log('🔍 Comparing booking fields with raw_json...\n')
  
  // Get bookings with raw_json
  const bookings = await prisma.$queryRaw`
    SELECT 
      id,
      booking_id,
      service_variation_id::text as service_variation_id,
      service_variation_version,
      technician_id::text as technician_id,
      raw_json
    FROM bookings
    WHERE raw_json IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 200
  `
  
  console.log(`📊 Analyzing ${bookings.length} bookings...\n`)
  
  const mismatches = {
    service_variation_id: [],
    service_variation_version: [],
    technician_id: [],
    missing_raw_data: []
  }
  
  // Get service variation mapping (Square ID -> UUID)
  const serviceVariationMap = new Map()
  const allServiceVariationIds = new Set()
  
  for (const booking of bookings) {
    if (!booking.raw_json) continue
    
    const rawJson = typeof booking.raw_json === 'string' 
      ? JSON.parse(booking.raw_json) 
      : booking.raw_json
    
    const segments = rawJson.appointmentSegments || rawJson.appointment_segments || []
    if (segments.length > 0) {
      const segment = segments[0]
      const rawServiceVariationId = segment.serviceVariationId || segment.service_variation_id
      if (rawServiceVariationId) {
        allServiceVariationIds.add(rawServiceVariationId)
      }
    }
  }
  
  // Fetch all service variations at once
  if (allServiceVariationIds.size > 0) {
    const serviceVariations = await prisma.$queryRaw`
      SELECT uuid::text as id, square_variation_id
      FROM service_variation
      WHERE square_variation_id = ANY(${Array.from(allServiceVariationIds)}::text[])
    `
    
    for (const sv of serviceVariations) {
      serviceVariationMap.set(sv.square_variation_id, sv.id)
    }
  }
  
  // Get team member mapping (Square ID -> UUID)
  const teamMemberMap = new Map()
  const allTeamMemberIds = new Set()
  
  for (const booking of bookings) {
    if (!booking.raw_json) continue
    
    const rawJson = typeof booking.raw_json === 'string' 
      ? JSON.parse(booking.raw_json) 
      : booking.raw_json
    
    const segments = rawJson.appointmentSegments || rawJson.appointment_segments || []
    for (const segment of segments) {
      const rawTeamMemberId = segment.teamMemberId || segment.team_member_id
      if (rawTeamMemberId) {
        allTeamMemberIds.add(rawTeamMemberId)
      }
    }
  }
  
  // Fetch all team members at once
  if (allTeamMemberIds.size > 0) {
    const teamMembers = await prisma.$queryRaw`
      SELECT id::text as id, square_team_member_id
      FROM team_members
      WHERE square_team_member_id = ANY(${Array.from(allTeamMemberIds)}::text[])
    `
    
    for (const tm of teamMembers) {
      teamMemberMap.set(tm.square_team_member_id, tm.id)
    }
  }
  
  // Now compare each booking
  for (const booking of bookings) {
    if (!booking.raw_json) {
      mismatches.missing_raw_data.push({
        booking_id: booking.booking_id,
        id: booking.id
      })
      continue
    }
    
    const rawJson = typeof booking.raw_json === 'string' 
      ? JSON.parse(booking.raw_json) 
      : booking.raw_json
    
    const segments = rawJson.appointmentSegments || rawJson.appointment_segments || []
    
    if (segments.length === 0) {
      mismatches.missing_raw_data.push({
        booking_id: booking.booking_id,
        id: booking.id,
        reason: 'No appointmentSegments in raw_json'
      })
      continue
    }
    
    const segment = segments[0]
    
    // Check service_variation_id
    const rawServiceVariationId = segment.serviceVariationId || segment.service_variation_id
    if (rawServiceVariationId) {
      const expectedUuid = serviceVariationMap.get(rawServiceVariationId)
      const storedUuid = booking.service_variation_id
      
      if (expectedUuid && storedUuid !== expectedUuid) {
        mismatches.service_variation_id.push({
          booking_id: booking.booking_id,
          id: booking.id,
          stored: storedUuid || 'NULL',
          expected: expectedUuid,
          raw_square_id: rawServiceVariationId
        })
      } else if (!expectedUuid && storedUuid) {
        mismatches.service_variation_id.push({
          booking_id: booking.booking_id,
          id: booking.id,
          stored: storedUuid,
          expected: 'NOT_FOUND_IN_DB',
          raw_square_id: rawServiceVariationId,
          note: 'Service variation not found in database'
        })
      }
    }
    
    // Check service_variation_version
    const rawVersion = segment.serviceVariationVersion || segment.service_variation_version
    const storedVersion = booking.service_variation_version 
      ? booking.service_variation_version.toString() 
      : null
    
    const rawVersionStr = rawVersion ? rawVersion.toString() : null
    
    if (rawVersionStr && storedVersion !== rawVersionStr) {
      mismatches.service_variation_version.push({
        booking_id: booking.booking_id,
        id: booking.id,
        stored: storedVersion || 'NULL',
        raw_json: rawVersionStr
      })
    }
    
    // Check technician_id
    const rawTeamMemberId = segment.teamMemberId || segment.team_member_id
    if (rawTeamMemberId) {
      const expectedUuid = teamMemberMap.get(rawTeamMemberId)
      const storedUuid = booking.technician_id
      
      if (expectedUuid && storedUuid !== expectedUuid) {
        mismatches.technician_id.push({
          booking_id: booking.booking_id,
          id: booking.id,
          stored: storedUuid || 'NULL',
          expected: expectedUuid,
          raw_square_id: rawTeamMemberId
        })
      } else if (!expectedUuid && storedUuid) {
        mismatches.technician_id.push({
          booking_id: booking.booking_id,
          id: booking.id,
          stored: storedUuid,
          expected: 'NOT_FOUND_IN_DB',
          raw_square_id: rawTeamMemberId,
          note: 'Team member not found in database'
        })
      } else if (expectedUuid && !storedUuid) {
        mismatches.technician_id.push({
          booking_id: booking.booking_id,
          id: booking.id,
          stored: 'NULL',
          expected: expectedUuid,
          raw_square_id: rawTeamMemberId,
          note: 'Team member exists but not stored'
        })
      }
    }
  }
  
  // Print results
  console.log('='.repeat(80))
  console.log('📊 COMPARISON RESULTS\n')
  
  console.log(`1️⃣ Service Variation ID Mismatches: ${mismatches.service_variation_id.length}`)
  if (mismatches.service_variation_id.length > 0) {
    console.log('\n   First 10 mismatches:')
    for (const mismatch of mismatches.service_variation_id.slice(0, 10)) {
      console.log(`\n   Booking: ${mismatch.booking_id}`)
      console.log(`      Stored UUID: ${mismatch.stored}`)
      console.log(`      Expected UUID: ${mismatch.expected}`)
      console.log(`      Raw Square ID: ${mismatch.raw_square_id}`)
      if (mismatch.note) {
        console.log(`      ⚠️ ${mismatch.note}`)
      }
    }
    if (mismatches.service_variation_id.length > 10) {
      console.log(`\n   ... and ${mismatches.service_variation_id.length - 10} more`)
    }
  }
  
  console.log(`\n2️⃣ Service Variation Version Mismatches: ${mismatches.service_variation_version.length}`)
  if (mismatches.service_variation_version.length > 0) {
    console.log('\n   First 10 mismatches:')
    for (const mismatch of mismatches.service_variation_version.slice(0, 10)) {
      console.log(`\n   Booking: ${mismatch.booking_id}`)
      console.log(`      Stored: ${mismatch.stored}`)
      console.log(`      Raw JSON: ${mismatch.raw_json}`)
    }
    if (mismatches.service_variation_version.length > 10) {
      console.log(`\n   ... and ${mismatches.service_variation_version.length - 10} more`)
    }
  }
  
  console.log(`\n3️⃣ Technician ID Mismatches: ${mismatches.technician_id.length}`)
  if (mismatches.technician_id.length > 0) {
    console.log('\n   First 10 mismatches:')
    for (const mismatch of mismatches.technician_id.slice(0, 10)) {
      console.log(`\n   Booking: ${mismatch.booking_id}`)
      console.log(`      Stored UUID: ${mismatch.stored}`)
      console.log(`      Expected UUID: ${mismatch.expected}`)
      console.log(`      Raw Square ID: ${mismatch.raw_square_id}`)
      if (mismatch.note) {
        console.log(`      ⚠️ ${mismatch.note}`)
      }
    }
    if (mismatches.technician_id.length > 10) {
      console.log(`\n   ... and ${mismatches.technician_id.length - 10} more`)
    }
  }
  
  console.log(`\n4️⃣ Missing Raw Data: ${mismatches.missing_raw_data.length}`)
  if (mismatches.missing_raw_data.length > 0) {
    console.log('\n   Bookings without raw_json or appointmentSegments:')
    for (const item of mismatches.missing_raw_data.slice(0, 5)) {
      console.log(`      - ${item.booking_id}${item.reason ? ` (${item.reason})` : ''}`)
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(80))
  console.log('📈 SUMMARY\n')
  console.log(`   Total bookings analyzed: ${bookings.length}`)
  console.log(`   Service Variation ID issues: ${mismatches.service_variation_id.length}`)
  console.log(`   Service Variation Version issues: ${mismatches.service_variation_version.length}`)
  console.log(`   Technician ID issues: ${mismatches.technician_id.length}`)
  console.log(`   Missing raw data: ${mismatches.missing_raw_data.length}`)
  
  const totalIssues = mismatches.service_variation_id.length + 
                     mismatches.service_variation_version.length + 
                     mismatches.technician_id.length
  
  if (totalIssues === 0) {
    console.log('\n   ✅ No mismatches found! All data is consistent.')
  } else {
    console.log(`\n   ⚠️ Total issues found: ${totalIssues}`)
  }
  
  await prisma.$disconnect()
}

compareBookingFields().catch(console.error)

