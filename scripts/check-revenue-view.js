/**
 * check-revenue-view.js
 *
 * READ-ONLY verification of `analytics_revenue_by_location_daily`.
 * Compares the live production view against a manual aggregation that
 * mirrors the live view's logic exactly. If the live view is correct, all
 * deltas are zero. Also reports refund exposure (Bug 2) and the analytics-
 * schema alternative view for comparison.
 *
 * NOTE: The live view definition in production has diverged from the file
 * at prisma/migrations/20260122000000_fix_analytics_revenue_include_payments_via_orders/migration.sql.
 * This script uses the LIVE definition, which already has the timezone fix,
 * uses square_created_at, uses amount_money_amount, and excludes OPEN orders.
 * Source of truth is `pg_get_viewdef('analytics_revenue_by_location_daily')`.
 *
 * Usage:
 *   node scripts/check-revenue-view.js          # last 7 days (default)
 *   node scripts/check-revenue-view.js --days=30
 *
 * Plan: ~/.claude/plans/tranquil-squishing-nebula.md
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Parse --days=N
const daysArg = process.argv.find((a) => a.startsWith('--days='));
const DAYS = daysArg ? parseInt(daysArg.split('=')[1], 10) : 7;

// Convert all BigInt fields in a row to Number for printing.
function normalize(rows) {
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'bigint') out[k] = Number(v);
      else out[k] = v;
    }
    return out;
  });
}

function fmtCents(c) {
  if (c == null) return '—';
  const sign = c < 0 ? '-' : '';
  const abs = Math.abs(Number(c));
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

function header(title) {
  const bar = '═'.repeat(78);
  console.log(`\n${bar}\n  ${title}\n${bar}`);
}

// Manual aggregation that mirrors the LIVE view definition exactly.
// Source of truth: pg_get_viewdef('analytics_revenue_by_location_daily').
// Updated 2026-04-08 (migration 20260408220000) — now also includes payments
// on OPEN-state orders (Square does too), and detects gift cards in BOTH
// camelCase and snake_case line item structures.
const MANUAL_AGG_SQL = `
  WITH payment_locations AS (
    SELECT
      p.id AS payment_id,
      p.organization_id,
      p.location_id,
      COALESCE(p.square_created_at, p.created_at) AS payment_date,
      p.amount_money_amount,
      LEAST(
        COALESCE((p.raw_json->'refunded_money'->>'amount')::int, 0),
        p.amount_money_amount
      ) AS refunded_cents,
      p.customer_id
    FROM payments p
    LEFT JOIN orders o ON o.id = p.order_id
    WHERE p.status = 'COMPLETED'
      AND p.location_id IS NOT NULL
      AND NOT COALESCE(o.raw_json->'lineItems' @> '[{"itemType": "GIFT_CARD"}]'::jsonb, FALSE)
      AND NOT COALESCE(o.raw_json->'line_items' @> '[{"item_type": "GIFT_CARD"}]'::jsonb, FALSE)

    UNION ALL

    SELECT
      p.id AS payment_id,
      p.organization_id,
      o.location_id,
      COALESCE(p.square_created_at, p.created_at) AS payment_date,
      p.amount_money_amount,
      LEAST(
        COALESCE((p.raw_json->'refunded_money'->>'amount')::int, 0),
        p.amount_money_amount
      ) AS refunded_cents,
      p.customer_id
    FROM payments p
    INNER JOIN orders o ON p.order_id = o.id
    WHERE p.status = 'COMPLETED'
      AND p.location_id IS NULL
      AND p.order_id IS NOT NULL
      AND o.location_id IS NOT NULL
      AND NOT (o.raw_json->'lineItems' @> '[{"itemType": "GIFT_CARD"}]'::jsonb)
      AND NOT (o.raw_json->'line_items' @> '[{"item_type": "GIFT_CARD"}]'::jsonb)
  )
  SELECT
    ((pl.payment_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date)::text AS date,
    l.name AS location_name,
    SUM(pl.amount_money_amount - pl.refunded_cents)::bigint AS revenue_cents,
    COUNT(DISTINCT pl.payment_id)::bigint AS payment_count,
    COUNT(DISTINCT pl.customer_id) FILTER (WHERE pl.customer_id IS NOT NULL)::bigint AS unique_customers
  FROM payment_locations pl
  INNER JOIN locations l
    ON pl.location_id = l.id
    AND pl.organization_id = l.organization_id
`;

(async () => {
  console.log(`\nVerification window: last ${DAYS} day(s)\n`);

  // ──────────────────────────────────────────────────────────────────────
  // Check 0 — sanity check: live view definition still matches expectations
  // ──────────────────────────────────────────────────────────────────────
  header(`CHECK 0 — Sanity: live view definition includes timezone conversion`);

  const def = await prisma.$queryRawUnsafe(`
    SELECT pg_get_viewdef('analytics_revenue_by_location_daily', true) AS def;
  `);
  const viewDef = def[0].def;
  const hasDoubleTz =
    /AT TIME ZONE\s+'UTC'.*AT TIME ZONE\s+'America\/Los_Angeles'/is.test(viewDef);
  // OPEN filter was REMOVED in 20260408220000 — Square counts OPEN-order
  // payments in Net Sales (open tabs/layaway with captured payments).
  const noOpenFilter = !/o\.state.*OPEN/.test(viewDef);
  const usesAmountMoneyAmount = /amount_money_amount/.test(viewDef);
  const usesSquareCreatedAt = /square_created_at/.test(viewDef);
  const excludesGiftCardsCamel = /lineItems.*GIFT_CARD/s.test(viewDef);
  const excludesGiftCardsSnake = /line_items.*GIFT_CARD/s.test(viewDef);
  const subtractsRefunds = /refunded_money/.test(viewDef);

  console.log(`  Double AT TIME ZONE (UTC → LA):     ${hasDoubleTz ? '✓' : '✗ MISSING'}`);
  console.log(`  No OPEN filter (Square counts them):${noOpenFilter ? '✓' : '✗ STILL HAS FILTER'}`);
  console.log(`  Uses amount_money_amount:           ${usesAmountMoneyAmount ? '✓' : '✗ MISSING'}`);
  console.log(`  Uses COALESCE(square_created_at):   ${usesSquareCreatedAt ? '✓' : '✗ MISSING'}`);
  console.log(`  Excludes gift cards (camelCase):    ${excludesGiftCardsCamel ? '✓' : '✗ MISSING'}`);
  console.log(`  Excludes gift cards (snake_case):   ${excludesGiftCardsSnake ? '✓' : '✗ MISSING'}`);
  console.log(`  Subtracts refunded_money:           ${subtractsRefunds ? '✓' : '✗ MISSING'}`);

  if (!hasDoubleTz || !noOpenFilter || !usesAmountMoneyAmount || !usesSquareCreatedAt || !excludesGiftCardsCamel || !excludesGiftCardsSnake || !subtractsRefunds) {
    console.log(
      '\n  ⚠  Live view does not match the expected production definition.'
    );
    console.log('  This script may report false positives. Inspect the view manually.');
  }

  // ──────────────────────────────────────────────────────────────────────
  // Check 1 — what the dashboard sees right now
  // ──────────────────────────────────────────────────────────────────────
  header(`CHECK 1 — Live view (what the dashboard shows)`);

  const viewRows = normalize(
    await prisma.$queryRawUnsafe(`
      SELECT
        date::text AS date,
        location_name,
        revenue_cents,
        payment_count,
        unique_customers
      FROM analytics_revenue_by_location_daily
      WHERE date >= CURRENT_DATE - INTERVAL '${DAYS} days'
      ORDER BY date DESC, location_name;
    `)
  );

  console.log(`Rows: ${viewRows.length}`);
  console.table(
    viewRows.map((r) => ({
      date: r.date,
      location: r.location_name,
      revenue: fmtCents(r.revenue_cents),
      payments: r.payment_count,
      customers: r.unique_customers,
    }))
  );

  // ──────────────────────────────────────────────────────────────────────
  // Check 2 — manual aggregation mirroring live view logic exactly
  // ──────────────────────────────────────────────────────────────────────
  header(`CHECK 2 — Manual aggregation mirroring live view logic`);

  const manualRows = normalize(
    await prisma.$queryRawUnsafe(`
      ${MANUAL_AGG_SQL}
      WHERE (pl.payment_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
            >= CURRENT_DATE - INTERVAL '${DAYS} days'
      GROUP BY 1, 2
      ORDER BY 1 DESC, 2;
    `)
  );

  console.log(`Rows: ${manualRows.length}`);
  console.table(
    manualRows.map((r) => ({
      date: r.date,
      location: r.location_name,
      revenue: fmtCents(r.revenue_cents),
      payments: r.payment_count,
      customers: r.unique_customers,
    }))
  );

  // ──────────────────────────────────────────────────────────────────────
  // Check 3 — diff: live view vs manual (should be all zeros)
  // ──────────────────────────────────────────────────────────────────────
  header(`CHECK 3 — DIFF: live view vs manual (expected: all zeros)`);

  // Build the diff in JS for clarity
  const key = (r) => `${r.date}::${r.location_name}`;
  const viewMap = new Map(viewRows.map((r) => [key(r), r]));
  const manualMap = new Map(manualRows.map((r) => [key(r), r]));
  const allKeys = new Set([...viewMap.keys(), ...manualMap.keys()]);

  const diffRows = [...allKeys]
    .map((k) => {
      const v = viewMap.get(k) || {};
      const m = manualMap.get(k) || {};
      const date = v.date || m.date;
      const loc = v.location_name || m.location_name;
      const vc = Number(v.revenue_cents || 0);
      const mc = Number(m.revenue_cents || 0);
      const vn = Number(v.payment_count || 0);
      const mn = Number(m.payment_count || 0);
      return {
        date,
        location: loc,
        view: fmtCents(vc),
        manual: fmtCents(mc),
        delta: fmtCents(mc - vc),
        view_n: vn,
        man_n: mn,
        d_n: mn - vn,
      };
    })
    .sort((a, b) => Math.abs(parseFloat(b.delta.replace(/[$,-]/g, ''))) - Math.abs(parseFloat(a.delta.replace(/[$,-]/g, ''))));

  console.table(diffRows);

  const nonZero = diffRows.filter(
    (r) => r.delta !== '$0.00' || r.d_n !== 0
  );
  if (nonZero.length === 0) {
    console.log('\n  ✓ Live view exactly matches manual aggregation. No bug detected.');
  } else {
    console.log(
      `\n  ⚠  ${nonZero.length} (date, location) cells diverge. Investigate — the live view does not match its expected logic.`
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Check 4 — refund exposure (Bug 2 — confirmed real)
  // ──────────────────────────────────────────────────────────────────────
  header(`CHECK 4 — Refund exposure (Bug 2 — gross still being counted as revenue)`);

  const refundRows = normalize(
    await prisma.$queryRawUnsafe(`
      SELECT
        ((COALESCE(p.square_created_at, p.created_at) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date)::text AS pacific_date,
        COALESCE(l.name, 'NO_LOCATION') AS location_name,
        COUNT(*)::bigint AS refunded_payment_count,
        SUM(p.amount_money_amount)::bigint AS gross_cents_still_counted
      FROM payments p
      LEFT JOIN locations l ON p.location_id::uuid = l.id
      LEFT JOIN orders o ON o.id = p.order_id::uuid
      WHERE p.status = 'COMPLETED'
        AND array_length(p.refund_ids, 1) > 0
        AND (o.state IS NULL OR o.state <> 'OPEN')
        AND (COALESCE(p.square_created_at, p.created_at) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
            >= CURRENT_DATE - INTERVAL '${DAYS} days'
      GROUP BY 1, 2
      ORDER BY 1 DESC, 2;
    `)
  );

  if (refundRows.length === 0) {
    console.log('No refunded payments in window.');
  } else {
    console.table(
      refundRows.map((r) => ({
        date: r.pacific_date,
        location: r.location_name,
        refunded_payments: r.refunded_payment_count,
        gross_still_counted: fmtCents(r.gross_cents_still_counted),
      }))
    );
    console.log(
      '\n  Caveat: this shows GROSS amount of payments that have AT LEAST ONE refund attached.'
    );
    console.log(
      '  Actual refunded portion may be partial. Exact refunded $ requires master_earnings_ledger or Square API.'
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Check 5 — public view vs analytics-schema view (semantic comparison)
  // ──────────────────────────────────────────────────────────────────────
  header(`CHECK 5 — public view vs analytics.analytics_revenue_by_location_daily`);
  console.log(
    '  Note: differences are SEMANTIC (payment date vs service-appointment date), not bugs.\n'
  );

  let analyticsRows = [];
  let analyticsAvailable = true;
  try {
    analyticsRows = normalize(
      await prisma.$queryRawUnsafe(`
        SELECT
          date::text AS date,
          location_name,
          revenue_cents::bigint AS revenue_cents,
          payments_count::bigint AS payment_count
        FROM analytics.analytics_revenue_by_location_daily
        WHERE date >= CURRENT_DATE - INTERVAL '${DAYS} days'
        ORDER BY date DESC, location_name;
      `)
    );
  } catch (e) {
    analyticsAvailable = false;
    console.log(`  analytics schema view not queryable: ${e.message.split('\n')[0]}`);
  }

  if (analyticsAvailable) {
    const sumByDate = (rows, cents = 'revenue_cents') => {
      const m = new Map();
      for (const r of rows) {
        const k = r.date;
        m.set(k, (m.get(k) || 0) + Number(r[cents] || 0));
      }
      return m;
    };

    const viewByDate = sumByDate(viewRows);
    const analyticsByDate = sumByDate(analyticsRows);
    const allDates = new Set([...viewByDate.keys(), ...analyticsByDate.keys()]);

    const sideBySide = [...allDates]
      .sort((a, b) => (a < b ? 1 : -1))
      .map((d) => ({
        date: d,
        public_view_total: fmtCents(viewByDate.get(d) || 0),
        analytics_view_total: fmtCents(analyticsByDate.get(d) || 0),
        delta: fmtCents((analyticsByDate.get(d) || 0) - (viewByDate.get(d) || 0)),
      }));

    console.table(sideBySide);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Final summary
  // ──────────────────────────────────────────────────────────────────────
  header('SUMMARY');
  console.log(`Window: last ${DAYS} day(s)`);
  console.log(
    `Bug 1 (timezone):   ${
      nonZero.length === 0
        ? 'NOT a bug — live view matches manual agg exactly'
        : `${nonZero.length} cells diverge — investigate`
    }`
  );
  console.log(
    `Bug 2 (refunds):    ${
      refundRows.length === 0
        ? 'no refunded payments in window'
        : `${refundRows.reduce((s, r) => s + Number(r.refunded_payment_count), 0)} refunded payments still counted as gross revenue (${fmtCents(refundRows.reduce((s, r) => s + Number(r.gross_cents_still_counted), 0))} gross)`
    }`
  );

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
