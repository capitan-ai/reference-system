/**
 * Get referral code usage statistics:
 * - Total number of unique referral codes used
 * - Total number of new customers who used referral codes
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function getReferralStats() {
  console.log('📊 Referral Code Usage Statistics\n')
  console.log('='.repeat(60))
  
  try {
    // Get statistics from square_existing_clients
    const stats = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total_customers_with_referrals,
        COUNT(DISTINCT used_referral_code)::int as unique_codes_used
      FROM square_existing_clients
      WHERE used_referral_code IS NOT NULL
        AND used_referral_code != ''
    `
    
    const result = stats[0]
    
    console.log('\n📈 Results:')
    console.log('─'.repeat(60))
    console.log(`Total unique referral codes used: ${result.unique_codes_used.toLocaleString()}`)
    console.log(`Total new customers who used referral codes: ${result.total_customers_with_referrals.toLocaleString()}`)
    console.log('─'.repeat(60))
    
    // Additional breakdown by code
    const codeBreakdown = await prisma.$queryRaw`
      SELECT 
        used_referral_code as code,
        COUNT(*)::int as usage_count
      FROM square_existing_clients
      WHERE used_referral_code IS NOT NULL
        AND used_referral_code != ''
      GROUP BY used_referral_code
      ORDER BY usage_count DESC
      LIMIT 20
    `
    
    if (codeBreakdown.length > 0) {
      console.log('\n🔝 Top 20 most used referral codes:')
      console.log('─'.repeat(60))
      codeBreakdown.forEach((row, idx) => {
        console.log(`${(idx + 1).toString().padStart(2)}. ${row.code.padEnd(20)} - ${row.usage_count} customer(s)`)
      })
    }
    
    console.log('\n✅ Statistics retrieved successfully!\n')
    
  } catch (error) {
    console.error('\n❌ Error getting referral statistics:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

getReferralStats()



