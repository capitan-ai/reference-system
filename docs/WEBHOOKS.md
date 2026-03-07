# Webhook Architecture

Webhooks are the primary data entry point for the system. They ensure our database stays in sync with Square.

## 📡 Webhook Entrypoint
**URL**: `/api/webhooks/square`
**Handlers**: 
- `app/api/webhooks/square/route.js` (Primary)
- `app/api/webhooks/square/referrals/route.js` (Referral-specific)

## 🛠 Reliability Features

### 1. Signature Verification
All incoming requests must be signed by Square. The system verifies the `x-square-hmacsha256-signature` header using the `SQUARE_WEBHOOK_SIGNATURE_KEY`.

### 2. Idempotency
To prevent duplicate processing (e.g., Square sending the same event twice), every event is checked against the `application_logs` or `giftcard_runs` table using the Square `event_id`.

### 3. Async Queueing (Fail-Safe)
If a webhook requires heavy processing (like issuing a gift card), the handler:
1.  Saves the raw payload to `application_logs`.
2.  Enqueues a job in `giftcard_jobs`.
3.  Returns `202 Accepted` immediately to Square.
4.  The background worker processes the job later.

## 🔄 Event Mapping

| Square Event | System Action | Source of Truth |
| :--- | :--- | :--- |
| `booking.created` | Creates `Booking` & `BookingSnapshot` | `bookings` table |
| `payment.updated` | Updates `Payment`, triggers Referral Reward | `payments` table |
| `customer.created` | Syncs profile to `square_existing_clients` | `square_existing_clients` |
| `order.updated` | Syncs `Order` and `OrderLineItem` | `orders` table |

## 🆘 Debugging Webhooks

### 1. Trace an Event
Find the raw payload and status for a specific Square Event ID:
```sql
SELECT status, payload, created_at 
FROM application_logs 
WHERE log_id = 'SQUARE_EVENT_ID';
```

### 2. Check for "Stuck" Jobs
If a webhook was received but the action didn't happen, check the job queue:
```sql
SELECT stage, status, last_error 
FROM giftcard_jobs 
WHERE status = 'error';
```

## ⚠️ Common Issues
- **401 Errors**: Webhook handler failed to fetch additional data from Square API (Token issue).
- **Missing Organization ID**: Webhook couldn't determine which salon location the event belonged to.
- **Race Conditions**: Two webhooks for the same order arriving simultaneously. (Handled by database unique constraints).

