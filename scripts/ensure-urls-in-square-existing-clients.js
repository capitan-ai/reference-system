#!/usr/bin/env node

/**
 * Ensure all referral URLs are stored in square_existing_clients table
 * This will:
 * 1. Check if referral_url column exists, create it if not
 * 2. Sync all URLs from ref_links to square_existing_clients
 * 3. Generate URLs for customers who have personal_code but no URL
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { generateReferralUrl } = require('../lib/utils/referral-url')

const prisma = new PrismaClient()

async function ensureUrlsInSquareExistingClients() {
  try {
    console.log('🔄 Ensuring referral URLs are in square_existing_clients table...')
    console.log('='.repeat(60))
    console.log('')

    // Step 1: Ensure referral_url column exists
    console.log('📋 Step 1: Checking if referral_url column exists...')
    try {
      const columnCheck = await prisma.$queryRaw`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'square_existing_clients' 
        AND column_name = 'referral_url'
      `
      
      if (!columnCheck || columnCheck.length === 0) {
        console.log('   ⚠️  Column does not exist, creating it...')
        await prisma.$executeRawUnsafe(`
          ALTER TABLE square_existing_clients 
          ADD COLUMN IF NOT EXISTS referral_url TEXT
        `)
        console.log('   ✅ Column created')
      } else {
        console.log('   ✅ Column exists')
      }
    } catch (error) {
      console.log('   ⚠️  Error checking column:', error.message)
      // Try to create it anyway
      try {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE square_existing_clients 
          ADD COLUMN IF NOT EXISTS referral_url TEXT
        `)
        console.log('   ✅ Column created')
      } catch (createError) {
        console.log('   ⚠️  Could not create column:', createError.message)
      }
    }
    console.log('')

    // Step 2: Sync URLs from ref_links table
    console.log('📋 Step 2: Syncing URLs from ref_links table...')
    const refLinks = await prisma.refLink.findMany({
      where: { status: 'ACTIVE' },
      include: {
        customer: {
          select: {
            squareCustomerId: true,
            phoneE164: true,
            fullName: true
          }
        }
      }
    })

    console.log(`   Found ${refLinks.length} referral links in ref_links table`)
    console.log('')

    let syncedCount = 0
    let notFoundCount = 0

    for (const link of refLinks) {
      const customer = link.customer
      
      if (!customer?.squareCustomerId) {
        notFoundCount++
        continue
      }

      try {
        // Update square_existing_clients
        const result = await prisma.$executeRaw`
          UPDATE square_existing_clients
          SET 
            referral_url = ${link.url},
            personal_code = COALESCE(personal_code, ${link.refCode}),
            updated_at = NOW()
          WHERE square_customer_id = ${customer.squareCustomerId}
        `

        // Verify update
        const check = await prisma.$queryRaw`
          SELECT referral_url 
          FROM square_existing_clients
          WHERE square_customer_id = ${customer.squareCustomerId}
        `

        if (check && check.length > 0 && check[0].referral_url === link.url) {
          syncedCount++
          if (syncedCount <= 5) {
            console.log(`   ✅ Synced: ${customer.squareCustomerId} → ${link.url}`)
          }
        }
      } catch (error) {
        if (notFoundCount < 5) {
          console.log(`   ⚠️  Could not sync ${customer.squareCustomerId}: ${error.message}`)
        }
        notFoundCount++
      }
    }

    console.log(`   ✅ Synced: ${syncedCount}`)
    console.log(`   ⏭️  Skipped (not in square_existing_clients): ${notFoundCount}`)
    console.log('')

    // Step 3: Generate URLs for customers with personal_code but no URL
    console.log('📋 Step 3: Generating URLs for customers with personal_code but no URL...')
    const customersWithoutUrl = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        personal_code,
        phone_number,
        given_name,
        family_name
      FROM square_existing_clients
      WHERE personal_code IS NOT NULL 
        AND personal_code != ''
        AND (referral_url IS NULL OR referral_url = '')
    `

    console.log(`   Found ${customersWithoutUrl.length} customers with personal_code but no URL`)
    console.log('')

    let generatedCount = 0

    for (const customer of customersWithoutUrl) {
      try {
        const referralUrl = generateReferralUrl(customer.personal_code)
        
        await prisma.$executeRaw`
          UPDATE square_existing_clients
          SET 
            referral_url = ${referralUrl},
            updated_at = NOW()
          WHERE square_customer_id = ${customer.square_customer_id}
        `

        generatedCount++
        if (generatedCount <= 5) {
          const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
          console.log(`   ✅ Generated: ${customer.square_customer_id} (${name})`)
          console.log(`      Code: ${customer.personal_code}`)
          console.log(`      URL: ${referralUrl}`)
        }
      } catch (error) {
        console.log(`   ⚠️  Error for ${customer.square_customer_id}: ${error.message}`)
      }
    }

    console.log(`   ✅ Generated: ${generatedCount}`)
    console.log('')

    // Final summary
    const finalCount = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM square_existing_clients
      WHERE referral_url IS NOT NULL AND referral_url != ''
    `

    console.log('='.repeat(60))
    console.log('📊 Final Summary:')
    console.log(`   Total URLs in square_existing_clients: ${finalCount[0]?.count || 0}`)
    console.log(`   Synced from ref_links: ${syncedCount}`)
    console.log(`   Generated from personal_code: ${generatedCount}`)
    console.log('')
    console.log('✅ Complete!')
    console.log('')
    console.log('💾 All URLs are now stored in square_existing_clients with:')
    console.log('   - square_customer_id')
    console.log('   - phone_number')
    console.log('   - referral_url')

  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

ensureUrlsInSquareExistingClients()

