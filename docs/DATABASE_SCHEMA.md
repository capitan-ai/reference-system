# Database Schema & Table Reference

This document provides a technical overview of all tables in the system, categorized by their functional domain.

## 👥 Customer & Staff Domain
Tables related to identity and profile management.

| Table | Purpose | Key Fields |
| :--- | :--- | :--- |
| `square_existing_clients` | Primary customer database. Mirror of Square profiles. | `square_customer_id`, `email_address`, `personal_code`, `got_signup_bonus` |
| `team_members` | Staff and technician directory. | `square_team_member_id`, `role`, `commission_rate` |
| `profiles` | Internal system user profiles for dashboard access. | `id`, `email`, `full_name` |
| `organizations` | Multi-tenant root table. | `id` (UUID), `square_merchant_id`, `settings` |

## 📅 Booking & Financial Domain
The raw data synchronized from Square.

| Table | Purpose | Key Fields |
| :--- | :--- | :--- |
| `bookings` | Individual service appointments. | `booking_id`, `start_at`, `status`, `technician_id` |
| `payments` | Financial transactions. | `payment_id`, `total_money_amount`, `tip_money_amount`, `status` |
| `orders` | Square orders containing line items. | `order_id`, `customer_id`, `location_id` |
| `order_line_items` | Individual items within an order (Services, Retail, Training). | `uid`, `name`, `total_money_amount` |
| `payment_tenders` | Payment method details (Card, Cash, Gift Card). | `type`, `amount_money_amount`, `gift_card_id` |

## 🎁 Referral & Reward Domain
Logic for invites, gift cards, and anti-abuse.

| Table | Purpose | Key Fields |
| :--- | :--- | :--- |
| `referral_rewards` | The source of truth for legitimate rewards. | `referrer_customer_id`, `referred_customer_id`, `status` (PAID/PENDING) |
| `referral_profiles` | Aggregated referral stats for the dashboard. | `square_customer_id`, `total_referrals_count`, `total_rewards_cents` |
| `gift_cards` | Local mirror of Square Gift Cards. | `square_gift_card_id`, `gift_card_gan`, `current_balance_cents` |
| `gift_card_transactions` | Financial ledger for all gift card balance changes. | `transaction_type` (CREATE/LOAD/REDEEM), `amount_cents` |
| `referral_carry_forward` | Tracks accidental credits for future "pre-earned" rewards. | `referrer_customer_id`, `status` (RESERVED/CONSUMED) |
| `square_gift_card_gan_audit` | Safety table for resolving card numbers (GANs). | `gift_card_id`, `resolved_gan` |

## 📈 Analytics & Earnings Domain
Aggregated data for high-performance reporting.

| Table | Purpose | Key Fields |
| :--- | :--- | :--- |
| `booking_snapshots` | Immutable record of price/commission at time of booking. | `price_snapshot_amount`, `commission_rate_snapshot`, `base_processed` |
| `master_earnings_ledger` | The financial source of truth for technician payouts. | `entry_type` (COMMISSION/TIP), `amount_amount` |
| `admin_analytics_daily` | Daily salon-wide performance KPIs. | `date_pacific`, `appointments_accepted`, `creator_revenue_cents` |
| `customer_analytics` | Customer lifecycle and segmentation data. | `customer_segment` (ACTIVE/LOST), `total_visits`, `gross_revenue_cents` |
| `master_performance_daily` | Individual technician efficiency and income stats. | `booked_minutes`, `utilization_rate`, `net_master_income` |

## ⚙️ System & Queue Domain
Background processing and audit logs.

| Table | Purpose | Key Fields |
| :--- | :--- | :--- |
| `application_logs` | The "Black Box" recorder for all system events. | `log_type`, `payload` (JSON), `status` |
| `giftcard_jobs` | The background task queue for reward issuance. | `stage`, `status`, `attempts`, `last_error` |
| `webhook_jobs` | Queue for processing and retrying Square webhooks. | `event_type`, `status`, `payload` |
| `notification_events` | History of all outgoing Emails and SMS. | `channel`, `templateType`, `status`, `externalId` |
| `custom_oauth_providers` | Configuration for Square OAuth 2.0 connections. | `client_id`, `scopes`, `enabled` |


