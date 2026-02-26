require('dotenv').config();
const { getCustomersApi } = require('../lib/utils/square-client');
const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma-client');

async function enrichGhosts() {
  console.log('🚀 Starting Ghost Profile Enrichment from Square API...');

  // 1. Find ghosts with activity
  const ghosts = await prisma.$queryRaw`
    SELECT square_customer_id, organization_id
    FROM square_existing_clients
    WHERE (given_name IS NULL OR given_name = '')
      AND (family_name IS NULL OR family_name = '')
      AND (email_address IS NULL OR email_address = '')
      AND (phone_number IS NULL OR phone_number = '')
      AND EXISTS (SELECT 1 FROM payments p WHERE p.customer_id = square_existing_clients.square_customer_id)
  `;

  console.log(`Found ${ghosts.length} active ghosts to enrich.`);

  const customersApi = getCustomersApi();
  let enrichedCount = 0;

  for (const ghost of ghosts) {
    try {
      console.log(`Fetching Square data for: ${ghost.square_customer_id}...`);
      const response = await customersApi.retrieveCustomer(ghost.square_customer_id);
      const customer = response.result.customer;
      // Log the source for debugging
      console.log(`  Source: ${customer.creationSource || customer.creation_source || "UNKNOWN"}`);

      if (customer) {
        const givenName = customer.givenName || null;
        const familyName = customer.familyName || null;
        const email = customer.emailAddress || null;
        const phone = customer.phoneNumber || null;

        if (givenName || familyName || email || phone) {
          await prisma.squareExistingClient.update({
            where: {
              organization_id_square_customer_id: {
                organization_id: ghost.organization_id,
                square_customer_id: ghost.square_customer_id
              }
            },
            data: {
              given_name: givenName,
              family_name: familyName,
              email_address: email,
              phone_number: phone,
              updated_at: new Date(),
              raw_json: customer // Update the full JSON as well
            }
          });
          console.log(`  ✅ Enriched: ${givenName} ${familyName} (${email || phone || 'no contact'})`);
          enrichedCount++;
        } else {
          console.log(`  ⚠️  Square profile also empty for ${ghost.square_customer_id}`);
        }
      }
      
      // Rate limit backoff
      await new Promise(r => setTimeout(r, 200));
    } catch (error) {
      console.error(`  ❌ Error fetching ${ghost.square_customer_id}:`, error.message);
    }
  }

  console.log(`\nFinished. Enriched ${enrichedCount} profiles.`);
  await prisma.$disconnect();
}

enrichGhosts().catch(console.error);

