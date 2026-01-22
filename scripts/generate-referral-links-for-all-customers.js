#!/usr/bin/env node

/**
 * Generate referral links for all customers who don't have one yet
 * This will update square_existing_clients.referral_url and referral_code for all customers
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { generateReferralUrl } = require('../lib/utils/referral-url')

const prisma = new PrismaClient()

// Generate a personal referral code (same logic as in the webhook handler)
function generatePersonalCode(name, customerId) {
  const cleanName = (name || 'CUSTOMER')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)
  
  const cleanId = (customerId || '')
    .toString()
    .replace(/[^A-Z0-9]/g, '')
    .slice(-4)
    .toUpperCase()
  
  return `${cleanName}${cleanId}`.slice(0, 12) || `CUST${Date.now().toString().slice(-4)}`
}

async function generateReferralLinksForAllCustomers() {
  try {
    console.log('🔍 Finding customers without referral links...')
    console.log('='.repeat(60))
    console.log('')
    
    // Get all customers who don't have a referral link
    const allCustomers = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        phone_number,
        referral_url,
        referral_code,
        personal_code
      FROM square_existing_clients
      ORDER BY created_at ASC
    `
    
    // Filter customers without referral URLs
    const customersWithoutRefLinks = allCustomers.filter(c => 
      !c.referral_url || c.referral_url === ''
    )
    
    const totalCustomers = allCustomers.length
    const customersWithRefLinks = totalCustomers - customersWithoutRefLinks.length
    
    console.log(`📊 Total Customers: ${totalCustomers}`)
    console.log(`📊 Customers with Referral Links: ${customersWithRefLinks}`)
    console.log(`📊 Customers without Referral Links: ${customersWithoutRefLinks.length}`)
    console.log('')
    
    if (customersWithoutRefLinks.length === 0) {
      console.log('✅ All customers already have referral links!')
      return
    }
    
    console.log(`🚀 Generating referral links for ${customersWithoutRefLinks.length} customers...`)
    console.log('')
    
    let successCount = 0
    let errorCount = 0
    const errors = []
    
    // Process in batches to avoid overwhelming the database
    const BATCH_SIZE = 50
    for (let i = 0; i < customersWithoutRefLinks.length; i += BATCH_SIZE) {
      const batch = customersWithoutRefLinks.slice(i, i + BATCH_SIZE)
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1
      const totalBatches = Math.ceil(customersWithoutRefLinks.length / BATCH_SIZE)
      
      console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} customers)...`)
      
      for (const customer of batch) {
        try {
          const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 
                              customer.email_address || 
                              'Customer'
          
          // Use existing referral_code or personal_code, or generate new one
          let referralCode = customer.referral_code || customer.personal_code || generatePersonalCode(customerName, customer.square_customer_id)
          let codeExists = true
          let attempts = 0
          const maxAttempts = 10
          
          // Ensure code is unique (check against square_existing_clients)
          while (codeExists && attempts < maxAttempts) {
            const existing = await prisma.$queryRaw`
              SELECT square_customer_id 
              FROM square_existing_clients
              WHERE (referral_code = ${referralCode} OR personal_code = ${referralCode})
              AND square_customer_id != ${customer.square_customer_id}
              LIMIT 1
            `
            
            if (!existing || existing.length === 0) {
              codeExists = false
            } else {
              // Try with timestamp to make it unique
              referralCode = generatePersonalCode(customerName, `${customer.square_customer_id}_${Date.now()}`)
              attempts++
            }
          }
          
          if (codeExists) {
            console.log(`   ⚠️  Could not generate unique code for ${customerName} after ${attempts} attempts`)
            errorCount++
            errors.push({ customer: customerName, error: 'Could not generate unique code' })
            continue
          }
          
          // Generate referral URL using the utility function
          const referralUrl = generateReferralUrl(referralCode)
          
          // Update square_existing_clients table with the URL and code
          await prisma.$executeRaw`
            UPDATE square_existing_clients
            SET 
              referral_url = ${referralUrl},
              referral_code = COALESCE(referral_code, ${referralCode}),
              personal_code = COALESCE(personal_code, ${referralCode}),
              updated_at = NOW()
            WHERE square_customer_id = ${customer.square_customer_id}
          `
          
          successCount++
          
          if (successCount % 10 === 0 || i === 0) {
            console.log(`   ✅ Created: ${referralCode} → ${referralUrl}`)
            console.log(`      Customer: ${customerName}`)
          }
          
        } catch (error) {
          errorCount++
          const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 
                              customer.email_address || 
                              'Unknown'
          errors.push({ customer: customerName, error: error.message })
          
          console.log(`   ❌ Error for ${customerName}: ${error.message}`)
        }
      }
      
      // Progress update
      const progress = ((i + batch.length) / customersWithoutRefLinks.length * 100).toFixed(1)
      console.log(`   Progress: ${progress}% (${i + batch.length}/${customersWithoutRefLinks.length})`)
      console.log('')
    }
    
    // Summary
    console.log('='.repeat(60))
    console.log('📊 SUMMARY')
    console.log('='.repeat(60))
    console.log(`Total customers: ${totalCustomers}`)
    console.log(`Customers processed: ${customersWithoutRefLinks.length}`)
    console.log(`✅ Successfully created: ${successCount}`)
    console.log(`❌ Failed: ${errorCount}`)
    console.log('')
    
    // Verify final count
    const finalCountResult = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM square_existing_clients
      WHERE referral_url IS NOT NULL AND referral_url != ''
    `
    const finalCount = Number(finalCountResult[0].count)
    console.log(`📊 Total Customers with Referral URLs in Database: ${finalCount}`)
    console.log('')
    
    if (errors.length > 0 && errors.length <= 20) {
      console.log('❌ Errors encountered:')
      errors.forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.customer}: ${err.error}`)
      })
    } else if (errors.length > 20) {
      console.log(`❌ ${errors.length} errors encountered (showing first 10):`)
      errors.slice(0, 10).forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.customer}: ${err.error}`)
      })
      console.log(`   ... and ${errors.length - 10} more errors`)
    }
    
    console.log('')
    console.log('✅ Done!')
    console.log('')
    console.log('💾 All referral URLs are stored in:')
    console.log('   Table: square_existing_clients')
    console.log('   Column: referral_url')
    console.log('')
    console.log('📋 To view all referral URLs, run:')
    console.log('   node scripts/check-referral-urls-in-db.js')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

generateReferralLinksForAllCustomers()

