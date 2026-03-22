# Debugging & Observability

This guide explains how to trace events and diagnose issues using the system's built-in logging.

## 📓 The Application Log
The `application_logs` table is the system's "Black Box." It records almost every significant action.

### Log Types
- `webhook`: Raw payload and processing status of incoming Square events.
- `structured`: High-level events (e.g., `giftcard.worker.job.start`).
- `cron`: Start/Stop times and results of scheduled jobs.
- `error`: Detailed stack traces for failures.

## 🔍 Common Debugging Scenarios

### 1. Tracing a Customer's Journey
If a customer claims they didn't get a reward, search by their Square Customer ID:
```sql
SELECT log_type, status, payload, created_at 
FROM application_logs 
WHERE payload::text LIKE '%CUSTOMER_ID%' 
ORDER BY created_at DESC;
```

### 2. Identifying Self-Referral Blocks
To see who was blocked by the anti-abuse logic:
```sql
SELECT payload->>'customerId' as customer, payload->>'reason' as reason, created_at 
FROM application_logs 
WHERE payload->>'reason' = 'self_referral' 
ORDER BY created_at DESC;
```

### 3. Checking API Failures
Find all 401 (Unauthorized) or 429 (Rate Limit) errors from Square:
```sql
SELECT log_id, payload->>'message' as error, created_at 
FROM application_logs 
WHERE payload::text LIKE '%401%' OR payload::text LIKE '%429%' 
ORDER BY created_at DESC;
```

## 🛠 Debugging Endpoints
The system includes several "Hidden" API routes for testing:
- `/api/debug-sendgrid-status`: Verifies SendGrid API connectivity.
- `/api/debug-square`: Tests Square API token validity.
- `/api/health/db`: Confirms database connection pool status.

## ⚠️ Important Note on PII
Logs contain **Personally Identifiable Information** (names, emails). Access to the `application_logs` table should be restricted to authorized administrators only.


