/**
 * Referral Analytics Daily Refresh
 *
 * Refreshes referral_analytics_daily with aggregates and details (names) per (organization_id, date_pacific).
 * Timezone: America/Los_Angeles for all date conversions.
 *
 * @see .cursor/plans/referral_analytics_march_implementation_6e92e1ab.plan.md
 *
 * Pacific calendar date from timestamptz: (col AT TIME ZONE 'America/Los_Angeles')::date
 * (Avoid `AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles'` — it buckets many events on the wrong day.)
 */

/**
 * Refresh referral_analytics_daily for date range.
 *
 * @param {object} db - Prisma client
 * @param {string} dateFrom - SQL expression e.g. "'2026-03-01 00:00:00'" or "NOW() - interval '35 days'"
 * @param {string} dateTo - SQL expression e.g. "'2026-04-01 00:00:00'" or "NOW() + interval '1 day'"
 * @returns {{ rowsWritten: number }}
 */
async function refreshReferralAnalytics(db, dateFrom, dateTo) {
  const refreshSQL = `
    WITH date_range AS (
      SELECT
        (${dateFrom})::timestamptz AS start_limit,
        (${dateTo})::timestamptz AS end_limit
    ),

    -- 1. New customers via referral (customer_analytics + square_existing_clients)
    -- Exclude self referrals: used_referral_code must not belong to the same customer
    new_customers_agg AS (
      SELECT
        ca.organization_id,
        (ca.first_visit_at AT TIME ZONE 'America/Los_Angeles')::date AS date_pacific,
        COUNT(*)::int AS new_customers_via_referral,
        COALESCE(
          json_agg(
            json_build_object(
              'square_customer_id', ca.square_customer_id,
              'given_name', ca.given_name,
              'family_name', ca.family_name,
              'used_referral_code', sec.used_referral_code,
              'first_visit_at', ca.first_visit_at
            )
            ORDER BY ca.first_visit_at
          ) FILTER (WHERE ca.square_customer_id IS NOT NULL),
          '[]'::json
        ) AS new_customers_json
      FROM customer_analytics ca
      JOIN square_existing_clients sec
        ON sec.organization_id = ca.organization_id
        AND sec.square_customer_id = ca.square_customer_id
      CROSS JOIN date_range dr
      WHERE sec.used_referral_code IS NOT NULL
        AND ca.first_visit_at IS NOT NULL
        AND ca.first_visit_at >= dr.start_limit
        AND ca.first_visit_at < dr.end_limit
        AND NOT EXISTS (
          SELECT 1 FROM referral_profiles rp_owner
          WHERE rp_owner.organization_id = ca.organization_id
            AND rp_owner.square_customer_id = ca.square_customer_id
            AND (LOWER(COALESCE(rp_owner.personal_code, '')) = LOWER(sec.used_referral_code)
                 OR LOWER(COALESCE(rp_owner.referral_code, '')) = LOWER(sec.used_referral_code))
        )
        AND NOT EXISTS (
          SELECT 1 FROM square_existing_clients sec_owner
          WHERE sec_owner.organization_id = ca.organization_id
            AND sec_owner.square_customer_id = ca.square_customer_id
            AND LOWER(COALESCE(sec_owner.personal_code, '')) = LOWER(sec.used_referral_code)
        )
        -- Manual exclusion: Irene Cruz used IRENE3104 (same person, different Square ID)
        AND NOT (ca.square_customer_id = 'WZ3WM22Y9D1139V9DCW56WX4Y0' AND sec.used_referral_code = 'IRENE3104')
      GROUP BY ca.organization_id, (ca.first_visit_at AT TIME ZONE 'America/Los_Angeles')::date
    ),

    -- 2a. Referrer rewards: referrer got $10 when referred customer paid for booking
    -- Deduplicate by (referrer, referred) so each referred person appears once per referrer
    rewards_deduped AS (
      SELECT DISTINCT ON (rr.organization_id, rr.referrer_customer_id, rr.referred_customer_id, (rr.created_at AT TIME ZONE 'America/Los_Angeles')::date)
        rr.id, rr.organization_id, rr.referrer_customer_id, rr.referred_customer_id,
        rr.reward_amount_cents, rr.status, rr.created_at, rr.payment_id, rr.booking_id
      FROM referral_rewards rr
      CROSS JOIN date_range dr
      WHERE rr.reward_type = 'referrer_reward'
        AND rr.created_at >= dr.start_limit
        AND rr.created_at < dr.end_limit
        AND rr.referrer_customer_id <> rr.referred_customer_id
      ORDER BY rr.organization_id, rr.referrer_customer_id, rr.referred_customer_id, (rr.created_at AT TIME ZONE 'America/Los_Angeles')::date, rr.created_at
    ),
    rewards_agg AS (
      SELECT
        rd.organization_id,
        (rd.created_at AT TIME ZONE 'America/Los_Angeles')::date AS date_pacific,
        COUNT(DISTINCT COALESCE(sec.personal_code, rp.personal_code, rd.referrer_customer_id))::int AS unique_codes_rewarded,
        COUNT(*) FILTER (WHERE rd.status = 'PAID')::int AS referrer_rewards_count,
        COALESCE(SUM(rd.reward_amount_cents) FILTER (WHERE rd.status = 'PAID'), 0)::int AS rewards_issued_cents,
        COALESCE(
          json_agg(
            json_build_object(
              'id', rd.id,
              'reward_type', 'referrer_reward',
              'recipient', 'referrer',
              'referrer_code', COALESCE(sec.personal_code, rp.personal_code),
              'referrer_name', TRIM(COALESCE(sec.given_name, '') || ' ' || COALESCE(sec.family_name, '')),
              'referred_name', TRIM(COALESCE(sec_ref.given_name, '') || ' ' || COALESCE(sec_ref.family_name, '')),
              'reward_amount_cents', rd.reward_amount_cents,
              'status', rd.status,
              'created_at', rd.created_at,
              'payment_id', rd.payment_id,
              'booking_id', rd.booking_id
            )
            ORDER BY rd.created_at
          ) FILTER (WHERE rd.id IS NOT NULL),
          '[]'::json
        ) AS rewards_json
      FROM rewards_deduped rd
      LEFT JOIN square_existing_clients sec
        ON sec.square_customer_id = rd.referrer_customer_id AND sec.organization_id = rd.organization_id
      LEFT JOIN referral_profiles rp
        ON rp.square_customer_id = rd.referrer_customer_id AND rp.organization_id = rd.organization_id
      LEFT JOIN square_existing_clients sec_ref
        ON sec_ref.square_customer_id = rd.referred_customer_id AND sec_ref.organization_id = rd.organization_id
      GROUP BY rd.organization_id, (rd.created_at AT TIME ZONE 'America/Los_Angeles')::date
    ),

    -- 2b. Friend signup bonuses: new client got $10 when they used referral code and paid
    friend_signup_deduped AS (
      SELECT DISTINCT ON (rr.organization_id, rr.referrer_customer_id, rr.referred_customer_id, (rr.created_at AT TIME ZONE 'America/Los_Angeles')::date)
        rr.id, rr.organization_id, rr.referrer_customer_id, rr.referred_customer_id,
        rr.reward_amount_cents, rr.status, rr.created_at, rr.payment_id, rr.booking_id
      FROM referral_rewards rr
      CROSS JOIN date_range dr
      WHERE rr.reward_type = 'friend_signup_bonus'
        AND rr.created_at >= dr.start_limit
        AND rr.created_at < dr.end_limit
        AND rr.referrer_customer_id <> rr.referred_customer_id
      ORDER BY rr.organization_id, rr.referrer_customer_id, rr.referred_customer_id, (rr.created_at AT TIME ZONE 'America/Los_Angeles')::date, rr.created_at
    ),
    friend_signup_agg AS (
      SELECT
        fd.organization_id,
        (fd.created_at AT TIME ZONE 'America/Los_Angeles')::date AS date_pacific,
        COUNT(*)::int AS friend_signup_bonuses_count,
        COALESCE(SUM(fd.reward_amount_cents) FILTER (WHERE fd.status = 'PAID'), 0)::int AS friend_signup_bonuses_cents,
        COALESCE(
          json_agg(
            json_build_object(
              'id', fd.id,
              'reward_type', 'friend_signup_bonus',
              'recipient', 'new_client',
              'new_client_name', TRIM(COALESCE(sec_ref.given_name, '') || ' ' || COALESCE(sec_ref.family_name, '')),
              'used_referral_code', COALESCE(sec.personal_code, rp.personal_code),
              'referrer_name', TRIM(COALESCE(sec.given_name, '') || ' ' || COALESCE(sec.family_name, '')),
              'reward_amount_cents', fd.reward_amount_cents,
              'status', fd.status,
              'created_at', fd.created_at,
              'payment_id', fd.payment_id,
              'booking_id', fd.booking_id
            )
            ORDER BY fd.created_at
          ) FILTER (WHERE fd.id IS NOT NULL),
          '[]'::json
        ) AS friend_signup_json
      FROM friend_signup_deduped fd
      LEFT JOIN square_existing_clients sec
        ON sec.square_customer_id = fd.referrer_customer_id AND sec.organization_id = fd.organization_id
      LEFT JOIN referral_profiles rp
        ON rp.square_customer_id = fd.referrer_customer_id AND rp.organization_id = fd.organization_id
      LEFT JOIN square_existing_clients sec_ref
        ON sec_ref.square_customer_id = fd.referred_customer_id AND sec_ref.organization_id = fd.organization_id
      GROUP BY fd.organization_id, (fd.created_at AT TIME ZONE 'America/Los_Angeles')::date
    ),

    -- 3. Notification events (emails sent)
    emails_agg AS (
      SELECT
        organization_id,
        (COALESCE("sentAt", "createdAt") AT TIME ZONE 'America/Los_Angeles')::date AS date_pacific,
        COALESCE(SUM(CASE WHEN "templateType" = 'REFERRAL_INVITE' THEN 1 ELSE 0 END), 0)::int AS emails_referral_invite_sent,
        COALESCE(SUM(CASE WHEN "templateType" = 'FRIEND_ACTIVATION' THEN 1 ELSE 0 END), 0)::int AS emails_friend_activation_sent,
        COALESCE(SUM(CASE WHEN "templateType" = 'REFERRER_ACTIVATION' THEN 1 ELSE 0 END), 0)::int AS emails_referrer_activation_sent
      FROM notification_events
      CROSS JOIN date_range dr
      WHERE "status" = 'sent'
        AND "templateType" IN ('REFERRAL_INVITE', 'FRIEND_ACTIVATION', 'REFERRER_ACTIVATION')
        AND COALESCE("sentAt", "createdAt") >= dr.start_limit
        AND COALESCE("sentAt", "createdAt") < dr.end_limit
      GROUP BY organization_id, (COALESCE("sentAt", "createdAt") AT TIME ZONE 'America/Los_Angeles')::date
    ),

    -- 4. Wallet activations (device_pass_registrations; gift_cards.wallet_activated_at when backfilled)
    wallet_agg AS (
      SELECT
        gc.organization_id,
        (dpr."createdAt" AT TIME ZONE 'America/Los_Angeles')::date AS date_pacific,
        COUNT(DISTINCT gc.id)::int AS wallet_activations_count
      FROM gift_cards gc
      JOIN device_pass_registrations dpr ON dpr."serialNumber" = gc.gift_card_gan
      CROSS JOIN date_range dr
      WHERE gc.reward_type IN ('FRIEND_SIGNUP_BONUS', 'REFERRER_REWARD')
        AND dpr."createdAt" >= dr.start_limit
        AND dpr."createdAt" < dr.end_limit
      GROUP BY gc.organization_id, (dpr."createdAt" AT TIME ZONE 'America/Los_Angeles')::date
    ),

    -- 5. Redemptions (gift_card_transactions REDEEM minus REFUND)
    redemptions_agg AS (
      SELECT
        gc.organization_id,
        (t.created_at AT TIME ZONE 'America/Los_Angeles')::date AS date_pacific,
        COUNT(*) FILTER (WHERE t.transaction_type = 'REDEEM')::int AS redemptions_count,
        GREATEST(
          COALESCE(SUM(ABS(t.amount_cents)) FILTER (WHERE t.transaction_type = 'REDEEM'), 0)
          - COALESCE(SUM(ABS(t.amount_cents)) FILTER (WHERE t.transaction_type = 'REFUND'), 0),
          0
        )::int AS redemptions_cents
      FROM gift_card_transactions t
      JOIN gift_cards gc ON gc.id = t.gift_card_id
      CROSS JOIN date_range dr
      WHERE t.transaction_type IN ('REDEEM', 'REFUND')
        AND gc.reward_type IN ('FRIEND_SIGNUP_BONUS', 'REFERRER_REWARD')
        AND t.created_at >= dr.start_limit
        AND t.created_at < dr.end_limit
      GROUP BY gc.organization_id, (t.created_at AT TIME ZONE 'America/Los_Angeles')::date
    ),

    -- Union all keys (org, date)
    all_keys AS (
      SELECT organization_id, date_pacific FROM new_customers_agg
      UNION
      SELECT organization_id, date_pacific FROM rewards_agg
      UNION
      SELECT organization_id, date_pacific FROM friend_signup_agg
      UNION
      SELECT organization_id, date_pacific FROM emails_agg
      UNION
      SELECT organization_id, date_pacific FROM wallet_agg
      UNION
      SELECT organization_id, date_pacific FROM redemptions_agg
    ),
    keys AS (
      SELECT DISTINCT organization_id, date_pacific FROM all_keys
    ),

    -- Build details_json: new_customers + referrer_rewards + friend_signup_bonuses
    -- new_customers: clients who used referral code on first visit (for "New Customers via Referral" list)
    -- referrer_rewards: referrer got $10 (for per-referrer "Referred Customers" - do NOT merge with new_customers)
    -- friend_signup_bonuses: new client got $10
    details_merged AS (
      SELECT
        k.organization_id,
        k.date_pacific,
        json_build_object(
          'new_customers', COALESCE(
            (SELECT new_customers_json FROM new_customers_agg n WHERE n.organization_id = k.organization_id AND n.date_pacific = k.date_pacific),
            '[]'::json
          ),
          'referrer_rewards', COALESCE(
            (SELECT rewards_json FROM rewards_agg r WHERE r.organization_id = k.organization_id AND r.date_pacific = k.date_pacific),
            '[]'::json
          ),
          'friend_signup_bonuses', COALESCE(
            (SELECT friend_signup_json FROM friend_signup_agg f WHERE f.organization_id = k.organization_id AND f.date_pacific = k.date_pacific),
            '[]'::json
          )
        ) AS details_json
      FROM keys k
    )

    INSERT INTO referral_analytics_daily (
      organization_id,
      date_pacific,
      new_customers_via_referral,
      unique_codes_rewarded,
      rewards_issued_cents,
      referrer_rewards_count,
      friend_signup_bonuses_count,
      friend_signup_bonuses_cents,
      emails_referral_invite_sent,
      emails_friend_activation_sent,
      emails_referrer_activation_sent,
      wallet_activations_count,
      redemptions_count,
      redemptions_cents,
      details_json,
      updated_at
    )
    SELECT
      k.organization_id,
      k.date_pacific,
      COALESCE(n.new_customers_via_referral, 0),
      COALESCE(r.unique_codes_rewarded, 0),
      COALESCE(r.rewards_issued_cents, 0),
      COALESCE(r.referrer_rewards_count, 0),
      COALESCE(fs.friend_signup_bonuses_count, 0),
      COALESCE(fs.friend_signup_bonuses_cents, 0),
      COALESCE(e.emails_referral_invite_sent, 0),
      COALESCE(e.emails_friend_activation_sent, 0),
      COALESCE(e.emails_referrer_activation_sent, 0),
      COALESCE(w.wallet_activations_count, 0),
      COALESCE(rd.redemptions_count, 0),
      COALESCE(rd.redemptions_cents, 0),
      dm.details_json,
      NOW()
    FROM keys k
    LEFT JOIN new_customers_agg n ON n.organization_id = k.organization_id AND n.date_pacific = k.date_pacific
    LEFT JOIN rewards_agg r ON r.organization_id = k.organization_id AND r.date_pacific = k.date_pacific
    LEFT JOIN friend_signup_agg fs ON fs.organization_id = k.organization_id AND fs.date_pacific = k.date_pacific
    LEFT JOIN emails_agg e ON e.organization_id = k.organization_id AND e.date_pacific = k.date_pacific
    LEFT JOIN wallet_agg w ON w.organization_id = k.organization_id AND w.date_pacific = k.date_pacific
    LEFT JOIN redemptions_agg rd ON rd.organization_id = k.organization_id AND rd.date_pacific = k.date_pacific
    LEFT JOIN details_merged dm ON dm.organization_id = k.organization_id AND dm.date_pacific = k.date_pacific
    ON CONFLICT (organization_id, date_pacific)
    DO UPDATE SET
      new_customers_via_referral = EXCLUDED.new_customers_via_referral,
      unique_codes_rewarded = EXCLUDED.unique_codes_rewarded,
      rewards_issued_cents = EXCLUDED.rewards_issued_cents,
      referrer_rewards_count = EXCLUDED.referrer_rewards_count,
      friend_signup_bonuses_count = EXCLUDED.friend_signup_bonuses_count,
      friend_signup_bonuses_cents = EXCLUDED.friend_signup_bonuses_cents,
      emails_referral_invite_sent = EXCLUDED.emails_referral_invite_sent,
      emails_friend_activation_sent = EXCLUDED.emails_friend_activation_sent,
      emails_referrer_activation_sent = EXCLUDED.emails_referrer_activation_sent,
      wallet_activations_count = EXCLUDED.wallet_activations_count,
      redemptions_count = EXCLUDED.redemptions_count,
      redemptions_cents = EXCLUDED.redemptions_cents,
      details_json = EXCLUDED.details_json,
      updated_at = NOW()
  `

  const result = await db.$executeRawUnsafe(refreshSQL)
  return { rowsWritten: Number(result) || 0 }
}

module.exports = { refreshReferralAnalytics }
