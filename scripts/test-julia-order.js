#!/usr/bin/env node
/**
 * Test technician extraction with an order that has "with Julia"
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Import Square SDK
let squareClient
let ordersApi
try {
  const squareModule = require('square')
  const { Client, Environment } = squareModule
  
  const { getSquareEnvironmentName } = require('../lib/utils/square-env')
  const squareEnvName = getSquareEnvironmentName()
  const resolvedEnvironment = squareEnvName === 'sandbox' ? Environment.Sandbox : Environment.Production
  
  squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
    environment: resolvedEnvironment,
  })
  ordersApi = squareClient.ordersApi
  
  console.log(`🔑 Using Square ${squareEnvName} environment`)
} catch (error) {
  console.error('Failed to initialize Square SDK:', error.message)
  process.exit(1)
}

function extractTechnicianNameFromLineItem(lineItemName) {
  if (!lineItemName) return null
  
  const name = lineItemName.trim()
  const roleWords = ['JUNIOR MASTER', 'JUNIOR', 'MASTER', 'TOP MASTER', 'TOP', 'SENIOR', 'LEAD', 'GEL', 'PACKAGE', 'SERVICES', 'SERVICE']
  
  // Pattern 1: "Top Master [NAME]" or "Master [NAME]"
  const masterMatch = name.match(/\b(?:Top\s+)?Master\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$/i)
  if (masterMatch && masterMatch[1]) {
    const extracted = masterMatch[1].trim()
    if (!roleWords.some(role => extracted.toUpperCase() === role.toUpperCase())) {
      return extracted
    }
  }
  
  // Pattern 2: "with [NAME]"
  const withMatch = name.match(/\bwith\s+([A-Z][A-Z\s]+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$/i)
  if (withMatch && withMatch[1]) {
    const extracted = withMatch[1].trim()
    const isRoleWord = roleWords.some(role => 
      extracted.toUpperCase() === role.toUpperCase() || 
      extracted.toUpperCase().includes(role.toUpperCase())
    )
    const isLikelyName = extracted.length >= 3 && 
                         !extracted.match(/^\d+/) &&
                         !extracted.match(/^[A-Z]{1,2}$/)
    
    if (!isRoleWord && isLikelyName) {
      return extracted
    }
  }
  
  return null
}

async function findTechnicianIdByName(technicianName, organizationId) {
  if (!technicianName || !organizationId) return null
  
  const nameParts = technicianName.trim().split(/\s+/).filter(Boolean)
  
  try {
    if (nameParts.length === 1) {
      const result = await prisma.$queryRaw`
        SELECT id, given_name, family_name, square_team_member_id
        FROM team_members
        WHERE organization_id = ${organizationId}::uuid
          AND (
            LOWER(TRIM(COALESCE(given_name, ''))) = LOWER(${nameParts[0]})
            OR LOWER(TRIM(COALESCE(family_name, ''))) = LOWER(${nameParts[0]})
          )
          AND (status = 'ACTIVE' OR status IS NULL)
        LIMIT 1
      `
      return result && result.length > 0 ? result[0] : null
    } else {
      const fullName = nameParts.join(' ')
      const result = await prisma.$queryRaw`
        SELECT id, given_name, family_name, square_team_member_id
        FROM team_members
        WHERE organization_id = ${organizationId}::uuid
          AND (
            LOWER(TRIM(CONCAT(COALESCE(given_name, ''), ' ', COALESCE(family_name, '')))) = LOWER(${fullName})
            OR (LOWER(TRIM(COALESCE(given_name, ''))) = LOWER(${nameParts[0]}) 
                AND LOWER(TRIM(COALESCE(family_name, ''))) = LOWER(${nameParts[1]}))
            OR (LOWER(TRIM(COALESCE(given_name, ''))) = LOWER(${nameParts[1]}) 
                AND LOWER(TRIM(COALESCE(family_name, ''))) = LOWER(${nameParts[0]}))
          )
          AND (status = 'ACTIVE' OR status IS NULL)
        LIMIT 1
      `
      return result && result.length > 0 ? result[0] : null
    }
  } catch (error) {
    console.warn(`⚠️  Error looking up technician "${technicianName}": ${error.message}`)
    return null
  }
}

async function testJuliaOrder() {
  const orderId = 'HJyUphNyGQqpBcPBzIS5pzggtjbZY'
  
  console.log('🧪 Testing Order with Julia\n')
  console.log('='.repeat(60))
  console.log(`Order ID: ${orderId}\n`)

  try {
    // Get order from database
    const order = await prisma.$queryRaw`
      SELECT organization_id FROM orders WHERE order_id = ${orderId} LIMIT 1
    `
    
    if (!order || order.length === 0) {
      console.log('⚠️  Order not found in database')
      return
    }

    const organizationId = order[0].organization_id
    console.log(`✅ Organization ID: ${organizationId}\n`)

    // Get line items
    const lineItems = await prisma.$queryRaw`
      SELECT name, service_variation_id, technician_id
      FROM order_line_items oli
      INNER JOIN orders o ON o.id = oli.order_id
      WHERE o.order_id = ${orderId}
    `

    console.log(`Found ${lineItems.length} line item(s):\n`)

    for (const lineItem of lineItems) {
      console.log(`Line Item: "${lineItem.name}"`)
      console.log(`Service Variation ID: ${lineItem.service_variation_id || 'N/A'}`)
      console.log(`Current Technician ID: ${lineItem.technician_id || 'N/A'}\n`)

      // Extract technician name
      const technicianName = extractTechnicianNameFromLineItem(lineItem.name)
      
      if (technicianName) {
        console.log(`✅ Extracted: "${technicianName}"`)
        
        // Look up in database
        const technician = await findTechnicianIdByName(technicianName, organizationId)
        
        if (technician) {
          console.log(`✅ Found in team_members:`)
          console.log(`   ID: ${technician.id}`)
          console.log(`   Name: ${technician.given_name || ''} ${technician.family_name || ''}`)
          console.log(`   Square ID: ${technician.square_team_member_id || 'N/A'}`)
          
          if (lineItem.technician_id === technician.id) {
            console.log(`   ✅ MATCH: Line item already has correct technician_id`)
          } else {
            console.log(`   ⚠️  MISMATCH: Should update technician_id to ${technician.id}`)
          }
        } else {
          console.log(`❌ NOT FOUND: "${technicianName}" not in team_members table`)
        }
      } else {
        console.log(`⚠️  No technician name extracted`)
      }
      console.log('')
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

testJuliaOrder()
  .then(() => {
    console.log('✅ Test complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test failed:', error)
    process.exit(1)
  })



