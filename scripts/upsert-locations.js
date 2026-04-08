#!/usr/bin/env node
/**
 * Upsert known locations into the database.
 * Update the array below if you add more locations.
 *
 * Usage:
 *   node scripts/upsert-locations.js
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const LOCATIONS = [
  {
    square_location_id: 'LNQKVBTQZN3EZ',
    name: 'Pacific Ave',
    address_line_1: '550 Pacific Ave',
    locality: 'San Francisco',
    administrative_district_level_1: 'CA',
    postal_code: '94133'
  },
  {
    square_location_id: 'LT4ZHFBQQYB2N',
    name: 'Union St',
    address_line_1: '3089 Union St',
    locality: 'San Francisco',
    administrative_district_level_1: 'CA',
    postal_code: '94123'
  }
]

async function main() {
  console.log('🏪 Upserting known locations...')
  for (const loc of LOCATIONS) {
    await prisma.location.upsert({
      where: { square_location_id: loc.square_location_id },
      update: { ...loc, updated_at: new Date() },
      create: loc
    })
    console.log(`   ✅ ${loc.name} (${loc.square_location_id})`)
  }
  console.log('✨ Done.')
}

main()
  .catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })




