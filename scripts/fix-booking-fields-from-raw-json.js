#!/usr/bin/env node
/**
 * Fix all bookings by updating service_variation_id, service_variation_version, and technician_id
 * from raw_json. OPTIMIZED VERSION with bulk processing.
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function fixAllBookings() {
  console.log('🔧 Fixing bookings from raw_json (OPTIMIZED)...\n')
  console.log('This script will:')
  console.log('  1. Check ALL bookings with raw_json')
  console.log('  2. Resolve Square IDs to UUIDs for service_variation_id and technician_id')
  console.log('  3. Update service_variation_version from raw_json')
  console.log('  4. Only update bookings that need fixing')
  console.log('  5. Use bulk processing for speed\n')
  
  // Get count first
  const countResult = await prisma.$queryRaw`
    SELECT COUNT(*)::int as count
    FROM bookings
    WHERE raw_json IS NOT NULL
  `
  const totalBookings = countResult[0].count
  console.log(`📊 Found ${totalBookings} bookings with raw_json to check...\n`)
  
  // Get ALL bookings with raw_json
  // TEST MODE: LIMIT 10 for testing (set TEST_MODE=false to process all)
  const TEST_MODE = process.env.TEST_MODE !== 'false' // Default to true for safety
  const limitClause = TEST_MODE ? 'LIMIT 10' : ''
  
  const bookings = await prisma.$queryRawUnsafe(`
    SELECT 
      id,
      booking_id,
      organization_id::text as organization_id,
      service_variation_id::text as service_variation_id,
      service_variation_version,
      technician_id::text as technician_id,
      raw_json
    FROM bookings
    WHERE raw_json IS NOT NULL
    ORDER BY created_at DESC
    ${limitClause}
  `)
  
  if (TEST_MODE) {
    console.log('⚠️  TEST MODE: Only processing first 10 bookings')
    console.log('   To process all bookings, run: TEST_MODE=false node scripts/fix-booking-fields-from-raw-json.js\n')
  }
  
  console.log(`Processing ${bookings.length} bookings...\n`)
  
  // Step 1: Extract all Square IDs from raw_json in one pass
  const serviceVariationIds = new Set()
  const teamMemberIds = new Set()
  const organizationIds = new Set()
  const bookingUpdates = []
  
  for (const booking of bookings) {
    if (!booking.raw_json) continue
    
    const rawJson = typeof booking.raw_json === 'string' 
      ? JSON.parse(booking.raw_json) 
      : booking.raw_json
    
    const segments = rawJson.appointmentSegments || rawJson.appointment_segments || []
    if (segments.length === 0) continue
    
    const segment = segments[0]
    const rawServiceVariationId = segment.serviceVariationId || segment.service_variation_id
    const rawTeamMemberId = segment.teamMemberId || segment.team_member_id
    const rawVersion = segment.serviceVariationVersion || segment.service_variation_version
    
    if (rawServiceVariationId) {
      serviceVariationIds.add(rawServiceVariationId)
      organizationIds.add(booking.organization_id)
    }
    if (rawTeamMemberId) {
      teamMemberIds.add(rawTeamMemberId)
      organizationIds.add(booking.organization_id)
    }
    
    // Prepare update object
    const update = {
      booking_id: booking.booking_id,
      id: booking.id,
      organization_id: booking.organization_id,
      current_service_variation_id: booking.service_variation_id,
      current_technician_id: booking.technician_id,
      current_version: booking.service_variation_version ? booking.service_variation_version.toString() : null,
      raw_service_variation_id: rawServiceVariationId,
      raw_team_member_id: rawTeamMemberId,
      raw_version: rawVersion ? rawVersion.toString() : null
    }
    
    bookingUpdates.push(update)
  }
  
  console.log(`📦 Extracted ${serviceVariationIds.size} unique service variation IDs`)
  console.log(`📦 Extracted ${teamMemberIds.size} unique team member IDs`)
  console.log(`📦 Processing ${bookingUpdates.length} bookings\n`)
  
  // Step 2: Bulk fetch all service variations
  const serviceVariationMap = new Map()
  if (serviceVariationIds.size > 0) {
    const serviceVariations = await prisma.$queryRawUnsafe(`
      SELECT uuid::text as id, square_variation_id, organization_id::text as organization_id
      FROM service_variation
      WHERE square_variation_id = ANY($1::text[])
    `, Array.from(serviceVariationIds))
    
    for (const sv of serviceVariations) {
      const key = `${sv.organization_id}:${sv.square_variation_id}`
      serviceVariationMap.set(key, sv.id)
    }
    console.log(`✅ Loaded ${serviceVariations.length} service variations`)
  }
  
  // Step 3: Bulk fetch all team members
  const teamMemberMap = new Map()
  if (teamMemberIds.size > 0) {
    const teamMembers = await prisma.$queryRawUnsafe(`
      SELECT id::text as id, square_team_member_id, organization_id::text as organization_id
      FROM team_members
      WHERE square_team_member_id = ANY($1::text[])
    `, Array.from(teamMemberIds))
    
    for (const tm of teamMembers) {
      const key = `${tm.organization_id}:${tm.square_team_member_id}`
      teamMemberMap.set(key, tm.id)
    }
    console.log(`✅ Loaded ${teamMembers.length} team members\n`)
  }
  
  // Step 4: Prepare all updates
  const updatesToApply = []
  let skipped = 0
  
  for (const booking of bookingUpdates) {
    const updates = {}
    let needsUpdate = false
    
    // Resolve service variation
    if (booking.raw_service_variation_id) {
      const key = `${booking.organization_id}:${booking.raw_service_variation_id}`
      const expectedUuid = serviceVariationMap.get(key)
      
      if (expectedUuid && booking.current_service_variation_id !== expectedUuid) {
        updates.service_variation_id = expectedUuid
        needsUpdate = true
      }
    }
    
    // Resolve version
    if (booking.raw_version && booking.current_version !== booking.raw_version) {
      updates.service_variation_version = BigInt(booking.raw_version)
      needsUpdate = true
    }
    
    // Resolve team member
    if (booking.raw_team_member_id) {
      const key = `${booking.organization_id}:${booking.raw_team_member_id}`
      const expectedUuid = teamMemberMap.get(key)
      
      if (expectedUuid && booking.current_technician_id !== expectedUuid) {
        updates.technician_id = expectedUuid
        needsUpdate = true
      }
    }
    
    if (needsUpdate) {
      updatesToApply.push({
        id: booking.id,
        ...updates
      })
    } else {
      skipped++
    }
  }
  
  console.log(`📝 Prepared ${updatesToApply.length} updates to apply`)
  console.log(`⏭️  ${skipped} bookings already correct\n`)
  
  // Step 5: Apply updates in bulk batches
  let fixed = 0
  let errors = 0
  const batchSize = 100
  
  console.log(`\n🚀 Starting bulk updates...\n`)
  
  for (let i = 0; i < updatesToApply.length; i += batchSize) {
    const batch = updatesToApply.slice(i, i + batchSize)
    const batchNum = Math.floor(i / batchSize) + 1
    const totalBatches = Math.ceil(updatesToApply.length / batchSize)
    
    console.log(`   Processing batch ${batchNum}/${totalBatches} (${batch.length} bookings)...`)
    
    try {
      // Use individual updates for safety (bulk CASE statements can be complex)
      for (const update of batch) {
        const updateFields = []
        const updateValues = []
        
        if (update.service_variation_id) {
          updateFields.push('service_variation_id = $' + (updateValues.length + 1) + '::uuid')
          updateValues.push(update.service_variation_id)
        }
        if (update.service_variation_version) {
          updateFields.push('service_variation_version = $' + (updateValues.length + 1) + '::bigint')
          updateValues.push(update.service_variation_version.toString())
        }
        if (update.technician_id) {
          updateFields.push('technician_id = $' + (updateValues.length + 1) + '::uuid')
          updateValues.push(update.technician_id)
        }
        
        if (updateFields.length > 0) {
          const updateQuery = `
            UPDATE bookings
            SET ${updateFields.join(', ')}, updated_at = NOW()
            WHERE id = $${updateValues.length + 1}::uuid
          `
          updateValues.push(update.id)
          
          await prisma.$executeRawUnsafe(updateQuery, ...updateValues)
          fixed++
        }
      }
      
      if (fixed % 500 === 0 || batchNum === totalBatches) {
        console.log(`   ✅ Fixed ${fixed}/${updatesToApply.length} bookings`)
      }
    } catch (error) {
      console.error(`   ❌ Error in batch ${batchNum}: ${error.message}`)
      errors += batch.length
    }
  }
  
  console.log('\n' + '='.repeat(80))
  console.log('📊 SUMMARY')
  console.log('='.repeat(80))
  console.log(`   Total bookings checked: ${bookings.length}`)
  console.log(`   ✅ Fixed: ${fixed}`)
  console.log(`   ⏭️  Skipped (no changes needed): ${skipped}`)
  console.log(`   ❌ Errors: ${errors}`)
  console.log('\n✅ Fix script completed!')
  
  await prisma.$disconnect()
}

fixAllBookings().catch(console.error)
