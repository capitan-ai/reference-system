require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SQ_TOKEN = process.env.SQUARE_ACCESS_TOKEN?.replace(/^Bearer /, '').replace(/"/g, '').trim();
const SQ_VERSION = '2024-12-18';
const SQ_BASE = 'https://connect.squareup.com/v2';

const HOW_DID_YOU_HEAR_KEY = 'square:c11dd5ac-8382-4570-9c7b-2bdcb1c781f1';
const HOW_DID_YOU_HEAR_OPTIONS = {
  '0826aee4-d259-434d-be44-511ac61b3629': 'Instagram',
  'a7b40271-729a-41aa-801b-fb1fffb83650': 'Google Maps',
  'af5791f8-348a-422e-98d1-5e865121bb19': 'Friend referral',
  'c0f2ee04-4762-42c6-a593-a4e745a81c92': 'Influencer post',
  'cb289afd-ba17-4a65-a12b-b7bbae60a65e': 'Online ad',
  'ea55658e-be3e-4b86-a64a-9d499c3b4b8c': 'Returning client',
  'fd306114-9968-4fe0-9bde-53f9bf837f39': 'Other',
};

async function fetchAcquisitionSource(customerId) {
  const url = `${SQ_BASE}/customers/${customerId}/custom-attributes/${encodeURIComponent(HOW_DID_YOU_HEAR_KEY)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${SQ_TOKEN}`, 'Square-Version': SQ_VERSION },
  });
  if (!res.ok) return null;
  const d = await res.json();
  const raw = d.custom_attribute?.value;
  if (!raw) return null;
  const uuid = Array.isArray(raw) ? raw[0] : raw;
  return HOW_DID_YOU_HEAR_OPTIONS[uuid] || null;
}

async function main() {
  if (!SQ_TOKEN) {
    console.error('SQUARE_ACCESS_TOKEN missing');
    process.exit(1);
  }

  const customers = await prisma.$queryRaw`
    SELECT square_customer_id, organization_id, given_name, family_name
    FROM square_existing_clients
    WHERE acquisition_source IS NULL
    ORDER BY created_at ASC
  `;

  console.log(`Found ${customers.length} customers without acquisition_source`);

  let updated = 0;
  let notSet = 0;
  let errors = 0;
  const BATCH = 25;

  for (let i = 0; i < customers.length; i += BATCH) {
    const batch = customers.slice(i, i + BATCH);

    await Promise.all(batch.map(async (c) => {
      try {
        const source = await fetchAcquisitionSource(c.square_customer_id);
        if (source) {
          await prisma.$executeRaw`
            UPDATE square_existing_clients
            SET acquisition_source = ${source}
            WHERE square_customer_id = ${c.square_customer_id}
              AND organization_id = ${c.organization_id}::uuid
              AND acquisition_source IS NULL
          `;
          updated++;
        } else {
          notSet++;
        }
      } catch (e) {
        errors++;
      }
    }));

    if ((i + BATCH) % 500 === 0 || i + BATCH >= customers.length) {
      console.log(`Progress: ${Math.min(i + BATCH, customers.length)}/${customers.length} | updated: ${updated} | no answer: ${notSet} | errors: ${errors}`);
    }
  }

  console.log(`\nDone. Updated: ${updated}, No answer: ${notSet}, Errors: ${errors}`);

  // Bulk update customer_analytics.referral_source from acquisition_source in one query
  console.log('\nUpdating customer_analytics.referral_source...');
  const analyticsResult = await prisma.$executeRaw`
    UPDATE customer_analytics ca
    SET referral_source = sec.acquisition_source,
        updated_at = NOW()
    FROM square_existing_clients sec
    WHERE ca.organization_id = sec.organization_id
      AND ca.square_customer_id = sec.square_customer_id
      AND sec.acquisition_source IS NOT NULL
      AND ca.referral_source IS NULL
  `;
  console.log(`Updated ${analyticsResult} customer_analytics rows.`);

  const summary = await prisma.$queryRaw`
    SELECT acquisition_source, COUNT(*) as cnt
    FROM square_existing_clients
    WHERE acquisition_source IS NOT NULL
    GROUP BY acquisition_source
    ORDER BY cnt DESC
  `;
  console.log('\nAcquisition source breakdown:');
  summary.forEach(r => console.log(`  ${r.acquisition_source}: ${r.cnt}`));

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
