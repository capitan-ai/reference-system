/**
 * Test organization_id resolution from location_id
 * Verifies that location_id from webhook can resolve organization_id
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Test location_id from the webhook payload
const TEST_LOCATION_ID = 'LT4ZHFBQQYB2N'

async function testLocationOrgResolution() {
  console.log('🧪 Testing Organization ID Resolution from Location ID\n')
  console.log('='.repeat(60))
  console.log(`Location ID: ${TEST_LOCATION_ID}\n`)

  try {
    // Step 1: Check if location exists in database
    console.log('1. Checking if location exists in database...')
    const location = await prisma.$queryRaw`
      SELECT id, square_location_id, organization_id, name
      FROM locations 
      WHERE square_location_id = ${TEST_LOCATION_ID}
      LIMIT 1
    `

    if (!location || location.length === 0) {
      console.error(`   ❌ Location ${TEST_LOCATION_ID} NOT found in database`)
      console.error(`   ⚠️  This means location-based resolution will fail`)
      console.error(`   ⚠️  The location needs to be created first (via location webhook or manual insert)`)
      return
    }

    const locationRecord = location[0]
    console.log(`   ✅ Location found:`)
    console.log(`      - Name: ${locationRecord.name}`)
    console.log(`      - Location UUID: ${locationRecord.id.substring(0, 8)}...`)
    console.log(`      - Organization ID: ${locationRecord.organization_id?.substring(0, 8)}...`)

    // Step 2: Verify organization_id is not null
    if (!locationRecord.organization_id) {
      console.error(`\n   ❌ Location has NULL organization_id`)
      console.error(`   ⚠️  This is a data integrity issue - location must have organization_id`)
      return
    }

    // Step 3: Verify the organization exists
    console.log('\n2. Verifying organization exists...')
    const org = await prisma.$queryRaw`
      SELECT id, square_merchant_id, name, is_active
      FROM organizations 
      WHERE id = ${locationRecord.organization_id}::uuid
      LIMIT 1
    `

    if (!org || org.length === 0) {
      console.error(`   ❌ Organization ${locationRecord.organization_id} NOT found`)
      console.error(`   ⚠️  This is a foreign key integrity issue`)
      return
    }

    const orgRecord = org[0]
    console.log(`   ✅ Organization found:`)
    console.log(`      - Name: ${orgRecord.name || 'Unnamed'}`)
    console.log(`      - Merchant ID: ${orgRecord.square_merchant_id?.substring(0, 16)}...`)
    console.log(`      - Active: ${orgRecord.is_active}`)

    // Step 4: Test the exact query used in webhook handler
    console.log('\n3. Testing webhook handler query...')
    const resolvedOrg = await prisma.$queryRaw`
      SELECT organization_id FROM locations 
      WHERE square_location_id = ${TEST_LOCATION_ID}
      LIMIT 1
    `

    if (resolvedOrg && resolvedOrg.length > 0) {
      const resolvedOrgId = resolvedOrg[0].organization_id
      console.log(`   ✅ Query successful`)
      console.log(`      - Resolved Organization ID: ${resolvedOrgId.substring(0, 8)}...`)
      
      if (resolvedOrgId === locationRecord.organization_id) {
        console.log(`   ✅ Organization ID matches location record`)
      } else {
        console.error(`   ❌ Organization ID mismatch!`)
      }
    } else {
      console.error(`   ❌ Query returned no results`)
    }

    // Step 5: Test with a scenario where merchant_id is missing
    console.log('\n4. Simulating webhook scenario (merchant_id missing)...')
    let organizationId = null
    
    // Simulate: merchant_id resolution fails (missing)
    console.log(`   Step 1: Try merchant_id resolution...`)
    console.log(`      ⚠️  merchant_id is missing (simulated)`)
    
    // Step 2: Try location-based resolution
    console.log(`   Step 2: Try location-based resolution...`)
    if (TEST_LOCATION_ID) {
      const locResult = await prisma.$queryRaw`
        SELECT organization_id FROM locations 
        WHERE square_location_id = ${TEST_LOCATION_ID}
        LIMIT 1
      `
      if (locResult && locResult.length > 0) {
        organizationId = locResult[0].organization_id
        console.log(`      ✅ SUCCESS: Resolved organization_id from location`)
        console.log(`         Organization ID: ${organizationId.substring(0, 8)}...`)
      } else {
        console.error(`      ❌ FAILED: Location not found`)
      }
    }

    // Step 6: Summary
    console.log('\n' + '='.repeat(60))
    if (organizationId) {
      console.log('\n✅ TEST SUCCESSFUL!')
      console.log(`   Location-based organization_id resolution works correctly`)
      console.log(`   Organization ID: ${organizationId}`)
    } else {
      console.log('\n❌ TEST FAILED!')
      console.log(`   Location-based organization_id resolution failed`)
    }

  } catch (error) {
    console.error('\n❌ Error during test:', error)
    console.error('   Stack:', error.stack)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

testLocationOrgResolution()
  .then(() => {
    console.log('\nScript completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Script failed:', error)
    process.exit(1)
  })



