/**
 * Check which of the updated referral URL customers have emails
 * and whether they received referral code emails
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function checkUpdatedReferralEmails() {
  try {
    console.log('🔍 Checking customers with updated referral URLs...')
    
    // Get all customers who have referral URLs with production domain
    // Focus on those that were previously using Vercel URLs (might still have old URLs saved)
    // Check all production URLs to see email status
    const customers = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        phone_number,
        personal_code,
        referral_url,
        referral_email_sent,
        first_payment_completed,
        created_at,
        updated_at
      FROM square_existing_clients
      WHERE referral_url LIKE '%zorinastudio-referral.com%'
      ORDER BY updated_at DESC
      LIMIT 50
    `
    
    console.log(`\n📊 Found ${customers.length} customers with recently updated URLs\n`)
    
    if (customers.length === 0) {
      console.log('ℹ️  No recently updated customers found')
      return
    }
    
    let withEmail = 0
    let withoutEmail = 0
    let emailSent = 0
    let emailNotSent = 0
    
    console.log('📋 Customer Details:\n')
    console.log('─'.repeat(120))
    
    customers.forEach((customer, index) => {
      const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
      const hasEmail = !!customer.email_address
      const emailSentStatus = customer.referral_email_sent
      const firstPayment = customer.first_payment_completed
      
      if (hasEmail) {
        withEmail++
        if (emailSentStatus) {
          emailSent++
        } else {
          emailNotSent++
        }
      } else {
        withoutEmail++
      }
      
      console.log(`${index + 1}. ${name}`)
      console.log(`   Customer ID: ${customer.square_customer_id}`)
      console.log(`   Referral Code: ${customer.personal_code || 'N/A'}`)
      console.log(`   Referral URL: ${customer.referral_url}`)
      console.log(`   Email: ${hasEmail ? customer.email_address : '❌ No email'}`)
      console.log(`   Email Sent: ${emailSentStatus ? '✅ YES' : '❌ NO'}`)
      console.log(`   First Payment: ${firstPayment ? '✅ Yes' : '❌ No'}`)
      console.log(`   Updated: ${new Date(customer.updated_at).toLocaleString()}`)
      console.log('─'.repeat(120))
    })
    
    console.log('\n📊 Summary:')
    console.log(`   Total customers: ${customers.length}`)
    console.log(`   With email: ${withEmail}`)
    console.log(`   Without email: ${withoutEmail}`)
    console.log(`   Email sent: ${emailSent}`)
    console.log(`   Email NOT sent (but has email): ${emailNotSent}`)
    
    if (emailNotSent > 0) {
      console.log('\n⚠️  Customers with email but referral email NOT sent:')
      customers
        .filter(c => c.email_address && !c.referral_email_sent)
        .forEach((customer) => {
          const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
          console.log(`   - ${name} (${customer.email_address})`)
          console.log(`     Referral URL: ${customer.referral_url}`)
        })
    }
    
    // Also check if there are any customers with production URLs that were NOT just updated
    // (to see if they received emails earlier)
    const allProductionUrls = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN email_address IS NOT NULL THEN 1 END) as with_email,
        COUNT(CASE WHEN referral_email_sent = TRUE THEN 1 END) as email_sent
      FROM square_existing_clients
      WHERE referral_url LIKE '%zorinastudio-referral.com%'
    `
    
    const stats = allProductionUrls[0]
    console.log('\n📈 All customers with production referral URLs:')
    console.log(`   Total: ${stats.total}`)
    console.log(`   With email: ${stats.with_email}`)
    console.log(`   Email sent: ${stats.email_sent}`)
    console.log(`   Email NOT sent (but has email): ${stats.with_email - stats.email_sent}`)
    
  } catch (error) {
    console.error('❌ Error checking customers:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run the check
checkUpdatedReferralEmails()
  .then(() => {
    console.log('\n✨ Done!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error)
    process.exit(1)
  })

