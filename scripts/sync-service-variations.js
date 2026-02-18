#!/usr/bin/env node
/**
 * Sync missing service variations from Square to database
 * 
 * Usage:
 *   node scripts/sync-service-variations.js <service_variation_id1> [service_variation_id2] ...
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()
const organizationId = 'd0e24178-2f94-4033-bc91-41f22df58278'

const envName = (process.env.SQUARE_ENV || 'production').toLowerCase()
const environment = envName === 'sandbox' ? Environment.Sandbox : Environment.Production
let token = process.env.SQUARE_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN_2
if (!token) {
  console.error('❌ Missing SQUARE_ACCESS_TOKEN')
  process.exit(1)
}
if (token.startsWith('Bearer ')) token = token.slice(7)

const square = new Client({ accessToken: token.trim(), environment })
const catalogApi = square.catalogApi

const serviceVariationIds = process.argv.slice(2)

if (serviceVariationIds.length === 0) {
  console.error('❌ Please provide at least one service variation ID')
  console.error('   Usage: node scripts/sync-service-variations.js <id1> [id2] ...')
  process.exit(1)
}

async function syncServiceVariation(serviceVariationId) {
  try {
    console.log(`\n📡 Fetching ${serviceVariationId} from Square...`)
    
    const response = await catalogApi.retrieveCatalogObject(serviceVariationId, true)
    
    if (!response.result || !response.result.object) {
      console.log(`   ⚠️  Service variation not found in Square`)
      return false
    }
    
    const catalogObject = response.result.object
    const varData = catalogObject.itemVariationData || catalogObject.itemData
    const related = response.result.relatedObjects || []
    const item = related.find(o => o.type === 'ITEM')
    const itemData = item?.itemData || item?.itemData
    
    const serviceName = itemData?.name || varData?.name || 'Unknown Service'
    const variationName = varData?.name || 'Regular'
    const durationMs = varData?.serviceDuration || null
    const durationMinutes = durationMs 
      ? Math.round((typeof durationMs === 'bigint' ? Number(durationMs) : durationMs) / 60000)
      : null
    const itemId = varData?.itemId || null
    
    console.log(`   ✅ Found: ${serviceName}`)
    console.log(`   Duration: ${durationMinutes || 'N/A'} minutes`)
    
    await prisma.$executeRaw`
      INSERT INTO service_variation (
        uuid, organization_id, square_variation_id, item_id,
        name, service_name, duration_minutes, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), ${organizationId}::uuid, ${serviceVariationId},
        ${itemId || null}, ${variationName}, ${serviceName},
        ${durationMinutes || null}, NOW(), NOW()
      )
      ON CONFLICT (organization_id, square_variation_id) DO UPDATE SET
        name = EXCLUDED.name,
        service_name = EXCLUDED.service_name,
        item_id = COALESCE(EXCLUDED.item_id, service_variation.item_id),
        duration_minutes = EXCLUDED.duration_minutes,
        updated_at = NOW()
    `
    
    console.log(`   ✅ Synced to database`)
    return true
  } catch (error) {
    if (error.statusCode === 404) {
      console.log(`   ⚠️  Service variation not found (404)`)
      return false
    }
    console.error(`   ❌ Error: ${error.message}`)
    return false
  }
}

async function syncAll() {
  console.log('🔄 Syncing service variations from Square')
  console.log('='.repeat(100))
  console.log(`Environment: ${envName}`)
  console.log(`Organization ID: ${organizationId}`)
  console.log(`Service Variations to sync: ${serviceVariationIds.length}`)
  
  let synced = 0
  let failed = 0
  
  for (const svId of serviceVariationIds) {
    const success = await syncServiceVariation(svId)
    if (success) synced++
    else failed++
  }
  
  console.log('\n' + '='.repeat(100))
  console.log('📊 Summary:')
  console.log(`   ✅ Synced: ${synced}/${serviceVariationIds.length}`)
  console.log(`   ❌ Failed: ${failed}/${serviceVariationIds.length}`)
  console.log('='.repeat(100))
}

syncAll()
  .then(() => {
    console.log('\n✅ Sync completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Sync failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

