#!/usr/bin/env node

/**
 * Sends referral SMS messages (Twilio) to customers who have not yet received SMS.
 * - Processes up to 10 customers per run by default (configurable via SMS_BATCH_LIMIT)
 * - Waits 10 seconds between sends to stay well below 10DLC throughput limits
 * - Marks customers as notified via referral_sms_sent + referral_sms_sent_at columns
 */

const dotenv = require('dotenv')
dotenv.config({ path: '.env.local', override: true })
dotenv.config()

const { PrismaClient } = require('@prisma/client')
const { sendReferralCodeSms, REFERRAL_PROGRAM_SMS_TEMPLATE } = require('../lib/twilio-service')
const { generateReferralUrl } = require('../lib/utils/referral-url')

const prisma = new PrismaClient()

const BATCH_LIMIT = Number(process.env.SMS_BATCH_LIMIT || 10)
const DELAY_MS = Number(process.env.SMS_DELAY_MS || 10000) // 10 seconds default
const SMS_TEMPLATE = process.env.REFERRAL_SMS_TEMPLATE || REFERRAL_PROGRAM_SMS_TEMPLATE

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cleanValue(value) {
  if (value === undefined || value === null) return null
  const trimmed = value.toString().trim()
  return trimmed.length > 0 ? trimmed : null
}

function formatCustomerName(customer) {
  const first = cleanValue(customer.given_name)
  const last = cleanValue(customer.family_name)
  const full = [first, last].filter(Boolean).join(' ').trim()
  return full || 'there'
}

function generatePersonalCode(customerName, customerId) {
  let namePart = 'CUST'
  if (customerName) {
    namePart = customerName
      .toString()
      .trim()
      .split(' ')[0]
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .substring(0, 10)
  }
  let idPart = ''
  if (customerId) {
    const idStr = customerId.toString()
    const numericMatches = idStr.match(/\d+/g)
    if (numericMatches && numericMatches.length > 0) {
      const allNums = numericMatches.join('')
      idPart = allNums.slice(-4).padStart(4, '0')
    } else {
      idPart = idStr.slice(-4).toUpperCase()
    }
  } else {
    idPart = Date.now().toString().slice(-4)
  }
  if (idPart.length < 3) idPart = idPart.padStart(4, '0')
  if (idPart.length > 4) idPart = idPart.slice(-4)
  return `${namePart}${idPart}`
}

async function fetchCustomers(limit) {
  return prisma.$queryRaw`
    SELECT square_customer_id, given_name, family_name, phone_number,
           personal_code, referral_url
    FROM square_existing_clients
    WHERE phone_number IS NOT NULL
      AND TRIM(phone_number) <> ''
      AND COALESCE(referral_sms_sent, FALSE) = FALSE
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `
}

async function ensureReferralArtifacts(customer, customerName) {
  let personalCode = cleanValue(customer.personal_code)
  if (!personalCode) {
    personalCode = generatePersonalCode(customerName, customer.square_customer_id)
    await prisma.$executeRaw`
      UPDATE square_existing_clients
      SET personal_code = ${personalCode},
          updated_at = NOW()
      WHERE square_customer_id = ${customer.square_customer_id}
    `
    console.log(`   ➕ Generated personal code: ${personalCode}`)
  }

  let referralUrl = cleanValue(customer.referral_url)
  if (!referralUrl && personalCode) {
    referralUrl = generateReferralUrl(personalCode)
    await prisma.$executeRaw`
      UPDATE square_existing_clients
      SET referral_url = ${referralUrl},
          updated_at = NOW()
      WHERE square_customer_id = ${customer.square_customer_id}
    `
    console.log(`   ➕ Stored referral URL: ${referralUrl}`)
  }

  return { personalCode, referralUrl }
}

async function markReferralSmsResult(customerId, smsSid) {
  await prisma.$executeRaw`
    UPDATE square_existing_clients
    SET referral_sms_sent = TRUE,
        referral_sms_sent_at = NOW(),
        referral_sms_sid = ${smsSid || null},
        updated_at = NOW()
    WHERE square_customer_id = ${customerId}
  `
}

async function run() {
  try {
    console.log(`\n🚀 Starting referral SMS run (limit ${BATCH_LIMIT}, delay ${Math.round(DELAY_MS / 1000)}s)...`)
    const maxBatchesRaw = Number(process.env.SMS_MAX_BATCHES)
    const maxBatches = Number.isFinite(maxBatchesRaw) && maxBatchesRaw > 0 ? maxBatchesRaw : null
    let batchNumber = 0
    let totalSent = 0

    while (true) {
      if (maxBatches && batchNumber >= maxBatches) {
        console.log(`⏹️ Reached SMS_MAX_BATCHES=${maxBatches}, stopping.`)
        break
      }

      const candidates = await fetchCustomers(BATCH_LIMIT)
      if (!Array.isArray(candidates) || candidates.length === 0) {
        if (batchNumber === 0) {
          console.log('✅ No eligible customers found (all SMS-ready customers already notified or missing phone numbers).')
        } else {
          console.log('✅ All pending SMS customers processed.')
        }
        break
      }

      batchNumber++
      console.log(`\n📋 Batch ${batchNumber}: processing ${candidates.length} customers pending SMS.`)

      let sentCount = 0
      for (const [index, customer] of candidates.entries()) {
        const phone = cleanValue(customer.phone_number)
        if (!phone) {
          console.log(`⚠️ Skipping ${customer.square_customer_id} — missing phone number.`)
          continue
        }

        const customerName = formatCustomerName(customer)
        console.log(`\n➡️  [Batch ${batchNumber} | ${index + 1}/${candidates.length}] ${customerName} — ${phone}`)

        try {
          const { personalCode, referralUrl } = await ensureReferralArtifacts(customer, customerName)
          if (!personalCode || !referralUrl) {
            console.log('   ⚠️ Missing referral data even after regeneration, skipping.')
            continue
          }

          const smsResult = await sendReferralCodeSms({
            to: phone,
            name: customerName,
            referralUrl,
            body: SMS_TEMPLATE
          })

          if (smsResult && smsResult.sid) {
            console.log(`   ✅ SMS sent (sid: ${smsResult.sid})`)
            await markReferralSmsResult(customer.square_customer_id, smsResult.sid)
            sentCount++
            totalSent++
          } else if (smsResult?.skipped) {
            console.log(`   ⏸️ SMS skipped: ${smsResult.reason || 'disabled'}`)
          } else {
            console.log(`   ❌ SMS failed: ${smsResult?.error || 'unknown error'}`)
          }
        } catch (error) {
          console.error(`   ❌ Error sending SMS: ${error.message}`)
        }

        if (index < candidates.length - 1) {
          console.log(`   ⏳ Waiting ${Math.round(DELAY_MS / 1000)}s before next SMS...`)
          await sleep(DELAY_MS)
        }
      }

      console.log(`\n✅ Batch ${batchNumber} complete. SMS sent to ${sentCount}/${candidates.length} customers.`)

      if (maxBatches && batchNumber >= maxBatches) {
        console.log(`⏹️ Reached SMS_MAX_BATCHES=${maxBatches}, stopping.`)
        break
      }
    }

    console.log(`\n🎯 Done. SMS sent to ${totalSent} customers across ${batchNumber} batch(es).`)
  } finally {
    await prisma.$disconnect()
  }
}

run().catch((error) => {
  console.error('❌ Fatal error while sending referral SMS:', error)
  prisma.$disconnect().finally(() => process.exit(1))
})

