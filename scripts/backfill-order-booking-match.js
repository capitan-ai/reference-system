#!/usr/bin/env node
/**
 * Backfill booking_id and technician_id for orders and order_line_items
 * 
 * Logic:
 * 1. Get orders with customer_id but missing booking_id
 * 2. For each order, get service_variation_ids from line items
 * 3. Call Square Bookings API to list bookings for that customer around order time
 * 4. Match by service_variation_id
 * 5. Update order with booking_id
 * 6. Update order_line_items with technician_id
 * 
 * Usage: node scripts/backfill-order-booking-match.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN?.trim();
const SQUARE_API_BASE = 'https://connect.squareup.com/v2';

// Helper to make Square API calls
async function squareApi(endpoint, method = 'GET', body = null) {
  const url = `${SQUARE_API_BASE}${endpoint}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-01-18'
    }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(`Square API error: ${JSON.stringify(data.errors || data)}`);
  }
  
  return data;
}

// Date range: Last 30 days
const endDate = new Date();
const startDate = new Date();
startDate.setDate(startDate.getDate() - 30);

console.log('🔄 Backfill Order → Booking Match (LIVE UPDATE)\n');
console.log('='.repeat(60));
console.log('📅 Date Range: Last 30 days');
console.log('   ' + startDate.toISOString().split('T')[0] + ' → ' + endDate.toISOString().split('T')[0]);
console.log('');

async function findBookingForOrder(order, lineItems) {
  const customerId = order.customer_id;
  const locationId = order.location_id;
  const orderCreatedAt = order.raw_json?.created_at || order.raw_json?.createdAt;
  
  if (!customerId) {
    return { found: false, reason: 'no_customer_id' };
  }
  
  // Get service_variation_ids from line items
  const serviceVariationIds = lineItems
    .map(li => li.service_variation_id)
    .filter(Boolean);
  
  if (serviceVariationIds.length === 0) {
    return { found: false, reason: 'no_service_variations' };
  }
  
  // Calculate time window: 4 hours before order creation
  const orderTime = new Date(orderCreatedAt);
  const startAt = new Date(orderTime.getTime() - 4 * 60 * 60 * 1000); // 4 hours before
  const endAt = orderTime; // Up to order creation
  
  try {
    // List bookings with customer filter
    const listUrl = `/bookings?customer_id=${customerId}&start_at_min=${startAt.toISOString()}&start_at_max=${endAt.toISOString()}&limit=100`;
    let bookings = [];
    
    try {
      const listResult = await squareApi(listUrl, 'GET');
      bookings = listResult.bookings || [];
    } catch (listErr) {
      return { found: false, reason: 'api_error' };
    }
    
    if (bookings.length === 0) {
      return { found: false, reason: 'no_bookings_found' };
    }
    
    // Match by service_variation_id
    for (const booking of bookings) {
      const segments = booking.appointment_segments || [];
      
      for (const segment of segments) {
        const bookingServiceVariationId = segment.service_variation_id;
        
        if (serviceVariationIds.includes(bookingServiceVariationId)) {
          return {
            found: true,
            squareBookingId: booking.id,
            squareTechnicianId: segment.team_member_id,
            matchedServiceVariationId: bookingServiceVariationId,
            allSegments: segments // Return all segments for multi-service matching
          };
        }
      }
    }
    
    return { found: false, reason: 'no_service_match' };
    
  } catch (error) {
    return { found: false, reason: 'api_error', error: error.message };
  }
}

async function backfillOrderBookings() {
  // Get orders with customer_id but missing booking_id (last 30 days)
  console.log('📋 Step 1: Fetching orders without booking_id...\n');
  
  const orders = await prisma.$queryRaw`
    SELECT 
      o.id, 
      o.order_id, 
      o.customer_id, 
      o.location_id,
      o.booking_id,
      o.raw_json
    FROM orders o
    WHERE o.customer_id IS NOT NULL
      AND o.booking_id IS NULL
      AND o.raw_json->>'state' = 'COMPLETED'
      AND (o.raw_json->>'created_at')::timestamp >= NOW() - INTERVAL '30 days'
      AND EXISTS (
        SELECT 1 FROM order_line_items oli 
        WHERE oli.order_id = o.id 
        AND oli.service_variation_id IS NOT NULL
      )
  `;
  
  console.log(`   Found ${orders.length} orders to process\n`);
  
  let matched = 0;
  let notMatched = 0;
  let updated = 0;
  let errors = 0;
  
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    
    // Progress update every 50 orders
    if ((i + 1) % 50 === 0) {
      console.log(`📊 Progress: ${i + 1}/${orders.length} (${matched} matched, ${updated} updated)`);
    }
    
    // Get line items for this order
    const lineItems = await prisma.$queryRaw`
      SELECT id, service_variation_id, name, uid
      FROM order_line_items
      WHERE order_id = ${order.id}::uuid
    `;
    
    const result = await findBookingForOrder(order, lineItems);
    
    if (result.found) {
      matched++;
      
      // Look up internal booking UUID from our bookings table
      let internalBookingId = null;
      let internalTechnicianId = null;
      
      if (result.squareBookingId) {
        const bookingRecord = await prisma.$queryRaw`
          SELECT id, technician_id FROM bookings WHERE booking_id = ${result.squareBookingId} LIMIT 1
        `;
        if (bookingRecord && bookingRecord.length > 0) {
          internalBookingId = bookingRecord[0].id;
          internalTechnicianId = bookingRecord[0].technician_id;
        }
      }
      
      // If no internal booking found, try to get technician from team_members table
      if (!internalTechnicianId && result.squareTechnicianId) {
        const techRecord = await prisma.$queryRaw`
          SELECT id FROM team_members WHERE square_team_member_id = ${result.squareTechnicianId} LIMIT 1
        `;
        if (techRecord && techRecord.length > 0) {
          internalTechnicianId = techRecord[0].id;
        }
      }
      
      // Update order with booking_id (if we have internal booking)
      if (internalBookingId) {
        try {
          await prisma.$executeRaw`
            UPDATE orders SET booking_id = ${internalBookingId}::uuid WHERE id = ${order.id}::uuid
          `;
          updated++;
        } catch (updateErr) {
          errors++;
        }
      }
      
      // Update order_line_items with technician_id
      if (internalTechnicianId) {
        try {
          // Match line items by service_variation_id from booking segments
          for (const segment of result.allSegments || []) {
            const segmentServiceVariationId = segment.service_variation_id;
            const segmentTechnicianSquareId = segment.team_member_id;
            
            // Get internal technician ID for this segment
            let segmentTechnicianId = internalTechnicianId;
            if (segmentTechnicianSquareId && segmentTechnicianSquareId !== result.squareTechnicianId) {
              const segTechRecord = await prisma.$queryRaw`
                SELECT id FROM team_members WHERE square_team_member_id = ${segmentTechnicianSquareId} LIMIT 1
              `;
              if (segTechRecord && segTechRecord.length > 0) {
                segmentTechnicianId = segTechRecord[0].id;
              }
            }
            
            // Update line items that match this service variation
            await prisma.$executeRaw`
              UPDATE order_line_items 
              SET technician_id = ${segmentTechnicianId}::uuid,
                  booking_id = ${internalBookingId}::uuid
              WHERE order_id = ${order.id}::uuid
                AND service_variation_id = ${segmentServiceVariationId}
            `;
          }
        } catch (liUpdateErr) {
          // Non-critical error
        }
      }
      
    } else {
      notMatched++;
    }
    
    // Rate limiting
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 FINAL SUMMARY:');
  console.log('='.repeat(60));
  console.log(`   📦 Total orders processed: ${orders.length}`);
  console.log(`   ✅ Matched with booking: ${matched}`);
  console.log(`   📝 Updated in database: ${updated}`);
  console.log(`   ❌ Not matched: ${notMatched}`);
  console.log(`   ⚠️ Errors: ${errors}`);
  console.log('='.repeat(60));
  
  return { total: orders.length, matched, updated, notMatched, errors };
}

// Run
backfillOrderBookings()
  .then(() => {
    console.log('\n✅ Backfill completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
