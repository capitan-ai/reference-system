#!/usr/bin/env node
/**
 * Fetch service variations from Square Catalog and upsert into service_variations table.
 * We pull ITEM_VARIATION objects and store:
 * - square_id (variation id)
 * - name (variation name)
 * - service_id (item id)
 * - duration_minutes (serviceDuration in minutes, if provided)
 *
 * Usage:
 *   node scripts/fetch-service-variations.js
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

const envName = (process.env.SQUARE_ENV || 'production').toLowerCase()
const environment = envName === 'sandbox' ? Environment.Sandbox : Environment.Production
// Use primary token first (can override with _2 if needed)
let token = process.env.SQUARE_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN_2
if (!token) {
  console.error('❌ Missing SQUARE_ACCESS_TOKEN(_2)')
  process.exit(1)
}
if (token.startsWith('Bearer ')) token = token.slice(7)

const square = new Client({ accessToken: token.trim(), environment })
const catalogApi = square.catalogApi

function toMinutes(ms) {
  if (ms === undefined || ms === null) return null
  const n = Number(ms)
  if (!Number.isFinite(n)) return null
  return Math.round(n / 60000)
}

async function main() {
  console.log(`🔑 Using Square ${environment === Environment.Production ? 'Production' : 'Sandbox'} environment`)
  console.log('📦 Fetching ITEM_VARIATION objects from Catalog via searchCatalogObjects (all pages)...')

  let cursor = undefined
  let created = 0
  let updated = 0
  let page = 0
  let total = 0

  do {
    page++
    const resp = await catalogApi.searchCatalogObjects({
      cursor: cursor || undefined,
      objectTypes: ['ITEM_VARIATION']
    })
    const objects = resp.result?.objects || []
    cursor = resp.result?.cursor

    total += objects.length
    if (objects.length) {
      console.log(` page ${page}: ${objects.length} variations (total ${total})`)
    } else {
      console.log(` page ${page}: 0 variations`)
    }

    for (const obj of objects) {
      if (obj.type !== 'ITEM_VARIATION') continue
      const id = obj.id
      const data = obj.itemVariationData || {}
      const name = data.name || null
      const itemId = data.itemId || null
      const durationMinutes = toMinutes(data.serviceDuration)

      const existing = await prisma.serviceVariation.findUnique({
        where: { square_id: id }
      })

      if (existing) {
        await prisma.serviceVariation.update({
          where: { square_id: id },
          data: {
            name,
            service_id: itemId,
            duration_minutes: durationMinutes,
            updated_at: new Date()
          }
        })
        updated++
      } else {
        await prisma.serviceVariation.create({
          data: {
            square_id: id,
            name,
            service_id: itemId,
            duration_minutes: durationMinutes
          }
        })
        created++
      }
    }
  } while (cursor)

  console.log(`\n📊 Done. Created: ${created}, Updated: ${updated}, Total seen: ${total}`)
}

main()
  .catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

