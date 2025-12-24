#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { sendReferralCodeEmail } = require('../lib/email-service-simple')

const prisma = new PrismaClient()

async function findAndSendEmails() {
  try {
    console.log('🔍 Searching for Bozhene and Iana Zorina...\n')
    
    const searchTerms = ['Bozhene', 'Iana', 'Zorina']
    
    const customers = await prisma.customer.findMany({
      where: {
        OR: [
          { firstName: { contains: 'Bozhene', mode: 'insensitive' } },
          { lastName: { contains: 'Bozhene', mode: 'insensitive' } },
          { fullName: { contains: 'Bozhene', mode: 'insensitive' } },
          { firstName: { contains: 'Iana', mode: 'insensitive' } },
          { lastName: { contains: 'Iana', mode: 'insensitive' } },
          { fullName: { contains: 'Iana', mode: 'insensitive' } },
          { lastName: { contains: 'Zorina', mode: 'insensitive' } },
          { fullName: { contains: 'Zorina', mode: 'insensitive' } }
        ]
      },
      include: {
        RefLinks: {
          where: { status: 'ACTIVE' },
          take: 1
        }
      }
    })
    
    if (customers.length === 0) {
      console.log('❌ No customers found with Prisma schema. Checking square_existing_clients table...\n')
      
      const rawCustomers = await prisma.$queryRaw`
        SELECT square_customer_id, given_name, family_name, email_address, 
               personal_code, created_at
        FROM square_existing_clients 
        WHERE LOWER(given_name) LIKE '%bozh%' 
           OR LOWER(family_name) LIKE '%bozh%'
           OR LOWER(given_name) LIKE '%iana%'
           OR LOWER(family_name) LIKE '%iana%'
           OR LOWER(family_name) LIKE '%zorina%'
        ORDER BY created_at DESC
      `
      
      if (rawCustomers && rawCustomers.length > 0) {
        console.log(`✅ Found ${rawCustomers.length} customer(s) in square_existing_clients:\n`)
        
        for (const customer of rawCustomers) {
          const fullName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim()
          console.log(`   Name: ${fullName}`)
          console.log(`   Email: ${customer.email_address || 'NO EMAIL ❌'}`)
          console.log(`   Code: ${customer.personal_code || 'NO CODE ❌'}`)
          console.log(`   Customer ID: ${customer.square_customer_id}`)
          console.log('')
          
          if (!customer.email_address) {
            console.log(`   ⚠️ Skipping ${fullName} - no email address\n`)
            continue
          }
          
          let referralCode = customer.personal_code
          if (!referralCode) {
            console.log(`   ⚠️ No referral code found for ${fullName}, generating one...`)
            const namePart = (customer.given_name || 'CUST').toString().trim().split(' ')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 10)
            const idStr = customer.square_customer_id.toString()
            const numericMatches = idStr.match(/\d+/g)
            let idPart = ''
            if (numericMatches && numericMatches.length > 0) {
              const allNums = numericMatches.join('')
              idPart = allNums.slice(-4).padStart(4, '0')
            } else {
              idPart = idStr.slice(-4).toUpperCase()
            }
            if (idPart.length < 3) idPart = idPart.padStart(4, '0')
            if (idPart.length > 4) idPart = idPart.slice(-4)
            referralCode = `${namePart}${idPart}`
            
            await prisma.$executeRaw`
              UPDATE square_existing_clients 
              SET personal_code = ${referralCode}
              WHERE square_customer_id = ${customer.square_customer_id}
            `
            console.log(`   ✅ Generated referral code: ${referralCode}\n`)
          }
          
          const referralUrl = `https://referral-system-salon.vercel.app/ref/${referralCode}`
          
          console.log(`📧 Sending test email to ${fullName}...`)
          console.log(`   Email: ${customer.email_address}`)
          console.log(`   Code: ${referralCode}`)
          console.log(`   URL: ${referralUrl}`)
          
          const emailResult = await sendReferralCodeEmail(
            fullName,
            customer.email_address,
            referralCode,
            referralUrl
          )
          
          if (emailResult.success) {
            console.log(`   ✅ Email sent successfully!`)
            console.log(`   Message ID: ${emailResult.messageId}\n`)
          } else {
            console.log(`   ❌ Failed to send email: ${emailResult.error}\n`)
          }
        }
      } else {
        console.log('❌ No customers found in either database.\n')
        console.log('📋 Searching all customers to help find them...\n')
        
        const allCustomers = await prisma.$queryRaw`
          SELECT square_customer_id, given_name, family_name, email_address, personal_code
          FROM square_existing_clients 
          ORDER BY created_at DESC
          LIMIT 50
        `
        
        if (allCustomers && allCustomers.length > 0) {
          console.log('All customers in database:')
          allCustomers.forEach((c, i) => {
            console.log(`   ${i+1}. ${c.given_name || ''} ${c.family_name || ''} - ${c.email_address || 'NO EMAIL'}`)
          })
        }
      }
    } else {
      console.log(`✅ Found ${customers.length} customer(s) in Prisma database:\n`)
      
      for (const customer of customers) {
        const fullName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.fullName || 'Customer'
        const email = customer.email
        
        console.log(`   Name: ${fullName}`)
        console.log(`   Email: ${email || 'NO EMAIL ❌'}`)
        
        if (!email) {
          console.log(`   ⚠️ Skipping ${fullName} - no email address\n`)
          continue
        }
        
        let referralCode = null
        let referralUrl = null
        
        if (customer.RefLinks && customer.RefLinks.length > 0) {
          referralCode = customer.RefLinks[0].refCode
          referralUrl = customer.RefLinks[0].url
        } else {
          console.log(`   ⚠️ No referral link found for ${fullName}, generating one...`)
          
          const namePart = (customer.firstName || 'CUST').toString().trim().split(' ')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 10)
          const idStr = customer.id.toString()
          const numericMatches = idStr.match(/\d+/g)
          let idPart = ''
          if (numericMatches && numericMatches.length > 0) {
            const allNums = numericMatches.join('')
            idPart = allNums.slice(-4).padStart(4, '0')
          } else {
            idPart = idStr.slice(-4).toUpperCase()
          }
          if (idPart.length < 3) idPart = idPart.padStart(4, '0')
          if (idPart.length > 4) idPart = idPart.slice(-4)
          referralCode = `${namePart}${idPart}`
          referralUrl = `https://referral-system-salon.vercel.app/ref/${referralCode}`
          
          await prisma.refLink.create({
            data: {
              customerId: customer.id,
              refCode: referralCode,
              url: referralUrl,
              status: 'ACTIVE'
            }
          })
          console.log(`   ✅ Created referral link: ${referralCode}\n`)
        }
        
        console.log(`📧 Sending test email to ${fullName}...`)
        console.log(`   Email: ${email}`)
        console.log(`   Code: ${referralCode}`)
        console.log(`   URL: ${referralUrl}`)
        
        const emailResult = await sendReferralCodeEmail(
          fullName,
          email,
          referralCode,
          referralUrl
        )
        
        if (emailResult.success) {
          console.log(`   ✅ Email sent successfully!`)
          console.log(`   Message ID: ${emailResult.messageId}\n`)
        } else {
          console.log(`   ❌ Failed to send email: ${emailResult.error}\n`)
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

findAndSendEmails()





