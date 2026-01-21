#!/usr/bin/env node

/**
 * Sync referral URLs from ref_links table to square_existing_clients table
 * This ensures all URLs are stored with customer ID and phone number in square_existing_clients
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function syncUrlsToSquareExistingClients() {
  try {
    console.log('🔄 Syncing referral URLs to square_existing_clients table...')
    console.log('='.repeat(60))
    console.log('')

    // Get all active referral links with customer info
    const refLinks = await prisma.refLink.findMany({
      where: {
        status: 'ACTIVE'
      },
      include: {
        customer: {
          select: {
            id: true,
            squareCustomerId: true,
            phoneE164: true,
            fullName: true
          }
        }
      }
    })

    console.log(`📊 Found ${refLinks.length} referral links to sync`)
    console.log('')

    if (refLinks.length === 0) {
      console.log('✅ No referral links to sync')
      return
    }

    let updatedCount = 0
    let skippedCount = 0
    const errors = []

    for (const link of refLinks) {
      const customer = link.customer
      
      if (!customer?.squareCustomerId) {
        console.log(`⚠️  Skipping ${link.refCode}: No squareCustomerId`)
        skippedCount++
        continue
      }

      try {
        // Update square_existing_clients with referral URL
        await prisma.$executeRaw`
          UPDATE square_existing_clients
          SET 
            referral_url = ${link.url},
            personal_code = COALESCE(personal_code, ${link.refCode}),
            updated_at = NOW()
          WHERE square_customer_id = ${customer.squareCustomerId}
        `

        // Check if row was updated
        const checkResult = await prisma.$queryRaw`
          SELECT referral_url, personal_code, phone_number, square_customer_id
          FROM square_existing_clients
          WHERE square_customer_id = ${customer.squareCustomerId}
        `

        if (checkResult && checkResult.length > 0) {
          const updated = checkResult[0]
          if (updated.referral_url === link.url) {
            updatedCount++
            const customerName = customer.fullName || 'Unknown'
            if (updatedCount <= 10 || updatedCount % 50 === 0) {
              console.log(`✅ Updated: ${customer.squareCustomerId} (${customerName})`)
              console.log(`   Code: ${link.refCode}`)
              console.log(`   URL: ${link.url}`)
              console.log(`   Phone: ${updated.phone_number || 'N/A'}`)
            }
          } else {
            skippedCount++
          }
        } else {
          skippedCount++
          console.log(`⚠️  Customer ${customer.squareCustomerId} not found in square_existing_clients`)
        }

      } catch (error) {
        errors.push({
          refCode: link.refCode,
          squareCustomerId: customer.squareCustomerId,
          error: error.message
        })
        if (errors.length <= 10) {
          console.log(`❌ Error updating ${customer.squareCustomerId}: ${error.message}`)
        }
      }
    }

    console.log('')
    console.log('='.repeat(60))
    console.log('📊 Summary:')
    console.log(`   Total referral links: ${refLinks.length}`)
    console.log(`   ✅ Updated: ${updatedCount}`)
    console.log(`   ⏭️  Skipped: ${skippedCount}`)
    console.log(`   ❌ Errors: ${errors.length}`)
    console.log('')

    if (errors.length > 0) {
      console.log('❌ Errors encountered:')
      errors.slice(0, 10).forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.squareCustomerId} (${err.refCode}): ${err.error}`)
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


