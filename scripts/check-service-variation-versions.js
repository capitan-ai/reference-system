#!/usr/bin/env node
/**
 * Check service_variation_version values for a specific service variation
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkServiceVariationVersions() {
  const serviceVariationId = '1ddde7c9-775a-4c89-b4bf-737a5cfaa0a3'
  const squareServiceVariationId = 'ZEAKNB35I37RMXNUBGWDZQIM'
  
  console.log('🔍 Checking service_variation_version for bookings...\n')
  console.log(`Service Variation UUID: ${serviceVariationId}`)
  console.log(`Square Service Variation ID: ${squareServiceVariationId}\n`)
  
  // First, verify the service variation exists
  // Note: The actual column is 'uuid', not 'id'
  const svRecord = await prisma.$queryRaw`
    SELECT 
      uuid::text as id, 
      square_variation_id::text as square_id, 
      name, 
      organization_id::text as organization_id
    FROM service_variation
    WHERE uuid = ${serviceVariationId}::uuid
  `
  
  if (svRecord.length === 0) {
    console.log('❌ Service variation not found!')
    await prisma.$disconnect()
    return
  }
  
  console.log('✅ Service Variation Found:')
  console.log(`   Name: ${svRecord[0].name || 'N/A'}`)
  console.log(`   Square ID: ${svRecord[0].square_id}`)
  console.log(`   Organization ID: ${svRecord[0].organization_id}\n`)
  
  // Get all bookings with this service variation
  const bookings = await prisma.$queryRaw`
    SELECT 
      id,
      booking_id,
      service_variation_id,
      service_variation_version,
      duration_minutes,
      start_at,
      created_at,
      updated_at,
      raw_json
    FROM bookings
    WHERE service_variation_id = ${serviceVariationId}::uuid
    ORDER BY created_at DESC
    LIMIT 100
  `
  
  console.log(`📊 Found ${bookings.length} bookings with this service variation\n`)
  
  if (bookings.length === 0) {
    console.log('❌ No bookings found!')
    await prisma.$disconnect()
    return
  }
  
  // Analyze versions
  const versionCounts = {}
  const versionMismatches = []
  
  for (const booking of bookings) {
    const version = booking.service_variation_version ? booking.service_variation_version.toString() : 'NULL'
    versionCounts[version] = (versionCounts[version] || 0) + 1
    
    // Check raw_json for comparison
    if (booking.raw_json) {
      const rawJson = typeof booking.raw_json === 'string' 
        ? JSON.parse(booking.raw_json) 
        : booking.raw_json
      
      const segments = rawJson.appointmentSegments || rawJson.appointment_segments || []
      if (segments.length > 0) {
        const segment = segments[0]
        const rawVersion = segment.serviceVariationVersion || segment.service_variation_version
        const rawServiceId = segment.serviceVariationId || segment.service_variation_id
        
        if (rawServiceId !== squareServiceVariationId) {
          versionMismatches.push({
            booking_id: booking.booking_id,
            stored_version: version,
            raw_version: rawVersion ? rawVersion.toString() : 'NULL',
            raw_service_id: rawServiceId,
            stored_service_id: squareServiceVariationId
          })
        } else if (rawVersion && version !== rawVersion.toString()) {
          versionMismatches.push({
            booking_id: booking.booking_id,
            stored_version: version,
            raw_version: rawVersion.toString(),
            raw_service_id: rawServiceId,
            match: 'version_mismatch'
          })
        }
      }
    }
  }
  
  console.log('📈 Version Distribution:')
  const sortedVersions = Object.entries(versionCounts)
    .sort((a, b) => b[1] - a[1])
  
  for (const [version, count] of sortedVersions) {
    console.log(`   Version ${version}: ${count} booking(s)`)
  }
  
  console.log(`\n📊 Total unique versions: ${Object.keys(versionCounts).length}`)
  
  if (versionMismatches.length > 0) {
    console.log(`\n⚠️ Found ${versionMismatches.length} mismatch(es) between stored data and raw_json:\n`)
    
    for (const mismatch of versionMismatches.slice(0, 10)) {
      console.log(`   Booking: ${mismatch.booking_id}`)
      console.log(`      Stored version: ${mismatch.stored_version}`)
      console.log(`      Raw JSON version: ${mismatch.raw_version}`)
      if (mismatch.raw_service_id !== squareServiceVariationId) {
        console.log(`      ⚠️ SERVICE ID MISMATCH!`)
        console.log(`         Stored service_id: ${mismatch.stored_service_id}`)
        console.log(`         Raw JSON service_id: ${mismatch.raw_service_id}`)
      }
      console.log('')
    }
    
    if (versionMismatches.length > 10) {
      console.log(`   ... and ${versionMismatches.length - 10} more\n`)
    }
  } else {
    console.log('\n✅ No mismatches found between stored data and raw_json')
  }
  
  // Show sample bookings
  console.log('\n📋 Sample Bookings (first 5):')
  for (const booking of bookings.slice(0, 5)) {
    console.log(`\n   Booking ID: ${booking.booking_id}`)
    console.log(`   Service Variation Version: ${booking.service_variation_version ? booking.service_variation_version.toString() : 'NULL'}`)
    console.log(`   Duration: ${booking.duration_minutes || 'N/A'} minutes`)
    console.log(`   Start At: ${booking.start_at}`)
    console.log(`   Created At: ${booking.created_at}`)
    
    if (booking.raw_json) {
      const rawJson = typeof booking.raw_json === 'string' 
        ? JSON.parse(booking.raw_json) 
        : booking.raw_json
      const segments = rawJson.appointmentSegments || rawJson.appointment_segments || []
      if (segments.length > 0) {
        const seg = segments[0]
        console.log(`   Raw JSON serviceVariationId: ${seg.serviceVariationId || seg.service_variation_id || 'N/A'}`)
        console.log(`   Raw JSON serviceVariationVersion: ${seg.serviceVariationVersion || seg.service_variation_version || 'N/A'}`)
      }
    }
  }
  
  await prisma.$disconnect()
}

checkServiceVariationVersions().catch(console.error)

