#!/usr/bin/env node

// Add referral codes to Bozhena V and Iana Zorina
require('dotenv').config()

const { PrismaClient } = require('@prisma/client')
const { generateReferralUrl } = require('../lib/utils/referral-url')

const prisma = new PrismaClient()

// Generate referral code (same format as used in the system)
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
    idPart = '0000'
  }
  return `${namePart}${idPart}`
}

const CUSTOMERS = [
  {
    name: 'Iana Zorina',
    squareId: '70WNH5QYS71S32NG7Z77YW4DA8'
  },
  {
    name: 'Bozhena V',
    squareId: 'BG84AFYW767H4Y3XZB8S8P8ME4'
  }
]

async function addRefCodes() {
  try {
    console.log('🔧 Adding referral codes to Bozhena V and Iana Zorina...')
    console.log('='.repeat(60))
    console.log('')
    
    for (const customerInfo of CUSTOMERS) {
      console.log(`📋 Processing: ${customerInfo.name}`)
      console.log(`   Square ID: ${customerInfo.squareId}`)
      
      // Get customer from database
      const customer = await prisma.customer.findUnique({
        where: {
          squareCustomerId: customerInfo.squareId
        },
        include: {
          RefLinks: true
        }
      })
      
      if (!customer) {
        console.log(`   ❌ Customer not found in database`)
        console.log('')
        continue
      }
      
      console.log(`   ✅ Found in database`)
      console.log(`   ID: ${customer.id}`)
      console.log(`   Name: ${customer.fullName || customerInfo.name}`)
      
      // Check if they already have a referral link
      if (customer.RefLinks.length > 0) {
        const existingLink = customer.RefLinks[0]
        console.log(`   ⚠️  Already has referral code: ${existingLink.refCode}`)
        console.log(`      URL: ${existingLink.url}`)
        console.log(`      Status: ${existingLink.status}`)
        console.log('')
        continue
      }
      
      // Generate referral code
      const customerName = customer.fullName || customerInfo.name
      const customerId = customer.squareCustomerId || customerInfo.squareId
      let referralCode = generatePersonalCode(customerName, customerId)
      
      // Check if code already exists (must be unique)
      let codeExists = true
      let attempts = 0
      while (codeExists && attempts < 10) {
        const existing = await prisma.refLink.findUnique({
          where: {
            refCode: referralCode
          }
        })
        
        if (!existing) {
          codeExists = false
        } else {
          // Try with timestamp to make it unique
          referralCode = generatePersonalCode(customerName, `${customerId}_${Date.now()}`)
          attempts++
        }
      }
      
      if (codeExists) {
        console.log(`   ❌ Could not generate unique referral code after ${attempts} attempts`)
        console.log('')
        continue
      }
      
      const referralUrl = generateReferralUrl(referralCode)
      
      // Create referral link
      try {
        const refLink = await prisma.refLink.create({
          data: {
            customerId: customer.id,
            refCode: referralCode,
            url: referralUrl,
            status: 'ACTIVE'
          }
        })
        
        console.log(`   ✅ Created referral code!`)
        console.log(`      Code: ${refLink.refCode}`)
        console.log(`      URL: ${refLink.url}`)
        console.log(`      Status: ${refLink.status}`)
      } catch (error) {
        if (error.code === 'P2002') {
          console.log(`   ❌ Referral code ${referralCode} already exists (unique constraint)`)
          // Try one more time with timestamp
          const altCode = generatePersonalCode(customerName, `${customerId}_${Date.now()}`)
          try {
            const refLink = await prisma.refLink.create({
              data: {
                customerId: customer.id,
                refCode: altCode,
                url: generateReferralUrl(altCode),
                status: 'ACTIVE'
              }
            })
            console.log(`   ✅ Created alternative referral code!`)
            console.log(`      Code: ${refLink.refCode}`)
            console.log(`      URL: ${refLink.url}`)
          } catch (altError) {
            console.log(`   ❌ Failed to create referral code: ${altError.message}`)
          }
        } else {
          console.log(`   ❌ Failed to create referral code: ${error.message}`)
        }
      }
      
      console.log('')
      console.log('   ' + '─'.repeat(50))
      console.log('')
    }
    
    // Final verification
    console.log('\n🔍 Final Verification:')
    console.log('='.repeat(60))
    
    for (const customerInfo of CUSTOMERS) {
      const finalCheck = await prisma.customer.findUnique({
        where: {
          squareCustomerId: customerInfo.squareId
        },
        include: {
          RefLinks: {
            where: {
              status: 'ACTIVE'
            }
          }
        }
      })
      
      if (finalCheck) {
        console.log(`\n${finalCheck.RefLinks.length > 0 ? '✅' : '❌'} ${customerInfo.name}`)
        if (finalCheck.RefLinks.length > 0) {
          console.log(`   Referral Code: ${finalCheck.RefLinks[0].refCode}`)
          console.log(`   URL: ${finalCheck.RefLinks[0].url}`)
        } else {
          console.log(`   No referral code`)
        }
      }
    }
    
    console.log('\n✅ Done!')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

addRefCodes()

