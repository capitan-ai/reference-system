#!/usr/bin/env node
/**
 * Check progress of the booking fix script by comparing before/after counts
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkProgress() {
  console.log('📊 Checking booking fix progress...\n')
  
  // Count bookings with issues
  const bookingsWithRawJson = await prisma.$queryRaw`
    SELECT COUNT(*)::int as count
    FROM bookings
    WHERE raw_json IS NOT NULL
  `
  
  console.log(`Total bookings with raw_json: ${bookingsWithRawJson[0].count}\n`)
  
  // Check for NULL service_variation_id (should be fixed)
  const nullServiceVariation = await prisma.$queryRaw`
    SELECT COUNT(*)::int as count
    FROM bookings
    WHERE raw_json IS NOT NULL
      AND service_variation_id IS NULL
  `
  
  console.log(`Bookings with NULL service_variation_id: ${nullServiceVariation[0].count}`)
  
  // Check for bookings where raw_json has serviceVariationId but stored is NULL
  const mismatches = await prisma.$queryRaw`
    SELECT COUNT(*)::int as count
    FROM bookings b
    WHERE b.raw_json IS NOT NULL
      AND b.service_variation_id IS NULL
      AND (
        b.raw_json->'appointmentSegments'->0->>'serviceVariationId' IS NOT NULL
        OR b.raw_json->'appointmentSegments'->0->>'service_variation_id' IS NOT NULL
      )
  `
  
  console.log(`Bookings with serviceVariationId in raw_json but NULL in DB: ${mismatches[0].count}\n`)
  
  // Sample a few bookings to check
  console.log('📋 Sample bookings to verify:')
  const samples = await prisma.$queryRaw`
    SELECT 
      booking_id,
      service_variation_id::text as service_variation_id,
      service_variation_version,
      technician_id::text as technician_id,
      raw_json->'appointmentSegments'->0->>'serviceVariationId' as raw_service_id,
      raw_json->'appointmentSegments'->0->>'serviceVariationVersion' as raw_version
    FROM bookings
    WHERE raw_json IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT 5
  `
  
  for (const sample of samples) {
    console.log(`\n   Booking: ${sample.booking_id}`)
    console.log(`      Stored service_variation_id: ${sample.service_variation_id || 'NULL'}`)
    console.log(`      Raw serviceVariationId: ${sample.raw_service_id || 'N/A'}`)
    console.log(`      Stored version: ${sample.service_variation_version ? sample.service_variation_version.toString() : 'NULL'}`)
    console.log(`      Raw version: ${sample.raw_version || 'N/A'}`)
  }
  
  await prisma.$disconnect()
}

checkProgress().catch(console.error)


