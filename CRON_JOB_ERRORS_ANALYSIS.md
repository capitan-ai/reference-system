# Cron Job Errors Analysis

## Summary

Examined Vercel cron job logs and database errors. Found multiple issues affecting the `/api/cron/giftcard-jobs` endpoint.

## Cron Job Configuration

- **Endpoint**: `/api/cron/giftcard-jobs`
- **Schedule**: `* * * * *` (every minute)
- **Status**: Running, but encountering errors when processing jobs

## Current Status from Database

- **Queued Jobs**: 25 jobs (all `customer_ingest` stage)
- **Completed Jobs**: 1,682 jobs (660 booking.created, 86 customer.created, 936 payment.updated)
- **Error Jobs**: Multiple jobs with `customer_ingest` stage failing

## Primary Error: NOT NULL Constraint Violation (Code 23502)

### Error Details

All failing jobs show the same error:
```
Invalid `prisma.$executeRaw()` invocation:
Raw query failed. Code: `23502`. Message: `Failing row contains (...)`
```

### Root Cause

The `processCustomerCreated` function in `lib/webhooks/giftcard-processors.js` (lines 1537-1576) is missing the required `organization_id` field when inserting into `square_existing_clients` table.

**Schema Requirement:**
- `organization_id` is a required NOT NULL field (see `prisma/schema.prisma` line 118)
- It's a foreign key to the `organizations` table

**Current INSERT Statement (BROKEN):**
```sql
INSERT INTO square_existing_clients (
  square_customer_id,
  given_name,
  family_name,
  email_address,
  phone_number,
  -- MISSING: organization_id
  ...
) VALUES (...)
```

### Affected Jobs

At least 10 jobs are failing with this error:
- All are `customer_ingest` stage jobs
- All have exceeded max attempts (5-6 attempts)
- All are scheduled for retry 24 hours later (due to retry mechanism)

### Sample Failed Jobs

1. Job ID: `5137bc16-7d03-4f27-a005-041e7974d9a3`
   - Customer: Zoe Cohen (9JYYZT18SWZXQTNZGJ4E9HPA5G)
   - Attempts: 6/5
   - Created: 2026-01-22T04:56:25.243Z

2. Job ID: `ffa351e2-64e0-4d15-a979-c574f93b4eaa`
   - Customer: Stephanie Avendano (Z7YC3C4RKJB3RD4TFC9QW8YR9M)
   - Attempts: 6/5
   - Created: 2026-01-22T03:36:02.788Z

3. Job ID: `7ccc3c3f-d8ec-4d54-a076-fcee5ddc4958`
   - Customer: Sabrina Vicino (QKE3HF8JNEP5ACSSE8XY4A7JEM)
   - Attempts: 6/5
   - Created: 2026-01-22T03:33:22.019Z

## Secondary Issue: Transaction Timeout Errors

Found in `worker.log`:
- Multiple transaction timeout errors
- Error: "Transaction already closed: A commit cannot be executed on an expired transaction"
- Timeout: 5000ms, but transactions taking 5-82 seconds
- Location: `lockNextGiftCardJob` function in `lib/workflows/giftcard-job-queue.js`

**Example:**
```
Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction. 
The timeout for this transaction was 5000 ms, however 82458 ms passed since the start of the transaction.
```

## Cron Job Execution Status

From Vercel logs (most recent deployment):
- ✅ Cron job is running every minute
- ✅ Authentication is working (CRON_SECRET is set)
- ✅ Endpoint is accessible
- ⚠️ Jobs are being processed but many are failing
- ⚠️ When jobs fail, cron reports "no_job" because failed jobs are scheduled for future retry

## Recommendations

### 1. Fix the Missing `organization_id` Field (CRITICAL)

**File**: `lib/webhooks/giftcard-processors.js`
**Function**: `processCustomerCreated`
**Lines**: 1537-1576

**Fix Required:**
1. Determine the organization_id (likely from environment variable or context)
2. Add `organization_id` to the INSERT statement
3. Ensure it's also included in the ON CONFLICT UPDATE clause

**Example Fix:**
```javascript
const organizationId = process.env.ORGANIZATION_ID || runContext?.organizationId || 'default-org-id'

await prisma.$executeRaw`
  INSERT INTO square_existing_clients (
    organization_id,  // ADD THIS
    square_customer_id,
    given_name,
    ...
  ) VALUES (
    ${organizationId},  // ADD THIS
    ${customerId},
    ...
  )
  ON CONFLICT (square_customer_id) DO UPDATE SET
    ...
`
```

### 2. Increase Transaction Timeout

**File**: `lib/workflows/giftcard-job-queue.js`
**Function**: `lockNextGiftCardJob`
**Line**: 217

**Fix Required:**
Increase the transaction timeout from 5000ms to at least 30000ms (30 seconds):

```javascript
return await prisma.$transaction(async (tx) => {
  // ... transaction code
}, {
  isolationLevel: 'Serializable',
  timeout: 30000  // ADD THIS - increase from default 5000ms
})
```

### 3. Requeue Failed Jobs

After fixing the `organization_id` issue, manually requeue the failed jobs:

```sql
UPDATE giftcard_jobs
SET 
  status = 'queued',
  scheduled_at = NOW(),
  attempts = 0,
  last_error = NULL
WHERE status = 'error' 
  AND stage = 'customer_ingest'
  AND last_error LIKE '%23502%';
```

## Monitoring

To check cron job status:
1. **Admin Dashboard**: `/api/admin/jobs/status` endpoint
2. **Script**: `node scripts/check-job-status.js`
3. **Vercel Logs**: `vercel logs <deployment-url>`

## Next Steps

1. ✅ **Identified**: Missing `organization_id` in INSERT statement
2. ⏳ **Fix**: Add `organization_id` to `processCustomerCreated` function
3. ⏳ **Fix**: Increase transaction timeout
4. ⏳ **Test**: Verify fix with a test customer creation
5. ⏳ **Requeue**: Manually requeue failed jobs after fix
6. ⏳ **Monitor**: Watch for new errors after deployment



