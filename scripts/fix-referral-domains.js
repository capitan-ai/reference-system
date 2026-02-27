require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278';

function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateReferralUrl(referralCode) {
  // Correct domain as requested
  return `https://studio-zorina.square.site/?utm_source=referral&utm_medium=friend&utm_campaign=${referralCode}`;
}

async function updateAllReferralUrls() {
  console.log('🚀 Updating all referral codes and URLs to the correct domain...');
  
  try {
    const customers = await prisma.squareExistingClient.findMany({
      where: { organization_id: ORG_ID }
    });

    console.log(`📊 Processing ${customers.length} customers...`);

    let updatedCount = 0;
    
    // Process in batches to avoid memory/db issues
    const batchSize = 100;
    for (let i = 0; i < customers.length; i += batchSize) {
      const batch = customers.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (customer) => {
        let code = customer.personal_code || customer.referral_code;
        if (!code) {
          code = generateReferralCode();
        }
        
        const correctUrl = generateReferralUrl(code);
        
        // Only update if something changed
        if (customer.personal_code !== code || customer.referral_url !== correctUrl) {
          await prisma.squareExistingClient.update({
            where: { id: customer.id },
            data: {
              personal_code: code,
              referral_code: code,
              referral_url: correctUrl,
              activated_as_referrer: true
            }
          });
          updatedCount++;
        }
      }));
      
      if ((i + batchSize) % 500 === 0 || (i + batchSize) >= customers.length) {
        console.log(`✅ Progress: ${Math.min(i + batchSize, customers.length)}/${customers.length} processed...`);
      }
    }

    console.log('\n✨ Update Complete!');
    console.log(`- Total customers processed: ${customers.length}`);
    console.log(`- Total records updated with correct domain: ${updatedCount}`);
    console.log(`- Correct Domain: studio-zorina.square.site`);

  } catch (error) {
    console.error('💥 Error during update:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateAllReferralUrls();


