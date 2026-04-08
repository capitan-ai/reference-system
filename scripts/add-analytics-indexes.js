#!/usr/bin/env node
/**
 * Add indexes for analytics performance
 * Run this script to add missing indexes for customer_analytics and admin_analytics_daily
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function addIndexes() {
  console.log('📊 Adding analytics indexes...\n')
  console.log('='.repeat(80))

  try {
    // Check existing indexes
    console.log('Checking existing indexes...')
    const existingIndexes = await prisma.$queryRaw`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename IN ('customer_analytics', 'admin_analytics_daily')
      ORDER BY tablename, indexname
    `
    
    console.log('\nExisting indexes:')
    existingIndexes.forEach(idx => {
      console.log(`  - ${idx.indexname}`)
    })

    // Indexes for customer_analytics
    console.log('\n\nAdding indexes for customer_analytics...')
    
    // For JOIN in VIEW analytics_appointments_by_location_daily
    console.log('  Creating idx_customer_analytics_org_customer...')
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_customer_analytics_org_customer 
      ON customer_analytics(organization_id, square_customer_id)
    `)

    // For filtering by first_visit_at (used in dashboard unique_customers query)
    console.log('  Creating idx_customer_analytics_first_visit...')
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_customer_analytics_first_visit 
      ON customer_analytics(organization_id, first_visit_at)
      WHERE first_visit_at IS NOT NULL
    `)

    // Indexes for admin_analytics_daily
    // For frequent queries by date_pacific
    console.log('  Creating idx_admin_analytics_date...')
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_admin_analytics_date 
      ON admin_analytics_daily(organization_id, date_pacific DESC)
    `)
    console.log('✅ Indexes created successfully!')

    // Verify indexes were created
    console.log('\n\nVerifying indexes...')
    const newIndexes = await prisma.$queryRaw`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename IN ('customer_analytics', 'admin_analytics_daily')
        AND indexname IN (
          'idx_customer_analytics_org_customer',
          'idx_customer_analytics_first_visit',
          'idx_admin_analytics_date'
        )
      ORDER BY tablename, indexname
    `

    console.log('\nNew indexes:')
    newIndexes.forEach(idx => {
      console.log(`  ✅ ${idx.indexname}`)
    })

    console.log('\n' + '='.repeat(80))
    console.log('✅ All indexes added successfully!')
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error adding indexes:', error.message)
    console.error(error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

addIndexes()

