#!/usr/bin/env node
require('dotenv').config()
const prisma = require('../lib/prisma-client')

// Simulate the resolution logic from the code
async function resolveOrganizationIdFromLocationId(squareLocationId) {
  if (!squareLocationId) {
    return null
  }
  
  try {
    // STEP 1: Fast database lookup (most common case)
    const location = await prisma.$queryRaw`
      SELECT organization_id, square_merchant_id
      FROM locations
      WHERE square_location_id = ${squareLocationId}
      LIMIT 1
    `
    
    if (location && location.length > 0) {
      const loc = location[0]
      
      // If we have organization_id, return it immediately (fastest path)
      if (loc.organization_id) {
        console.log(`   ✅ FAST PATH: Found organization_id in database`)
        return loc.organization_id
      }
      
      // If we have merchant_id but no organization_id, resolve it
      if (loc.square_merchant_id) {
        const org = await prisma.$queryRaw`
          SELECT id FROM organizations 
          WHERE square_merchant_id = ${loc.square_merchant_id}
          LIMIT 1
        `
        if (org && org.length > 0) {
          const orgId = org[0].id
          console.log(`   ✅ MEDIUM PATH: Resolved from merchant_id`)
          return orgId
        }
      }
    }
    
    // STEP 2: Would fetch from Square API here (not testing API in this script)
    console.log(`   ⚠️  SLOW PATH: Would fetch from Square API`)
    return null
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`)
    return null
  }
}

async function testLocationResolution() {
  console.log('🧪 Testing Location Resolution Function\n')
  console.log('=' .repeat(60))
  
  try {
    // Get a test location
    const locations = await prisma.$queryRaw`
      SELECT square_location_id, organization_id, square_merchant_id
      FROM locations
      LIMIT 1
    `
    
    if (locations.length === 0) {
      console.log('❌ No locations found in database')
      return
    }
    
    const testLocation = locations[0]
    console.log(`\n📍 Test Location: ${testLocation.square_location_id}`)
    console.log(`   Current organization_id: ${testLocation.organization_id || 'NOT SET'}`)
    console.log(`   Current merchant_id: ${testLocation.square_merchant_id || 'NOT SET'}`)
    
    console.log(`\n🔍 Testing resolution...\n`)
    const resolvedOrgId = await resolveOrganizationIdFromLocationId(testLocation.square_location_id)
    
    if (resolvedOrgId) {
      console.log(`\n✅ SUCCESS: Resolved organization_id: ${resolvedOrgId}`)
      
      if (resolvedOrgId === testLocation.organization_id) {
        console.log(`   ✅ Matches existing organization_id`)
      } else {
        console.log(`   ⚠️  Different from existing (might need update)`)
      }
    } else {
      console.log(`\n⚠️  Could not resolve organization_id`)
      console.log(`   This location would need Square API fetch`)
    }
    
    // Test with a non-existent location
    console.log(`\n🔍 Testing with non-existent location...\n`)
    const fakeLocationId = 'FAKE_LOCATION_ID_12345'
    const fakeResolved = await resolveOrganizationIdFromLocationId(fakeLocationId)
    
    if (!fakeResolved) {
      console.log(`✅ Correctly returned null for non-existent location`)
    } else {
      console.log(`❌ Unexpectedly resolved non-existent location`)
    }
    
    console.log('\n' + '=' .repeat(60))
    console.log('\n✅ Test complete!')
    
  } catch (error) {
    console.error('\n❌ Error during test:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

testLocationResolution()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })



