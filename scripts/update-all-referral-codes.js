#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

// Same logic as in webhook handlers - generate code in name+ID format
function generatePersonalCode(customerName, customerId) {
  let namePart = 'CUST'
  if (customerName) {
    namePart = customerName.toString().trim().split(' ')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 10)
  }
  let idPart = ''
  if (customerId) {
    const idStr = customerId.toString()
    const numericMatches = idStr.match(/\d+/g)
    if (numericMatches && numericMatches.length > 0) {
      const allNums = numericMatches.join('')
      idPart = allNums.slice(-4).padStart(4, '0')
    } else {
      idPart = idStr.slice(-4).toUpperCase()
    }
  } else {
    idPart = Date.now().toString().slice(-4)
  }
  if (idPart.length < 3) idPart = idPart.padStart(4, '0')
  if (idPart.length > 4) idPart = idPart.slice(-4)
  return `${namePart}${idPart}`
}

async function updateAllReferralCodes() {
  try {
    console.log('🔍 Fetching all customers from database...\n')
    
    // Get all customers who need referral codes
    const customers = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        personal_code,
        email_address
      FROM square_existing_clients
      WHERE square_customer_id IS NOT NULL
      ORDER BY created_at ASC
    `
    
    console.log(`✅ Found ${customers.length} customers\n`)
    
    let updatedCount = 0
    let skippedCount = 0
    const errors = []
    
    console.log('🔄 Updating referral codes to name+ID format...\n')
    
    for (let i = 0; i < customers.length; i++) {
      const customer = customers[i]
      const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || customer.given_name || customer.family_name || null
      const customerId = customer.square_customer_id
      
      // Generate new code in name+ID format
      const newCode = generatePersonalCode(customerName, customerId)
      
      // Check if code already matches new format (starts with name, ends with 4 digits)
      const currentCode = customer.personal_code
      const alreadyNewFormat = currentCode && /^[A-Z]{2,10}\d{4}$/.test(currentCode)
      
      if (alreadyNewFormat && currentCode === newCode) {
        skippedCount++
        if (i < 10 || i % 100 === 0) {
          console.log(`   ⏭️  ${i + 1}/${customers.length}: ${customerName || 'Unknown'} - Already has new format: ${currentCode}`)
        }
        continue
      }
      
      try {
        // Check if new code is already taken by another customer
        const existing = await prisma.$queryRaw`
          SELECT square_customer_id
          FROM square_existing_clients
          WHERE personal_code = ${newCode}
            AND square_customer_id != ${customerId}
          LIMIT 1
        `
        
        let finalCode = newCode
        if (existing && existing.length > 0) {
          // Code collision - append a number
          let counter = 1
          let namePart = newCode.slice(0, -4) // Extract name part
          let idPart = newCode.slice(-4) // Extract ID part
          
          while (true) {
            // Try appending counter to name part if it fits, otherwise to end
            const alternativeCode = namePart.length + counter.toString().length <= 10 
              ? `${namePart}${counter}${idPart.slice(counter.toString().length)}`
              : `${newCode}${counter}`
            
            const check = await prisma.$queryRaw`
              SELECT square_customer_id
              FROM square_existing_clients
              WHERE personal_code = ${alternativeCode}
                AND square_customer_id != ${customerId}
              LIMIT 1
            `
            if (!check || check.length === 0) {
              finalCode = alternativeCode
              break
            }
            counter++
            if (counter > 999) {
              // Fallback to timestamp
              finalCode = generatePersonalCode(customerName, `${customerId}_${Date.now()}`)
              break
            }
          }
        }
        
        // Update database
        await prisma.$executeRaw`
          UPDATE square_existing_clients
          SET personal_code = ${finalCode},
              updated_at = NOW()
          WHERE square_customer_id = ${customerId}
        `
        
        updatedCount++
        if (i < 10 || updatedCount <= 20 || i % 50 === 0) {
          console.log(`   ✅ ${i + 1}/${customers.length}: ${customerName || 'Unknown'}`)
          console.log(`      Old: ${currentCode || 'NULL'} → New: ${finalCode}`)
        }
      } catch (error) {
        errors.push({ customer: customerName || 'Unknown', error: error.message })
        console.log(`   ❌ ${i + 1}/${customers.length}: ${customerName || 'Unknown'} - Error: ${error.message}`)
      }
    }
    
    console.log('\n' + '='.repeat(60))
    console.log('📊 SUMMARY')
    console.log('='.repeat(60))
    console.log(`Total customers: ${customers.length}`)
    console.log(`✅ Updated: ${updatedCount}`)
    console.log(`⏭️  Skipped (already new format): ${skippedCount}`)
    console.log(`❌ Errors: ${errors.length}`)
    
    if (errors.length > 0) {
      console.log('\n❌ Errors encountered:')
      errors.slice(0, 10).forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.customer}: ${err.error}`)
      })
      if (errors.length > 10) {
        console.log(`   ... and ${errors.length - 10} more errors`)
      }
    }
    
    console.log('\n✅ Done! All referral codes updated to name+ID format!')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

updateAllReferralCodes()
