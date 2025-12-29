# Gift Card Flow Resilience Audit

## 1. Current Pipeline Topology

- **Entry Points:** Square webhooks handled in `app/api/webhooks/square/referrals/route.js`.
- **Primary Triggers:**
  1. `customer.created` → seeds `square_existing_clients`.
  2. `booking.created` → looks up referral code, issues friend gift card immediately.
  3. `payment.{created|updated}` (status `COMPLETED`) → rewards referrer, promotes friend to referrer.
- **Execution Model:** Synchronous handler per webhook; no background queue or state checkpointing beyond database columns.

## 2. Stage Breakdown & Dependencies

| Stage | Major Actions | External Dependencies | Persistence | Notes |
|-------|---------------|-----------------------|-------------|-------|
| Customer ingest | Normalize profile, write `square_existing_clients` row | Square Customers API | DB insert/update | Retries rely on webhook redelivery; missing idempotency keys |
| Booking capture (friend reward) | Resolve referral code (custom fields, custom attributes); create/activate gift card; send email | Square Gift Card + Orders + Payments APIs, Email service | Update `gift_card_*` columns, `used_referral_code`, `got_signup_bonus` | Single transaction spans multiple remote calls; failure mid-way leaves partial state |
| Payment completion (referrer reward) | Lookup referrer, create/load gift card, send notifications, mark `first_payment_completed` | Square Gift Card APIs, Orders/Payments (owner-funded), Email service | Update `total_referrals`, `total_rewards`, gift card metadata | Same webhook handles both new and repeat referrals without checkpoint |
| Referral promotion | Generate personal code, ensure referrer gift card exists, send referral code email | Square Custom Attributes, Gift Card API, Email service | Update `personal_code`, `activated_as_referrer`, `referral_email_sent` | Duplicate emails prevented via DB flag but no retry resume logic |

## 3. Failure Surfaces Observed in Code

- **Square API calls** (`giftCardsApi`, `giftCardActivitiesApi`, `ordersApi`, `paymentsApi`): multiple try/catch blocks log and continue, but the handler ultimately returns success even when a downstream call fails; webhook will not be retried automatically.
- **Database writes** via `prisma.$executeRaw` / `$queryRaw`: raw SQL means transient failures (timeouts, constraint errors) throw and abort the entire webhook, with no recovery steps.
- **Email delivery** (`sendGiftCardIssuedEmail`, `sendReferralCodeEmail`): errors are logged but not escalated; missed emails are not retried.
- **Long-running handler** (~1,900 lines): sequential logic means any exception bubbles up, returns 500, and Square retries—but the code is not idempotent, risking duplicate gift cards or double `ADJUST_INCREMENT` loads.

## 4. Impact of Mid-Flow Failures

- **Friend gift card issuance failure:** customer misses $10 signup reward; `used_referral_code` may be recorded without gift card metadata, causing confusion and manual recovery.
- **Referrer reward failure:** referrer never receives $10 load, `total_referrals` may remain stale, and customer progression to referrer is blocked by `first_payment_completed` not being set.
- **Database partial updates:** if DB update succeeds but Square activation fails (or vice versa), future webhook retries will hit inconsistent state (e.g., `gift_card_id` saved but Square activation pending).
- **Email failure:** customers/referrers lack communication; system has no signal to re-send.

## 5. Observability & Controls Gaps

- Logging is verbose but unstructured (`console.log`). No correlation ID or job identifier across stages.
- No metrics/alerting around failure counts, retry attempts, or missing gift card metadata.
- No dead-letter storage for payloads that repeatedly fail.

## 6. Constraints & Opportunities for Resilience

- **Existing State:** `square_existing_clients` already stores rich metadata (`gift_card_*`, `total_*`, `personal_code`) that can serve as a checkpoint store for a resumable worker.
- **Idempotency Hooks:** Square APIs accept `idempotencyKey` per request but current code uses `Date.now()`—needs stable keys derived from correlation IDs to allow safe retries.
- **Webhook Retries:** Square replays failed events automatically, but without declarative stage management the handler cannot resume safely; introducing durable queue + state machine will mitigate.

## 7. Next Steps (Feeds Into Subsequent To-Dos)

1. Define correlation strategy (e.g., `eventId` + stage suffix) and persist per-run execution logs.
2. Model the flow as discrete stages (`customer_ingest`, `friend_reward`, `referrer_reward`, `referrer_promotion`) with explicit state transitions in a new `giftcard_runs` table/document.
3. Wrap Square/DB/email operations with retry-friendly, idempotent service functions before introducing a queue worker.

---

## 8. Implemented Idempotency & Run Tracking

- `giftcard_runs` table (Prisma) now persists correlation ID, stage, status, payload/context, attempts, and last error for every job.
- `lib/runs/giftcard-run-tracker.js` centralizes:
  - Correlation ID generation from Square event metadata.
  - Stage-scoped idempotency key derivation to keep retries safe across Square APIs.
  - Helpers to mark stages completed/failed and to increment attempt counters.
- `app/api/webhooks/square/referrals/route.js` integrates the helpers to:
  - Upsert run records at the start of each webhook (`customer.created`, `booking.created`, `payment.{created|updated}`).
  - Persist stage transitions (`friend_reward:issuing`, `referrer_reward:completed`, etc.) along with payload snapshots for resume logic.
  - Pass deterministic idempotency seeds into gift card creation, promotion orders, and owner-funded payment calls.

## 9. Durable Queue & Worker

- `giftcard_jobs` table stores queued work with per-stage dedupe (`correlationId + stage`), attempts, and exponential backoff scheduling.
- `lib/workflows/giftcard-job-queue.js` handles enqueueing, locking (with `FOR UPDATE SKIP LOCKED`), completion, and retry logic capped at 5 minutes between attempts.
- Webhook handler now enqueues jobs (responding `202 Accepted`) instead of running the flow inline; `giftcard_runs` stage is updated to `:*:queued` until processed.
- `scripts/giftcard-worker.js` polls the queue, resumes runs with the exported stage handlers, and records success/error back into both `giftcard_jobs` and `giftcard_runs`.
- Stage handlers (`processCustomerCreated`, `processBookingCreated`, `processPaymentCompletion`) are exported for reuse by the worker while remaining callable from tests or other orchestrators.
- Worker-side circuit breaker pauses problematic stages for 60s after three failed attempts, preventing hammering unstable downstream services while other stages continue draining.
- Jobs that exhaust `maxAttempts` settle in `giftcard_jobs.status = 'error'`, serving as a dead-letter queue for manual review and replay via future tooling.
- Operational procedures for replaying jobs, adjusting breakers, and monitoring logs are documented in `docs/giftcard_worker_runbook.md`.

## 10. Incremental Rollout Checklist

1. **Stage 0 – Schema Deploy**
   - Run `prisma migrate deploy` to create `giftcard_jobs`.
   - Verify Prisma client regeneration.
2. **Stage 1 – Dual-Run Webhook**
   - Deploy webhook changes; confirm events return `202`.
   - Monitor `giftcard_runs` rows progressing to `:queued`.
3. **Stage 2 – Shadow Worker**
   - Start worker in staging; ensure jobs drain successfully.
   - Validate structured logs and that `giftcard_jobs` empties.
4. **Stage 3 – Failure Drills**
   - Simulate Square outage (mock 500) and confirm:
     - Jobs retry with backoff.
     - Circuit breaker opens after 3 attempts.
     - DLQ entries appear when max attempts hit.
5. **Stage 4 – Production Cutover**
   - Launch worker in production.
   - Watch `giftcard.worker.job.failed`/`circuit_open` logs for first hour.
6. **Stage 5 – Post-Deploy Verification**
   - Spot check customer + referrer records for recent bookings/payments.
   - Re-run chaos drills quarterly to validate resilience path.



