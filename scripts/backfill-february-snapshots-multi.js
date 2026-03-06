const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function backfill() {
  console.log('🚀 Starting Corrected Backfill for February 2026 (Multi-Segment Support)...');
  
  const startDate = new Date('2026-02-01T00:00:00Z');
  const endDate = new Date('2026-03-01T00:00:00Z');

  try {
    const bookings = await prisma.booking.findMany({
      where: {
        start_at: { gte: startDate, lt: endDate },
        status: 'ACCEPTED'
      }
    });

    console.log(`Found ${bookings.length} accepted bookings in February.`);

    let created = 0;
    let skipped = 0;

    for (const booking of bookings) {
      if (!booking.technician_id) {
        skipped++;
        continue;
      }

      const masterSettings = await prisma.masterSettings.findUnique({
        where: { team_member_id: booking.technician_id }
      });

      if (!masterSettings) {
        skipped++;
        continue;
      }

      // SUM UP ALL SEGMENTS
      const segments = booking.raw_json?.appointment_segments || [];
      let totalBookingPrice = 0;
      let totalDuration = 0;
      let isFix = false;

      for (const segment of segments) {
        const svId = segment.service_variation_id;
        if (svId) {
          const sv = await prisma.serviceVariation.findUnique({
            where: { square_variation_id: svId }
          });
          if (sv) {
            totalBookingPrice += (sv.price_amount || 0);
            if (sv.name?.toLowerCase().includes('fix')) isFix = true;
          }
        }
        totalDuration += (segment.duration_minutes || 0);
      }

      // If no segments found in raw_json, fallback to the linked service_variation
      if (totalBookingPrice === 0 && booking.service_variation_id) {
        const sv = await prisma.serviceVariation.findUnique({
          where: { uuid: booking.service_variation_id }
        });
        if (sv) {
          totalBookingPrice = sv.price_amount || 0;
          if (sv.name?.toLowerCase().includes('fix')) isFix = true;
        }
        totalDuration = booking.duration_minutes || 60;
      }

      await prisma.bookingSnapshot.upsert({
        where: { booking_id: booking.id },
        update: {
          status: booking.status,
          price_snapshot_amount: totalBookingPrice,
          commission_rate_snapshot: masterSettings.commission_rate,
          category_snapshot: masterSettings.category,
          duration_minutes_snapshot: totalDuration || 60,
          is_fix: isFix
        },
        create: {
          booking_id: booking.id,
          organization_id: booking.organization_id,
          location_id: booking.location_id,
          technician_id: booking.technician_id,
          status: booking.status,
          price_snapshot_amount: totalBookingPrice,
          commission_rate_snapshot: masterSettings.commission_rate,
          category_snapshot: masterSettings.category,
          duration_minutes_snapshot: totalDuration || 60,
          is_fix: isFix
        }
      });
      created++;
    }

    console.log(`✅ Backfill completed: ${created} snapshots updated with multi-segment prices.`);
  } catch (error) {
    console.error('❌ Backfill failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

backfill();

