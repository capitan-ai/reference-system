#!/usr/bin/env node
/**
 * Test technician name extraction from line item names and database lookup
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

/**
 * Extract technician name from line item name
 * Filters out role words like "JUNIOR MASTER", "MASTER", "TOP MASTER"
 */
function extractTechnicianNameFromLineItem(lineItemName) {
  if (!lineItemName) return null
  
  const name = lineItemName.trim()
  
  // Role words to filter out (not actual names)
  const roleWords = ['JUNIOR MASTER', 'JUNIOR', 'MASTER', 'TOP MASTER', 'TOP', 'SENIOR', 'LEAD', 'GEL', 'PACKAGE', 'SERVICES', 'SERVICE']
  
  // Pattern 1: "Top Master [NAME]" or "Master [NAME]" (extract name after Master)
  // This is the most reliable pattern - Master is followed by actual name
  const masterMatch = name.match(/\b(?:Top\s+)?Master\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$/i)
  if (masterMatch && masterMatch[1]) {
    const extracted = masterMatch[1].trim()
    // Check if it's a role word (shouldn't be, but double-check)
    if (!roleWords.some(role => extracted.toUpperCase() === role.toUpperCase())) {
      return extracted
    }
  }
  
  // Pattern 2: "with [NAME]" (e.g., "with Julia", "with ANNA")
  // But filter out role words and common non-name words
  const withMatch = name.match(/\bwith\s+([A-Z][A-Z\s]+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$/i)
  if (withMatch && withMatch[1]) {
    const extracted = withMatch[1].trim()
    // Check if it's a role word or common non-name word
    const isRoleWord = roleWords.some(role => 
      extracted.toUpperCase() === role.toUpperCase() || 
      extracted.toUpperCase().includes(role.toUpperCase())
    )
    // Also check if it's too short (likely not a name) or looks like a product
    const isLikelyName = extracted.length >= 3 && 
                         !extracted.match(/^\d+/) && // doesn't start with number
                         !extracted.match(/^[A-Z]{1,2}$/) // not just 1-2 uppercase letters
    
    if (!isRoleWord && isLikelyName) {
      return extracted
    }
  }
  
  // Pattern 3: "[SERVICE] with [ROLE] [NAME]" - extract name after role
  const roleNameMatch = name.match(/\bwith\s+(?:JUNIOR\s+)?(?:TOP\s+)?MASTER\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$/i)
  if (roleNameMatch && roleNameMatch[1]) {
    const extracted = roleNameMatch[1].trim()
    if (!roleWords.some(role => extracted.toUpperCase() === role.toUpperCase())) {
      return extracted
    }
  }
  
  return null
}

/**
 * Find technician_id from team_members by name
 */
async function findTechnicianIdByName(technicianName, organizationId) {
  if (!technicianName || !organizationId) return null
  
  const nameParts = technicianName.trim().split(/\s+/).filter(Boolean)
  
  try {
    if (nameParts.length === 1) {
      // Single name - match against given_name or family_name
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
      // Multiple names - try full name match
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

async function testTechnicianExtraction() {
  try {
    console.log('🧪 Testing Technician Name Extraction\n')
    console.log('='.repeat(60))

    // Test 1: Test name extraction function with various patterns
  console.log('\n📝 TEST 1: Name Extraction Function\n')
  
  const testNames = [
    'Russian Manicure with JUNIOR MASTER',
    'Top Master Irina',
    'Smart E-file Pedicure with gel',
    'Designs',
    'Russian Manicure with ANNA',
    'Master Anna',
    'Service with JOHN DOE',
    'Regular Service',
    'Training with Julia',
    'Classes with Julia',
    'Black Friday TOP Master 3 services'
  ]

  testNames.forEach(name => {
    const extracted = extractTechnicianNameFromLineItem(name)
    console.log(`   "${name}"`)
    console.log(`   → Extracted: ${extracted || 'NONE'}`)
    console.log('')
  })

  // Test 2: Get team members from database
  console.log('='.repeat(60))
  console.log('\n👥 TEST 2: Team Members in Database\n')
  
  const teamMembers = await prisma.$queryRaw`
    SELECT id, given_name, family_name, 
           CONCAT(COALESCE(given_name, ''), ' ', COALESCE(family_name, '')) as full_name,
           square_team_member_id, status
    FROM team_members
    WHERE status = 'ACTIVE' OR status IS NULL
    ORDER BY given_name, family_name
    LIMIT 20
  `

  console.log(`Found ${teamMembers.length} team members:\n`)
  teamMembers.forEach(member => {
    const fullName = `${member.given_name || ''} ${member.family_name || ''}`.trim()
    console.log(`   ${fullName || 'N/A'}`)
    console.log(`     ID: ${member.id}`)
    console.log(`     Square ID: ${member.square_team_member_id || 'N/A'}`)
    console.log(`     Status: ${member.status || 'N/A'}`)
    console.log('')
  })

  // Test 3: Test with actual order
  console.log('='.repeat(60))
  console.log('\n📦 TEST 3: Testing with Actual Order\n')
  
  const orderId = 'RQNfktNCBiZUvJ7ACllbMTMrJiSZY'
  
  try {
    // Get organization_id for this order
    const order = await prisma.$queryRaw`
      SELECT organization_id FROM orders WHERE order_id = ${orderId} LIMIT 1
    `
    
    if (!order || order.length === 0) {
      console.log('⚠️  Order not found in database, fetching from Square...')
      
      const orderResponse = await ordersApi.retrieveOrder(orderId)
      const squareOrder = orderResponse.result?.order
      
      if (!squareOrder) {
        console.log('❌ Order not found in Square either')
        return
      }

      // Get organization_id from location
      const locationId = squareOrder.locationId || squareOrder.location_id
      if (locationId) {
        const loc = await prisma.$queryRaw`
          SELECT organization_id FROM locations 
          WHERE square_location_id = ${locationId}
          LIMIT 1
        `
        if (loc && loc.length > 0) {
          const organizationId = loc[0].organization_id
          
          console.log(`✅ Using organization_id: ${organizationId}\n`)
          
          // Test with line items from this order
          const lineItems = squareOrder.lineItems || squareOrder.line_items || []
          
          console.log(`Found ${lineItems.length} line item(s) in order:\n`)
          
          for (const lineItem of lineItems) {
            const lineItemName = lineItem.name || 'N/A'
            const serviceVariationId = lineItem.catalogObjectId || lineItem.catalog_object_id || 'N/A'
            
            console.log(`Line Item: "${lineItemName}"`)
            console.log(`Service Variation ID: ${serviceVariationId}`)
            
            // Extract technician name
            const technicianName = extractTechnicianNameFromLineItem(lineItemName)
            
            if (technicianName) {
              console.log(`✅ Extracted technician name: "${technicianName}"`)
              
              // Look up in database
              const technician = await findTechnicianIdByName(technicianName, organizationId)
              
              if (technician) {
                console.log(`✅ Found technician in database:`)
                console.log(`   ID: ${technician.id}`)
                console.log(`   Name: ${technician.given_name || ''} ${technician.family_name || ''}`)
                console.log(`   Square ID: ${technician.square_team_member_id || 'N/A'}`)
              } else {
                console.log(`❌ Technician "${technicianName}" NOT found in database`)
                console.log(`   Available team members:`)
                teamMembers.slice(0, 5).forEach(m => {
                  const name = `${m.given_name || ''} ${m.family_name || ''}`.trim()
                  console.log(`     - ${name}`)
                })
              }
            } else {
              console.log(`⚠️  No technician name extracted from line item name`)
            }
            console.log('')
          }
        }
      }
    } else {
      const organizationId = order[0].organization_id
      console.log(`✅ Order found in database`)
      console.log(`   Organization ID: ${organizationId}\n`)
      
      // Get line items from database
      const lineItems = await prisma.$queryRaw`
        SELECT oli.name, oli.service_variation_id, oli.technician_id
        FROM order_line_items oli
        INNER JOIN orders o ON o.id = oli.order_id
        WHERE o.order_id = ${orderId}
      `
      
      console.log(`Found ${lineItems.length} line item(s) in database:\n`)
      
      for (const lineItem of lineItems) {
        const lineItemName = lineItem.name || 'N/A'
        const serviceVariationId = lineItem.service_variation_id || 'N/A'
        const currentTechnicianId = lineItem.technician_id || 'N/A'
        
        console.log(`Line Item: "${lineItemName}"`)
        console.log(`Service Variation ID: ${serviceVariationId}`)
        console.log(`Current Technician ID: ${currentTechnicianId}`)
        
        // Extract technician name
        const technicianName = extractTechnicianNameFromLineItem(lineItemName)
        
        if (technicianName) {
          console.log(`✅ Extracted technician name: "${technicianName}"`)
          
          // Look up in database
          const technician = await findTechnicianIdByName(technicianName, organizationId)
          
          if (technician) {
            console.log(`✅ Found technician in database:`)
            console.log(`   ID: ${technician.id}`)
            console.log(`   Name: ${technician.given_name || ''} ${technician.family_name || ''}`)
            console.log(`   Square ID: ${technician.square_team_member_id || 'N/A'}`)
            
            if (currentTechnicianId === 'N/A' || currentTechnicianId !== technician.id) {
              console.log(`   ⚠️  MISMATCH: Current technician_id is ${currentTechnicianId}, should be ${technician.id}`)
            } else {
              console.log(`   ✅ MATCH: Current technician_id is correct`)
            }
          } else {
            console.log(`❌ Technician "${technicianName}" NOT found in database`)
          }
        } else {
          console.log(`⚠️  No technician name extracted from line item name`)
        }
        console.log('')
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
    throw error
  }

  // Test 4: Test with multiple recent orders
  console.log('='.repeat(60))
  console.log('\n📊 TEST 4: Testing with Multiple Recent Orders\n')
  
  const recentOrders = await prisma.$queryRaw`
    SELECT DISTINCT o.order_id, o.organization_id, o.created_at
    FROM orders o
    WHERE o.created_at >= NOW() - INTERVAL '7 days'
    ORDER BY o.created_at DESC
    LIMIT 5
  `

  console.log(`Testing ${recentOrders.length} recent orders:\n`)

  let totalLineItems = 0
  let extractedNames = 0
  let foundTechnicians = 0
  let matchedTechnicians = 0

  for (const order of recentOrders) {
    try {
      const lineItems = await prisma.$queryRaw`
        SELECT oli.name, oli.service_variation_id, oli.technician_id
        FROM order_line_items oli
        INNER JOIN orders o ON o.id = oli.order_id
        WHERE o.order_id = ${order.order_id}
      `

      for (const lineItem of lineItems) {
        totalLineItems++
        const technicianName = extractTechnicianNameFromLineItem(lineItem.name)
        
        if (technicianName) {
          extractedNames++
          const technician = await findTechnicianIdByName(technicianName, order.organization_id)
          
          if (technician) {
            foundTechnicians++
            if (lineItem.technician_id === technician.id) {
              matchedTechnicians++
            }
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️  Error processing order ${order.order_id}: ${error.message}`)
    }
  }

  console.log(`\n📊 Results:`)
  console.log(`   Total Line Items: ${totalLineItems}`)
  console.log(`   Names Extracted: ${extractedNames}`)
  console.log(`   Technicians Found: ${foundTechnicians}`)
  console.log(`   Already Matched: ${matchedTechnicians}`)
  console.log(`   Needs Update: ${foundTechnicians - matchedTechnicians}`)

    console.log('\n' + '='.repeat(60))
    console.log('\n✅ Test Complete\n')

  } catch (error) {
    console.error('❌ Error:', error.message)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

testTechnicianExtraction()
  .then(() => {
    console.log('✅ All tests complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test failed:', error)
    process.exit(1)
  })

