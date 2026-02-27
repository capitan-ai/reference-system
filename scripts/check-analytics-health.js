require('dotenv').config();
const prisma = require('../lib/prisma-client');

function fail(msg) {
  console.error(`\n❌ ANALYTICS HEALTH CHECK FAILED: ${msg}\n`);
  process.exit(2);
}

function warn(msg) {
  console.warn(`\n⚠️  ${msg}\n`);
}

async function main() {
  console.log('='.repeat(80));
  console.log('ANALYTICS HEALTH CHECK (v5.1)');
  console.log('='.repeat(80));

  // 1) Coverage of completed orders having line_items
  const coverage = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int AS completed_orders,
      COUNT(*) FILTER (WHERE li_cnt > 0)::int AS completed_with_items,
      ROUND(100.0 * COUNT(*) FILTER (WHERE li_cnt > 0) / NULLIF(COUNT(*),0), 2) AS pct
    FROM (
      SELECT o.id, COUNT(li.id) AS li_cnt
      FROM orders o
      LEFT JOIN order_line_items li ON li.order_id = o.id
      WHERE o.state = 'COMPLETED'
      GROUP BY o.id
    ) t;
  `;

  const pct = Number(coverage[0]?.pct ?? 0);
  console.log(`Coverage: ${coverage[0].completed_with_items}/${coverage[0].completed_orders} = ${pct}%`);

  if (pct < 99.0) fail(`Coverage below 99% (${pct}%)`);

  // 2) Paying Potential > 0
  const payingPotential = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM customer_analytics
    WHERE customer_type='POTENTIAL'
      AND gross_revenue_cents > 0;
  `;
  const pp = payingPotential[0]?.cnt ?? 0;
  console.log(`Paying POTENTIAL: ${pp}`);
  if (pp > 0) fail(`Found ${pp} POTENTIAL customers with gross_revenue_cents > 0`);

  // 3) Student collision check (Classic vs Class)
  // Using word boundaries \m \M to ensure "Class" is a separate word
  const collisions = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM order_line_items li
    JOIN customer_analytics ca
      ON ca.organization_id = li.organization_id
     AND ca.square_customer_id = li.customer_id
    WHERE ca.customer_type='STUDENT'
      AND li.name ~* '\\mclassic\\M';
  `;
  const col = collisions[0]?.cnt ?? 0;
  console.log(`Student collision candidates (classic): ${col}`);

  if (col > 0) warn(`There are ${col} STUDENT line items containing "classic". Review regex boundaries.`);

  console.log('\n✅ Analytics health checks passed.');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});


