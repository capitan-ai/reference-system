#!/usr/bin/env node
/**
 * Complete Database Analysis Script
 * Analyzes ALL data in the database for dashboard planning
 * 
 * Usage:
 *   node scripts/analyze-all-database-data.js
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

// Helper to format numbers
function formatNum(num) {
  return num ? num.toLocaleString() : '0'
}

// Helper to format dates
function formatDate(date) {
  if (!date) return 'N/A'
  return new Date(date).toISOString().split('T')[0]
}

async function checkTableExists(tableName) {
  try {
    await prisma.$queryRawUnsafe(`SELECT 1 FROM "${tableName}" LIMIT 1`)
    return true
  } catch {
    return false
  }
}

async function analyzeDatabase() {
  console.log('📊 COMPLETE DATABASE ANALYSIS')
  console.log('='.repeat(80))
  console.log(`Analysis Date: ${new Date().toISOString()}`)
  console.log('='.repeat(80))
  
  try {
    // ============================================
    // SECTION 1: CUSTOMERS DATA
    // ============================================
    console.log('\n👥 SECTION 1: CUSTOMERS DATA')
    console.log('='.repeat(80))
    
    // 1.1 Modern customers table
    console.log('\n1.1 Modern Customers Table (customers):')
    try {
      const customersCount = await prisma.customer.count()
      const customersWithSquare = await prisma.customer.count({
        where: { squareCustomerId: { not: null } }
      })
      const customersWithPayment = await prisma.customer.count({
        where: { firstPaidSeen: true }
      })
      
      console.log(`   Total Customers:        ${formatNum(customersCount)}`)
      console.log(`   With Square Customer ID: ${formatNum(customersWithSquare)}`)
      console.log(`   With First Payment:      ${formatNum(customersWithPayment)}`)
      
      if (customersCount > 0) {
        const oldest = await prisma.customer.findFirst({
          orderBy: { createdAt: 'asc' }
        })
        const newest = await prisma.customer.findFirst({
          orderBy: { createdAt: 'desc' }
        })
        
        console.log(`   Date Range:             ${formatDate(oldest?.createdAt)} to ${formatDate(newest?.createdAt)}`)
      }
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`)
    }
    
    // 1.2 Legacy square_existing_clients table
    console.log('\n1.2 Legacy Customers Table (square_existing_clients):')
    try {
      const legacyStats = await prisma.$queryRaw`
        SELECT 
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE email_address IS NOT NULL)::int as with_email,
          COUNT(*) FILTER (WHERE phone_number IS NOT NULL)::int as with_phone,
          COUNT(*) FILTER (WHERE gift_card_id IS NOT NULL)::int as with_gift_card,
          COUNT(*) FILTER (WHERE activated_as_referrer = true)::int as referrers,
          COUNT(*) FILTER (WHERE got_signup_bonus = true)::int as got_bonus,
          COUNT(*) FILTER (WHERE first_payment_completed = true)::int as first_paid,
          MIN(created_at) as earliest,
          MAX(created_at) as latest
        FROM square_existing_clients
      `
      
      const stats = legacyStats[0]
      console.log(`   Total Customers:        ${formatNum(stats.total)}`)
      console.log(`   With Email:             ${formatNum(stats.with_email)}`)
      console.log(`   With Phone:             ${formatNum(stats.with_phone)}`)
      console.log(`   With Gift Card:         ${formatNum(stats.with_gift_card)}`)
      console.log(`   Activated Referrers:    ${formatNum(stats.referrers)}`)
      console.log(`   Got Signup Bonus:       ${formatNum(stats.got_bonus)}`)
      console.log(`   First Payment Done:     ${formatNum(stats.first_paid)}`)
      console.log(`   Date Range:             ${formatDate(stats.earliest)} to ${formatDate(stats.latest)}`)
      
      // Sample customers
      const sampleCustomers = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          given_name,
          family_name,
          email_address,
          gift_card_id,
          activated_as_referrer,
          total_referrals,
          total_rewards,
          created_at
        FROM square_existing_clients
        ORDER BY created_at DESC
        LIMIT 5
      `
      
      console.log(`\n   Sample Customers (latest 5):`)
      sampleCustomers.forEach((cust, idx) => {
        console.log(`   ${idx + 1}. ${cust.given_name || ''} ${cust.family_name || ''}`)
        console.log(`      - ID: ${cust.square_customer_id}`)
        console.log(`      - Email: ${cust.email_address || 'None'}`)
        console.log(`      - Gift Card: ${cust.gift_card_id ? 'Yes' : 'No'}`)
        console.log(`      - Referrer: ${cust.activated_as_referrer ? 'Yes' : 'No'}`)
        console.log(`      - Referrals: ${cust.total_referrals || 0}, Rewards: $${((cust.total_rewards || 0) / 100).toFixed(2)}`)
      })
      
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`)
    }
    
    // ============================================
    // SECTION 2: GIFT CARDS DATA
    // ============================================
    console.log('\n\n🎁 SECTION 2: GIFT CARDS DATA')
    console.log('='.repeat(80))
    
    // 2.1 Gift cards in square_existing_clients
    console.log('\n2.1 Gift Cards in square_existing_clients:')
    try {
      const giftCardStats = await prisma.$queryRaw`
        SELECT 
          COUNT(*) FILTER (WHERE gift_card_id IS NOT NULL)::int as with_id,
          COUNT(*) FILTER (WHERE gift_card_gan IS NOT NULL)::int as with_gan,
          COUNT(*) FILTER (WHERE gift_card_order_id IS NOT NULL)::int as with_order_id,
          COUNT(*) FILTER (WHERE gift_card_activation_url IS NOT NULL)::int as with_activation_url,
          COUNT(*) FILTER (WHERE gift_card_pass_kit_url IS NOT NULL)::int as with_passkit_url,
          COUNT(*) FILTER (WHERE gift_card_digital_email IS NOT NULL)::int as with_email,
          COUNT(DISTINCT gift_card_id) FILTER (WHERE gift_card_id IS NOT NULL)::int as unique_cards
        FROM square_existing_clients
      `
      
      const gcStats = giftCardStats[0]
      console.log(`   Customers with Gift Card ID:    ${formatNum(gcStats.with_id)}`)
      console.log(`   Customers with GAN:              ${formatNum(gcStats.with_gan)}`)
      console.log(`   Unique Gift Card IDs:            ${formatNum(gcStats.unique_cards)}`)
      console.log(`   With Order ID:                   ${formatNum(gcStats.with_order_id)}`)
      console.log(`   With Activation URL:             ${formatNum(gcStats.with_activation_url)}`)
      console.log(`   With PassKit URL:                ${formatNum(gcStats.with_passkit_url)}`)
      console.log(`   With Digital Email:              ${formatNum(gcStats.with_email)}`)
      
      // Delivery channel breakdown
      const deliveryChannels = await prisma.$queryRaw`
        SELECT 
          gift_card_delivery_channel,
          COUNT(*)::int as count
        FROM square_existing_clients
        WHERE gift_card_delivery_channel IS NOT NULL
        GROUP BY gift_card_delivery_channel
        ORDER BY count DESC
      `
      
      if (deliveryChannels.length > 0) {
        console.log(`\n   Delivery Channels:`)
        deliveryChannels.forEach(ch => {
          console.log(`      - ${ch.gift_card_delivery_channel || 'NULL'}: ${formatNum(ch.count)}`)
        })
      }
      
      // Sample gift cards
      const sampleGiftCards = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          given_name,
          family_name,
          gift_card_id,
          gift_card_gan,
          gift_card_delivery_channel,
          got_signup_bonus,
          activated_as_referrer,
          created_at
        FROM square_existing_clients
        WHERE gift_card_id IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 5
      `
      
      console.log(`\n   Sample Gift Cards (latest 5):`)
      sampleGiftCards.forEach((gc, idx) => {
        console.log(`   ${idx + 1}. Customer: ${gc.given_name || ''} ${gc.family_name || ''}`)
        console.log(`      - Gift Card ID: ${gc.gift_card_id}`)
        console.log(`      - GAN: ${gc.gift_card_gan || 'Missing'}`)
        console.log(`      - Channel: ${gc.gift_card_delivery_channel || 'Unknown'}`)
        console.log(`      - Type: ${gc.got_signup_bonus ? 'Friend Bonus' : gc.activated_as_referrer ? 'Referrer Reward' : 'Unknown'}`)
      })
      
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`)
    }
    
    // 2.2 Gift card GAN audit table
    console.log('\n2.2 Gift Card GAN Audit Table:')
    try {
      const auditExists = await checkTableExists('square_gift_card_gan_audit')
      if (auditExists) {
        const auditStats = await prisma.$queryRaw`
          SELECT 
            COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE resolved_gan IS NOT NULL)::int as with_gan,
            MIN(verified_at) as earliest,
            MAX(verified_at) as latest
          FROM square_gift_card_gan_audit
        `
        
        const audit = auditStats[0]
        console.log(`   Total Audit Records:     ${formatNum(audit.total)}`)
        console.log(`   With Resolved GAN:       ${formatNum(audit.with_gan)}`)
        console.log(`   Date Range:              ${formatDate(audit.earliest)} to ${formatDate(audit.latest)}`)
      } else {
        console.log(`   ⚠️  Table does not exist`)
      }
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`)
    }
    
    // 2.3 New gift_cards table (if exists)
    console.log('\n2.3 New Gift Cards Table (if exists):')
    try {
      const newGiftCardsExists = await checkTableExists('gift_cards')
      if (newGiftCardsExists) {
        const newGcStats = await prisma.$queryRaw`
          SELECT 
            COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE gan IS NOT NULL)::int as with_gan,
            COUNT(*) FILTER (WHERE state = 'ACTIVE')::int as active,
            SUM(balance_cents)::bigint as total_balance_cents
          FROM gift_cards
        `
        
        const stats = newGcStats[0]
        console.log(`   Total Gift Cards:        ${formatNum(stats.total)}`)
        console.log(`   With GAN:                ${formatNum(stats.with_gan)}`)
        console.log(`   Active:                  ${formatNum(stats.active)}`)
        console.log(`   Total Balance:           $${((stats.total_balance_cents || 0) / 100).toFixed(2)}`)
      } else {
        console.log(`   ⚠️  Table does not exist yet (will be created in Phase 1)`)
      }
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`)
    }
    
    // ============================================
    // SECTION 3: REFERRAL PROGRAM DATA
    // ============================================
    console.log('\n\n🎯 SECTION 3: REFERRAL PROGRAM DATA')
    console.log('='.repeat(80))
    
    // 3.1 Referral Links
    console.log('\n3.1 Referral Links:')
    try {
      const refLinksStats = await prisma.refLink.groupBy({
        by: ['status'],
        _count: true
      })
      
      const totalLinks = await prisma.refLink.count()
      console.log(`   Total Referral Links:    ${formatNum(totalLinks)}`)
      refLinksStats.forEach(stat => {
        console.log(`      - ${stat.status}: ${formatNum(stat._count)}`)
      })
      
      if (totalLinks > 0) {
        const oldestLink = await prisma.refLink.findFirst({
          orderBy: { createdAt: 'asc' }
        })
        const newestLink = await prisma.refLink.findFirst({
          orderBy: { createdAt: 'desc' }
        })
        console.log(`   Date Range:              ${formatDate(oldestLink?.createdAt)} to ${formatDate(newestLink?.createdAt)}`)
      }
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`)
    }
    
    // 3.2 Referral Clicks
    console.log('\n3.2 Referral Clicks:')
    try {
      const clicksCount = await prisma.refClick.count()
      const clicksMatched = await prisma.refClick.count({
        where: { matched: true }
      })
      const clicksWithCustomer = await prisma.refClick.count({
        where: { customerId: { not: null } }
      })
      
      // Get unique codes count
      const uniqueCodesResult = await prisma.$queryRaw`
        SELECT COUNT(DISTINCT "refCode")::int as count
        FROM ref_clicks
      `
      const uniqueCodes = uniqueCodesResult[0]?.count || 0
      
      console.log(`   Total Clicks:            ${formatNum(clicksCount)}`)
      console.log(`   Matched Clicks:          ${formatNum(clicksMatched)}`)
      console.log(`   Match Rate:              ${clicksCount > 0 ? ((clicksMatched / clicksCount) * 100).toFixed(2) + '%' : '0%'}`)
      console.log(`   Unique Referral Codes:   ${formatNum(uniqueCodes)}`)
      console.log(`   Clicks with Customer ID: ${formatNum(clicksWithCustomer)}`)
      
      // Top referral codes by clicks
      const topCodesResult = await prisma.$queryRaw`
        SELECT 
          "refCode" as ref_code,
          COUNT(*)::int as clicks,
          COUNT(*) FILTER (WHERE matched = true)::int as matched
        FROM ref_clicks
        GROUP BY "refCode"
        ORDER BY clicks DESC
        LIMIT 5
      `
      
      if (topCodesResult.length > 0) {
        console.log(`\n   Top Referral Codes:`)
        topCodesResult.forEach((code, idx) => {
          console.log(`      ${idx + 1}. ${code.ref_code}: ${formatNum(code.clicks)} clicks, ${formatNum(code.matched)} matched`)
        })
      }
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`)
    }
    
    // 3.3 Referral Matches
    console.log('\n3.3 Referral Matches:')
    try {
      const matchesCount = await prisma.refMatch.count()
      const uniqueCodesResult = await prisma.$queryRaw`
        SELECT COUNT(DISTINCT "refCode")::int as count
        FROM ref_matches
      `
      const uniqueCodes = uniqueCodesResult[0]?.count || 0
      
      const avgConfidenceResult = await prisma.$queryRaw`
        SELECT AVG(confidence)::float as avg_confidence
        FROM ref_matches
      `
      const avgConfidence = avgConfidenceResult[0]?.avg_confidence || null
      
      console.log(`   Total Matches:           ${formatNum(matchesCount)}`)
      console.log(`   Unique Referral Codes:   ${formatNum(uniqueCodes)}`)
      console.log(`   Average Confidence:      ${avgConfidence ? avgConfidence.toFixed(2) : 'N/A'}`)
      
      // Match methods breakdown using Prisma
      const matches = await prisma.refMatch.findMany({
        select: { matchedVia: true }
      })
      
      const methodCounts = {}
      matches.forEach(m => {
        methodCounts[m.matchedVia] = (methodCounts[m.matchedVia] || 0) + 1
      })
      
      if (Object.keys(methodCounts).length > 0) {
        console.log(`\n   Match Methods:`)
        Object.entries(methodCounts)
          .sort((a, b) => b[1] - a[1])
          .forEach(([method, count]) => {
            console.log(`      - ${method}: ${formatNum(count)}`)
          })
      }
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`)
    }
    
    // 3.4 Referral Rewards
    console.log('\n3.4 Referral Rewards:')
    try {
      const rewardsTotal = await prisma.refReward.count()
      const friendDiscounts = await prisma.refReward.count({
        where: { type: 'FRIEND_DISCOUNT' }
      })
      const referrerRewards = await prisma.refReward.count({
        where: { type: 'REFERRER_REWARD' }
      })
      const granted = await prisma.refReward.count({
        where: { status: 'GRANTED' }
      })
      const pending = await prisma.refReward.count({
        where: { status: 'PENDING' }
      })
      const redeemed = await prisma.refReward.count({
        where: { status: 'REDEEMED' }
      })
      
      // Get total granted amount
      const grantedRewards = await prisma.refReward.findMany({
        where: { status: 'GRANTED' },
        select: { amount: true }
      })
      const totalGrantedCents = grantedRewards.reduce((sum, r) => sum + r.amount, 0)
      
      console.log(`   Total Rewards:           ${formatNum(rewardsTotal)}`)
      console.log(`   Friend Discounts:        ${formatNum(friendDiscounts)}`)
      console.log(`   Referrer Rewards:        ${formatNum(referrerRewards)}`)
      console.log(`   Status Breakdown:`)
      console.log(`      - Granted:  ${formatNum(granted)}`)
      console.log(`      - Pending:  ${formatNum(pending)}`)
      console.log(`      - Redeemed: ${formatNum(redeemed)}`)
      console.log(`   Total Granted Amount:    $${(totalGrantedCents / 100).toFixed(2)}`)
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`)
    }
    
    // ============================================
    // SECTION 4: BOOKINGS DATA (NEW TABLES)
    // ============================================
    console.log('\n\n📅 SECTION 4: BOOKINGS DATA')
    console.log('='.repeat(80))
    
    console.log('\n4.1 Bookings Table:')
    try {
      const bookingsExists = await checkTableExists('bookings')
      if (bookingsExists) {
        const bookingsStats = await prisma.$queryRaw`
          SELECT 
            COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE status = 'CREATED')::int as created,
            COUNT(*) FILTER (WHERE status = 'CANCELLED')::int as cancelled,
            COUNT(*) FILTER (WHERE status = 'COMPLETED')::int as completed,
            COUNT(DISTINCT location_name)::int as unique_locations,
            MIN(created_at) as earliest,
            MAX(created_at) as latest
          FROM bookings
        `
        
        const bookings = bookingsStats[0]
        console.log(`   Total Bookings:          ${formatNum(bookings.total)}`)
        console.log(`   Status Breakdown:`)
        console.log(`      - Created:   ${formatNum(bookings.created)}`)
        console.log(`      - Cancelled: ${formatNum(bookings.cancelled)}`)
        console.log(`      - Completed: ${formatNum(bookings.completed)}`)
        console.log(`   Unique Locations:        ${formatNum(bookings.unique_locations)}`)
        console.log(`   Date Range:              ${formatDate(bookings.earliest)} to ${formatDate(bookings.latest)}`)
        
        // By location
        const byLocation = await prisma.$queryRaw`
          SELECT 
            location_name,
            COUNT(*)::int as count
          FROM bookings
          WHERE location_name IS NOT NULL
          GROUP BY location_name
          ORDER BY count DESC
        `
        
        if (byLocation.length > 0) {
          console.log(`\n   By Location:`)
          byLocation.forEach(loc => {
            console.log(`      - ${loc.location_name || 'Unknown'}: ${formatNum(loc.count)}`)
          })
        }
      } else {
        console.log(`   ⚠️  Table does not exist yet (will be created in Phase 1)`)
      }
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`)
    }
    
    // ============================================
    // SECTION 5: PAYMENTS DATA (NEW TABLES)
    // ============================================
    console.log('\n\n💰 SECTION 5: PAYMENTS DATA')
    console.log('='.repeat(80))
    
    console.log('\n5.1 Payments Table:')
    try {
      const paymentsExists = await checkTableExists('payments')
      if (paymentsExists) {
        const paymentsStats = await prisma.$queryRaw`
          SELECT 
            COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE status = 'COMPLETED')::int as completed,
            COUNT(*) FILTER (WHERE status = 'REFUNDED')::int as refunded,
            SUM(amount_cents) FILTER (WHERE status = 'COMPLETED')::bigint as total_revenue_cents,
            SUM(tip_amount_cents) FILTER (WHERE status = 'COMPLETED')::bigint as total_tips_cents,
            AVG(amount_cents) FILTER (WHERE status = 'COMPLETED')::float as avg_ticket_cents,
            MIN(paid_at) as earliest,
            MAX(paid_at) as latest
          FROM payments
        `
        
        const payments = paymentsStats[0]
        console.log(`   Total Payments:          ${formatNum(payments.total)}`)
        console.log(`   Status Breakdown:`)
        console.log(`      - Completed: ${formatNum(payments.completed)}`)
        console.log(`      - Refunded:  ${formatNum(payments.refunded)}`)
        console.log(`   Total Revenue:           $${((payments.total_revenue_cents || 0) / 100).toFixed(2)}`)
        console.log(`   Total Tips:              $${((payments.total_tips_cents || 0) / 100).toFixed(2)}`)
        console.log(`   Average Ticket:          $${((payments.avg_ticket_cents || 0) / 100).toFixed(2)}`)
        console.log(`   Date Range:              ${formatDate(payments.earliest)} to ${formatDate(payments.latest)}`)
      } else {
        console.log(`   ⚠️  Table does not exist yet (will be created in Phase 1)`)
      }
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`)
    }
    
    // ============================================
    // SECTION 6: GIFT CARD JOBS & RUNS
    // ============================================
    console.log('\n\n⚙️  SECTION 6: GIFT CARD PROCESSING')
    console.log('='.repeat(80))
    
    // 6.1 Gift Card Jobs
    console.log('\n6.1 Gift Card Jobs:')
    try {
      const jobsStats = await prisma.$queryRaw`
        SELECT 
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE status = 'queued')::int as queued,
          COUNT(*) FILTER (WHERE status = 'running')::int as running,
          COUNT(*) FILTER (WHERE status = 'completed')::int as completed,
          COUNT(*) FILTER (WHERE status = 'error')::int as errors
        FROM giftcard_jobs
      `
      
      const jobs = jobsStats[0]
      console.log(`   Total Jobs:              ${formatNum(jobs.total)}`)
      console.log(`   Status Breakdown:`)
      console.log(`      - Queued:    ${formatNum(jobs.queued)}`)
      console.log(`      - Running:   ${formatNum(jobs.running)}`)
      console.log(`      - Completed: ${formatNum(jobs.completed)}`)
      console.log(`      - Errors:    ${formatNum(jobs.errors)}`)
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`)
    }
    
    // 6.2 Gift Card Runs
    console.log('\n6.2 Gift Card Runs:')
    try {
      const runsStats = await prisma.$queryRaw`
        SELECT 
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE status = 'pending')::int as pending,
          COUNT(*) FILTER (WHERE status = 'completed')::int as completed,
          COUNT(*) FILTER (WHERE status = 'error')::int as errors,
          AVG(attempts)::float as avg_attempts
        FROM giftcard_runs
      `
      
      const runs = runsStats[0]
      console.log(`   Total Runs:              ${formatNum(runs.total)}`)
      console.log(`   Status Breakdown:`)
      console.log(`      - Pending:   ${formatNum(runs.pending)}`)
      console.log(`      - Completed: ${formatNum(runs.completed)}`)
      console.log(`      - Errors:    ${formatNum(runs.errors)}`)
      console.log(`   Average Attempts:        ${runs.avg_attempts ? runs.avg_attempts.toFixed(2) : 'N/A'}`)
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`)
    }
    
    // ============================================
    // SECTION 7: NOTIFICATIONS
    // ============================================
    console.log('\n\n📧 SECTION 7: NOTIFICATIONS')
    console.log('='.repeat(80))
    
    console.log('\n7.1 Notification Events:')
    try {
      const notifStats = await prisma.$queryRaw`
        SELECT 
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE channel = 'EMAIL')::int as emails,
          COUNT(*) FILTER (WHERE channel = 'SMS')::int as sms,
          COUNT(*) FILTER (WHERE status = 'sent')::int as sent,
          COUNT(*) FILTER (WHERE status = 'delivered')::int as delivered,
          COUNT(*) FILTER (WHERE status = 'failed')::int as failed
        FROM notification_events
      `
      
      const notifs = notifStats[0]
      console.log(`   Total Notifications:     ${formatNum(notifs.total)}`)
      console.log(`   By Channel:`)
      console.log(`      - Email: ${formatNum(notifs.emails)}`)
      console.log(`      - SMS:   ${formatNum(notifs.sms)}`)
      console.log(`   Status Breakdown:`)
      console.log(`      - Sent:      ${formatNum(notifs.sent)}`)
      console.log(`      - Delivered: ${formatNum(notifs.delivered)}`)
      console.log(`      - Failed:    ${formatNum(notifs.failed)}`)
      
      const deliveryRate = notifs.sent > 0 
        ? ((notifs.delivered / notifs.sent) * 100).toFixed(2) + '%'
        : '0%'
      console.log(`   Delivery Rate:           ${deliveryRate}`)
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`)
    }
    
    // ============================================
    // SECTION 8: PROCESSED EVENTS
    // ============================================
    console.log('\n\n🔄 SECTION 8: IDEMPOTENCY')
    console.log('='.repeat(80))
    
    console.log('\n8.1 Processed Events:')
    try {
      const processedCount = await prisma.processedEvent.count()
      console.log(`   Total Processed Events:  ${formatNum(processedCount)}`)
      
      if (processedCount > 0) {
        const sample = await prisma.processedEvent.findMany({
          take: 5,
          orderBy: { createdAt: 'desc' }
        })
        
        console.log(`\n   Sample Event Keys (latest 5):`)
        sample.forEach((event, idx) => {
          console.log(`      ${idx + 1}. ${event.idempotencyKey}`)
        })
      }
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`)
    }
    
    // ============================================
    // SUMMARY & RECOMMENDATIONS
    // ============================================
    console.log('\n\n' + '='.repeat(80))
    console.log('📋 SUMMARY & RECOMMENDATIONS')
    console.log('='.repeat(80))
    
    try {
      const legacyCustomers = await prisma.$queryRaw`
        SELECT COUNT(*)::int as count FROM square_existing_clients
      `
      const modernCustomers = await prisma.customer.count()
      const giftCards = await prisma.$queryRaw`
        SELECT COUNT(*) FILTER (WHERE gift_card_id IS NOT NULL)::int as count 
        FROM square_existing_clients
      `
      
      console.log(`\n✅ Existing Data Ready for Dashboard:`)
      console.log(`   - Legacy Customers:      ${formatNum(legacyCustomers[0].count)}`)
      console.log(`   - Modern Customers:      ${formatNum(modernCustomers)}`)
      console.log(`   - Gift Cards:            ${formatNum(giftCards[0].count)}`)
      
      const bookingsExists = await checkTableExists('bookings')
      const paymentsExists = await checkTableExists('payments')
      
      console.log(`\n📊 Dashboard Tables Status:`)
      console.log(`   - Bookings Table:        ${bookingsExists ? '✅ Exists' : '❌ Not created (Phase 1)'}`)
      console.log(`   - Payments Table:        ${paymentsExists ? '✅ Exists' : '❌ Not created (Phase 1)'}`)
      console.log(`   - Discounts Table:       ${await checkTableExists('payment_discounts') ? '✅ Exists' : '❌ Not created (Phase 1)'}`)
      console.log(`   - Master Earnings Table: ${await checkTableExists('master_earnings') ? '✅ Exists' : '❌ Not created (Phase 1)'}`)
      console.log(`   - Gift Cards Table:      ${await checkTableExists('gift_cards') ? '✅ Exists' : '❌ Not created (Phase 1)'}`)
      
      console.log(`\n📝 Next Steps:`)
      if (!bookingsExists) {
        console.log(`   1. Phase 1: Create database tables (bookings, payments, etc.)`)
      }
      console.log(`   2. Phase 2: Backfill historical bookings from Square API`)
      console.log(`   3. Phase 4: Backfill historical payments from Square API`)
      console.log(`   4. Phase 6: Migrate existing gift card data from square_existing_clients`)
      console.log(`   5. Phase 7: Backfill gift card transactions from Square Activities API`)
      
    } catch (error) {
      console.log(`   ⚠️  Error generating summary: ${error.message}`)
    }
    
    console.log('\n' + '='.repeat(80))
    console.log('✅ Analysis Complete!')
    console.log('='.repeat(80))
    
  } catch (error) {
    console.error('\n❌ Analysis failed:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  analyzeDatabase()
    .catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

module.exports = { analyzeDatabase }
