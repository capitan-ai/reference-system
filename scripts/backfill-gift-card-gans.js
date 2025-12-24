#!/usr/bin/env node

/**
 * Backfill helper: finds rows in square_existing_clients missing gift_card_gan,
 * resolves GAN via audit table or Square API, and updates the table.
 */

const path = require('path')
const fs = require('fs')
const dotenv = require('dotenv')

const envLocalPath = path.join(__dirname, '..', '.env.local')
const envPath = path.join(__dirname, '..', '.env')

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
    console.error('❌ Missing SQUARE_ACCESS_TOKEN – cannot backfill GANs.')
    process.exit(1)
  }

  const client = new Client({
    accessToken,
    environment: Environment.Production
  })
  const { giftCardsApi } = client

  const rows = await prisma.$queryRaw`
    SELECT square_customer_id, gift_card_id
    FROM square_existing_clients
    WHERE gift_card_id IS NOT NULL
      AND (gift_card_gan IS NULL OR gift_card_gan = '')
    ORDER BY updated_at DESC
  `

  console.log(`🔍 Found ${rows.length} customers missing gift_card_gan`)

  let successCount = 0
  let skippedCount = 0
  let failureCount = 0

  for (const row of rows) {
    const giftCardId = row.gift_card_id
    const customerId = row.square_customer_id

    if (!giftCardId) continue

    try {
      let resolvedGan = null

      const cachedGan = await prisma.$queryRaw`
        SELECT resolved_gan
        FROM square_gift_card_gan_audit
        WHERE gift_card_id = ${giftCardId}
        LIMIT 1
      `
      if (cachedGan?.length && cachedGan[0].resolved_gan) {
        resolvedGan = cachedGan[0].resolved_gan
      }

      if (!resolvedGan) {
        const response = await giftCardsApi.retrieveGiftCard(giftCardId)
        const giftCard = response.result?.giftCard

        if (!giftCard?.gan) {
          throw new Error('Square returned gift card without GAN')
        }

        resolvedGan = giftCard.gan
        await upsertAuditRow({
          giftCardId,
          squareCustomerId: customerId,
          resolvedGan,
          rawPayload: giftCard
        })
      }

      if (resolvedGan) {
        await prisma.$executeRaw`
          UPDATE square_existing_clients
          SET gift_card_gan = ${resolvedGan}, updated_at = NOW()
          WHERE square_customer_id = ${customerId} AND gift_card_id = ${giftCardId}
        `
        successCount++
        console.log(`✅ Updated ${giftCardId} → ${resolvedGan}`)
      } else {
        skippedCount++
        console.warn(`⚠️ Could not resolve GAN for ${giftCardId}, skipping`)
      }
    } catch (error) {
      failureCount++
      if (error.statusCode === 404) {
        console.warn(`⚠️ Gift card ${giftCardId} not found in Square (404). Skipping.`)
      } else {
        console.error(`❌ Failed to backfill ${giftCardId}: ${error.message}`)
      }
    }
  }

  console.log('')
  console.log(
    `📊 Backfill complete: ${successCount} updated, ${skippedCount} skipped, ${failureCount} failed`
  )
}

main()
  .catch((error) => {
    console.error('❌ Unexpected error during GAN backfill:', error)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })


