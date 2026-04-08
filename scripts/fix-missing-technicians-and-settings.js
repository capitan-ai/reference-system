const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixData() {
  console.log('🚀 Starting data recovery for missing technicians and settings...');

  try {
    // 1. Fix missing technician_id in Bookings from raw_json
    console.log('--- Phase 1: Fixing missing technician_id in Bookings ---');
    const bookingsToFix = await prisma.booking.findMany({
      where: {
        technician_id: null,
        raw_json: { not: null }
      }
    });

    console.log(`Found ${bookingsToFix.length} bookings without technician_id.`);

    let fixedBookings = 0;
    for (const booking of bookingsToFix) {
      const raw = booking.raw_json;
      // Extract team_member_id from segments or creator_details
      const segments = raw.appointment_segments || raw.appointmentSegments || [];
      const squareTeamMemberId = segments[0]?.team_member_id || segments[0]?.teamMemberId || 
                                raw.creator_details?.team_member_id || raw.creator_details?.teamMemberId;

      if (squareTeamMemberId) {
        const teamMember = await prisma.teamMember.findFirst({
          where: { 
            square_team_member_id: squareTeamMemberId,
            organization_id: booking.organization_id
          }
        });

        if (teamMember) {
          await prisma.booking.update({
            where: { id: booking.id },
            data: { technician_id: teamMember.id }
          });
          fixedBookings++;
        }
      }
    }
    console.log(`✅ Fixed ${fixedBookings} bookings with missing technician_id.`);

    // 2. Backfill MasterSettings for missing masters
    console.log('--- Phase 2: Backfilling MasterSettings from TeamMember table ---');
    const allActiveMasters = await prisma.teamMember.findMany({
      where: { 
        status: 'ACTIVE',
        is_system: false
      }
    });

    let settingsCreated = 0;
    for (const tm of allActiveMasters) {
      const existing = await prisma.masterSettings.findUnique({
        where: { team_member_id: tm.id }
      });

      if (!existing) {
        // Use defaults from TeamMember.role if available
        await prisma.masterSettings.create({
          data: {
            team_member_id: tm.id,
            commission_rate: tm.commission_rate || 40.0,
            category: tm.role || 'MASTER',
            location_code: tm.location_code || 'UNKNOWN_LOC',
            is_active: true
          }
        });
        settingsCreated++;
        console.log(`Created settings for: ${tm.given_name} ${tm.family_name}`);
      }
    }
    console.log(`✅ Created ${settingsCreated} missing MasterSettings records.`);

  } catch (error) {
    console.error('❌ Data recovery failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixData();
