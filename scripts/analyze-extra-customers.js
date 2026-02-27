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
      if (data.customers) {
        data.customers.forEach(c => allIds.add(c.id));
      }
      cursor = data.cursor;
    } while (cursor);
    return allIds;
  } catch (error) {
    console.error('Error fetching Square IDs:', error);
    throw error;
  }
}

async function analyzeExtraCustomers() {
  console.log('🔍 Analyzing customers present in DB but missing in Square...');
  
  try {
    const squareIds = await fetchAllSquareCustomerIds();
    console.log(`✅ Square IDs fetched: ${squareIds.size}`);
    
    const dbCustomers = await prisma.squareExistingClient.findMany({
      where: { organization_id: ORG_ID },
      select: {
        id: true,
        square_customer_id: true,
        given_name: true,
        family_name: true,
        email_address: true,
        created_at: true
      }
    });
    
    const extraCustomers = dbCustomers.filter(c => !squareIds.has(c.square_customer_id));
    console.log(`📊 Found ${extraCustomers.length} extra customers in DB.`);
    
    const analysis = [];
    
    for (const customer of extraCustomers) {
      // Check for bookings
      const bookingCount = await prisma.booking.count({
        where: { 
          organization_id: ORG_ID,
          customer_id: customer.square_customer_id 
        }
      });
      
      // Check for payments
      const paymentCount = await prisma.payment.count({
        where: { 
          organization_id: ORG_ID,
          customer_id: customer.square_customer_id 
        }
      });
      
      analysis.push({
        square_id: customer.square_customer_id,
        name: `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'N/A',
        email: customer.email_address || 'N/A',
        created_at: customer.created_at,
        bookings: bookingCount,
        payments: paymentCount
      });
    }
    
    // Sort by activity (most active first)
    analysis.sort((a, b) => (b.bookings + b.payments) - (a.bookings + a.payments));
    
    console.log('\n--- Analysis of Extra Customers (Top 20) ---');
    console.table(analysis.slice(0, 20).map(c => ({
      ...c,
      created_at: c.created_at?.toISOString().split('T')[0]
    })));
    
    const withActivity = analysis.filter(c => c.bookings > 0 || c.payments > 0);
    const withoutActivity = analysis.filter(c => c.bookings === 0 && c.payments === 0);
    
    console.log(`\n📈 Summary:`);
    console.log(`- Total extra: ${analysis.length}`);
    console.log(`- With activity (bookings/payments): ${withActivity.length}`);
    console.log(`- Without any activity: ${withoutActivity.length}`);
    
    if (withoutActivity.length > 0) {
      console.log(`\n💡 Recommendation: You can safely delete the ${withoutActivity.length} customers with no activity.`);
    }

  } catch (error) {
    console.error('💥 Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

analyzeExtraCustomers();


