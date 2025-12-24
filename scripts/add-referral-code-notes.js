#!/usr/bin/env node
require('dotenv').config()
const { generateReferralUrl } = require('../lib/utils/referral-url')
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production
})

const customersApi = squareClient.customersApi

async function appendReferralNote(customerId, referralCode, referralUrl) {
  if (!customerId || !referralCode || !referralUrl) {
    return { skipped: true, reason: 'Missing data' }
  }

  try {
    const response = await customersApi.retrieveCustomer(customerId)
    const existingNote = response.result?.customer?.note?.trim() || ''
    const issuedOn = new Date().toISOString().split('T')[0]
    const noteEntry = `[${issuedOn}] Personal referral code: ${referralCode} – ${referralUrl}`

    if (existingNote.includes(referralCode) || existingNote.includes(referralUrl)) {
      return { skipped: true, reason: 'Already present' }
    }

    const updatedNote = existingNote ? `${existingNote}\n${noteEntry}` : noteEntry

    await customersApi.updateCustomer(customerId, {
      note: updatedNote
    })

    return { updated: true }
  } catch (error) {
    console.error(`Failed to append referral note for ${customerId}: ${error.message}`)
    if (error.errors) {
      console.error(JSON.stringify(error.errors, null, 2))
    }
    return { error: error.message }
  }
}

async function main() {
  const limit = parseInt(process.argv[2] || '10', 10)
  const offset = parseInt(process.argv[3] || '0', 10)

  console.log(`Processing up to ${limit} referrers (offset ${offset})`)

  try {
    const referrers = await prisma.$queryRaw`
      SELECT square_customer_id, personal_code, given_name, family_name
      FROM square_existing_clients 
      WHERE activated_as_referrer = TRUE 
        AND personal_code IS NOT NULL
        AND square_customer_id NOT LIKE 'TEST_%'
      ORDER BY updated_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `

    if (!referrers || referrers.length === 0) {
      console.log('No referrers found for the specified range.')
      return
    }

    let updatedCount = 0
    let skippedCount = 0

    for (const referrer of referrers) {
      const customerId = referrer.square_customer_id
      const referralCode = referrer.personal_code
      const referralUrl = generateReferralUrl(referralCode)

      console.log(`\n➡️  Updating ${referrer.given_name || ''} ${referrer.family_name || ''} (${customerId})`)

      const result = await appendReferralNote(customerId, referralCode, referralUrl)

      if (result?.updated) {
        console.log(`   ✅ Added referral code ${referralCode} to notes`)
        updatedCount += 1
      } else if (result?.skipped) {
        console.log(`   ⏭️ Skipped: ${result.reason}`)
        skippedCount += 1
      } else if (result?.error) {
        console.log(`   ❌ Error: ${result.error}`)
      }
    }

    console.log('\nSummary:')
    console.log(`   Updated: ${updatedCount}`)
    console.log(`   Skipped: ${skippedCount}`)
    console.log(`   Total processed: ${referrers.length}`)
  } catch (error) {
    console.error(`Script failure: ${error.message}`)
  } finally {
    await prisma.$disconnect()
  }
}

main()


