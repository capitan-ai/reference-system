# Multi-Tenant & Scaling Roadmap

This document outlines the strategy for evolving the system into a full multi-tenant CRM and automating salon onboarding.

## 🏢 Multi-Organization Scaling

Currently, new salon locations are added manually via `location-map.js`. The roadmap for automation includes:

### 1. Automated Onboarding Flow
- **Self-Service Portal**: A dashboard where new salon owners can sign up.
- **Square OAuth 2.0 Integration**: Replace the current manual token system with a "Connect to Square" button.
    - System will automatically exchange the authorization code for an `access_token` and `refresh_token`.
    - Tokens will be stored securely in the `organizations` table.
- **Automatic Discovery**: Upon connection, the system will call Square's `ListLocations` API to automatically populate the `locations` table, removing the need for manual mapping.

### 2. Multi-Tenant Architecture
- **Data Isolation**: All tables (Bookings, Payments, Rewards) are already keyed by `organization_id`. 
- **Tenant-Specific Logic**: Future support for custom reward amounts ($5 vs $10) and custom email templates per organization.

## 🤖 Automation & Reliability

### 1. Unified OAuth Management
- Move away from n8n for token management.
- Implement a background worker to handle token refreshing (Square tokens expire every 30 days).
- **Table**: `custom_oauth_providers` (already exists in schema) will be used to manage these connections.

### 2. Intelligent Notification Retries
- **Email -> SMS Fallback**: If SendGrid returns a permanent failure (e.g., email bounced or blocked), the system will check for a valid phone number in `square_existing_clients`.
- **Automatic Retry**: If the error is transient (e.g., SendGrid rate limit), the job will be re-queued in `giftcard_jobs` with exponential backoff.

## 📈 CRM Evolution
- **Chat Agent Integration**: Expanding the current dashboard agent to handle customer inquiries directly using the synchronized Square data.
- **Automated Marketing**: Using the "At Risk" and "Lost" segments to trigger automated re-engagement campaigns (SMS/Email).

## 🔌 Database Optimization (Supabase)
As the system scales to hundreds of salons:
- **Connection Pooling**: Always use the Transaction mode port (6543) for Supabase to handle high-concurrency serverless functions.
- **Read Replicas**: Consider offloading analytics queries to a read-only replica if dashboard performance slows down.

