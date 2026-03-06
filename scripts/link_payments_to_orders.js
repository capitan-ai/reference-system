require('dotenv').config();
const prisma = require('../lib/prisma-client');

async function linkPaymentsToOrders() {
  console.log('🚀 Linking backfilled payments to their orders...');
  
  const paymentOrderMap = [
    { payment_id: 'hmBZ3I6v2vDm5M36WXna64XGG1ZZY', order_id: 'xgxTXUGpxHYqUf2ajY2mK8VlCM8YY' },
    { payment_id: 'Nw9W5QstR80WmqayW2X0FNWGSl6YY', order_id: 'LnGlwHSoVzcnfsRtuAR3Bcjpl7SZY' }
  ];

  const organizationId = 'd0e24178-2f94-4033-bc91-41f22df58278';

  for (const mapping of paymentOrderMap) {
    try {
      // Find the internal order UUID
      const dbOrder = await prisma.order.findFirst({
        where: { order_id: mapping.order_id, organization_id: organizationId }
      });

      if (dbOrder) {
        console.log(`Linking payment ${mapping.payment_id} to order UUID ${dbOrder.id}...`);
        await prisma.$executeRaw`
          UPDATE payments 
          SET order_id = ${dbOrder.id}::uuid
          WHERE payment_id = ${mapping.payment_id} 
            AND organization_id = ${organizationId}::uuid
        `;
        console.log(`✅ Successfully linked ${mapping.payment_id}`);
      } else {
        console.warn(`⚠️ Could not find order ${mapping.order_id} in DB`);
      }
    } catch (err) {
      console.error(`❌ Failed to link payment ${mapping.payment_id}:`, err.message);
    }
  }

  console.log('\n✨ Payment-Order linking completed.');
  await prisma.$disconnect();
}

linkPaymentsToOrders();

