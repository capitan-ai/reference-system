#!/usr/bin/env node
/**
 * Backfill merchant_id for locations table
 * Fetches merchant_id from Square API for each location
 * 
 * Usage:
 *   node scripts/backfill-locations-merchant-id.js [limit]
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

const envName = (process.env.SQUARE_ENV || 'production').toLowerCase()
const environment = envName === 'sandbox' ? Environment.Sandbox : Environment.Production
let token = process.env.SQUARE_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN_2
if (!token) {
  console.error('❌ Missing SQUARE_ACCESS_TOKEN')
  process.exit(1)
}
if (token.startsWith('Bearer ')) token = token.slice(7)
token = token.trim()

console.log(`🔑 Using Square ${envName} environment`)

const square = new Client({ accessToken: token, environment })
const locationsApi = square.locationsApi

async function backfillLocationsMerchantId() {
  const limit = parseInt(process.argv[2]) || 1000
  
  console.log('🔄 Backfilling merchant_id for Locations Table\n')
  console.log('=' .repeat(60))
  
  try {
    // Get all locations missing merchant_id
    const locations = await prisma.$queryRaw`
      SELECT 
        id,
        square_location_id,
        square_merchant_id,
        name,
        organization_id
      FROM locations
      WHERE square_merchant_id IS NULL
        AND square_location_id IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `
    
    console.log(`\n📋 Found ${locations.length} locations missing merchant_id\n`)
    
    if (locations.length === 0) {
      console.log('✅ All locations already have merchant_id!')
      return
    }
    
    let updated = 0
    let errors = 0
    let notFound = 0
    
    for (let i = 0; i < locations.length; i++) {
      const location = locations[i]
      
      console.log(`\n${i + 1}/${locations.length}. Processing location: ${location.square_location_id}`)
      console.log(`   Name: ${location.name || 'Unnamed'}`)
      
      try {
        // Fetch from Square API
        console.log(`   📡 Fetching from Square API...`)
        const response = await locationsApi.retrieveLocation(location.square_location_id)
        const locationData = response.result?.location
        
        if (!locationData) {
          console.log(`   ⚠️  Location not found in Square API`)
          notFound++
          continue
        }
        
        // Square API returns merchantId (camelCase), not merchant_id
        const merchantId = locationData.merchantId || locationData.merchant_id || null
        
        if (!merchantId) {
          console.log(`   ⚠️  Location missing merchantId in Square API response`)
          console.log(`      Available fields: ${Object.keys(locationData).join(', ')}`)
          notFound++
          continue
        }
        
        console.log(`   ✅ Found merchant_id: ${merchantId.substring(0, 16)}...`)
        
        // Update location in database
        await prisma.$executeRaw`
          UPDATE locations
          SET square_merchant_id = ${merchantId},
              updated_at = NOW()
          WHERE id = ${location.id}::uuid
        `
        
        console.log(`   ✅ Updated location with merchant_id`)
        updated++
        
        // Small delay to avoid rate limiting (Square API has rate limits)
        if ((i + 1) % 10 === 0) {
          console.log(`   ⏸️  Pausing briefly to avoid rate limits...`)
          await new Promise(resolve => setTimeout(resolve, 500))
        } else {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        
      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`)
        if (error.statusCode) {
          console.error(`      Status code: ${error.statusCode}`)
        }
        if (error.errors) {
          console.error(`      Square errors: ${JSON.stringify(error.errors)}`)
        }
        errors++
        
        // If it's a rate limit error, wait longer
        if (error.statusCode === 429) {
          console.log(`   ⏸️  Rate limited, waiting 2 seconds...`)
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }
    }
    
    console.log('\n' + '=' .repeat(60))
    console.log('\n📊 Summary:')
    console.log(`   ✅ Successfully updated: ${updated}`)
    console.log(`   ❌ Errors: ${errors}`)
    console.log(`   ⚠️  Not found/missing: ${notFound}`)
    console.log(`   📋 Total processed: ${locations.length}`)
    
    if (updated > 0) {
      console.log('\n💡 Next steps:')
      console.log('   1. Run: node scripts/backfill-merchant-id.js')
      console.log('   2. This will now use merchant_id from locations to update bookings/payments')
    }
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

backfillLocationsMerchantId()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })

