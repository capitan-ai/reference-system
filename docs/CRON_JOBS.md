# Cron & Background Jobs

The system relies on scheduled cron jobs to process queues, calculate earnings, and refresh analytics.

## ⏰ Cron Schedule (Vercel)

| Path | Frequency | Purpose |
| :--- | :--- | :--- |
| `/api/cron/giftcard-jobs` | Every minute | Processes the reward issuance queue. |
| `/api/cron/webhook-jobs` | Every minute | Processes retries for failed webhooks. |
| `/api/cron/master-earnings` | Hourly | Calculates commissions and tips into the Ledger. |
| `/api/cron/refresh-customer-analytics` | Hourly | Updates customer segments (Active, Lost, etc.). |
| `/api/cron/refresh-admin-analytics` | Hourly | Aggregates daily salon performance KPIs. |
| `/api/cron/cleanup-logs` | Daily | Deletes logs older than 30 days to save DB space. |

## 👷 Background Workers

### 1. Gift Card Worker
- **File**: `lib/workers/giftcard-job-runner.js`
- **Stages**: `customer_ingest`, `booking`, `payment`, `send_notification`.
- **Retry Logic**: Exponential backoff. After 3 failed attempts, the "Circuit Breaker" opens to prevent API spam.

### 2. Master Earnings Worker
- **File**: `lib/workers/master-earnings-worker.js`
- **Logic**: Atomic transactions to ensure commissions are never double-counted.

## 🛠 Queue Management

### Monitoring the Queue
Use this query to see the current state of background jobs:
```sql
SELECT stage, status, attempts, last_error, updated_at 
FROM giftcard_jobs 
WHERE status != 'completed' 
ORDER BY updated_at DESC;
```

### Manually Restarting a Job
If a job is stuck in `error` state, you can reset it to `queued`:
```sql
UPDATE giftcard_jobs 
SET status = 'queued', attempts = 0 
WHERE id = 'JOB_UUID';
```

## 🆘 Troubleshooting
- **Cron Not Triggering**: Verify `CRON_SECRET` matches between Vercel and the environment.
- **Worker Timeout**: Vercel functions have a 30s limit. If a batch is too large, it may timeout. The worker is designed to process 10 jobs per run to avoid this.
- **Database Locks**: Multi-minute cron jobs can cause "Too many connections" errors. Ensure `prisma.$disconnect()` is called in the `finally` block.

