#!/usr/bin/env node
/**
 * Check Revenue by Location
 * Shows revenue breakdown for each location
 * 
 * Usage:
 *   node scripts/check-location-revenue.js [organization_id]
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

const ORG_ID = process.argv[2] || 'd0e24178-2f94-4033-bc91-41f22df58278'

function formatCurrency(amount) {
  if (!amount) return '$0.00'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(amount))
}

function formatNumber(num) {
  return num ? Number(num).toLocaleString() : '0'
}

async function checkLocationRevenue() {
  console.log('💰 Checking Revenue by Location\n')
  console.log('='.repeat(80))
  console.log(`Organization ID: ${ORG_ID}\n`)

  try {
    // Verify organization exists
    const org = await prisma.$queryRaw`
      SELECT id, name, square_merchant_id
      FROM organizations
      WHERE id = ${ORG_ID}::uuid
    `

    if (!org || org.length === 0) {
      console.log('❌ Organization not found!')
      return
    }

    console.log(`Organization: ${org[0].name || org[0].square_merchant_id || ORG_ID}\n`)

    // 1. Total Revenue by Location (All Time)
    console.log('📊 TOTAL REVENUE BY LOCATION (All Time)')
    console.log('-'.repeat(80))
    
    const totalRevenue = await prisma.$queryRaw`
      SELECT 
        location_name,
        SUM(revenue_dollars) as total_revenue,
        SUM(payment_count) as total_payments,
        SUM(unique_customers) as total_customers,
        COUNT(DISTINCT date) as days_with_revenue
      FROM analytics_revenue_by_location_daily
      WHERE organization_id = ${ORG_ID}::uuid
      GROUP BY location_name
      ORDER BY total_revenue DESC
    `

    if (totalRevenue && totalRevenue.length > 0) {
      const grandTotal = totalRevenue.reduce((sum, loc) => sum + Number(loc.total_revenue || 0), 0)
      
      totalRevenue.forEach((loc, idx) => {
        const percentage = grandTotal > 0 
          ? ((Number(loc.total_revenue) / grandTotal) * 100).toFixed(1)
          : '0.0'
        
        console.log(`\n${idx + 1}. ${loc.location_name || 'Unknown Location'}`)
        console.log(`   Total Revenue:     ${formatCurrency(loc.total_revenue)} (${percentage}%)`)
        console.log(`   Total Payments:    ${formatNumber(loc.total_payments)}`)
        console.log(`   Total Customers:   ${formatNumber(loc.total_customers)}`)
        console.log(`   Days with Revenue: ${formatNumber(loc.days_with_revenue)}`)
        if (loc.total_payments > 0) {
          const avgTicket = Number(loc.total_revenue) / Number(loc.total_payments)
          console.log(`   Avg Ticket Size:   ${formatCurrency(avgTicket)}`)
        }
      })
      
      console.log(`\n${'='.repeat(80)}`)
      console.log(`GRAND TOTAL: ${formatCurrency(grandTotal)}`)
      console.log(`Total Locations: ${totalRevenue.length}`)
    } else {
      console.log('   ⚠️  No revenue data found')
    }

    // 2. Revenue by Location (Last 30 Days)
    console.log('\n\n📈 REVENUE BY LOCATION (Last 30 Days)')
    console.log('-'.repeat(80))
    
    const recentRevenue = await prisma.$queryRaw`
      SELECT 
        location_name,
        SUM(revenue_dollars) as revenue_last_30_days,
        SUM(payment_count) as payments_last_30_days,
        SUM(unique_customers) as customers_last_30_days,
        ROUND(AVG(revenue_dollars), 2) as avg_daily_revenue
      FROM analytics_revenue_by_location_daily
      WHERE organization_id = ${ORG_ID}::uuid
        AND date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY location_name
      ORDER BY revenue_last_30_days DESC
    `

    if (recentRevenue && recentRevenue.length > 0) {
      const recentTotal = recentRevenue.reduce((sum, loc) => sum + Number(loc.revenue_last_30_days || 0), 0)
      
      recentRevenue.forEach((loc, idx) => {
        const percentage = recentTotal > 0
          ? ((Number(loc.revenue_last_30_days) / recentTotal) * 100).toFixed(1)
          : '0.0'
        
        console.log(`\n${idx + 1}. ${loc.location_name || 'Unknown Location'}`)
        console.log(`   Revenue (30 days): ${formatCurrency(loc.revenue_last_30_days)} (${percentage}%)`)
        console.log(`   Payments:          ${formatNumber(loc.payments_last_30_days)}`)
        console.log(`   Customers:         ${formatNumber(loc.customers_last_30_days)}`)
        console.log(`   Avg Daily Revenue: ${formatCurrency(loc.avg_daily_revenue)}`)
      })
      
      console.log(`\n${'='.repeat(80)}`)
      console.log(`TOTAL (30 days): ${formatCurrency(recentTotal)}`)
    } else {
      console.log('   ⚠️  No revenue data found for last 30 days')
    }

    // 3. Daily Breakdown (Last 7 Days)
    console.log('\n\n📅 DAILY REVENUE BY LOCATION (Last 7 Days)')
    console.log('-'.repeat(80))
    
    const dailyRevenue = await prisma.$queryRaw`
      SELECT 
        location_name,
        date,
        revenue_dollars,
        payment_count,
        unique_customers
      FROM analytics_revenue_by_location_daily
      WHERE organization_id = ${ORG_ID}::uuid
        AND date >= CURRENT_DATE - INTERVAL '7 days'
      ORDER BY date DESC, revenue_dollars DESC
    `

    if (dailyRevenue && dailyRevenue.length > 0) {
      // Group by date
      const byDate = {}
      dailyRevenue.forEach(row => {
        const dateKey = row.date.toISOString().split('T')[0]
        if (!byDate[dateKey]) {
          byDate[dateKey] = []
        }
        byDate[dateKey].push(row)
      })

      Object.keys(byDate).sort().reverse().forEach(date => {
        const dayTotal = byDate[date].reduce((sum, loc) => sum + Number(loc.revenue_dollars || 0), 0)
        console.log(`\n📅 ${date} - Total: ${formatCurrency(dayTotal)}`)
        byDate[date].forEach(loc => {
          console.log(`   ${loc.location_name || 'Unknown'}: ${formatCurrency(loc.revenue_dollars)} (${formatNumber(loc.payment_count)} payments, ${formatNumber(loc.unique_customers)} customers)`)
        })
      })
    } else {
      console.log('   ⚠️  No revenue data found for last 7 days')
    }

    // 4. Monthly Comparison (Last 3 Months)
    console.log('\n\n📆 MONTHLY REVENUE BY LOCATION (Last 3 Months)')
    console.log('-'.repeat(80))
    
    const monthlyRevenue = await prisma.$queryRaw`
      SELECT 
        location_name,
        DATE_TRUNC('month', date) as month,
        SUM(revenue_dollars) as monthly_revenue,
        SUM(payment_count) as monthly_payments,
        SUM(unique_customers) as monthly_customers
      FROM analytics_revenue_by_location_daily
      WHERE organization_id = ${ORG_ID}::uuid
        AND date >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY location_name, DATE_TRUNC('month', date)
      ORDER BY month DESC, monthly_revenue DESC
    `

    if (monthlyRevenue && monthlyRevenue.length > 0) {
      // Group by month
      const byMonth = {}
      monthlyRevenue.forEach(row => {
        const monthKey = row.month.toISOString().split('T')[0].substring(0, 7) // YYYY-MM
        if (!byMonth[monthKey]) {
          byMonth[monthKey] = []
        }
        byMonth[monthKey].push(row)
      })

      Object.keys(byMonth).sort().reverse().forEach(month => {
        const monthTotal = byMonth[month].reduce((sum, loc) => sum + Number(loc.monthly_revenue || 0), 0)
        console.log(`\n📅 ${month} - Total: ${formatCurrency(monthTotal)}`)
        byMonth[month].forEach(loc => {
          console.log(`   ${loc.location_name || 'Unknown'}: ${formatCurrency(loc.monthly_revenue)} (${formatNumber(loc.monthly_payments)} payments, ${formatNumber(loc.monthly_customers)} customers)`)
        })
      })
    } else {
      console.log('   ⚠️  No revenue data found for last 3 months')
    }

    console.log('\n' + '='.repeat(80))
    console.log('✅ Revenue check completed!')
    console.log('='.repeat(80))

  } catch (error) {
    console.error('\n❌ Error checking revenue:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

checkLocationRevenue()



