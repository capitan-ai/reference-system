# Gift Card Worker Runbook

## Purpose
- Processes queued gift-card flows asynchronously (`giftcard_jobs` table)
- Guarantees resume/retry behaviour after transient failures
- Emits structured logs for observability (`event`, `correlationId`, `stage`, `workerId`)

## Starting / Stopping the Worker
- Run locally: `node scripts/giftcard-worker.js`
- Recommended env:
  - `GIFTCARD_WORKER_ID` (optional human-friendly identifier)
  - `GIFTCARD_WORKER_POLL_MS` (default `2000`)
  - `GIFTCARD_WORKER_BREAKER_MS` (default `60000`)
- Graceful shutdown: send `SIGINT`/`SIGTERM`; worker drains current job then exits

## Monitoring & Telemetry
- Structured logs:
  - `giftcard.job.enqueued` from webhook
  - `giftcard.worker.job.start|completed|failed`
  - `giftcard.worker.circuit_open` when breaker trips (stage paused)
  - `giftcard.worker.loop_error` for unexpected poller issues
- Suggested alerts:
  - Log count of `giftcard.worker.job.failed` > 3 per 5 min
  - Presence of `giftcard.worker.circuit_open` events
  - `giftcard_jobs` rows with `status = 'error'`

## Dead-Letter Queue (DLQ)
- `giftcard_jobs.status = 'error'` represents DLQ entries
- Inspect payload/context:
  ```sql
  SELECT id, correlation_id, stage, attempts, last_error, payload
  FROM giftcard_jobs
  WHERE status = 'error'
  ORDER BY updated_at DESC;
  ```
- To requeue after fix:
  ```sql
  UPDATE giftcard_jobs
  SET status = 'queued',
      scheduled_at = NOW(),
      attempts = 0,
      last_error = NULL
  WHERE id = $JOB_ID;
  ```

## Circuit Breaker Behaviour
- After 3 consecutive failures on the same stage, worker opens circuit for `GIFTCARD_WORKER_BREAKER_MS`
- While open, jobs for that stage remain in queue; other stages continue
- Logs `giftcard.worker.circuit_open` with cooldown duration
- Manual override: update `giftcard_jobs.scheduled_at` if you want to delay/resume specific jobs longer

## Manual Job Execution (One-off)
- Fetch job payload: `SELECT payload FROM giftcard_jobs WHERE id = $JOB_ID;`
- Run stage handler manually (Node REPL or script) by importing from `app/api/webhooks/square/referrals/route.js`
- If successful, mark job `completed` to avoid reprocessing

## Incident Response Checklist
1. Check `giftcard.worker.job.failed` logs for correlation IDs
2. Inspect matching `giftcard_runs` for stage + error details
3. Validate Square service health / credentials (access token, network)
4. If recurring platform outage, leave circuit open and notify stakeholders
5. Once fixed, requeue DLQ jobs and monitor for `completed` logs



