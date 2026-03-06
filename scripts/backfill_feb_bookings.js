require('dotenv').config();
const prisma = require('../lib/prisma-client');
const { getSquareClient } = require('../lib/utils/square-client');
const SquareBookingsBackfill = require('../lib/square-bookings-backfill');

async function runBackfill() {
  console.log('🚀 Starting backfill for February 2026 missing bookings...');
  
  try {
    const squareClient = getSquareClient();
    
    // We'll process both locations to be safe
    const locations = [
      { id: 'L0667W69S6V6F', name: 'Pacific Ave' },
      { id: 'L8S6W69S6V6F', name: 'Union St' }
    ];

    const startAtMin = '2026-02-01T00:00:00Z';
    const startAtMax = '2026-03-01T00:00:00Z';

    for (const loc of locations) {
      console.log(`\n📍 Processing location: ${loc.name} (${loc.id})`);
      const backfill = new SquareBookingsBackfill(prisma, squareClient, loc.id);
      
      await backfill.backfillBookings({
        incremental: false,
        startAtMin,
        startAtMax
      });
      
      console.log(`✅ Finished location: ${loc.name}`);
    }

    console.log('\n✨ Backfill process completed successfully.');

  } catch (error) {
    console.error('\n❌ Backfill failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

runBackfill();

