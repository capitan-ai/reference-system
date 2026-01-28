#!/usr/bin/env node
/**
 * Check a specific booking by booking_id
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkSpecificBooking() {
  const bookingId = 'd0ane0kkznbroo'
  
  console.log(`🔍 Checking booking: ${bookingId}\n`)
  
  const bookings = await prisma.$queryRaw`
    SELECT 
      id,
      booking_id,
      service_variation_id::text as service_variation_id,
      service_variation_version,
      technician_id::text as technician_id,
      duration_minutes,
      start_at,
      created_at,
      updated_at,
      raw_json
    FROM bookings
    WHERE booking_id LIKE ${`${bookingId}%`}
    ORDER BY created_at DESC
  `
  
  if (bookings.length === 0) {
    console.log('❌ Booking not found!')
    await prisma.$disconnect()
    return
  }
  
  console.log(`📊 Found ${bookings.length} booking record(s)\n`)
  
  for (const booking of bookings) {
    console.log('='.repeat(80))
    console.log(`Booking ID: ${booking.booking_id}`)
    console.log(`Internal ID: ${booking.id}`)
    console.log(`\n📋 STORED VALUES:`)
    console.log(`   service_variation_id: ${booking.service_variation_id || 'NULL'}`)
    console.log(`   service_variation_version: ${booking.service_variation_version ? booking.service_variation_version.toString() : 'NULL'}`)
    console.log(`   technician_id: ${booking.technician_id || 'NULL'}`)
    console.log(`   duration_minutes: ${booking.duration_minutes || 'N/A'}`)
    console.log(`   start_at: ${booking.start_at}`)
    
    if (booking.raw_json) {
      const rawJson = typeof booking.raw_json === 'string' 
        ? JSON.parse(booking.raw_json) 
        : booking.raw_json
      
      console.log(`\n📄 RAW JSON VALUES:`)
      const segments = rawJson.appointmentSegments || rawJson.appointment_segments || []
      
      if (segments.length > 0) {
        const segment = segments[0]
        console.log(`   serviceVariationId: ${segment.serviceVariationId || segment.service_variation_id || 'N/A'}`)
        console.log(`   serviceVariationVersion: ${segment.serviceVariationVersion || segment.service_variation_version || 'N/A'}`)
        console.log(`   teamMemberId: ${segment.teamMemberId || segment.team_member_id || 'N/A'}`)
        console.log(`   durationMinutes: ${segment.durationMinutes || segment.duration_minutes || 'N/A'}`)
        
        // Resolve service variation UUID
        const rawServiceVariationId = segment.serviceVariationId || segment.service_variation_id
        if (rawServiceVariationId) {
          const svRecord = await prisma.$queryRaw`
            SELECT uuid::text as id, square_variation_id, name
            FROM service_variation
            WHERE square_variation_id = ${rawServiceVariationId}
            LIMIT 1
          `
          
          if (svRecord.length > 0) {
            console.log(`\n✅ SERVICE VARIATION LOOKUP:`)
            console.log(`   Expected UUID: ${svRecord[0].id}`)
            console.log(`   Square ID: ${svRecord[0].square_variation_id}`)
            console.log(`   Name: ${svRecord[0].name || 'N/A'}`)
            
            if (booking.service_variation_id !== svRecord[0].id) {
              console.log(`   ⚠️ MISMATCH! Stored: ${booking.service_variation_id || 'NULL'}, Expected: ${svRecord[0].id}`)
            } else {
              console.log(`   ✅ Match!`)
            }
          } else {
            console.log(`\n⚠️ Service variation ${rawServiceVariationId} not found in database`)
          }
        }
        
        // Resolve team member UUID
        const rawTeamMemberId = segment.teamMemberId || segment.team_member_id
        if (rawTeamMemberId) {
          const tmRecord = await prisma.$queryRaw`
            SELECT id::text as id, square_team_member_id, given_name, family_name
            FROM team_members
            WHERE square_team_member_id = ${rawTeamMemberId}
            LIMIT 1
          `
          
          if (tmRecord.length > 0) {
            console.log(`\n✅ TEAM MEMBER LOOKUP:`)
            console.log(`   Expected UUID: ${tmRecord[0].id}`)
            console.log(`   Square ID: ${tmRecord[0].square_team_member_id}`)
            console.log(`   Name: ${tmRecord[0].given_name || ''} ${tmRecord[0].family_name || ''}`.trim() || 'N/A')
            
            if (booking.technician_id !== tmRecord[0].id) {
              console.log(`   ⚠️ MISMATCH! Stored: ${booking.technician_id || 'NULL'}, Expected: ${tmRecord[0].id}`)
            } else {
              console.log(`   ✅ Match!`)
            }
          } else {
            console.log(`\n⚠️ Team member ${rawTeamMemberId} not found in database`)
          }
        }
        
        // Check version
        const rawVersion = segment.serviceVariationVersion || segment.service_variation_version
        const storedVersion = booking.service_variation_version ? booking.service_variation_version.toString() : null
        
        console.log(`\n📊 VERSION COMPARISON:`)
        console.log(`   Stored: ${storedVersion || 'NULL'}`)
        console.log(`   Raw JSON: ${rawVersion || 'N/A'}`)
        
        if (rawVersion && storedVersion !== rawVersion.toString()) {
          console.log(`   ⚠️ MISMATCH!`)
        } else if (rawVersion && storedVersion === rawVersion.toString()) {
          console.log(`   ✅ Match!`)
        }
      } else {
        console.log('   ⚠️ No appointmentSegments found in raw_json')
      }
    } else {
      console.log('\n⚠️ No raw_json found')
    }
    
    console.log('')
  }
  
  await prisma.$disconnect()
}

// Get booking ID from command line or use default
const bookingId = process.argv[2] || 'd0ane0kkznbroo'
checkSpecificBooking(bookingId).catch(console.error)



