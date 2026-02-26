require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { Client, Environment } = require('square');

const prisma = new PrismaClient();
const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // From existing scripts

const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production,
});

const customersApi = squareClient.customersApi;

function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateReferralUrl(referralCode) {
  return `https://studio-zorina.square.site/?utm_source=referral&utm_medium=friend&utm_campaign=${referralCode}`;
}

async function syncAllCustomers() {
  console.log('🚀 Starting full Square-to-DB customer synchronization...');
  
  try {
    let cursor = null;
    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalCreated = 0;
    let totalMissingInfo = 0;

    do {
      const response = await customersApi.listCustomers(cursor);
      const customers = response.result.customers || [];
      cursor = response.result.cursor;

      console.log(`📦 Fetched ${customers.length} customers from Square...`);

      for (const squareCustomer of customers) {
        totalProcessed++;
        
        const {
          id: square_customer_id,
          givenName: given_name,
          familyName: family_name,
          emailAddress: email_address,
          phoneNumber: phone_number,
        } = squareCustomer;

        // Check if important info is missing
        const isMissingInfo = !given_name || !family_name || !phone_number;
        if (isMissingInfo) {
          totalMissingInfo++;
          console.log(`⚠️ Customer ${square_customer_id} is missing info: ${given_name || 'N/A'} ${family_name || 'N/A'}, Phone: ${phone_number || 'N/A'}`);
        }

        // Check if customer exists in DB
        const existingDbCustomer = await prisma.squareExistingClient.findUnique({
          where: {
            organization_id_square_customer_id: {
              organization_id: ORG_ID,
              square_customer_id: square_customer_id,
            },
          },
        });

        let referralCode = existingDbCustomer?.personal_code || existingDbCustomer?.referral_code;
        let referralUrl = existingDbCustomer?.referral_url;

        // If no referral code, generate one
        if (!referralCode) {
          referralCode = generateReferralCode();
          referralUrl = generateReferralUrl(referralCode);
          console.log(`✨ Generated new referral code ${referralCode} for ${given_name} ${family_name}`);
        }

        const customerData = {
          given_name: given_name || null,
          family_name: family_name || null,
          email_address: email_address || null,
          phone_number: phone_number || null,
          personal_code: referralCode,
          referral_code: referralCode,
          referral_url: referralUrl,
          activated_as_referrer: true, // Mark as activated since we are ensuring they have a code
          organization_id: ORG_ID,
          raw_json: JSON.parse(JSON.stringify(squareCustomer)),
        };

        if (existingDbCustomer) {
          await prisma.squareExistingClient.update({
            where: { id: existingDbCustomer.id },
            data: customerData,
          });
          totalUpdated++;
        } else {
          await prisma.squareExistingClient.create({
            data: {
              ...customerData,
              square_customer_id: square_customer_id,
            },
          });
          totalCreated++;
        }

        // Optional: Update Square with the referral code if it was newly generated
        // For now, we focus on DB sync as requested.
      }

      console.log(`✅ Processed ${totalProcessed} customers so far...`);

    } while (cursor);

    console.log('\n--- Sync Results ---');
    console.log(`Total Processed: ${totalProcessed}`);
    console.log(`Total Updated:   ${totalUpdated}`);
    console.log(`Total Created:   ${totalCreated}`);
    console.log(`Total with Missing Info: ${totalMissingInfo}`);
    console.log('--------------------\n');

  } catch (error) {
    console.error('💥 Error during sync:', error);
  } finally {
    await prisma.$disconnect();
  }
}

syncAllCustomers();

