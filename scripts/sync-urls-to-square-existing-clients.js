#!/usr/bin/env node

/**
 * Sync referral URLs to square_existing_clients table
 * 
 * Note: ref_links table has been removed. This script now only generates URLs
 * for customers who have personal_code but no referral_url.
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function syncUrlsToSquareExistingClients() {
  try {
    console.log('🔄 Syncing referral URLs to square_existing_clients table...')
    console.log('='.repeat(60))
    console.log('')

    // Generate URLs for customers with personal_code but no referral_url
    const { generateReferralUrl } = require('../lib/utils/referral-url')
    
    const customersWithoutUrl = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        personal_code,
        given_name,
        family_name,
        phone_number
      FROM square_existing_clients
      WHERE personal_code IS NOT NULL 
        AND personal_code != ''
        AND (referral_url IS NULL OR referral_url = '')
    `

    console.log(`📊 Found ${customersWithoutUrl.length} customers with personal_code but no URL`)
    console.log('')

    if (customersWithoutUrl.length === 0) {
      console.log('✅ All customers with personal_code already have referral URLs')
      return
    }

    let updatedCount = 0
    let skippedCount = 0
    const errors = []

    for (const customer of customersWithoutUrl) {
      try {
        const referralUrl = generateReferralUrl(customer.personal_code)
        
        // Update square_existing_clients with referral URL
        await prisma.$executeRaw`
          UPDATE square_existing_clients
          SET 
            referral_url = ${referralUrl},
            referral_code = COALESCE(referral_code, ${customer.personal_code}),
            updated_at = NOW()
          WHERE square_customer_id = ${customer.square_customer_id}
        `

        updatedCount++
        const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
        if (updatedCount <= 10 || updatedCount % 50 === 0) {
          console.log(`✅ Updated: ${customer.square_customer_id} (${customerName})`)
          console.log(`   Code: ${customer.personal_code}`)
          console.log(`   URL: ${referralUrl}`)
        }

      } catch (error) {
        errors.push({
          squareCustomerId: customer.square_customer_id,
          error: error.message
        })
        skippedCount++
        if (errors.length <= 10) {
          console.log(`❌ Error updating ${customer.square_customer_id}: ${error.message}`)
        }
      }
    }

    console.log('')
    console.log('='.repeat(60))
    console.log('📊 Summary:')
    console.log(`   Total customers processed: ${customersWithoutUrl.length}`)
    console.log(`   ✅ Updated: ${updatedCount}`)
    console.log(`   ⏭️  Skipped: ${skippedCount}`)
    console.log(`   ❌ Errors: ${errors.length}`)
    console.log('')

    if (errors.length > 0) {
      console.log('❌ Errors encountered:')
      errors.slice(0, 10).forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.squareCustomerId}: ${err.error}`)
      })
      if (errors.length > 10) {
        console.log(`   ... and ${errors.length - 10} more errors`)
      }
      console.log('')
    }

    // Verify final count
    const finalCount = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM square_existing_clients
      WHERE referral_url IS NOT NULL AND referral_url != ''
    `

    console.log(`📊 Total URLs in square_existing_clients: ${finalCount[0]?.count || 0}`)
    console.log('')
    console.log('✅ Sync complete!')
    console.log('')
    console.log('💾 All URLs are now stored in square_existing_clients table with:')
    console.log('   - square_customer_id (customer ID)')
    console.log('   - phone_number')
    console.log('   - referral_url')

  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

syncUrlsToSquareExistingClients()


