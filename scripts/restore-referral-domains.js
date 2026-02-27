require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278';

function generateReferralUrl(referralCode) {
  // Returning to the CORRECT domain as per user instruction
  return `https://www.zorinastudio-referral.com/ref/${referralCode}`;
}

async function rollbackReferralUrls() {
  console.log('🔄 Rolling back referral URLs to zorinastudio-referral.com...');
  
  try {
    const customers = await prisma.squareExistingClient.findMany({
      where: { organization_id: ORG_ID }
    });

    console.log(`📊 Processing ${customers.length} customers...`);

    let updatedCount = 0;
    const batchSize = 100;

    for (let i = 0; i < customers.length; i += batchSize) {
      const batch = customers.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (customer) => {
        const code = customer.personal_code || customer.referral_code;
        if (!code) return;

        const correctUrl = generateReferralUrl(code);
        
        if (customer.referral_url !== correctUrl) {
          await prisma.squareExistingClient.update({
            where: { id: customer.id },
            data: {
              referral_url: correctUrl
            }
          });
          updatedCount++;
        }
      }));
      
      if ((i + batchSize) % 500 === 0 || (i + batchSize) >= customers.length) {
        console.log(`✅ Progress: ${Math.min(i + batchSize, customers.length)}/${customers.length} processed...`);
      }
    }

    console.log('\n✨ Rollback Complete!');
    console.log(`- Total records restored to correct domain: ${updatedCount}`);
    console.log(`- Domain: zorinastudio-referral.com`);

  } catch (error) {
    console.error('💥 Error during rollback:', error);
  } finally {
    await prisma.$disconnect();
  }
}

rollbackReferralUrls();


