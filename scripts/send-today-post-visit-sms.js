/**
 * One-time script: Send post-visit referral SMS to all customers
 * who made a completed payment today but didn't receive the SMS
 * (due to the column name bug in the initial deploy).
 *
 * Usage: node scripts/send-today-post-visit-sms.js [--dry-run]
 */

const prisma = require('../lib/prisma-client')
const { sendPostVisitReminderSms } = require('../lib/twilio-service')
const { generateReferralUrl } = require('../lib/utils/referral-url')
const { generateUniquePersonalCode } = require('../lib/webhooks/giftcard-processors')

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  console.log(`\n📲 Post-visit SMS catch-up script (${DRY_RUN ? 'DRY RUN' : 'LIVE'})\n`)

  // Get unique customers from today's completed payments
  const customers = await prisma.$queryRaw`
    SELECT DISTINCT ON (c.square_customer_id)
      p.payment_id,
      p.organization_id,
      c.square_customer_id,
      c.given_name,
      c.family_name,
      c.phone_number,
      c.personal_code,
      c.referral_url
    FROM payments p
    JOIN square_existing_clients c
      ON p.customer_id = c.square_customer_id AND p.organization_id = c.organization_id
    WHERE p.created_at >= '2026-04-16T00:00:00Z'
      AND p.status = 'COMPLETED'
      AND p.customer_id IS NOT NULL
      AND c.phone_number IS NOT NULL
    ORDER BY c.square_customer_id, p.created_at DESC
  `

  console.log(`Found ${customers.length} unique customers with phone numbers\n`)

  // Check which customers already received SMS today
  const alreadySent = await prisma.$queryRaw`
    SELECT "customerId" FROM notification_events
    WHERE channel = 'SMS'
      AND "templateType" = 'POST_VISIT_REMINDER'
      AND "createdAt" >= '2026-04-16T00:00:00Z'
      AND status IN ('sent', 'queued', 'delivered')
  `
  const sentSet = new Set(alreadySent.map(r => r.customerId))

  let sent = 0
  let skipped = 0
  let failed = 0
  let generated = 0

  for (const cust of customers) {
    const name = `${cust.given_name || ''} ${cust.family_name || ''}`.trim()

    if (sentSet.has(cust.square_customer_id)) {
      console.log(`  SKIP ${name} — already sent today`)
      skipped++
      continue
    }

    // Generate code if missing
    let code = cust.personal_code
    let url = cust.referral_url
    if (!code) {
      try {
        code = await generateUniquePersonalCode(cust.given_name || '', cust.square_customer_id, cust.organization_id)
        url = generateReferralUrl(code)
        if (!DRY_RUN) {
          await prisma.$executeRaw`
            UPDATE square_existing_clients
            SET personal_code = ${code}, referral_url = ${url}
            WHERE square_customer_id = ${cust.square_customer_id}
              AND organization_id = ${cust.organization_id}::uuid
          `
        }
        console.log(`  GEN  ${name} — created code ${code}`)
        generated++
      } catch (err) {
        console.error(`  FAIL ${name} — code generation failed: ${err.message}`)
        failed++
        continue
      }
    }
    if (!url) {
      url = generateReferralUrl(code)
    }

    if (DRY_RUN) {
      console.log(`  SEND ${name} → ${cust.phone_number} | code: ${code} | url: ${url}`)
      sent++
      continue
    }

    // Send SMS
    const result = await sendPostVisitReminderSms({
      to: cust.phone_number,
      customerName: cust.given_name || 'there',
      referralCode: code,
      referralUrl: url
    })

    if (result.success && !result.skipped) {
      // Track in notification_events
      const notifId = `pvr-catchup-${cust.square_customer_id}-${Date.now()}`
      await prisma.$executeRaw`
        INSERT INTO notification_events (id, channel, "templateType", status, "customerId", "externalId", "sentAt", metadata, "createdAt", "statusAt", organization_id)
        VALUES (${notifId}, 'SMS', 'POST_VISIT_REMINDER'::"NotificationTemplateType", 'sent'::"NotificationStatus", ${cust.square_customer_id}, ${result.sid}, NOW(), ${JSON.stringify({ referralCode: code, paymentId: cust.payment_id, referralUrl: url, source: 'catchup-script' })}::jsonb, NOW(), NOW(), ${cust.organization_id}::uuid)
      `
      console.log(`  SENT ${name} → ${cust.phone_number} (sid: ${result.sid})`)
      sent++
    } else if (result.skipped) {
      console.log(`  SKIP ${name} — ${result.reason}`)
      skipped++
    } else {
      console.error(`  FAIL ${name} — ${result.error}`)
      failed++
    }

    // 1s delay between sends to respect throughput limits
    await new Promise(r => setTimeout(r, 1000))
  }

  console.log(`\n--- Results ---`)
  console.log(`Sent:      ${sent}`)
  console.log(`Skipped:   ${skipped}`)
  console.log(`Failed:    ${failed}`)
  console.log(`Generated: ${generated} new codes`)
  console.log()

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('Script failed:', err)
  process.exit(1)
})
