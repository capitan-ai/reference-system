const { getSquareClient } = require('../lib/utils/square-client');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function syncTeamMembers() {
  const square = getSquareClient();
  try {
    console.log('Fetching team members from Square...');
    const response = await square.teamApi.searchTeamMembers({
      query: {
        filter: {
          status: 'ACTIVE'
        }
      }
    });

    const teamMembers = response.result.teamMembers || [];
    console.log(`Found ${teamMembers.length} active team members in Square.`);

    // Get default organization
    const org = await prisma.organization.findFirst({ where: { is_active: true } });
    if (!org) throw new Error('No active organization found');

    for (const tm of teamMembers) {
      const fullName = `${tm.givenName || ''} ${tm.familyName || ''}`.trim();
      console.log(`Syncing: ${fullName} (${tm.id})`);

      await prisma.teamMember.upsert({
        where: {
          organization_id_square_team_member_id: {
            organization_id: org.id,
            square_team_member_id: tm.id
          }
        },
        update: {
          given_name: tm.givenName,
          family_name: tm.familyName,
          email_address: tm.emailAddress,
          phone_number: tm.phoneNumber,
          status: tm.status,
          updated_at: new Date()
        },
        create: {
          organization_id: org.id,
          square_team_member_id: tm.id,
          given_name: tm.givenName,
          family_name: tm.familyName,
          email_address: tm.emailAddress,
          phone_number: tm.phoneNumber,
          status: tm.status,
          created_at: new Date(),
          updated_at: new Date()
        }
      });
    }
    console.log('Sync completed successfully.');
  } catch (error) {
    console.error('Error syncing team members:', error);
  } finally {
    await prisma.$disconnect();
  }
}

syncTeamMembers();

