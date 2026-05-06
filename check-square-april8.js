require('dotenv').config();
const { SquareClient } = require('square');
const fs = require('fs');

(async () => {
  const output = [];
  try {
    const client = new SquareClient({
      accessToken: process.env.SQUARE_ACCESS_TOKEN
    });

    output.push('Fetching bookings from Square API...');
    output.push('UTC Time: 2026-04-08T07:00:00Z to 2026-04-09T07:00:00Z');
    output.push('(Corresponds to April 8 in America/Los_Angeles)\n');

    const result = await client.bookings.list({
      beginTime: '2026-04-08T07:00:00Z',
      endTime: '2026-04-09T07:00:00Z',
      limit: 100
    });

    const bookings = result.result?.bookings || [];
    output.push(`✅ Found ${bookings.length} bookings from Square\n`);

    const by = {};
    bookings.forEach(b => {
      const loc = b.locationId;
      const status = b.status;
      if (!by[loc]) by[loc] = {};
      by[loc][status] = (by[loc][status] || 0) + 1;
    });

    Object.entries(by).forEach(([loc, statuses]) => {
      const total = Object.values(statuses).reduce((a, b) => a + b, 0);
      output.push(`Location: ${loc}`);
      output.push(`  Total: ${total}`);
      Object.entries(statuses).sort().forEach(([s, c]) => {
        output.push(`    ${s}: ${c}`);
      });
      output.push('');
    });

    const msg = output.join('\n');
    console.log(msg);
    fs.writeFileSync('/tmp/square_april8_output.txt', msg);
    process.exit(0);
  } catch (err) {
    const msg = `Error: ${err.message}`;
    console.error(msg);
    fs.writeFileSync('/tmp/square_april8_output.txt', msg);
    process.exit(1);
  }
})();
