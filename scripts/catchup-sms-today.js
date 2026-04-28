require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { sendPostVisitReminderSms } = require('../lib/twilio-service')
const { generateReferralUrl } = require('../lib/utils/referral-url')

async function main() {
  const customers = await prisma.$queryRaw`
    SELECT DISTINCT ON (c.square_customer_id)
      p.payment_id, p.organization_id,
      c.square_customer_id, c.given_name, c.family_name,
      c.phone_number, c.personal_code, c.referral_url
    FROM payments p
    JOIN square_existing_clients c
      ON p.customer_id = c.square_customer_id AND p.organization_id = c.organization_id
    WHERE p.created_at >= '2026-04-16T00:00:00Z'
      AND p.status = 'COMPLETED'
      AND p.customer_id IS NOT NULL
      AND c.phone_number IS NOT NULL
    ORDER BY c.square_customer_id, p.created_at DESC
  `

  // Check already sent
  const alreadySent = await prisma.$queryRaw`
    SELECT "customerId" FROM notification_events
    WHERE channel = 'SMS'
      AND "templateType" = 'POST_VISIT_REMINDER'
      AND "createdAt" >= '2026-04-16T00:00:00Z'
  `
  const sentSet = new Set(alreadySent.map(r => r.customerId))

  console.log(`Found ${customers.length} customers, ${sentSet.size} already sent`)

  let sent = 0, skipped = 0, noCode = 0, failed = 0
  for (const c of customers) {
    const name = `${c.given_name || ''} ${c.family_name || ''}`.trim()

    if (sentSet.has(c.square_customer_id)) {
      console.log(`  ALREADY_SENT ${name}`)
      skipped++
      continue
    }

    if (!c.personal_code) {
      console.log(`  NO_CODE ${name} | ${c.phone_number}`)
      noCode++
      continue
    }

    const url = c.referral_url || generateReferralUrl(c.personal_code)
    const result = await sendPostVisitReminderSms({
      to: c.phone_number,
      customerName: c.given_name || 'there',
      referralCode: c.personal_code,
      referralUrl: url
    })

    if (result.success && !result.skipped) {
      const nId = `pvr-catchup-${c.square_customer_id}-${Date.now()}`
      await prisma.$executeRaw`
        INSERT INTO notification_events
          (id, channel, "templateType", status, "customerId", "externalId", "sentAt", metadata, "createdAt", "statusAt", organization_id)
        VALUES
          (${nId}, 'SMS'::"NotificationChannel", 'POST_VISIT_REMINDER'::"NotificationTemplateType", 'sent'::"NotificationStatus",
           ${c.square_customer_id}, ${result.sid}, NOW(),
           ${JSON.stringify({ referralCode: c.personal_code, paymentId: c.payment_id, referralUrl: url, source: 'catchup' })}::jsonb,
           NOW(), NOW(), ${c.organization_id}::uuid)
      `
      console.log(`  SENT ${name} -> ${c.phone_number} (sid: ${result.sid})`)
      sent++
    } else if (result.skipped) {
      console.log(`  SKIP ${name} -> ${result.reason}`)
      skipped++
    } else {
      console.log(`  FAIL ${name} -> ${result.error}`)
      failed++
    }

    // 1s delay between sends
    await new Promise(r => setTimeout(r, 1000))
  }

  console.log(`\nDONE: sent=${sent} skipped=${skipped} failed=${failed} noCode=${noCode}`)
  await prisma.$disconnect()
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL:', e.message); process.exit(1) })
