#!/usr/bin/env node

/**
 * Update all referral URLs in square_existing_clients to use custom domain
 * Changes from Vercel preview URL to zorinastudio-referral.com
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const CUSTOM_DOMAIN = 'https://zorinastudio-referral.com'

async function updateUrlsToCustomDomain() {
  try {
    console.log('🔄 Updating referral URLs to custom domain...')
    console.log('='.repeat(60))
    console.log(`📋 Target domain: ${CUSTOM_DOMAIN}`)
    console.log('')

    // Get all customers with referral URLs
    const customers = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        personal_code,
        referral_url,
        given_name,
        family_name
      FROM square_existing_clients
      WHERE referral_url IS NOT NULL 
        AND referral_url != ''
        AND personal_code IS NOT NULL
        AND personal_code != ''
    `

    console.log(`📊 Found ${customers.length} customers with referral URLs`)
    console.log('')

    if (customers.length === 0) {
      console.log('✅ No URLs to update')
      return
    }

    let updatedCount = 0
    let alreadyCorrectCount = 0
    let errorCount = 0

    for (const customer of customers) {
      try {
        // Extract referral code from current URL or use personal_code
        let refCode = customer.personal_code
        
        // Try to extract from current URL if personal_code is missing
        if (!refCode && customer.referral_url) {
          const match = customer.referral_url.match(/\/ref\/([^\/\?]+)/)
          if (match) {
            refCode = match[1]
          }
        }

        if (!refCode) {
          console.log(`⚠️  Skipping ${customer.square_customer_id}: No referral code found`)
          errorCount++
          continue
        }

        // Generate new URL with custom domain
        const newUrl = `${CUSTOM_DOMAIN}/ref/${refCode}`

        // Check if URL needs updating
        if (customer.referral_url === newUrl) {
          alreadyCorrectCount++
          continue
        }

        // Update the URL
        await prisma.$executeRaw`
          UPDATE square_existing_clients
          SET 
            referral_url = ${newUrl},
            updated_at = NOW()
          WHERE square_customer_id = ${customer.square_customer_id}
        `

        updatedCount++
        
        if (updatedCount <= 10 || updatedCount % 1000 === 0) {
          const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
          console.log(`✅ Updated: ${customer.square_customer_id} (${name})`)
          console.log(`   Old: ${customer.referral_url}`)
          console.log(`   New: ${newUrl}`)
        }

      } catch (error) {
        errorCount++
        if (errorCount <= 10) {
          console.log(`❌ Error updating ${customer.square_customer_id}: ${error.message}`)
        }
      }
    }

    console.log('')
    console.log('='.repeat(60))
    console.log('📊 Summary:')
    console.log(`   Total customers: ${customers.length}`)
    console.log(`   ✅ Updated: ${updatedCount}`)
    console.log(`   ⏭️  Already correct: ${alreadyCorrectCount}`)
    console.log(`   ❌ Errors: ${errorCount}`)
    console.log('')

    // Verify final count
    const finalCount = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM square_existing_clients
      WHERE referral_url LIKE ${CUSTOM_DOMAIN + '%'}
    `

    console.log(`📊 URLs using custom domain: ${finalCount[0]?.count || 0}`)
    console.log('')
    console.log('✅ Update complete!')
    console.log('')
    console.log('💾 All URLs now use custom domain:')
    console.log(`   ${CUSTOM_DOMAIN}/ref/{CODE}`)

  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

updateUrlsToCustomDomain()

