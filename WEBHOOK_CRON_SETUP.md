# Webhook Cron Job Setup

## Overview

This document explains the webhook cron job system that processes failed webhooks and ensures all 12 webhook event types are properly handled.

## Components Created

### 1. Database Schema (`prisma/schema.prisma`)

Added:
- `WebhookJob` model - stores webhook jobs for retry processing
- `WebhookJobStatus` enum - queued, processing, completed, error

### 2. Webhook Job Queue (`lib/workflows/webhook-job-queue.js`)

Functions:
- `enqueueWebhookJob()` - Add a failed webhook to the retry queue
- `lockNextWebhookJob()` - Get next job to process (with locking)
- `completeWebhookJob()` - Mark job as completed
- `failWebhookJob()` - Mark job as failed and schedule retry with exponential backoff

### 3. Webhook Job Runner (`lib/workers/webhook-job-runner.js`)

Functions:
- `runWebhookJobOnce()` - Process a single webhook job from the queue
- Routes to appropriate handler based on event type

### 4. Cron Endpoint (`app/api/cron/webhook-jobs/route.js`)

- Runs every minute (configured in `vercel.json`)
- Processes up to 10 webhook jobs per run (configurable via `WEBHOOK_JOBS_PER_CRON_RUN` env var)
- Uses same authorization as giftcard-jobs cron

### 5. Vercel Configuration (`vercel.json`)

Added cron schedule:
```json
{
  "path": "/api/cron/webhook-jobs",
  "schedule": "* * * * *"
}
```

## How It Works

### 1. Webhook Receives Event

When a webhook is received in `app/api/webhooks/square/route.js`:
- Tries to process immediately
- If successful: returns 200 OK
- If fails: enqueues job and returns 500 (Square will also retry)

### 2. Failed Webhooks Enqueued

Failed webhooks are added to `webhook_jobs` table with:
- `status = 'queued'`
- `scheduled_at = now() + backoff_delay` (exponential backoff)
- `attempts = 0`
- `max_attempts = 5` (default)

### 3. Cron Job Processes Queue

Every minute, the cron endpoint:
1. Locks next available job (where `scheduled_at <= now()`)
2. Calls appropriate handler from `webhook-processors.js`
3. Marks as completed or failed (with retry scheduling)

### 4. Retry Logic

- **Attempt 1**: 5 second delay
- **Attempt 2**: 10 second delay
- **Attempt 3**: 20 second delay
- **Attempt 4**: 40 second delay
- **Attempt 5**: 80 second delay (max 5 minutes)
- **After 5 attempts**: Status = 'error' (requires manual intervention)

## Supported Webhook Events

All 12 event types are supported:

1. `booking.created` → `bookings` table
2. `booking.updated` → `bookings` table
3. `customer.created` → `square_existing_clients` table
4. `payment.updated` → `payments` table
5. `gift_card.activity.created` → `gift_card_transactions` table
6. `gift_card.activity.updated` → `gift_card_transactions` table
7. `gift_card.customer_linked` → `gift_cards` table
8. `gift_card.updated` → `gift_cards` table
9. `refund.created` → `payments.refund_ids` array
10. `refund.updated` → `payments.refund_ids` array
11. `order.updated` → `orders` table
12. `team_member.created` → `team_members` table

## Next Steps

### 1. Create Migration

Run Prisma migration to create the `webhook_jobs` table:

```bash
npx prisma migrate dev --name add_webhook_jobs
```

### 2. Create Webhook Processors

Create `app/api/webhooks/square/webhook-processors.js` with handlers for all 12 event types. See the proposed structure in the previous conversation.

### 3. Test the System

1. Trigger a webhook that will fail
2. Check `webhook_jobs` table - should see queued job
3. Wait for cron to run (or trigger manually)
4. Verify job is processed

### 4. Monitor

Check webhook job status:
```sql
-- Queued jobs
SELECT * FROM webhook_jobs WHERE status = 'queued' ORDER BY scheduled_at ASC;

-- Failed jobs (need manual intervention)
SELECT * FROM webhook_jobs WHERE status = 'error' ORDER BY updated_at DESC;

-- Processing jobs (stuck jobs)
SELECT * FROM webhook_jobs WHERE status = 'processing' AND locked_at < NOW() - INTERVAL '10 minutes';
```

## Environment Variables

- `WEBHOOK_JOBS_PER_CRON_RUN` - Max jobs to process per cron run (default: 10)
- `CRON_SECRET` - Secret for cron endpoint authorization (shared with giftcard-jobs)

## Manual Job Management

### Requeue a failed job:
```sql
UPDATE webhook_jobs
SET status = 'queued',
    scheduled_at = NOW(),
    attempts = 0,
    last_error = NULL
WHERE id = 'JOB_ID';
```

### Requeue all failed jobs:
```sql
UPDATE webhook_jobs
SET status = 'queued',
    scheduled_at = NOW(),
    attempts = 0,
    last_error = NULL
WHERE status = 'error';
```


