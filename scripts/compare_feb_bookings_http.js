require('dotenv').config();
const axios = require('axios');
const prisma = require('../lib/prisma-client');

async function compareBookings() {
  console.log('Script started');
  
  let accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (accessToken) {
    accessToken = accessToken.trim();
    if (accessToken.startsWith('Bearer ')) {
      accessToken = accessToken.slice(7);
    }
  }
  const env = process.env.SQUARE_ENVIRONMENT || 'production';
  const baseUrl = env === 'sandbox' 
    ? 'https://connect.squareupsandbox.com/v2' 
    : 'https://connect.squareup.com/v2';

  console.log(`Using Base URL: ${baseUrl}`);

  if (!accessToken) {
    console.error('SQUARE_ACCESS_TOKEN is missing');
    return;
  }

  try {
    const startAt = '2026-02-01T00:00:00Z';
    const endAt = '2026-03-01T00:00:00Z';

    console.log(`Fetching Square bookings via HTTP from ${startAt} to ${endAt}...`);
    
    let squareBookings = [];
    let cursor = null;
    
    do {
      console.log(`Requesting Square API (cursor: ${cursor || 'none'})...`);
      const url = `${baseUrl}/bookings`;
      
      const response = await axios.get(url, {
        params: {
          start_at_min: startAt,
          start_at_max: endAt,
          cursor: cursor || undefined
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Square-Version': '2025-02-20',
          'Accept': 'application/json'
        }
      });
      
      const bookings = response.data.bookings || [];
      console.log(`Received ${bookings.length} bookings.`);
      squareBookings = squareBookings.concat(bookings);
      cursor = response.data.cursor;
    } while (cursor);

    console.log(`Total Square bookings found: ${squareBookings.length}`);

    // Fetch from DB
    console.log('Fetching bookings from DB...');
    const dbBookings = await prisma.booking.findMany({
      where: {
        start_at: {
          gte: new Date(startAt),
          lt: new Date(endAt)
        }
      }
    });
    console.log(`Total DB bookings found: ${dbBookings.length}`);

    const squareIds = new Set(squareBookings.map(b => b.id));
    const dbIds = new Set(dbBookings.map(b => b.booking_id));

    const missingInDb = squareBookings.filter(b => !dbIds.has(b.id));
    const extraInDb = dbBookings.filter(b => !squareIds.has(b.booking_id));

    console.log('\n--- Comparison Results ---');
    console.log(`Square Count: ${squareBookings.length}`);
    console.log(`DB Count:     ${dbBookings.length}`);
    console.log(`Missing in DB: ${missingInDb.length}`);
    console.log(`Extra in DB:   ${extraInDb.length}`);

    if (missingInDb.length > 0) {
      console.log('\nSample Missing IDs (Square IDs not in DB):');
      const sampleMissing = missingInDb.slice(0, 10);
      console.log(sampleMissing.map(b => ({
        id: b.id,
        start_at: b.start_at,
        status: b.status,
        customer_id: b.customer_id
      })));

      console.log('\n--- Retrieving Orders and Payments for Missing Bookings ---');
      for (const booking of sampleMissing) {
        console.log(`\nBooking ID: ${booking.id}`);
        
        try {
          // 1. Search Orders by location and customer
          const ordersResponse = await axios.post(`${baseUrl}/orders/search`, {
            location_ids: [booking.location_id],
            query: {
              filter: {
                customer_filter: {
                  customer_ids: [booking.customer_id]
                }
              }
            }
          }, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Square-Version': '2025-02-20',
              'Content-Type': 'application/json'
            }
          });

          const orders = ordersResponse.data.orders || [];
          
          // Debug: log all orders for this customer to see structure
          if (orders.length > 0) {
            console.log(`  Customer has ${orders.length} total orders at this location.`);
            
            // Try to find order by matching booking_id in any field
            const relatedOrders = orders.filter(o => {
              const orderStr = JSON.stringify(o);
              return orderStr.includes(booking.id);
            });

            if (relatedOrders.length > 0) {
              console.log(`  Found ${relatedOrders.length} orders explicitly linked to booking ${booking.id}:`);
              for (const order of relatedOrders) {
                console.log(`  - Order ID: ${order.id}, State: ${order.state}, Created: ${order.created_at}`);
                if (order.line_items) {
                  console.log(`    Line Items:`);
                  order.line_items.forEach(li => {
                    console.log(`    * ${li.name} x${li.quantity} (${li.total_money?.amount} ${li.total_money?.currency})`);
                  });
                }
                
                // Fetch payments for this order
                const paymentsResponse = await axios.get(`${baseUrl}/payments`, {
                  params: { order_id: order.id },
                  headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Square-Version': '2025-02-20'
                  }
                });
                const payments = paymentsResponse.data.payments || [];
                if (payments.length > 0) {
                  console.log(`    Payments:`);
                  payments.forEach(p => {
                    console.log(`    $ ${p.amount_money?.amount} ${p.amount_money?.currency} - Status: ${p.status} (ID: ${p.id})`);
                  });
                }
              }
            } else {
              // If no explicit link, show orders created around the same time as the booking
              const bookingDate = new Date(booking.start_at);
              const closeOrders = orders.filter(o => {
                const orderDate = new Date(o.created_at);
                const diffHours = Math.abs(orderDate - bookingDate) / (1000 * 60 * 60);
                return diffHours < 24; // Within 24 hours
              });

              if (closeOrders.length > 0) {
                console.log(`  No explicit link found, but ${closeOrders.length} orders were created within 24h of booking:`);
                for (const o of closeOrders) {
                  console.log(`  - Potential Order ID: ${o.id}, Created: ${o.created_at}, Total: ${o.total_money?.amount} ${o.total_money?.currency}`);
                  
                  // Retrieve full order details including line items
                  try {
                    const fullOrderResponse = await axios.get(`${baseUrl}/orders/${o.id}`, {
                      headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Square-Version': '2025-02-20'
                      }
                    });
                    const fullOrder = fullOrderResponse.data.order;
                    if (fullOrder.line_items) {
                      console.log(`    Line Items:`);
                      fullOrder.line_items.forEach(li => {
                        console.log(`    * ${li.name} x${li.quantity} (${li.total_money?.amount} ${li.total_money?.currency})`);
                      });
                    }

                    // Retrieve payments for this order
                    const paymentsResponse = await axios.get(`${baseUrl}/payments`, {
                      params: { 
                        location_id: booking.location_id,
                        begin_time: new Date(new Date(o.created_at).getTime() - 1000 * 60 * 60).toISOString(), // 1h before order
                        end_time: new Date(new Date(o.created_at).getTime() + 1000 * 60 * 60 * 2).toISOString() // 2h after order
                      },
                      headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Square-Version': '2025-02-20'
                      }
                    });
                    const payments = paymentsResponse.data.payments || [];
                    // Filter payments that belong to this order
                    const orderPayments = payments.filter(p => p.order_id === o.id);
                    
                    if (orderPayments.length > 0) {
                      console.log(`    Payments:`);
                      orderPayments.forEach(p => {
                        console.log(`    $ ${p.amount_money?.amount} ${p.amount_money?.currency} - Status: ${p.status} (ID: ${p.id})`);
                      });
                    } else {
                      console.log(`    No payments found linked to this order ID.`);
                    }
                  } catch (orderErr) {
                    console.error(`    Error fetching full details for order ${o.id}:`, orderErr.message);
                  }
                }
              } else {
                console.log(`  No orders found for this customer within 24h of the booking.`);
              }
            }
          } else {
            console.log(`  No orders found for this customer at this location.`);
          }
        } catch (err) {
          console.error(`  Error:`, err.response?.data || err.message);
        }
      }
    }

  } catch (error) {
    console.error('Error:', error.response ? error.response.data : error.message);
  } finally {
    await prisma.$disconnect();
  }
}

compareBookings();
