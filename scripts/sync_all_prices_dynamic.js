require('dotenv').config();
const prisma = require('../lib/prisma-client');
const axios = require('axios');

async function syncAllPrices() {
  console.log('🚀 Syncing all service variation prices from Square...');
  
  let accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (accessToken) {
    accessToken = accessToken.trim();
    if (accessToken.startsWith('Bearer ')) {
      accessToken = accessToken.slice(7);
    }
  }
  const baseUrl = 'https://connect.squareup.com/v2';

  try {
    const variations = await prisma.serviceVariation.findMany({
      select: { square_variation_id: true }
    });

    console.log(`Found ${variations.length} variations in DB.`);

    for (const v of variations) {
      try {
        const response = await axios.get(`${baseUrl}/catalog/object/${v.square_variation_id}`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Square-Version': '2025-02-20',
            'Accept': 'application/json'
          }
        });

        const obj = response.data.object;
        if (obj && obj.item_variation_data && obj.item_variation_data.price_money) {
          const amount = obj.item_variation_data.price_money.amount;
          console.log(`  Updating ${v.square_variation_id} -> ${amount}`);
          await prisma.serviceVariation.update({
            where: { square_variation_id: v.square_variation_id },
            data: { price_amount: amount }
          });
        } else {
          console.warn(`  No price found for ${v.square_variation_id}`);
        }
      } catch (err) {
        console.error(`  Failed to fetch ${v.square_variation_id}:`, err.message);
      }
    }

    console.log('\n✅ Price sync completed.');
  } catch (error) {
    console.error('❌ Sync failed:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

syncAllPrices();

