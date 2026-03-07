# Referral System Remediation & Recovery Report
**Date:** March 6, 2026
**Status:** In Progress (Critical Fixes Deployed)

## 1. Executive Summary
Following a deep forensic audit of the referral system, we identified a logic gap that allowed customers to receive rewards by referring themselves. We discovered **541 self-referrals** who received accidental $10 gift cards, totaling **$5,410.00** in issued credit. Only **$70.00** has been spent to date. We have implemented strict security to stop new self-referrals and designed a "Carry-Forward" plan to recover the remaining **$5,340.00**.

## 2. Audit Results (October 2025 – March 2026)
We scanned all 7,965 customers in the database using Square's Custom Attributes API.

### 2.1 Self-Referrals (The "Accidental" Rewards)
- **Count**: 541 customers
- **Issue**: These clients typed their own personal code or name into the Square booking page.
- **Status**: Most received a $10 gift card accidentally because the system "failed open" during API errors.
- **Example**: A customer used their own personal code (e.g., `NAME1234`) and was accidentally rewarded.
- **Data Source**: `final_self_referrals.json` (Ignored by git)

### 2.2 True Referrals (The "Valid" New Clients)
- **Count**: 15 customers
- **Status**: These are high-value legitimate referrals where Person A invited Person B.
- **Action**: These 15 records are being backfilled into the `referral_rewards` table for accurate dashboard reporting.
- **Data Source**: `final_true_referrals.json` (Ignored by git)

## 3. Root Cause Analysis
The failure was a "Perfect Storm" of three factors:
1. **API Authentication Instability**: Intermittent `401 Unauthorized` errors from Square caused the system to be "blind" to referral codes during the check.
2. **Fail-Open Logic**: If the check failed due to an API error, the system assumed the referral was valid and continued.
3. **Worker Logic Gap**: The background worker issued gift cards without a final identity check, allowing self-referrals to bypass the system.

## 4. Completed Fixes (Production Hardening)
The following changes are now live:
- **Strict Blocking**: Added `return` statements to stop issuance immediately if `customerId === referrerId`.
- **Fail-Closed Design**: Any API error during validation now results in a "Blocked" state.
- **Atomic Locking**: The system now saves the reward record to the database **before** calling SendGrid, preventing duplicate emails.
- **Multi-Email Fix**: Resolved the loop that caused clients like Sophie Bunton to receive 7+ duplicate emails.

## 5. Remediation Plan: "The Carry-Forward"
Instead of deactivating accidental cards, we will convert them into "Pre-Earned" rewards.

### 5.1 Target Data Model
A new `ReferralCarryForward` table will track these credits:
```prisma
model ReferralCarryForward {
  id                         String   @id @default(uuid())
  referrer_customer_id       String   @unique
  status                     CarryForwardStatus @default(RESERVED)
  gift_card_id               String
  origin                     String   // "SELF_REFERRAL_REMEDIATION_2026_03"
  seeded_at                  DateTime @default(now())
  consumed_by_reward_id      String?  @unique
}

enum CarryForwardStatus {
  RESERVED    // Credit is waiting for a real referral
  CONSUMED    // Matched to a real referral (No new payout)
  INVALIDATED // Card was spent before a real referral happened
}
```

### 5.2 Consumption Logic (The "Skip" Rule)
When a legitimate referral qualifies:
1. **Check**: Does the referrer have a `RESERVED` carry-forward?
2. **Atomic Update**: Transition status to `CONSUMED` only if it is currently `RESERVED`.
3. **Fulfillment**: Link the old gift card to the new referral. Skip the Square API call to add more money.
4. **Exit**: The customer is notified they "earned" their reward, but the salon pays $0.

## 6. Rollout Plan
1. [ ] **Database Migration**: Create the `ReferralCarryForward` table.
2. [ ] **Seeding**: Populate the table with the 518 eligible customers (those with full $10 balances).
3. [ ] **Logic Update**: Update the worker to check the carry-forward table before issuing new funds.

