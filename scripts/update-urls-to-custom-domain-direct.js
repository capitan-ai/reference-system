#!/usr/bin/env node

// Directly update all referral URLs to use custom domain (zorinastudio-referral.com)
require('dotenv').config()

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const CUSTOM_DOMAIN = 'https://zorinastudio-referral.com'

async function updateUrlsDirectly() {
  try {
    console.log('🔄 Updating referral URLs directly to custom domain...')
    console.log('='.repeat(60))
    console.log(`📋 Target domain: ${CUSTOM_DOMAIN}`)
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
      const newUrl = `${CUSTOM_DOMAIN}/ref/${link.refCode}`
      
      // Check if URL needs updating
      if (oldUrl === newUrl) {
        skippedCount++
        if (updatedCount + skippedCount <= 10) {
          console.log(`⏭️  ${link.refCode}: Already using custom domain`)
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
    if (updatedCount > 0 || refLinks.length > 0) {
      console.log('')
      console.log('📋 Current URLs in database:')
      const sampleLinks = await prisma.refLink.findMany({
        take: 10,
        select: {
          refCode: true,
          url: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      })
      sampleLinks.forEach(link => {
        const isCustomDomain = link.url.includes('zorinastudio-referral.com')
        const icon = isCustomDomain ? '✅' : '⚠️'
        console.log(`   ${icon} ${link.refCode}: ${link.url}`)
      })
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

updateUrlsDirectly()

