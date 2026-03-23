-- Prevent race condition: only one reward per (org, referred customer, reward type)
-- This stops duplicate $10 payouts if two payments arrive simultaneously
ALTER TABLE "public"."referral_rewards"
ADD CONSTRAINT "uq_referral_reward_per_referred"
UNIQUE ("organization_id", "referred_customer_id", "reward_type");
