require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278';
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

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

async function fetchAllSquareCustomers() {
  let allCustomers = [];
  let cursor = null;
  
  console.log('📡 Fetching customers from Square API...');
  
  try {
    do {
      let url = 'https://connect.squareup.com/v2/customers';
      if (cursor) {
        url += `?cursor=${encodeURIComponent(cursor)}`;
      }
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Square-Version': '2026-01-22',
          'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Square API error: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      if (data.customers) {
        allCustomers = allCustomers.concat(data.customers);
      }
      cursor = data.cursor;
      console.log(`   Fetched ${allCustomers.length} customers...`);
    } while (cursor);
    
    return allCustomers;
  } catch (error) {
    console.error('❌ Error fetching from Square:', error.message);
    throw error;
  }
}

async function sync() {
  try {
    const squareCustomers = await fetchAllSquareCustomers();
    console.log(`✅ Total Square customers found: ${squareCustomers.length}`);
    
    const dbCustomers = await prisma.squareExistingClient.findMany({
      where: { organization_id: ORG_ID }
    });
    
    const dbMap = new Map(dbCustomers.map(c => [c.square_customer_id, c]));
    console.log(`📊 Total DB customers found: ${dbCustomers.length}`);
    
    let created = 0;
    let updated = 0;
    let missingInfo = [];
    
    for (const sc of squareCustomers) {
      const dbCustomer = dbMap.get(sc.id);
      
      const given_name = sc.given_name || '';
      const family_name = sc.family_name || '';
      const phone_number = sc.phone_number || '';
      const email_address = sc.email_address || '';
      
      if (!given_name || !family_name || !phone_number) {
        missingInfo.push({
          id: sc.id,
          name: `${given_name} ${family_name}`.trim() || 'N/A',
          phone: phone_number || 'N/A',
          email: email_address || 'N/A'
        });
      }
      
      let referralCode = dbCustomer?.personal_code || dbCustomer?.referral_code;
      let referralUrl = dbCustomer?.referral_url;
      
      if (!referralCode) {
        referralCode = generateReferralCode();
        referralUrl = generateReferralUrl(referralCode);
      }
      
      const data = {
        given_name: given_name || null,
        family_name: family_name || null,
        email_address: email_address || null,
        phone_number: phone_number || null,
        personal_code: referralCode,
        referral_code: referralCode,
        referral_url: referralUrl,
        activated_as_referrer: true,
        organization_id: ORG_ID,
        raw_json: sc
      };
      
      if (dbCustomer) {
        // Update if data changed or missing
        const needsUpdate = 
          dbCustomer.given_name !== data.given_name ||
          dbCustomer.family_name !== data.family_name ||
          dbCustomer.phone_number !== data.phone_number ||
          !dbCustomer.personal_code;
          
        if (needsUpdate) {
          await prisma.squareExistingClient.update({
            where: { id: dbCustomer.id },
            data
          });
          updated++;
        }
      } else {
        await prisma.squareExistingClient.create({
          data: {
            ...data,
            square_customer_id: sc.id
          }
        });
        created++;
      }
    }
    
    console.log('\n✨ Sync complete!');
    console.log(`🆕 Created: ${created}`);
    console.log(`🔄 Updated: ${updated}`);
    console.log(`⚠️ Customers with missing info (name or phone): ${missingInfo.length}`);
    
    if (missingInfo.length > 0) {
      console.log('\n📋 Top 10 customers missing info:');
      console.table(missingInfo.slice(0, 10));
    }
    
  } catch (error) {
    console.error('💥 Fatal error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

sync();

