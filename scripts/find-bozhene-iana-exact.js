#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function findTeamMembers() {
  try {
    console.log('🔍 Searching for team members: Bozhene and Iana Zorina...\n')
    
    const teamMembers = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, 
             personal_code, created_at
      FROM square_existing_clients 
      WHERE (LOWER(given_name) = 'bozhene' OR LOWER(given_name) = 'bozhena')
         OR (LOWER(given_name) = 'iana' AND LOWER(family_name) = 'zorina')
         OR (LOWER(family_name) = 'zorina' AND LOWER(given_name) = 'iana')
      ORDER BY created_at DESC
    `
    
    if (teamMembers && teamMembers.length > 0) {
      console.log(`✅ Found ${teamMembers.length} team member(s):\n`)
      
      teamMembers.forEach((member, i) => {
        const fullName = `${member.given_name || ''} ${member.family_name || ''}`.trim()
        console.log(`${i+1}. ${fullName}`)
        console.log(`   Email: ${member.email_address || 'NO EMAIL ❌'}`)
        console.log(`   Code: ${member.personal_code || 'NO CODE ❌'}`)
        console.log(`   Customer ID: ${member.square_customer_id}`)
        console.log('')
      })
      
      return teamMembers
    } else {
      console.log('❌ Team members not found with exact match.')
      console.log('\n📋 Searching for similar names...\n')
      
      const similar = await prisma.$queryRaw`
        SELECT square_customer_id, given_name, family_name, email_address, personal_code
        FROM square_existing_clients 
        WHERE LOWER(given_name) LIKE '%bozh%'
           OR (LOWER(given_name) LIKE '%iana%' AND LOWER(family_name) LIKE '%zorin%')
        ORDER BY created_at DESC
        LIMIT 10
      `
      
      if (similar && similar.length > 0) {
        console.log('Similar names found:')
        similar.forEach((c, i) => {
          console.log(`   ${i+1}. ${c.given_name || ''} ${c.family_name || ''} - ${c.email_address || 'NO EMAIL'}`)
        })
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

findTeamMembers()





