#!/usr/bin/env node

/**
 * Audit helper: loads every gift card recorded in square_existing_clients,
 * fetches the live GAN from Square, and writes the result into an audit table
 * (square_gift_card_gan_audit) so we can track discrepancies over time.
 */

const path = require('path')
const fs = require('fs')
const dotenv = require('dotenv')

const projectRoot = path.resolve(__dirname, '..')
const envLocalPath = path.join(projectRoot, '.env.local')
const envPath = path.join(projectRoot, '.env')

if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true })
}

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: false })
}

const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

const safeStringify = (value) =>
  JSON.stringify(
    value,
    (_key, val) => (typeof val === 'bigint' ? val.toString() : val)
  )

async function ensureAuditTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS square_gift_card_gan_audit (
      gift_card_id TEXT PRIMARY KEY,
      square_customer_id TEXT,
      resolved_gan TEXT,
      verified_at TIMESTAMPTZ DEFAULT NOW(),
      raw_payload JSONB
    )
  `)
}

async function upsertAuditRow({ giftCardId, squareCustomerId, resolvedGan, rawPayload }) {
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO square_gift_card_gan_audit (gift_card_id, square_customer_id, resolved_gan, verified_at, raw_payload)
      VALUES ($1, $2, $3, NOW(), $4::jsonb)
      ON CONFLICT (gift_card_id) DO UPDATE SET
        square_customer_id = EXCLUDED.square_customer_id,
        resolved_gan = EXCLUDED.resolved_gan,
        verified_at = NOW(),
        raw_payload = EXCLUDED.raw_payload
    `,
    giftCardId,
    squareCustomerId,
    resolvedGan,
    safeStringify(rawPayload ?? null)
  )
}

async function main() {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()
  if (!accessToken) {
    console.error('❌ Missing SQUARE_ACCESS_TOKEN – cannot audit gift card GANs.')
    process.exit(1)
  }

  const squareClient = new Client({
    accessToken,
    environment: Environment.Production
  })
  const { giftCardsApi } = squareClient

  await ensureAuditTable()

  const rows = await prisma.$queryRaw`
    SELECT square_customer_id, gift_card_id
    FROM square_existing_clients
    WHERE gift_card_id IS NOT NULL
    ORDER BY updated_at DESC
  `

  console.log(`🔍 Found ${rows.length} gift cards to audit`)

  let successCount = 0
  let failureCount = 0

  for (const row of rows) {
    const giftCardId = row.gift_card_id
    const customerId = row.square_customer_id

    if (!giftCardId) continue

    try {
      const response = await giftCardsApi.retrieveGiftCard(giftCardId)
      const giftCard = response.result?.giftCard

      if (!giftCard?.gan) {
        throw new Error('Square returned gift card without GAN')
      }

      await upsertAuditRow({
        giftCardId,
        squareCustomerId: customerId,
        resolvedGan: giftCard.gan,
        rawPayload: giftCard
      })

      successCount++
      console.log(`✅ ${giftCardId} → ${giftCard.gan}`)
    } catch (error) {
      failureCount++
      if (error.statusCode === 404) {
        console.warn(`⚠️ Gift card ${giftCardId} not found in Square (404). Skipping.`)
      } else {
        console.error(`❌ Failed to resolve ${giftCardId}: ${error.message}`)
      }
    }
  }

  console.log('')
  console.log(`📊 Audit complete: ${successCount} succeeded, ${failureCount} failed`)
}

main()
  .catch((error) => {
    console.error('❌ Unexpected error while auditing gift cards:', error)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })


