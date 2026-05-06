/**
 * Cron: reconcile stale payment statuses
 *
 * Daily safety net for payments stuck in non-terminal status
 * (anything other than COMPLETED, FAILED, CANCELED) older than 1 hour.
 *
 * Re-fetches each one from the Square /v2/payments API and updates our DB
 * if Square has moved the payment to COMPLETED. Catches any payment that
 * the live webhook handler missed (lost webhook delivery, brief endpoint
 * outage, race condition with the new fresh-fetch defense in
 * savePaymentToDatabase).
 *
 * This route is the production counterpart to scripts/reconcile-stale-
 * payment-statuses.js (which is for ad-hoc / manual runs from a developer
 * workstation).
 *
 * Schedule: 0 8 * * *  (daily at 08:00 UTC = 01:00 PT)
 */

import prisma from '@/lib/prisma-client'
import { logInfo, logError, logWarn } from '@/lib/observability/logger'
import https from 'node:https'

export const dynamic = 'force-dynamic'

const SQUARE_API_HOST = 'connect.squareup.com'
const SQUARE_API_VERSION = '2024-12-18'
const HOURS_THRESHOLD = 1
const MAX_PAYMENTS_PER_RUN = 200

function squareGetPayment(paymentId, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: SQUARE_API_HOST,
        port: 443,
        path: '/v2/payments/' + encodeURIComponent(paymentId),
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + token,
          'Square-Version': SQUARE_API_VERSION,
          Accept: 'application/json',
        },
        timeout: 10000,
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body)
            resolve({ statusCode: res.statusCode, body: parsed })
          } catch (e) {
            reject(new Error(`Square API parse error: ${e.message}`))
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(new Error('Square API request timed out'))
    })
    req.end()
  })
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const token = process.env.SQUARE_ACCESS_TOKEN?.trim().replace(/^Bearer /, '')
  if (!token) {
    logError('reconcile_stale_payments.no_token', {})
    return Response.json({ success: false, error: 'SQUARE_ACCESS_TOKEN not set' }, { status: 500 })
  }

  try {
    const stale = await prisma.$queryRaw`
      SELECT
        p.id::text AS uuid,
        p.payment_id AS sq_id,
        p.status AS our_status,
        p.amount_money_amount AS amount
      FROM payments p
      WHERE p.status NOT IN ('COMPLETED', 'FAILED', 'CANCELED')
        AND p.created_at < NOW() - (INTERVAL '1 hour' * ${HOURS_THRESHOLD})
      ORDER BY p.created_at
      LIMIT ${MAX_PAYMENTS_PER_RUN}
    `

    logInfo('reconcile_stale_payments.found', { count: stale.length })

    let updated = 0
    let unchanged = 0
    let errors = 0
    const updatedDetails = []

    for (const row of stale) {
      try {
        const result = await squareGetPayment(row.sq_id, token)
        if (result.statusCode !== 200 || !result.body?.payment) {
          errors++
          logWarn('reconcile_stale_payments.api_error', {
            paymentId: row.sq_id,
            statusCode: result.statusCode,
            errors: result.body?.errors,
          })
          continue
        }
        const sqStatus = result.body.payment.status
        if (sqStatus === row.our_status) {
          unchanged++
          continue
        }
        if (sqStatus === 'COMPLETED') {
          await prisma.$executeRaw`
            UPDATE payments
            SET status = 'COMPLETED', updated_at = NOW()
            WHERE id = ${row.uuid}::uuid
          `
          updated++
          updatedDetails.push({
            payment_id: row.sq_id,
            from: row.our_status,
            to: 'COMPLETED',
            amount_cents: Number(row.amount),
          })
        } else {
          unchanged++
        }
      } catch (e) {
        errors++
        logWarn('reconcile_stale_payments.fetch_error', {
          paymentId: row.sq_id,
          error: e.message,
        })
      }
    }

    logInfo('reconcile_stale_payments.done', {
      checked: stale.length,
      updated,
      unchanged,
      errors,
    })

    return Response.json({
      success: true,
      checked: stale.length,
      updated,
      unchanged,
      errors,
      details: updatedDetails,
    })
  } catch (error) {
    logError('reconcile_stale_payments.error', { error: error.message })
    return Response.json({ success: false, error: error.message }, { status: 500 })
  }
}
