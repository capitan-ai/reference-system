require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SQ_TOKEN = process.env.SQUARE_ACCESS_TOKEN?.replace(/^Bearer /, '').trim();
const SQ_VERSION = '2024-12-18';
const SQ_BASE = 'https://connect.squareup.com/v2';

async function sqGet(path) {
  const res = await fetch(`${SQ_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${SQ_TOKEN}`,
      'Square-Version': SQ_VERSION,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

// Get all bookings at a location on a given day (LA), paginated
async function listBookingsAtLocationForDay(locationSquareId, day = '2026-04-08') {
  const all = [];
  let cursor = null;
  do {
    const params = new URLSearchParams({
      limit: '100',
      location_id: locationSquareId,
      start_at_min: `${day}T07:00:00Z`, // 00:00 PDT
      start_at_max: `${day}T30:00:00Z`.replace('30:00:00Z', '07:00:00Z').replace(day, new Date(new Date(day).getTime() + 24*3600*1000).toISOString().slice(0,10)),
    });
    if (cursor) params.set('cursor', cursor);
    const data = await sqGet(`/bookings?${params}`);
    all.push(...(data.bookings || []));
    cursor = data.cursor || null;
  } while (cursor);
  return all;
}

// For a given Square customer, count their prior ACCEPTED bookings anywhere
// (walking 31-day windows backward). Returns { hasPrior, firstAcceptedDate }
async function customerFirstAccepted(customerId, beforeIso) {
  const all = [];
  const seen = new Set();
  const windows = [];
  let cur = new Date('2024-06-01T00:00:00Z');
  const end = new Date(beforeIso);
  while (cur < end) {
    const next = new Date(cur.getTime() + 30 * 24 * 3600 * 1000);
    windows.push([cur.toISOString(), next > end ? end.toISOString() : next.toISOString()]);
    cur = next;
  }
  for (const [wMin, wMax] of windows) {
    let cursor = null;
    do {
      const params = new URLSearchParams({
        limit: '100',
        customer_id: customerId,
        start_at_min: wMin,
        start_at_max: wMax,
      });
      if (cursor) params.set('cursor', cursor);
      const data = await sqGet(`/bookings?${params}`);
      for (const b of (data.bookings || [])) {
        if (!seen.has(b.id)) {
          seen.add(b.id);
          all.push(b);
        }
      }
      cursor = data.cursor || null;
    } while (cursor);
  }
  const accepted = all
    .filter((b) => b.status === 'ACCEPTED')
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
  return {
    accepted,
    firstAcceptedDate: accepted[0]?.start_at || null,
    priorAcceptedCount: accepted.length,
  };
}

(async () => {
  const locs = await prisma.$queryRaw`SELECT square_location_id, name FROM locations`;
  const unionSq = locs.find((l) => l.name.includes('Union')).square_location_id;
  const pacificSq = locs.find((l) => l.name.includes('Pacific')).square_location_id;

  for (const [label, locSq] of [['Union St', unionSq], ['Pacific Ave', pacificSq]]) {
    console.log(`\n========================================`);
    console.log(`  ${label} — new clients today 2026-04-08 (verified via Square API)`);
    console.log(`========================================`);

    const dayBookings = await listBookingsAtLocationForDay(locSq, '2026-04-08');
    const accepted = dayBookings.filter((b) => b.status === 'ACCEPTED');
    console.log(`Today ACCEPTED at this location: ${accepted.length}`);

    // Get distinct customer IDs
    const custIds = [...new Set(accepted.map((b) => b.customer_id).filter(Boolean))];
    console.log(`Distinct customers with ACCEPTED today: ${custIds.length}`);

    const newClients = [];
    for (const cid of custIds) {
      // For each customer, check if they have ANY ACCEPTED booking BEFORE today
      const { accepted: hist } = await customerFirstAccepted(cid, '2026-04-08T07:00:00Z');
      const priorAccepted = hist.length; // all these are before today because we passed beforeIso
      if (priorAccepted === 0) {
        // Get customer name
        try {
          const { customer } = await sqGet(`/customers/${cid}`);
          newClients.push({
            id: cid,
            name: `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || '(unknown)',
            email: customer.email_address,
            created: customer.created_at,
          });
        } catch (e) {
          newClients.push({ id: cid, name: '(fetch error)' });
        }
      }
    }

    console.log(`\nNew clients (no prior ACCEPTED booking anywhere): ${newClients.length}`);
    newClients.forEach((c) =>
      console.log(`  ${c.name.padEnd(32)}  sq_created=${c.created?.slice(0, 10) || '?'}  ${c.id}`)
    );
  }

  await prisma.$disconnect();
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
