#!/usr/bin/env node
/**
 * Refresh Analytics Materialized Views
 * Run this script nightly via cron to refresh materialized views
 * Only needed if materialized views are being used
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function refreshMaterializedViews() {
  console.log('🔄 Refreshing Analytics Materialized Views\n')
  console.log('='.repeat(60))

  try {
    // Check if materialized views exist
    const views = await prisma.$queryRaw`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = 'public'
        AND table_name LIKE 'analytics_%_mv'
      ORDER BY table_name
    `

    if (!views || views.length === 0) {
      console.log('ℹ️  No materialized views found.')
      console.log('   Materialized views are optional and only needed if regular views are slow.')
      console.log('   To create them, run: prisma/migrations/20260121150001_add_analytics_materialized_views.sql')
      return
    }

    console.log(`\nFound ${views.length} materialized views to refresh:`)
    views.forEach(v => console.log(`   - ${v.table_name}`))

    console.log('\nRefreshing views...')

    // Use the refresh function if it exists
    try {
      await prisma.$executeRaw`SELECT refresh_analytics_materialized_views()`
      console.log('✅ All materialized views refreshed successfully!')
    } catch (error) {
      // Fallback: refresh individually
      console.log('⚠️  Refresh function not found, refreshing individually...')
      
      for (const view of views) {
        const viewName = view.table_name
        console.log(`   Refreshing ${viewName}...`)
        
        try {
          await prisma.$executeRaw`
            REFRESH MATERIALIZED VIEW CONCURRENTLY ${prisma.Prisma.raw(viewName)}
          `
          console.log(`   ✅ ${viewName} refreshed`)
        } catch (err) {
          console.error(`   ❌ Error refreshing ${viewName}: ${err.message}`)
        }
      }
    }

    // Verify refresh
    console.log('\nVerifying refresh...')
    const sampleQuery = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM analytics_overview_daily_mv
      LIMIT 1
    `

    if (sampleQuery && sampleQuery.length > 0) {
      console.log(`✅ Verification successful (sample count: ${sampleQuery[0].count || 0})`)
    }

    console.log('\n' + '='.repeat(60))
    console.log('✅ Materialized views refresh completed!')
    console.log('='.repeat(60))

  } catch (error) {
    console.error('\n❌ Refresh failed:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

refreshMaterializedViews()

