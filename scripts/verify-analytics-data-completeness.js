/**
 * Verify Analytics Data Completeness
 * 
 * Checks if all required fields for analytics views are populated correctly
 */

const prisma = require('../lib/prisma-client')

async function verifyAnalyticsData() {
  console.log('🔍 Verifying Analytics Data Completeness\n')
  console.log('='.repeat(80))

  const issues = []

  // 1. Check payments have organization_id
  console.log('\n1️⃣ Checking Payments...')
  const paymentsWithoutOrg = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM payments
    WHERE organization_id IS NULL
  `
  if (paymentsWithoutOrg[0].count > 0) {
    issues.push(`❌ ${paymentsWithoutOrg[0].count} payments missing organization_id`)
    console.log(`   ❌ ${paymentsWithoutOrg[0].count} payments missing organization_id`)
  } else {
    console.log('   ✅ All payments have organization_id')
  }

  const paymentsWithoutLocation = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM payments
    WHERE organization_id IS NOT NULL
      AND location_id IS NULL
  `
  if (paymentsWithoutLocation[0].count > 0) {
    issues.push(`⚠️ ${paymentsWithoutLocation[0].count} payments missing location_id (UUID)`)
    console.log(`   ⚠️ ${paymentsWithoutLocation[0].count} payments missing location_id (UUID)`)
  } else {
    console.log('   ✅ All payments have location_id')
  }

  // 2. Check bookings have organization_id
  console.log('\n2️⃣ Checking Bookings...')
  const bookingsWithoutOrg = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM bookings
    WHERE organization_id IS NULL
  `
  if (bookingsWithoutOrg[0].count > 0) {
    issues.push(`❌ ${bookingsWithoutOrg[0].count} bookings missing organization_id`)
    console.log(`   ❌ ${bookingsWithoutOrg[0].count} bookings missing organization_id`)
  } else {
    console.log('   ✅ All bookings have organization_id')
  }

  const bookingsWithoutLocation = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM bookings
    WHERE organization_id IS NOT NULL
      AND location_id IS NULL
  `
  if (bookingsWithoutLocation[0].count > 0) {
    issues.push(`⚠️ ${bookingsWithoutLocation[0].count} bookings missing location_id (UUID)`)
    console.log(`   ⚠️ ${bookingsWithoutLocation[0].count} bookings missing location_id (UUID)`)
  } else {
    console.log('   ✅ All bookings have location_id')
  }

  // 3. Check service_variation_id in bookings (should be UUID, not Square ID)
  console.log('\n3️⃣ Checking Booking Service Variations...')
  const bookingsWithServiceVariation = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM bookings
    WHERE service_variation_id IS NOT NULL
  `
  console.log(`   📊 ${bookingsWithServiceVariation[0].count} bookings have service_variation_id`)

  // Check if service_variation_id values are valid UUIDs that exist in service_variation table
  // Note: service_variation table uses 'id' as primary key (UUID)
  const invalidServiceVariations = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT b.service_variation_id) as count
    FROM bookings b
    WHERE b.service_variation_id IS NOT NULL
      AND b.service_variation_id::text NOT IN (
        SELECT id::text FROM service_variation
      )
  `
  if (invalidServiceVariations[0].count > 0) {
    issues.push(`❌ ${invalidServiceVariations[0].count} bookings have invalid service_variation_id (not found in service_variation table)`)
    console.log(`   ❌ ${invalidServiceVariations[0].count} bookings have invalid service_variation_id`)
  } else {
    console.log('   ✅ All booking service_variation_ids are valid UUIDs')
  }

  // 4. Check technician_id in bookings (should be UUID, not Square ID)
  console.log('\n4️⃣ Checking Booking Technicians...')
  const bookingsWithTechnician = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM bookings
    WHERE technician_id IS NOT NULL
  `
  console.log(`   📊 ${bookingsWithTechnician[0].count} bookings have technician_id`)

  const invalidTechnicians = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT b.technician_id) as count
    FROM bookings b
    WHERE b.technician_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM team_members tm
        WHERE tm.id = b.technician_id::uuid
      )
  `
  if (invalidTechnicians[0].count > 0) {
    issues.push(`❌ ${invalidTechnicians[0].count} bookings have invalid technician_id (not found in team_members table)`)
    console.log(`   ❌ ${invalidTechnicians[0].count} bookings have invalid technician_id`)
  } else {
    console.log('   ✅ All booking technician_ids are valid UUIDs')
  }

  // 5. Check order_line_items have organization_id
  console.log('\n5️⃣ Checking Order Line Items...')
  const orderLineItemsWithoutOrg = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM order_line_items
    WHERE organization_id IS NULL
  `
  if (orderLineItemsWithoutOrg[0].count > 0) {
    issues.push(`❌ ${orderLineItemsWithoutOrg[0].count} order_line_items missing organization_id`)
    console.log(`   ❌ ${orderLineItemsWithoutOrg[0].count} order_line_items missing organization_id`)
  } else {
    console.log('   ✅ All order_line_items have organization_id')
  }

  // 6. Check service_variation_id in order_line_items
  const orderLineItemsWithService = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM order_line_items
    WHERE service_variation_id IS NOT NULL
  `
  console.log(`   📊 ${orderLineItemsWithService[0].count} order_line_items have service_variation_id`)

  // 7. Check analytics view data availability
  console.log('\n6️⃣ Checking Analytics Views Data...')
  
  const overviewData = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM analytics_overview_daily
    WHERE organization_id IS NOT NULL
  `
  console.log(`   📊 analytics_overview_daily: ${overviewData[0].count} rows`)

  const revenueByLocation = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM analytics_revenue_by_location_daily
    WHERE organization_id IS NOT NULL
  `
  console.log(`   📊 analytics_revenue_by_location_daily: ${revenueByLocation[0].count} rows`)

  const appointmentsByLocation = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM analytics_appointments_by_location_daily
    WHERE organization_id IS NOT NULL
  `
  console.log(`   📊 analytics_appointments_by_location_daily: ${appointmentsByLocation[0].count} rows`)

  const masterPerformance = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM analytics_master_performance_daily
    WHERE organization_id IS NOT NULL
  `
  console.log(`   📊 analytics_master_performance_daily: ${masterPerformance[0].count} rows`)

  const servicePerformance = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM analytics_service_performance_daily
    WHERE organization_id IS NOT NULL
  `
  console.log(`   📊 analytics_service_performance_daily: ${servicePerformance[0].count} rows`)

  // 8. Check for data type mismatches
  console.log('\n7️⃣ Checking Data Type Issues...')
  
  // Check if bookings.location_id is Square ID instead of UUID
  const bookingsWithSquareLocationId = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM bookings b
    WHERE b.location_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM locations l
        WHERE l.id = b.location_id::uuid
      )
  `
  if (bookingsWithSquareLocationId[0].count > 0) {
    issues.push(`❌ ${bookingsWithSquareLocationId[0].count} bookings have location_id that is not a valid UUID (might be Square ID)`)
    console.log(`   ❌ ${bookingsWithSquareLocationId[0].count} bookings have invalid location_id`)
  } else {
    console.log('   ✅ All booking location_ids are valid UUIDs')
  }

  // Check if payments.location_id is Square ID instead of UUID
  const paymentsWithSquareLocationId = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM payments p
    WHERE p.location_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM locations l
        WHERE l.id = p.location_id::uuid
      )
  `
  if (paymentsWithSquareLocationId[0].count > 0) {
    issues.push(`❌ ${paymentsWithSquareLocationId[0].count} payments have location_id that is not a valid UUID (might be Square ID)`)
    console.log(`   ❌ ${paymentsWithSquareLocationId[0].count} payments have invalid location_id`)
  } else {
    console.log('   ✅ All payment location_ids are valid UUIDs')
  }

  // Summary
  console.log('\n' + '='.repeat(80))
  console.log('📊 SUMMARY')
  console.log('='.repeat(80))
  
  if (issues.length === 0) {
    console.log('\n✅ All analytics data looks good! No issues found.')
  } else {
    console.log(`\n⚠️ Found ${issues.length} issue(s):\n`)
    issues.forEach((issue, index) => {
      console.log(`   ${index + 1}. ${issue}`)
    })
    console.log('\n❌ Analytics views may have missing or incorrect data.')
  }

  await prisma.$disconnect()
}

verifyAnalyticsData()
  .catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })

