#!/usr/bin/env node
require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function debugLocationResolution() {
  console.log('🔍 Debugging Location Resolution Implementation\n')
  console.log('=' .repeat(60))
  
  try {
    // 1. Check if column exists
    console.log('\n1️⃣ Checking Database Schema...\n')
    const columnCheck = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'locations'
        AND column_name = 'square_merchant_id'
    `
    
    if (columnCheck.length > 0) {
      console.log('   ✅ square_merchant_id column exists')
      console.log(`      Type: ${columnCheck[0].data_type}`)
      console.log(`      Nullable: ${columnCheck[0].is_nullable}`)
    } else {
      console.log('   ❌ square_merchant_id column NOT found!')
      console.log('      Run migration first!')
      return
    }
    
    // 2. Check indexes
    console.log('\n2️⃣ Checking Indexes...\n')
    const indexes = await prisma.$queryRaw`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'locations'
        AND (indexname LIKE '%square_merchant%' OR indexname LIKE '%square_location%')
    `
    
    if (indexes.length > 0) {
      console.log(`   ✅ Found ${indexes.length} relevant indexes:`)
      indexes.forEach(idx => {
        console.log(`      - ${idx.indexname}`)
      })
    } else {
      console.log('   ⚠️  No indexes found (may need to create them)')
    }
    
    // 3. Check sample locations
    console.log('\n3️⃣ Checking Sample Locations...\n')
    const locations = await prisma.$queryRaw`
      SELECT 
        id,
        square_location_id,
        square_merchant_id,
        organization_id,
        name
      FROM locations
      ORDER BY updated_at DESC
      LIMIT 5
    `
    
    if (locations.length > 0) {
      console.log(`   Found ${locations.length} recent locations:`)
      locations.forEach((loc, idx) => {
        console.log(`\n   ${idx + 1}. ${loc.name || 'Unnamed'}`)
        console.log(`      Location ID: ${loc.square_location_id}`)
        console.log(`      Merchant ID: ${loc.square_merchant_id || '❌ NOT SET'}`)
        console.log(`      Organization ID: ${loc.organization_id || '❌ NOT SET'}`)
        
        if (!loc.square_merchant_id) {
          console.log(`      ⚠️  This location needs merchant_id from Square API`)
        }
        if (!loc.organization_id) {
          console.log(`      ⚠️  This location needs organization_id`)
        }
      })
    } else {
      console.log('   ⚠️  No locations found in database')
    }
    
    // 4. Test resolution function (if we can import it)
    console.log('\n4️⃣ Testing Resolution Logic...\n')
    
    // Check if we can resolve organization_id from a location
    if (locations.length > 0 && locations[0].square_location_id) {
      const testLocationId = locations[0].square_location_id
      console.log(`   Testing with location: ${testLocationId}`)
      
      // Try to resolve organization_id from location
      const locationData = await prisma.$queryRaw`
        SELECT organization_id, square_merchant_id
        FROM locations
        WHERE square_location_id = ${testLocationId}
        LIMIT 1
      `
      
      if (locationData.length > 0) {
        const loc = locationData[0]
        console.log(`   ✅ Location found in database`)
        console.log(`      Organization ID: ${loc.organization_id || '❌ NOT SET'}`)
        console.log(`      Merchant ID: ${loc.square_merchant_id || '❌ NOT SET'}`)
        
        if (loc.organization_id) {
          console.log(`   ✅ Can resolve organization_id directly (FAST PATH)`)
        } else if (loc.square_merchant_id) {
          console.log(`   ⚠️  Has merchant_id but no organization_id`)
          console.log(`      Will need to resolve organization_id from merchant_id`)
          
          // Try to resolve from merchant_id
          const org = await prisma.$queryRaw`
            SELECT id FROM organizations
            WHERE square_merchant_id = ${loc.square_merchant_id}
            LIMIT 1
          `
          
          if (org.length > 0) {
            console.log(`   ✅ Can resolve organization_id from merchant_id`)
          } else {
            console.log(`   ❌ Cannot resolve organization_id from merchant_id`)
            console.log(`      Merchant ID: ${loc.square_merchant_id}`)
          }
        } else {
          console.log(`   ⚠️  Missing both merchant_id and organization_id`)
          console.log(`      Will need to fetch from Square API (SLOW PATH)`)
        }
      }
    }
    
    // 5. Check organizations
    console.log('\n5️⃣ Checking Organizations...\n')
    const orgs = await prisma.$queryRaw`
      SELECT id, square_merchant_id, name
      FROM organizations
      LIMIT 5
    `
    
    console.log(`   Found ${orgs.length} organizations:`)
    orgs.forEach((org, idx) => {
      console.log(`   ${idx + 1}. ${org.name || 'Unnamed'} (${org.square_merchant_id?.substring(0, 16)}...)`)
    })
    
    // 6. Summary
    console.log('\n' + '=' .repeat(60))
    console.log('\n📊 Summary:\n')
    
    const locationsWithMerchantId = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM locations
      WHERE square_merchant_id IS NOT NULL
    `
    
    const locationsWithOrgId = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM locations
      WHERE organization_id IS NOT NULL
    `
    
    const totalLocations = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM locations
    `
    
    console.log(`   Total locations: ${totalLocations[0].count}`)
    console.log(`   With merchant_id: ${locationsWithMerchantId[0].count}`)
    console.log(`   With organization_id: ${locationsWithOrgId[0].count}`)
    
    if (locationsWithMerchantId[0].count < totalLocations[0].count) {
      console.log(`\n   ⚠️  ${totalLocations[0].count - locationsWithMerchantId[0].count} locations missing merchant_id`)
      console.log(`      These will be populated automatically when webhooks are processed`)
    }
    
    console.log('\n✅ Debug check complete!')
    console.log('\n💡 Next steps:')
    console.log('   1. Process a test webhook to verify location_id resolution')
    console.log('   2. Check logs to see if organization_id is resolved from location_id')
    console.log('   3. Verify locations are updated with merchant_id from Square API')
    
  } catch (error) {
    console.error('\n❌ Error during debug:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

debugLocationResolution()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })



