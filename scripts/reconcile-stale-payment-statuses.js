/**
 * reconcile-stale-payment-statuses.js
 *
 * Finds payments stuck in non-COMPLETED status (APPROVED, PENDING, etc.) that
 * are older than a threshold, queries Square API for their actual current
 * status, and updates our DB if Square has moved them to COMPLETED.
 *
 * Background: on 2026-04-08 we found 1 payment ($130) that had been stuck
 * with status='APPROVED' since 2026-04-02. Square's Sales Summary correctly
 * counted it in Net Sales (Square API confirmed status=COMPLETED), but our
 * dashboard view excluded it because the column was stale. The webhook
 * handler is correct (upsert overwrites status), so the most likely cause
 * was either a missed payment.updated webhook delivery or a brief endpoint
 * outage. This kind of edge case can happen for delayed-capture payments
 * where Square fires payment.created with APPROVED, then payment.updated
 * with COMPLETED a few seconds later — if the second webhook is lost, we
 * stay stale.
 *
 * Strategy: daily/hourly cron that catches these within ~24h instead of
 * waiting for an analyst to spot the discrepancy with Square.
 *
 * Usage:
 *   node scripts/reconcile-stale-payment-statuses.js              # dry-run, default
 *   node scripts/reconcile-stale-payment-statuses.js --apply      # actually update DB
 *   node scripts/reconcile-stale-payment-statuses.js --hours=12   # only payments older than 12h
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const https = require('https');

const APPLY = process.argv.includes('--apply');
const hoursArg = process.argv.find((a) => a.startsWith('--hours='));
const HOURS = hoursArg ? parseInt(hoursArg.split('=')[1], 10) : 1;

const TOKEN = process.env.SQUARE_ACCESS_TOKEN?.trim().replace(/^Bearer /, '');
if (!TOKEN) {
  console.error('SQUARE_ACCESS_TOKEN not set');
  process.exit(1);
}

const prisma = new PrismaClient();

function squareGetPayment(paymentId) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'connect.squareup.com',
        port: 443,
        path: '/v2/payments/' + paymentId,
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + TOKEN,
          'Square-Version': '2024-12-18',
          Accept: 'application/json',
        },
        timeout: 10000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            if (j.payment) resolve({ statusCode: res.statusCode, payment: j.payment });
            else if (j.errors) resolve({ statusCode: res.statusCode, errors: j.errors });
            else resolve({ statusCode: res.statusCode, raw: body.slice(0, 200) });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Square API timeout'));
    });
    req.end();
  });
}

(async () => {
  console.log(`\n${APPLY ? '🔧 APPLY' : '👀 DRY-RUN'} mode | minimum age: ${HOURS}h\n`);

  // Find stale non-COMPLETED, non-FAILED, non-CANCELED payments
  const stale = await prisma.$queryRawUnsafe(`
    SELECT
      p.id::text AS uuid,
      p.payment_id AS sq_id,
      p.status AS our_status,
      p.amount_money_amount AS amount,
      p.created_at::text AS created,
      EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 AS age_hours,
      o.state AS order_state,
      o.raw_json->>'state' AS order_raw_state
    FROM payments p
    LEFT JOIN orders o ON o.id = p.order_id
    WHERE p.status NOT IN ('COMPLETED', 'FAILED', 'CANCELED')
      AND p.created_at < NOW() - (INTERVAL '1 hour' * ${HOURS})
    ORDER BY p.created_at
  `);

  console.log(`Found ${stale.length} stale payments older than ${HOURS}h with status not in (COMPLETED, FAILED, CANCELED)`);
  if (stale.length === 0) {
    console.log('Nothing to reconcile.\n');
    await prisma.$disconnect();
    return;
  }

  let updates = 0;
  let unchanged = 0;
  let errors = 0;

  for (const row of stale) {
    const ageH = Number(row.age_hours).toFixed(1);
    console.log(`\n  ${row.sq_id}  our:${row.our_status}  $${(Number(row.amount) / 100).toFixed(2)}  age:${ageH}h  order_state:${row.order_state}`);

    try {
      const result = await squareGetPayment(row.sq_id);
      if (result.errors) {
        console.log(`    Square API error:`, JSON.stringify(result.errors));
        errors++;
        continue;
      }
      if (!result.payment) {
        console.log(`    No payment in Square response`);
        errors++;
        continue;
      }
      const sqStatus = result.payment.status;
      console.log(`    Square says: ${sqStatus}`);

      if (sqStatus === row.our_status) {
        console.log(`    → unchanged`);
        unchanged++;
        continue;
      }

      if (sqStatus === 'COMPLETED') {
        if (APPLY) {
          await prisma.$executeRawUnsafe(`
            UPDATE payments
            SET status = 'COMPLETED', updated_at = NOW()
            WHERE id = '${row.uuid}'::uuid
          `);
          console.log(`    ✅ updated → COMPLETED`);
        } else {
          console.log(`    [dry-run] would update → COMPLETED`);
        }
        updates++;
      } else {
        console.log(`    Square has different non-COMPLETED status, leaving alone`);
        unchanged++;
      }
    } catch (e) {
      console.log(`    Error:`, e.message);
      errors++;
    }
  }

  console.log(`\nSummary: ${updates} ${APPLY ? 'updated' : 'would update'}, ${unchanged} unchanged, ${errors} errors\n`);
  if (!APPLY && updates > 0) {
    console.log(`Re-run with --apply to actually update.\n`);
  }
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
