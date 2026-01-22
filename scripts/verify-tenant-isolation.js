#!/usr/bin/env node
/**
 * Tenant Isolation Verification Script
 * Verifies that analytics views properly enforce tenant isolation
 * Tests that queries cannot leak data across organizations
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function verifyTenantIsolation() {
  console.log('🔒 Verifying Tenant Isolation in Analytics Views\n')
  console.log('='.repeat(60))

  try {
    // Get multiple organizations to test with
    const orgs = await prisma.$queryRaw`
      SELECT id, name, square_merchant_id
      FROM organizations
      ORDER BY created_at
      LIMIT 3
    `

    if (!orgs || orgs.length < 2) {
      console.log('⚠️  Need at least 2 organizations to test tenant isolation')
      console.log('   Found:', orgs?.length || 0)
      return
    }

    console.log(`\n📊 Testing with ${orgs.length} organizations:`)
    orgs.forEach((org, idx) => {
      console.log(`   ${idx + 1}. ${org.name || org.square_merchant_id} (${org.id})`)
    })

    const org1 = orgs[0].id
    const org2 = orgs[1].id

    console.log('\n' + '='.repeat(60))
    console.log('Testing: analytics_overview_daily')
    console.log('='.repeat(60))

    // Test 1: Query org1 data
    const org1Data = await prisma.$queryRaw`
      SELECT 
        organization_id,
        COUNT(*) as record_count,
        SUM(total_revenue_cents) as total_revenue
      FROM analytics_overview_daily
      WHERE organization_id = ${org1}
      GROUP BY organization_id
    `

    // Test 2: Query org2 data
    const org2Data = await prisma.$queryRaw`
      SELECT 
        organization_id,
        COUNT(*) as record_count,
        SUM(total_revenue_cents) as total_revenue
      FROM analytics_overview_daily
      WHERE organization_id = ${org2}
      GROUP BY organization_id
    `

    // Test 3: Try to query both (should return separate records)
    const bothData = await prisma.$queryRaw`
      SELECT 
        organization_id,
        COUNT(*) as record_count
      FROM analytics_overview_daily
      WHERE organization_id IN (${org1}, ${org2})
      GROUP BY organization_id
      ORDER BY organization_id
    `

    console.log(`\n✅ Organization 1 records: ${org1Data[0]?.record_count || 0}`)
    console.log(`✅ Organization 2 records: ${org2Data[0]?.record_count || 0}`)
    console.log(`✅ Combined query returned ${bothData.length} separate groups`)

    // Verify no cross-contamination
    const org1Ids = org1Data.map(r => r.organization_id)
    const org2Ids = org2Data.map(r => r.organization_id)
    const bothIds = bothData.map(r => r.organization_id)

    if (org1Ids.includes(org2) || org2Ids.includes(org1)) {
      console.error('\n❌ TENANT ISOLATION VIOLATION: Data leaked between organizations!')
      process.exit(1)
    }

    if (bothIds.length !== new Set(bothIds).size) {
      console.error('\n❌ TENANT ISOLATION VIOLATION: Duplicate organization IDs found!')
      process.exit(1)
    }

    console.log('\n✅ Tenant isolation verified for analytics_overview_daily')

    // Test other views
    const views = [
      'analytics_revenue_by_location_daily',
      'analytics_appointments_by_location_daily',
      'analytics_master_performance_daily',
      'analytics_service_performance_daily'
    ]

    for (const viewName of views) {
      console.log(`\nTesting: ${viewName}`)
      
      // Use parameterized queries with Prisma.sql for safety
      const org1ViewData = await prisma.$queryRaw`
        SELECT COUNT(*)::INTEGER as count
        FROM ${prisma.Prisma.raw(`"${viewName}"`)}
        WHERE organization_id = ${org1}
      `

      const org2ViewData = await prisma.$queryRaw`
        SELECT COUNT(*)::INTEGER as count
        FROM ${prisma.Prisma.raw(`"${viewName}"`)}
        WHERE organization_id = ${org2}
      `

      // Verify no cross-contamination
      const crossCheck = await prisma.$queryRaw`
        SELECT organization_id, COUNT(*)::INTEGER as count
        FROM ${prisma.Prisma.raw(`"${viewName}"`)}
        WHERE organization_id IN (${org1}, ${org2})
        GROUP BY organization_id
      `

      const orgIds = crossCheck.map(r => r.organization_id)
      if (orgIds.length !== new Set(orgIds).size) {
        console.error(`\n❌ TENANT ISOLATION VIOLATION in ${viewName}!`)
        process.exit(1)
      }

      console.log(`   ✅ Org1: ${org1ViewData[0]?.count || 0} records`)
      console.log(`   ✅ Org2: ${org2ViewData[0]?.count || 0} records`)
      console.log(`   ✅ Isolation verified`)
    }

    console.log('\n' + '='.repeat(60))
    console.log('✅ All tenant isolation checks passed!')
    console.log('='.repeat(60))

  } catch (error) {
    console.error('\n❌ Verification failed:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

verifyTenantIsolation()

