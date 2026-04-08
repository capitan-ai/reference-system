require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SQ_TOKEN = process.env.SQUARE_ACCESS_TOKEN?.replace(/^Bearer /, '').trim();
const SQ_VERSION = '2024-12-18';
const SQ_BASE = 'https://connect.squareup.com/v2';

if (!SQ_TOKEN) {
  console.error('SQUARE_ACCESS_TOKEN missing');
  process.exit(1);
}

async function sqGet(path) {
  const res = await fetch(`${SQ_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${SQ_TOKEN}`,
      'Square-Version': SQ_VERSION,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json();
}

async function listBookingsForCustomer(customerId) {
  // Square API limits start window to 31 days. Walk back month by month.
  const all = [];
  const seen = new Set();
  // Build 31-day windows covering Jan 2025 - May 2026
  const windows = [];
  let cur = new Date('2025-01-01T00:00:00Z');
  const end = new Date('2026-06-01T00:00:00Z');
  while (cur < end) {
    const next = new Date(cur.getTime() + 30 * 24 * 3600 * 1000);
    windows.push([cur.toISOString(), next.toISOString()]);
    cur = next;
  }
  for (const [wMin, wMax] of windows) {
    let cursor = null;
    let pages = 0;
    do {
      const params = new URLSearchParams({
        limit: '100',
        customer_id: customerId,
        start_at_min: wMin,
        start_at_max: wMax,
      });
      if (cursor) params.set('cursor', cursor);
      const data = await sqGet(`/bookings?${params}`);
      const page = data.bookings || [];
      for (const b of page) {
        if (!seen.has(b.id)) {
          seen.add(b.id);
          all.push(b);
        }
      }
      cursor = data.cursor || null;
      pages++;
      if (pages > 20) break;
    } while (cursor);
  }
  return all;
}

async function retrieveCustomer(customerId) {
  return sqGet(`/customers/${customerId}`);
}

const TARGETS = [
  { name: 'Pamela Odetto',    id: 'GV68PEDHEVFBHN70C091RHBZXR' },
  { name: 'Hailey Irvin',     id: 'QDBAP9ZHDZYE350SA6DN9ZPQNG' },
  { name: 'Stefanie Canillo', id: 'QGN1B3F1ZC6WP8BDVC6E41WX7M' },
];

(async () => {
  const locs = await prisma.$queryRaw`SELECT square_location_id, name FROM locations`;
  const locMap = new Map(locs.map((l) => [l.square_location_id, l.name]));

  for (const t of TARGETS) {
    console.log(`\n========================================`);
    console.log(`  ${t.name}   (${t.id})`);
    console.log(`========================================`);

    try {
      const { customer } = await retrieveCustomer(t.id);
      console.log(`  Square profile: ${customer.given_name || ''} ${customer.family_name || ''}`);
      console.log(`  Created: ${customer.created_at}`);
      console.log(`  Updated: ${customer.updated_at}`);
      console.log(`  Email:   ${customer.email_address || '—'}`);
      console.log(`  Phone:   ${customer.phone_number || '—'}`);
    } catch (e) {
      console.log(`  Customer error: ${e.message}`);
    }

    try {
      const bookings = await listBookingsForCustomer(t.id);
      console.log(`\n  Bookings in Square API: ${bookings.length}`);
      bookings
        .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
        .forEach((b) => {
          const loc = locMap.get(b.location_id) || b.location_id;
          const startLa = new Date(b.start_at).toLocaleString('en-US', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
          });
          const created = b.created_at ? b.created_at.slice(0, 10) : '?';
          console.log(`    ${startLa.padEnd(20)}  ${String(b.status).padEnd(22)}  ${loc}  created=${created}  sq=${b.id}`);
        });
    } catch (e) {
      console.log(`  Bookings error: ${e.message}`);
    }
  }

  // BONUS: fetch all bookings at Union St for 2026-04-08 directly from Square,
  // then compare against our DB list.
  console.log('\n========================================');
  console.log('  Union St — all bookings for 2026-04-08 directly from Square');
  console.log('========================================');
  const unionSq = locs.find((l) => l.name?.includes('Union'))?.square_location_id;
  if (unionSq) {
    try {
      const params = new URLSearchParams({
        limit: '100',
        location_id: unionSq,
        start_at_min: '2026-04-08T07:00:00Z',
        start_at_max: '2026-04-09T07:00:00Z',
      });
      const data = await sqGet(`/bookings?${params}`);
      const page = data.bookings || [];
      console.log(`  Square returned: ${page.length}`);
      page
        .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
        .forEach((b) => {
          const startLa = new Date(b.start_at).toLocaleString('en-US', {
            timeZone: 'America/Los_Angeles',
            hour: '2-digit', minute: '2-digit',
          });
          console.log(`    ${startLa}  ${String(b.status).padEnd(22)}  cust=${b.customer_id || '—'}  sq=${b.id}`);
        });
    } catch (e) {
      console.log(`  Union search error: ${e.message}`);
    }
  }

  await prisma.$disconnect();
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
