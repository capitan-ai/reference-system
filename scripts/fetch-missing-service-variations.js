#!/usr/bin/env node
/**
 * Fetch missing service variations from Square API and add them to the database
 * 
 * This script:
 * 1. Finds service variation IDs referenced in bookings but not in the database
 * 2. Fetches each one from Square Catalog API
 * 3. Inserts them into the service_variation table
 * 4. Then you can re-run backfill-booking-fields.js to link them
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const { getSquareEnvironmentName } = require('../lib/utils/square-env')

const prisma = new PrismaClient()

const squareEnvironmentName = getSquareEnvironmentName()
const environment = squareEnvironmentName === 'sandbox' ? Environment.Sandbox : Environment.Production
let token = process.env.SQUARE_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN_2
if (!token) {
  console.error('❌ Missing SQUARE_ACCESS_TOKEN')
  process.exit(1)
}
if (token.startsWith('Bearer ')) token = token.slice(7)

const square = new Client({ accessToken: token.trim(), environment })
const catalogApi = square.catalogApi

// Helper to delay between API calls (rate limiting)
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getMissingServiceVariationIds() {
  console.log('📋 Step 1: Finding missing service variation IDs...\n')
  
  // Get all unique service variation IDs referenced in bookings
  const referenced = await prisma.$queryRaw`
    SELECT DISTINCT 
      COALESCE(
        b.raw_json->'appointmentSegments'->0->>'serviceVariationId',
        b.raw_json->'appointmentSegments'->0->>'service_variation_id'
      ) as service_id,
      COUNT(*) as booking_count
    FROM bookings b
    WHERE b.raw_json IS NOT NULL
      AND (b.raw_json->'appointmentSegments'->0->>'serviceVariationId' IS NOT NULL
           OR b.raw_json->'appointmentSegments'->0->>'service_variation_id' IS NOT NULL)
    GROUP BY service_id
    ORDER BY booking_count DESC
  `
  
  // Get all service variation IDs in DB
  const inDb = await prisma.$queryRaw`
    SELECT square_variation_id FROM service_variation
  `
  const dbIds = new Set(inDb.map(r => r.square_variation_id))
  
  // Find missing ones
  const missing = referenced
    .filter(r => r.service_id && !dbIds.has(r.service_id))
    .map(r => ({ id: r.service_id, count: Number(r.booking_count) }))
    .sort((a, b) => b.count - a.count)
  
  console.log(`✅ Found ${missing.length} missing service variations`)
  console.log(`   Total bookings affected: ${missing.reduce((sum, sv) => sum + sv.count, 0)}\n`)
  
  return missing
}

async function fetchServiceVariationFromSquare(serviceVariationId) {
  try {
    // Use Catalog API to retrieve the object
    const response = await catalogApi.retrieveCatalogObject(serviceVariationId, true)
    
    if (!response.result || !response.result.object) {
      return null
    }
    
    const catalogObject = response.result.object
    const serviceVariation = catalogObject.itemVariationData || catalogObject.itemData
    
    if (!serviceVariation) {
      return null
    }
    
    // Get related item if available
    const relatedObjects = response.result.relatedObjects || []
    const item = relatedObjects.find(obj => obj.type === 'ITEM')
    
    return {
      id: catalogObject.id,
      name: serviceVariation.name || item?.itemData?.name || 'Unknown Service',
      serviceId: catalogObject.itemId || null,
      durationMinutes: serviceVariation.serviceDuration || serviceVariation.service_duration || null,
      price: serviceVariation.priceMoney || null,
      itemData: item?.itemData || null
    }
  } catch (error) {
    if (error.statusCode === 404) {
      return { notFound: true, id: serviceVariationId }
    }
    throw error
  }
}

async function insertServiceVariation(serviceVariationData, organizationId) {
  try {
    const duration = serviceVariationData.durationMinutes 
      ? (typeof serviceVariationData.durationMinutes === 'object' 
          ? serviceVariationData.durationMinutes.scalar || null
          : serviceVariationData.durationMinutes)
      : null
    
    await prisma.$executeRaw`
      INSERT INTO service_variation (
        uuid,
        square_variation_id,
        organization_id,
        name,
        duration_minutes,
        item_id,
        service_duration,
        service_name,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        ${serviceVariationData.id},
        ${organizationId}::uuid,
        ${serviceVariationData.name || 'Unknown Service'},
        ${duration},
        ${serviceVariationData.serviceId || null},
        ${duration},
        ${serviceVariationData.name || 'Unknown Service'},
        NOW(),
        NOW()
      )
      ON CONFLICT (square_variation_id, organization_id) DO UPDATE SET
        name = EXCLUDED.name,
        duration_minutes = COALESCE(EXCLUDED.duration_minutes, service_variation.duration_minutes),
        service_duration = COALESCE(EXCLUDED.service_duration, service_variation.service_duration),
        service_name = COALESCE(EXCLUDED.service_name, service_variation.service_name),
        updated_at = NOW()
    `
    return true
  } catch (error) {
    console.error(`   ❌ Error inserting: ${error.message}`)
    return false
  }
}

async function fetchAndInsertMissingServiceVariations() {
  console.log('🔄 Starting service variation fetch...\n')
  console.log('='.repeat(80))
  
  try {
    // Get organization_id (we'll use the first one or get from bookings)
    const org = await prisma.$queryRaw`
      SELECT id FROM organizations LIMIT 1
    `
    if (!org || org.length === 0) {
      console.error('❌ No organizations found in database')
      return
    }
    const organizationId = org[0].id
    console.log(`✅ Using organization: ${organizationId.substring(0, 8)}...\n`)
    
    // Get missing service variation IDs
    const missing = await getMissingServiceVariationIds()
    
    if (missing.length === 0) {
      console.log('✅ No missing service variations found!')
      return
    }
    
    console.log('📥 Step 2: Fetching service variations from Square API...\n')
    console.log(`   Processing ${missing.length} service variations...\n`)
    
    let fetched = 0
    let inserted = 0
    let notFound = 0
    let errors = 0
    
    for (let i = 0; i < missing.length; i++) {
      const sv = missing[i]
      const progress = ((i + 1) / missing.length * 100).toFixed(1)
      
      process.stdout.write(`   [${i + 1}/${missing.length}] (${progress}%) Fetching ${sv.id}... `)
      
      try {
        const serviceData = await fetchServiceVariationFromSquare(sv.id)
        
        if (serviceData && serviceData.notFound) {
          console.log('❌ NOT FOUND (404)')
          notFound++
        } else if (serviceData) {
          console.log(`✅ Found: "${serviceData.name}"`)
          fetched++
          
          // Insert into database
          const insertedSuccess = await insertServiceVariation(serviceData, organizationId)
          if (insertedSuccess) {
            inserted++
          } else {
            errors++
          }
        } else {
          console.log('⚠️  No data returned')
          errors++
        }
        
        // Rate limiting: wait 100ms between requests
        if (i < missing.length - 1) {
          await delay(100)
        }
      } catch (error) {
        console.log(`❌ Error: ${error.message}`)
        errors++
        
        // If rate limited, wait longer
        if (error.statusCode === 429) {
          console.log('   ⏳ Rate limited, waiting 2 seconds...')
          await delay(2000)
        }
      }
    }
    
    console.log('\n' + '='.repeat(80))
    console.log('📊 FETCH RESULTS\n')
    console.log(`Total missing service variations: ${missing.length}`)
    console.log(`✅ Successfully fetched: ${fetched}`)
    console.log(`✅ Successfully inserted: ${inserted}`)
    console.log(`❌ Not found in Square (404): ${notFound}`)
    console.log(`❌ Errors: ${errors}`)
    console.log('\n' + '='.repeat(80))
    console.log('✅ Fetch completed!\n')
    console.log('💡 Next step: Run backfill-booking-fields.js to link these to bookings')
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run if called directly
if (require.main === module) {
  fetchAndInsertMissingServiceVariations()
    .then(() => {
      console.log('✅ Script completed successfully')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Script failed:', error)
      process.exit(1)
    })
}

module.exports = { fetchAndInsertMissingServiceVariations }



