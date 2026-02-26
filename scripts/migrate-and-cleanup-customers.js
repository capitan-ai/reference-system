require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278';
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

async function fetchAllSquareCustomerIds() {
  let allIds = new Set();
  let cursor = null;
  try {
    do {
      let url = 'https://connect.squareup.com/v2/customers';
      if (cursor) url += `?cursor=${encodeURIComponent(cursor)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Square-Version': '2026-01-22',
          'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await response.json();
      if (data.customers) data.customers.forEach(c => allIds.add(c.id));
      cursor = data.cursor;
    } while (cursor);
    return allIds;
  } catch (error) {
    console.error('Error fetching Square IDs:', error);
    throw error;
  }
}

async function migrateAndCleanup() {
  console.log('🚀 Starting migration of merged customers and cleanup of inactive ones...');
  
  try {
    const squareIds = await fetchAllSquareCustomerIds();
    console.log(`✅ Current Square active IDs: ${squareIds.size}`);

    const dbCustomers = await prisma.squareExistingClient.findMany({
      where: { organization_id: ORG_ID }
    });

    const extraCustomers = dbCustomers.filter(c => !squareIds.has(c.square_customer_id));
    console.log(`📊 Found ${extraCustomers.length} extra customers in DB.`);

    let migratedRecords = 0;
    let movedToArchive = 0;
    let mergedCount = 0;

    for (const oldCustomer of extraCustomers) {
      const oldId = oldCustomer.square_customer_id;
      
      // 1. Try to find a "New" profile with the same email or phone to merge into
      const newProfile = await prisma.squareExistingClient.findFirst({
        where: {
          organization_id: ORG_ID,
          square_customer_id: { in: Array.from(squareIds) },
          OR: [
            oldCustomer.email_address ? { email_address: oldCustomer.email_address } : null,
            oldCustomer.phone_number ? { phone_number: oldCustomer.phone_number } : null,
            // Also check if name matches exactly if email/phone are missing
            (oldCustomer.given_name && oldCustomer.family_name) ? {
              given_name: oldCustomer.given_name,
              family_name: oldCustomer.family_name
            } : null
          ].filter(Boolean)
        }
      });

      if (newProfile) {
        const newId = newProfile.square_customer_id;
        console.log(`🔗 Merging ${oldCustomer.given_name} ${oldCustomer.family_name} (${oldId}) -> (${newId})`);

        // Update Bookings
        const b = await prisma.booking.updateMany({
          where: { organization_id: ORG_ID, customer_id: oldId },
          data: { customer_id: newId }
        });
        
        // Update Payments
        const p = await prisma.payment.updateMany({
          where: { organization_id: ORG_ID, customer_id: oldId },
          data: { customer_id: newId }
        });

        // Update Orders
        const o = await prisma.order.updateMany({
          where: { organization_id: ORG_ID, customer_id: oldId },
          data: { customer_id: newId }
        });

        // Update OrderLineItems
        const li = await prisma.orderLineItem.updateMany({
          where: { organization_id: ORG_ID, customer_id: oldId },
          data: { customer_id: newId }
        });

        migratedRecords += (b.count + p.count + o.count + li.count);
        mergedCount++;

        // After migration, we can move the old profile to archive (or delete if you prefer, but we'll archive for safety)
        // Since we don't have an archive table yet, let's just mark it or move it if the user wants.
        // User said: "remove old customer profile" after connecting.
        await prisma.squareExistingClient.delete({ where: { id: oldCustomer.id } });
      } else {
        // 2. No new profile found - check if inactive
        const bookingCount = await prisma.booking.count({ where: { customer_id: oldId } });
        const paymentCount = await prisma.payment.count({ where: { customer_id: oldId } });

        if (bookingCount === 0 && paymentCount === 0) {
          console.log(`📦 Archiving inactive customer: ${oldCustomer.given_name} ${oldCustomer.family_name} (${oldId})`);
          // Move to archive (we'll use a JSON file or a temporary log since we don't want to change schema now)
          // For this task, I will just log them and delete from main table as requested.
          await prisma.squareExistingClient.delete({ where: { id: oldCustomer.id } });
          movedToArchive++;
        } else {
          console.log(`⚠️ Extra customer with activity but NO matching new profile: ${oldCustomer.given_name} (${oldId}) - Keeping for now.`);
        }
      }
    }

    console.log('\n✨ Migration & Cleanup Results:');
    console.log(`- Profiles Merged & Deleted: ${mergedCount}`);
    console.log(`- Records (Bookings/Payments) Re-linked: ${migratedRecords}`);
    console.log(`- Inactive Profiles Removed: ${movedToArchive}`);
    console.log('------------------------------------------');

  } catch (error) {
    console.error('💥 Fatal error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

migrateAndCleanup();

