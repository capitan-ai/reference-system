/**
 * Debug script to investigate foreign key constraint issue
 * 
 * Run this to check if location UUID actually exists in database
 * 
 * Usage:
 *   node scripts/debug-location-fk-issue.js <square_location_id> <location_uuid>
 * 
 * Example:
 *   node scripts/debug-location-fk-issue.js LT4ZHFBQQYB2N 9dc99ffe-8904-4f9b-895f-f1f006d0d380
 */

const prisma = require('../lib/prisma-client')

async function debugLocationFK(squareLocationId, locationUuid) {
  console.log('🔍 Debugging Foreign Key Constraint Issue\n')
  console.log(`Square Location ID: ${squareLocationId}`)
  console.log(`Location UUID: ${locationUuid}\n`)

  // Check 1: Does the UUID exist?
  console.log('1️⃣ Checking if location UUID exists...')
  const uuidCheck = await prisma.$queryRaw`
    SELECT id, square_location_id, organization_id, name, created_at
    FROM locations
    WHERE id = ${locationUuid}::uuid
  `
  
  if (uuidCheck && uuidCheck.length > 0) {
    console.log('✅ Location UUID EXISTS in database:')
    console.log(`   ID: ${uuidCheck[0].id}`)
    console.log(`   Square Location ID: ${uuidCheck[0].square_location_id}`)
    console.log(`   Organization ID: ${uuidCheck[0].organization_id}`)
    console.log(`   Name: ${uuidCheck[0].name}`)
    console.log(`   Created: ${uuidCheck[0].created_at}`)
  } else {
    console.log('❌ Location UUID DOES NOT EXIST in database!')
    console.log('   This is why the foreign key constraint fails!')
  }

  console.log('\n')

  // Check 2: What location has this square_location_id?
  console.log('2️⃣ Checking what location has this square_location_id...')
  const squareIdCheck = await prisma.$queryRaw`
    SELECT id, square_location_id, organization_id, name, created_at
    FROM locations
    WHERE square_location_id = ${squareLocationId}
    ORDER BY created_at
  `
  
  if (squareIdCheck && squareIdCheck.length > 0) {
    console.log(`✅ Found ${squareIdCheck.length} location(s) with square_location_id "${squareLocationId}":`)
    squareIdCheck.forEach((loc, idx) => {
      console.log(`\n   Location ${idx + 1}:`)
      console.log(`   ID: ${loc.id}`)
      console.log(`   Square Location ID: ${loc.square_location_id}`)
      console.log(`   Organization ID: ${loc.organization_id}`)
      console.log(`   Name: ${loc.name}`)
      console.log(`   Created: ${loc.created_at}`)
      
      if (loc.id === locationUuid) {
        console.log('   ✅ UUID MATCHES!')
      } else {
        console.log('   ⚠️ UUID DOES NOT MATCH!')
        console.log(`   Expected: ${locationUuid}`)
        console.log(`   Actual: ${loc.id}`)
      }
    })
    
    if (squareIdCheck.length > 1) {
      console.log('\n   ⚠️ WARNING: Multiple locations with same square_location_id!')
      console.log('   This could cause issues. Consider cleaning up duplicates.')
    }
  } else {
    console.log(`❌ No location found with square_location_id "${squareLocationId}"`)
  }

  console.log('\n')

  // Check 3: Check for UUID format issues
  console.log('3️⃣ Checking UUID format...')
  const uuidStr = String(locationUuid).trim()
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  
  if (uuidRegex.test(uuidStr)) {
    console.log('✅ UUID format is valid')
  } else {
    console.log('❌ UUID format is INVALID!')
    console.log(`   UUID: "${uuidStr}"`)
    console.log(`   Length: ${uuidStr.length}`)
    console.log('   This could cause foreign key constraint failures!')
  }

  console.log('\n')

  // Check 4: Try to find orders that reference this location
  console.log('4️⃣ Checking existing orders with this location_id...')
  const ordersCheck = await prisma.$queryRaw`
    SELECT id, order_id, location_id, organization_id, state, created_at
    FROM orders
    WHERE location_id::text = ${locationUuid}
    ORDER BY created_at DESC
    LIMIT 5
  `
  
  if (ordersCheck && ordersCheck.length > 0) {
    console.log(`✅ Found ${ordersCheck.length} existing order(s) with this location_id:`)
    ordersCheck.forEach((order, idx) => {
      console.log(`\n   Order ${idx + 1}:`)
      console.log(`   Order ID: ${order.order_id}`)
      console.log(`   Location ID: ${order.location_id}`)
      console.log(`   Organization ID: ${order.organization_id}`)
      console.log(`   State: ${order.state}`)
      console.log(`   Created: ${order.created_at}`)
    })
    console.log('\n   ✅ If orders exist with this location_id, the FK constraint should work!')
  } else {
    console.log('ℹ️ No existing orders found with this location_id')
  }

  console.log('\n')

  // Summary
  console.log('📊 SUMMARY:')
  const uuidExists = uuidCheck && uuidCheck.length > 0
  const squareIdExists = squareIdCheck && squareIdCheck.length > 0
  const uuidMatches = squareIdCheck && squareIdCheck.some(loc => loc.id === locationUuid)
  const formatValid = uuidRegex.test(String(locationUuid).trim())

  if (uuidExists && formatValid) {
    console.log('✅ Location UUID exists and format is valid')
    console.log('   Foreign key constraint should work.')
    console.log('   If it still fails, check:')
    console.log('   - Transaction isolation issues')
    console.log('   - Location deleted between lookup and insert')
    console.log('   - Organization mismatch (though FK doesn\'t check this)')
  } else if (!uuidExists && squareIdExists) {
    console.log('❌ PROBLEM FOUND:')
    console.log('   Location with square_location_id exists, but UUID doesn\'t match!')
    console.log(`   Expected UUID: ${locationUuid}`)
    console.log(`   Actual UUID: ${squareIdCheck[0].id}`)
    console.log('   This is why the foreign key constraint fails!')
    console.log('\n   SOLUTION:')
    console.log('   The code is finding the wrong location UUID.')
    console.log('   Check the location lookup query in the webhook handler.')
  } else if (!uuidExists) {
    console.log('❌ PROBLEM FOUND:')
    console.log('   Location UUID does not exist in database!')
    console.log('   This is why the foreign key constraint fails!')
    console.log('\n   SOLUTION:')
    console.log('   The location was either:')
    console.log('   - Never created')
    console.log('   - Deleted')
    console.log('   - Wrong UUID was used')
  } else {
    console.log('⚠️ Unable to determine issue. Check the output above.')
  }

  await prisma.$disconnect()
}

// Get command line arguments
const squareLocationId = process.argv[2]
const locationUuid = process.argv[3]

if (!squareLocationId || !locationUuid) {
  console.error('Usage: node scripts/debug-location-fk-issue.js <square_location_id> <location_uuid>')
  console.error('Example: node scripts/debug-location-fk-issue.js LT4ZHFBQQYB2N 9dc99ffe-8904-4f9b-895f-f1f006d0d380')
  process.exit(1)
}

debugLocationFK(squareLocationId, locationUuid).catch(error => {
  console.error('❌ Error:', error)
  process.exit(1)
})

