/**
 * Fix existing referral URLs in database
 * Updates all referral URLs that contain Vercel preview URLs to production URL
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function fixReferralUrls() {
  try {
    console.log('🔧 Starting to fix referral URLs...')
    
    // First, let's check how many records need to be updated
    const recordsWithVercelUrl = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM square_existing_clients
      WHERE referral_url LIKE '%vercel.app%'
    `
    
    const count = Number(recordsWithVercelUrl[0]?.count || 0)
    console.log(`📊 Found ${count} records with Vercel preview URLs`)
    
    if (count === 0) {
      console.log('✅ No records need updating!')
      return
    }
    
    // Show some examples before updating
    const examples = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, referral_url
      FROM square_existing_clients
      WHERE referral_url LIKE '%vercel.app%'
      LIMIT 5
    `
    
    if (examples && examples.length > 0) {
      console.log('\n📝 Examples of URLs that will be updated:')
      examples.forEach((record) => {
        console.log(`   - ${record.given_name} ${record.family_name}: ${record.referral_url}`)
      })
    }
    
    // Update all referral URLs that contain Vercel preview URLs
    // Handle both the long preview URLs and the base vercel.app URLs
    const result = await prisma.$executeRaw`
      UPDATE square_existing_clients
      SET 
        referral_url = REPLACE(
          REPLACE(
            referral_url,
            'https://referral-system-salon-fbbq6x1wt-umis-projects-e802f152.vercel.app',
            'https://www.zorinastudio-referral.com'
          ),
          'https://referral-system-salon.vercel.app',
          'https://www.zorinastudio-referral.com'
        ),
        updated_at = NOW()
      WHERE referral_url LIKE '%vercel.app%'
    `
    
    const updatedCount = Number(result || 0)
    console.log(`\n✅ Updated ${updatedCount} referral URLs to production domain`)
    
    // Verify the update worked
    const remainingVercelUrls = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM square_existing_clients
      WHERE referral_url LIKE '%vercel.app%'
    `
    
    const remaining = Number(remainingVercelUrls[0]?.count || 0)
    if (remaining > 0) {
      console.log(`⚠️  Warning: ${remaining} records still contain Vercel URLs`)
      console.log('   These might have different Vercel URL formats')
    } else {
      console.log('✅ All Vercel URLs have been successfully updated!')
    }
    
    // Show some updated examples
    const updatedExamples = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, referral_url
      FROM square_existing_clients
      WHERE referral_url LIKE '%zorinastudio-referral.com%'
      ORDER BY updated_at DESC
      LIMIT 5
    `
    
    if (updatedExamples && updatedExamples.length > 0) {
      console.log('\n✅ Examples of updated URLs:')
      updatedExamples.forEach((record) => {
        console.log(`   - ${record.given_name} ${record.family_name}: ${record.referral_url}`)
      })
    }
    
  } catch (error) {
    console.error('❌ Error fixing referral URLs:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run the fix
fixReferralUrls()
  .then(() => {
    console.log('\n✨ Done!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error)
    process.exit(1)
  })

