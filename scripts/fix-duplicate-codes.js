#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

// Generate unique personal code - tries 4 digits first, then 5 if duplicate
function generatePersonalCode(customerName, customerId, use5Digits = false) {
  let namePart = 'CUST'
  if (customerName) {
    namePart = customerName
      .toString()
      .trim()
      .split(' ')[0]
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .substring(0, 10)
  }
  
  let idPart = ''
  if (customerId) {
    const idStr = customerId.toString()
    const numericMatches = idStr.match(/\d+/g)
    if (numericMatches && numericMatches.length > 0) {
      const allNums = numericMatches.join('')
      const digitCount = use5Digits ? 5 : 4
      idPart = allNums.slice(-digitCount).padStart(digitCount, '0')
    } else {
      const digitCount = use5Digits ? 5 : 4
      idPart = idStr.slice(-digitCount).toUpperCase()
    }
  } else {
    const digitCount = use5Digits ? 5 : 4
    idPart = Date.now().toString().slice(-digitCount)
  }
  
  const digitCount = use5Digits ? 5 : 4
  if (idPart.length < digitCount) idPart = idPart.padStart(digitCount, '0')
  if (idPart.length > digitCount) idPart = idPart.slice(-digitCount)
  
  return `${namePart}${idPart}`
}

async function fixDuplicates() {
  try {
    console.log('🔍 Finding customers with duplicate or missing referral codes...\n')
    
    // Find duplicates
    const duplicates = await prisma.$queryRaw`
      SELECT personal_code, COUNT(*) as count
      FROM square_existing_clients
      WHERE personal_code IS NOT NULL
      GROUP BY personal_code
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `
    
    // Find NULL codes
    const nullCodes = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name
      FROM square_existing_clients
      WHERE personal_code IS NULL
    `
    
    console.log(`📊 Found:`)
    console.log(`   - ${duplicates.length} duplicate codes`)
    console.log(`   - ${nullCodes.length} NULL codes\n`)
    
    const fixes = []
    
    // Fix duplicates - keep first, regenerate others
    for (const dup of duplicates) {
      const customers = await prisma.$queryRaw`
        SELECT square_customer_id, given_name, family_name, personal_code
        FROM square_existing_clients
        WHERE personal_code = ${dup.personal_code}
        ORDER BY created_at ASC
      `
      
      // Keep first customer's code, fix others
      for (let i = 1; i < customers.length; i++) {
        const customer = customers[i]
        const firstName = (customer.given_name || '').trim()
        // Try 5 digits for duplicates
        const newCode = generatePersonalCode(firstName || null, customer.square_customer_id, true)
        
        fixes.push({
          customerId: customer.square_customer_id,
          oldCode: customer.personal_code,
          newCode: newCode,
          name: `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Customer',
          reason: 'duplicate'
        })
      }
    }
    
    // Fix NULL codes
    for (const customer of nullCodes) {
      const firstName = (customer.given_name || '').trim()
      const newCode = generatePersonalCode(firstName || null, customer.square_customer_id)
      
      fixes.push({
        customerId: customer.square_customer_id,
        oldCode: null,
        newCode: newCode,
        name: `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Customer',
        reason: 'null'
      })
    }
    
    if (fixes.length === 0) {
      console.log('✅ No fixes needed!')
      return
    }
    
    console.log(`\n📋 Will fix ${fixes.length} customers:\n`)
    fixes.slice(0, 10).forEach((fix, i) => {
      console.log(`${i + 1}. ${fix.name} (${fix.reason})`)
      console.log(`   Old: ${fix.oldCode || 'NULL'}`)
      console.log(`   New: ${fix.newCode}`)
      console.log('')
    })
    
    if (fixes.length > 10) {
      console.log(`   ... and ${fixes.length - 10} more\n`)
    }
    
    const DRY_RUN = process.env.DRY_RUN !== 'false'
    
    if (DRY_RUN) {
      console.log('⚠️  DRY RUN MODE - No changes will be made')
      console.log('   Set DRY_RUN=false to actually update the database\n')
      return
    }
    
    console.log('💾 Fixing duplicate and NULL codes...\n')
    
    let successCount = 0
    let errorCount = 0
    
    for (const fix of fixes) {
      try {
        // Check if new code is already taken
        const existing = await prisma.$queryRaw`
          SELECT COUNT(*) as count
          FROM square_existing_clients
          WHERE personal_code = ${fix.newCode}
          AND square_customer_id != ${fix.customerId}
        `
        
        if (existing[0].count > 0) {
          // Try with 5 digits if 4 digits is taken
          const altCode = generatePersonalCode(fix.name.split(' ')[0], fix.customerId, true)
          console.log(`   ⚠️  Code ${fix.newCode} taken, using ${altCode} instead`)
          
          await prisma.$executeRaw`
            UPDATE square_existing_clients
            SET personal_code = ${altCode}
            WHERE square_customer_id = ${fix.customerId}
          `
        } else {
          await prisma.$executeRaw`
            UPDATE square_existing_clients
            SET personal_code = ${fix.newCode}
            WHERE square_customer_id = ${fix.customerId}
          `
        }
        
        successCount++
      } catch (error) {
        console.error(`   ❌ Error fixing ${fix.name}: ${error.message}`)
        errorCount++
      }
    }
    
    console.log('\n' + '='.repeat(60))
    console.log('📊 FINAL SUMMARY')
    console.log('='.repeat(60))
    console.log(`✅ Successfully fixed: ${successCount}`)
    console.log(`❌ Errors: ${errorCount}`)
    console.log('')
    console.log('✅ Done! All duplicate and NULL codes fixed!')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

fixDuplicates()
