# Security & Data Privacy

This document outlines the security measures, data handling policies, and anti-abuse mechanisms implemented to protect customer data and the salon's financial assets.

## 🔒 Data Privacy & PII Handling

The system handles **Personally Identifiable Information (PII)** including customer names, email addresses, phone numbers, and booking history.

### 1. Database Security
- **Data Isolation**: The system is multi-tenant. Every row in critical tables (Bookings, Payments, Rewards) is keyed by `organization_id`. Database queries must always include an `organization_id` filter to prevent cross-tenant data leakage.
- **Access Control**: Production database access is restricted to authorized personnel. Prisma ORM is used to prevent SQL injection attacks.

### 2. Logging & PII
- **Application Logs**: The `application_logs` table stores raw Square webhook payloads for audit purposes.
- **Risk**: These payloads contain raw PII. 
- **Mitigation**: 
    - **Log Retention**: A daily cron job (`/api/cron/cleanup-logs`) automatically deletes logs older than **30 days**.
    - **Restricted Access**: The `/api/debug-logs` and similar endpoints must be secured by `CRON_SECRET` or admin session checks.

---

## 🛡 Referral Anti-Abuse (Security)

To protect the salon from financial loss (estimated at over $5,000 previously), the following "Hardened" security rules are enforced:

### 1. Self-Referral Blocking
The system prevents a customer from using their own referral code to earn a reward.
- **Identity Check**: `customerId` is compared against `referrerId`.
- **Name-Code Matching**: The system checks if the referral code used is a derivative of the customer's own name (e.g., `ALI8814` for `Ali Lee`).
- **Fail-Closed Policy**: If the Square API fails during the security check (e.g., a 401 error), the reward is **blocked by default**.

### 2. New Customer Invariant
Rewards are only issued if the customer is **truly new**.
- **Chronological Check**: The system queries the `bookings` table for any successful appointments with a `start_at` time *before* the current referral event. 
- **Payment Check**: If a customer has paid for any service in the past, they are ineligible to use a referral code.

---

## 🔑 Authentication & API Security

### 1. Square API
- **Token Management**: The `SQUARE_ACCESS_TOKEN` is stored as an environment variable. 
- **Webhook Signatures**: Every incoming Square webhook is verified using `SQUARE_WEBHOOK_SIGNATURE_KEY`. Requests with missing or invalid signatures are rejected with a `401 Unauthorized` response.

### 2. Internal Cron Security
All cron endpoints (e.g., `/api/cron/*`) require a `Bearer` token matching the `CRON_SECRET` environment variable. This prevents external actors from triggering expensive analytics refreshes or reward issuance.

---

## 🆘 Security Incident Response
If a security vulnerability or data leak is suspected:
1.  **Rotate Tokens**: Immediately update `SQUARE_ACCESS_TOKEN` and `CRON_SECRET` in Vercel.
2.  **Clear Logs**: Run `DELETE FROM application_logs;` to remove all cached PII.
3.  **Audit Rewards**: Check `referral_rewards` for any suspicious patterns (e.g., one IP address triggering multiple rewards).

