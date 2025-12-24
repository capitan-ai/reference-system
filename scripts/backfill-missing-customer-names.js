#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production
})

const customersApi = squareClient.customersApi

function clean(value) {
  if (value === undefined || value === null) return null
  const trimmed = value.toString().trim()
  return trimmed.length > 0 ? trimmed : null
}

async function updateCustomerRecord(customerId, data) {
  const { givenName, familyName, emailAddress, phoneNumber } = data

  if (!givenName && !familyName && !emailAddress && !phoneNumber) {
    return { skipped: true }
  }

  await prisma.$executeRaw`
    UPDATE square_existing_clients
    SET
      given_name = COALESCE(square_existing_clients.given_name, ${givenName}),
      family_name = COALESCE(square_existing_clients.family_name, ${familyName}),
      email_address = COALESCE(square_existing_clients.email_address, ${emailAddress}),
      phone_number = COALESCE(square_existing_clients.phone_number, ${phoneNumber}),
      updated_at = NOW()
    WHERE square_customer_id = ${customerId}
  `

  return { updated: true }
}

async function main() {
  const limit = parseInt(process.argv[2] || '25', 10)
  const offset = parseInt(process.argv[3] || '0', 10)

  console.log(`Backfilling up to ${limit} customers (offset ${offset})`)

  try {
    const rows = await prisma.$queryRaw`
      SELECT square_customer_id
      FROM square_existing_clients
      WHERE (given_name IS NULL OR TRIM(given_name) = '')
         OR (family_name IS NULL OR TRIM(family_name) = '')
         OR (email_address IS NULL OR TRIM(email_address) = '')
         OR (phone_number IS NULL OR TRIM(phone_number) = '')
      ORDER BY updated_at ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `

    if (!rows || rows.length === 0) {
      console.log('No customers require backfill for the specified range.')
      return
    }

    let updated = 0
    let skipped = 0
    let failures = 0

    for (const row of rows) {
      const customerId = row.square_customer_id

      try {
        const response = await customersApi.retrieveCustomer(customerId)
        const customer = response.result?.customer

        if (!customer) {
          console.log(`❌ Customer ${customerId} not found in Square`)
          failures += 1
          continue
        }

        const result = await updateCustomerRecord(customerId, {
          givenName: clean(customer.givenName),
          familyName: clean(customer.familyName),
          emailAddress: clean(customer.emailAddress),
          phoneNumber: clean(customer.phoneNumber)
        })

        if (result.updated) {
          console.log(`✅ Updated customer ${customerId}`)
          updated += 1
        } else {
          console.log(`⏭️ Skipped customer ${customerId} (no new data)`)
          skipped += 1
        }
      } catch (error) {
        console.error(`❌ Failed to process ${customerId}: ${error.message}`)
        if (error.errors) {
          console.error(JSON.stringify(error.errors, null, 2))
        }
        failures += 1
      }
    }

    console.log('\nSummary:')
    console.log(`   Updated: ${updated}`)
    console.log(`   Skipped: ${skipped}`)
    console.log(`   Failed: ${failures}`)
    console.log(`   Total processed: ${rows.length}`)
  } catch (error) {
    console.error(`Script error: ${error.message}`)
  } finally {
    await prisma.$disconnect()
  }
}

main()





