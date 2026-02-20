require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function verifyAdminAnalytics() {
  console.log('🔍 Verifying Admin Analytics Consistency (Dual Attribution)\n')
  console.log('='.repeat(80))

  try {
    // 1. Get totals from admin_analytics_daily for the last 7 days
    const adminTotals = await prisma.$queryRaw`
      SELECT 
        date_pacific,
        SUM(creator_revenue_cents) as creator_revenue,
        SUM(cashier_revenue_cents) as cashier_revenue
      FROM admin_analytics_daily
      WHERE date_pacific >= CURRENT_DATE - interval '7 days'
      GROUP BY 1
      ORDER BY 1 DESC
    `

    // 2. Get total appointment-linked revenue from payments for the same period
    const paymentTotals = await prisma.$queryRaw`
      SELECT 
        DATE(b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') as date_pacific,
        SUM(p.total_money_amount) as revenue
      FROM bookings b
      JOIN payments p ON p.booking_id = b.id
      WHERE p.status = 'COMPLETED'
        AND b.start_at >= CURRENT_DATE - interval '7 days'
      GROUP BY 1
      ORDER BY 1 DESC
    `

    console.log('\n📊 Comparison (Last 7 Days):')
    console.log('Date       | Creator Rev | Cashier Rev | Payment Rev | Status')
    console.log('-'.repeat(80))

    const dates = [...new Set([
      ...adminTotals.map(t => t.date_pacific.toISOString().split('T')[0]),
      ...paymentTotals.map(t => t.date_pacific.toISOString().split('T')[0])
    ])].sort().reverse()

    for (const date of dates) {
      const admin = adminTotals.find(t => t.date_pacific.toISOString().split('T')[0] === date) || { creator_revenue: 0, cashier_revenue: 0 }
      const pay = paymentTotals.find(t => t.date_pacific.toISOString().split('T')[0] === date) || { revenue: 0 }

      const creatorRev = Number(admin.creator_revenue)
      const cashierRev = Number(admin.cashier_revenue)
      const paymentRev = Number(pay.revenue)

      // DoD 1: Creator Revenue == Cashier Revenue (on the same set)
      const internalMatch = creatorRev === cashierRev ? '✅' : '❌'
      
      // DoD 2: Cashier Revenue == Payment Revenue (appointment-linked)
      const externalMatch = cashierRev === paymentRev ? '✅' : '❌'

      console.log(`${date} | ${String(creatorRev).padEnd(11)} | ${String(cashierRev).padEnd(11)} | ${String(paymentRev).padEnd(11)} | ${internalMatch} ${externalMatch}`)
    }

    console.log('\nNote: Status shows [Internal Match] [External Match]')
    console.log('✅✅ means data is perfectly consistent across both attribution models and raw payments.')

    // 3. Show Unattributed percentage
    const unattributed = await prisma.$queryRaw`
      SELECT 
        tm.given_name,
        SUM(cashier_revenue_cents) as revenue
      FROM admin_analytics_daily aad
      JOIN team_members tm ON tm.id = aad.team_member_id
      WHERE aad.date_pacific >= CURRENT_DATE - interval '30 days'
      GROUP BY 1
    `
    
    const totalRev = unattributed.reduce((sum, r) => sum + Number(r.revenue), 0)
    const systemRev = unattributed.find(r => r.given_name === 'Unattributed')?.revenue || 0
    const pct = totalRev > 0 ? (Number(systemRev) / totalRev * 100).toFixed(2) : 0

    console.log(`\n📉 Data Quality: ${pct}% of revenue is Unattributed (last 30 days)`)

    console.log('\n✅ Verification check complete.')

  } catch (error) {
    console.error('❌ Error during verification:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

verifyAdminAnalytics()
