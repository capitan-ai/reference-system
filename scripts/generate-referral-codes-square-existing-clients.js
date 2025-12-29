#!/usr/bin/env node

/**
 * Generate referral codes for customers in square_existing_clients table
 * This works with the 7000+ customers in the legacy table
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { generateReferralUrl } = require('../lib/utils/referral-url')

const prisma = new PrismaClient()

// Generate a personal referral code
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

async function generateReferralCodesForSquareExistingClients() {
  try {
    console.log('🔍 Finding customers in square_existing_clients without referral codes...\n')
    console.log('='.repeat(60))
    
    // Get all customers who don't have a referral code
    const customersWithoutCodes = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        personal_code,
        referral_url
      FROM square_existing_clients
      WHERE personal_code IS NULL 
         OR personal_code = ''
         OR personal_code = 'NULL'
      ORDER BY created_at ASC
    `
    
    const totalCustomers = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM square_existing_clients
    `
    const totalCount = Number(totalCustomers[0].count)
    
    const customersWithCodes = await prisma.$queryRaw`
      SELECT COUNT(*) as count 
      FROM square_existing_clients
      WHERE personal_code IS NOT NULL 
        AND personal_code != ''
        AND personal_code != 'NULL'
    `
    const withCodesCount = Number(customersWithCodes[0].count)
    
    console.log(`📊 Total customers: ${totalCount.toLocaleString()}`)
    console.log(`📊 Customers with referral codes: ${withCodesCount.toLocaleString()}`)
    console.log(`📊 Customers without referral codes: ${customersWithoutCodes.length.toLocaleString()}`)
    console.log('')
    
    if (customersWithoutCodes.length === 0) {
      console.log('✅ All customers already have referral codes!')
      return
    }
    
    console.log(`🚀 Generating referral codes for ${customersWithoutCodes.length.toLocaleString()} customers...`)
    console.log('')
    
    let successCount = 0
    let errorCount = 0
    const errors = []
    
    // Process in batches to avoid overwhelming the database
    const BATCH_SIZE = 50
    for (let i = 0; i < customersWithoutCodes.length; i += BATCH_SIZE) {
      const batch = customersWithoutCodes.slice(i, i + BATCH_SIZE)
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1
      const totalBatches = Math.ceil(customersWithoutCodes.length / BATCH_SIZE)
      
      console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} customers)...`)
      
      for (const customer of batch) {
        try {
          const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 
                              customer.email_address || 
                              'Customer'
          
          // Generate unique referral code
          let referralCode = generatePersonalCode(customerName, customer.square_customer_id)
          let codeExists = true
          let attempts = 0
          const maxAttempts = 10
          
          // Ensure code is unique in square_existing_clients
          while (codeExists && attempts < maxAttempts) {
            const existing = await prisma.$queryRaw`
              SELECT square_customer_id 
              FROM square_existing_clients 
              WHERE personal_code = ${referralCode}
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
          
          // Generate referral URL
          const referralUrl = generateReferralUrl(referralCode)
          
          // Update square_existing_clients table with the code and URL
          await prisma.$executeRaw`
            UPDATE square_existing_clients
            SET 
              personal_code = ${referralCode},
              referral_url = ${referralUrl},
              updated_at = NOW()
            WHERE square_customer_id = ${customer.square_customer_id}
          `
          
          successCount++
          
          if (successCount % 10 === 0 || i === 0) {
            console.log(`   ✅ Created: ${referralCode} → ${referralUrl.substring(0, 60)}...`)
            console.log(`      Customer: ${customerName}`)
          }
          
        } catch (error) {
          errorCount++
          const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 
                              customer.email_address || 
                              'Unknown'
          errors.push({ customer: customerName, error: error.message })
          
          if (error.code === 'P2002' || error.message.includes('unique')) {
            console.log(`   ⚠️  Duplicate code for ${customerName}, skipping...`)
          } else {
            console.log(`   ❌ Error for ${customerName}: ${error.message}`)
          }
        }
      }
      
      // Progress update
      const progress = ((i + batch.length) / customersWithoutCodes.length * 100).toFixed(1)
      console.log(`   Progress: ${progress}% (${i + batch.length}/${customersWithoutCodes.length})`)
      console.log('')
    }
    
    // Summary
    console.log('='.repeat(60))
    console.log('📊 SUMMARY')
    console.log('='.repeat(60))
    console.log(`Total customers: ${totalCount.toLocaleString()}`)
    console.log(`Customers processed: ${customersWithoutCodes.length.toLocaleString()}`)
    console.log(`✅ Successfully created: ${successCount.toLocaleString()}`)
    console.log(`❌ Failed: ${errorCount.toLocaleString()}`)
    console.log('')
    
    // Verify final count
    const finalCount = await prisma.$queryRaw`
      SELECT COUNT(*) as count 
      FROM square_existing_clients
      WHERE personal_code IS NOT NULL 
        AND personal_code != ''
        AND personal_code != 'NULL'
    `
    console.log(`📊 Total customers with referral codes: ${Number(finalCount[0].count).toLocaleString()}`)
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
    console.log('💾 All referral codes are stored in:')
    console.log('   Table: square_existing_clients')
    console.log('   Column: personal_code')
    console.log('   Column: referral_url')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

generateReferralCodesForSquareExistingClients()


