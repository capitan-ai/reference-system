#!/usr/bin/env node

// Update all existing referral URLs in database to use custom domain
require('dotenv').config()

const { PrismaClient } = require('@prisma/client')
const { generateReferralUrl } = require('../lib/utils/referral-url')

const prisma = new PrismaClient()

async function updateReferralUrls() {
  try {
    console.log('🔄 Updating referral URLs to use custom domain...')
    console.log('='.repeat(60))
    console.log('')
    
    // Get base URL being used
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || 'https://referral-system-salon.vercel.app'
    console.log(`📋 Using base URL: ${baseUrl}`)
    console.log('')
    
    // Get all referral links
    const refLinks = await prisma.refLink.findMany({
      include: {
        customer: {
          select: {
            fullName: true,
            email: true
          }
        }
      }
    })
    
    console.log(`📊 Found ${refLinks.length} referral links in database`)
    console.log('')
    
    if (refLinks.length === 0) {
      console.log('✅ No referral links to update')
      return
    }
    
    let updatedCount = 0
    let skippedCount = 0
    
    for (const link of refLinks) {
      const oldUrl = link.url
      const newUrl = generateReferralUrl(link.refCode)
      
      // Check if URL needs updating
      if (oldUrl === newUrl) {
        skippedCount++
        if (updatedCount + skippedCount <= 10) {
          console.log(`⏭️  ${link.refCode}: Already using correct URL`)
        }
        continue
      }
      
      // Update the URL
      try {
        await prisma.refLink.update({
          where: {
            id: link.id
          },
          data: {
            url: newUrl
          }
        })
        
        updatedCount++
        const customerName = link.customer?.fullName || link.customer?.email || 'Unknown'
        console.log(`✅ Updated ${link.refCode} (${customerName})`)
        console.log(`   Old: ${oldUrl}`)
        console.log(`   New: ${newUrl}`)
        console.log('')
      } catch (error) {
        console.error(`❌ Failed to update ${link.refCode}: ${error.message}`)
      }
    }
    
    console.log('='.repeat(60))
    console.log('📊 Summary:')
    console.log(`   Total links: ${refLinks.length}`)
    console.log(`   Updated: ${updatedCount}`)
    console.log(`   Already correct: ${skippedCount}`)
    console.log('')
    console.log('✅ Update complete!')
    
    // Show sample of updated URLs
    if (updatedCount > 0) {
      console.log('')
      console.log('📋 Sample updated URLs:')
      const sampleLinks = await prisma.refLink.findMany({
        take: 5,
        select: {
          refCode: true,
          url: true
        }
      })
      sampleLinks.forEach(link => {
        console.log(`   ${link.refCode}: ${link.url}`)
      })
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

updateReferralUrls()

