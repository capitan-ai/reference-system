require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio

async function checkEdgeCaseBookingsCreators() {
  console.log('🔍 Checking Creators for Edge Case Bookings\n');

  try {
    // First, get Iryna and Renata's team member IDs
    console.log('📚 Fetching Iryna and Renata team member info...\n');
    
    const irynaRenata = await prisma.teamMember.findMany({
      where: {
        organization_id: ORG_ID,
        given_name: { in: ['Iryna', 'Renata'] }
      },
      select: {
        id: true,
        given_name: true,
        family_name: true,
        square_team_member_id: true
      }
    });

    console.log('Team Member Info:');
    irynaRenata.forEach(tm => {
      console.log(`  ${tm.given_name} ${tm.family_name}`);
      console.log(`    Internal ID: ${tm.id}`);
      console.log(`    Square ID: ${tm.square_team_member_id}\n`);
    });

    // Edge case booking IDs
    const edgeCaseBookingIds = [
      '65navdataex3xs',
      'uzf1nklhobhk1i',
      '4s76h9gylpzg60',
      'c44bxv6ggx40el',
      't4cj4wpu6a4lri',
      'nn4i1vaqd24p1o' // Feb 28 edge case
    ];

    console.log('='.repeat(80));
    console.log('\n🔎 Edge Case Bookings - Creator Details\n');

    for (const bookingId of edgeCaseBookingIds) {
      const booking = await prisma.booking.findFirst({
        where: {
          organization_id: ORG_ID,
          booking_id: bookingId
        },
        select: {
          booking_id: true,
          start_at: true,
          administrator_id: true,
          created_at: true,
          location: { select: { name: true } },
          raw_json: true
        }
      });

      if (booking) {
        const date = new Date(booking.start_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        console.log(`📌 ${booking.booking_id}`);
        console.log(`   Date: ${date}`);
        console.log(`   Location: ${booking.location.name}`);
        console.log(`   Administrator ID (DB): ${booking.administrator_id || 'NULL'}`);
        
        if (booking.raw_json?.creator_details) {
          console.log(`   Creator (raw_json):`);
          console.log(`     Type: ${booking.raw_json.creator_details.creator_type}`);
          console.log(`     Team Member ID: ${booking.raw_json.creator_details.team_member_id}`);
          console.log(`     Customer ID: ${booking.raw_json.creator_details.customer_id || 'N/A'}`);
        }
        console.log();
      }
    }

    // Check all Feb & Mar bookings with Iryna/Renata as administrator
    console.log('='.repeat(80));
    console.log('\n🔎 Checking for Iryna/Renata as Administrator in Feb/Mar\n');

    for (const tm of irynaRenata) {
      const count = await prisma.booking.count({
        where: {
          organization_id: ORG_ID,
          administrator_id: tm.id,
          start_at: {
            gte: new Date('2026-02-01T00:00:00Z'),
            lt: new Date('2026-04-01T00:00:00Z')
          }
        }
      });

      console.log(`${tm.given_name} ${tm.family_name} (${tm.square_team_member_id})`);
      console.log(`  Administrator bookings in Feb/Mar: ${count}`);
    }

    // List all unique creators for the edge case bookings
    console.log('\n' + '='.repeat(80));
    console.log('\n📊 Summary of Edge Case Booking Creators\n');

    const creatorMap = {};
    for (const bookingId of edgeCaseBookingIds) {
      const booking = await prisma.booking.findFirst({
        where: {
          organization_id: ORG_ID,
          booking_id: bookingId
        },
        select: {
          raw_json: true
        }
      });

      if (booking?.raw_json?.creator_details?.team_member_id) {
        const creatorId = booking.raw_json.creator_details.team_member_id;
        if (!creatorMap[creatorId]) {
          creatorMap[creatorId] = [];
        }
        creatorMap[creatorId].push(bookingId);
      }
    }

    // Get team member names for these creators
    const creatorIds = Object.keys(creatorMap);
    if (creatorIds.length > 0) {
      const creators = await prisma.teamMember.findMany({
        where: {
          organization_id: ORG_ID,
          square_team_member_id: { in: creatorIds }
        },
        select: {
          given_name: true,
          family_name: true,
          square_team_member_id: true
        }
      });

      console.log('Creators of Edge Case Bookings:');
      creators.forEach(creator => {
        const count = creatorMap[creator.square_team_member_id].length;
        console.log(`  ${creator.given_name} ${creator.family_name} (${creator.square_team_member_id}): ${count} booking(s)`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkEdgeCaseBookingsCreators();

