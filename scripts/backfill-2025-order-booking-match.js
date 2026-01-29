#!/usr/bin/env node
/**
 * Backfill booking_id and technician_id for 2025 orders and line items
 * 
 * Logic:
 * 1. Get orders with customer_id but missing booking_id (2025)
 * 2. For each order, get line items with service_variation_id
 * 3. Call Square API to list bookings for that customer around order time
 * 4. Match booking segments to line items by service_variation_id
 * 5. Update order with booking_id and technician_id (from first/primary segment)
 * 6. Update each line item with its specific technician_id from matched segment
 * 
 * Usage: node scripts/backfill-2025-order-booking-match.js
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

// Cache for team member lookups
const teamMemberCache = {};

async function getInternalTeamMemberId(squareTeamMemberId) {
  if (!squareTeamMemberId) return null;
  
  if (teamMemberCache[squareTeamMemberId]) {
    return teamMemberCache[squareTeamMemberId];
  }
  
  const tm = await prisma.$queryRaw`
    SELECT id FROM team_members WHERE square_team_member_id = ${squareTeamMemberId} LIMIT 1
  `;
  
  const internalId = tm?.[0]?.id || null;
  teamMemberCache[squareTeamMemberId] = internalId;
  return internalId;
}

// Cache for booking lookups
const bookingCache = {};

async function getInternalBookingId(squareBookingId) {
  if (!squareBookingId) return null;
  
  if (bookingCache[squareBookingId]) {
    return bookingCache[squareBookingId];
  }
  
  const b = await prisma.$queryRaw`
    SELECT id, technician_id FROM bookings WHERE booking_id = ${squareBookingId} LIMIT 1
  `;
  
  const result = b?.[0] || null;
  bookingCache[squareBookingId] = result;
  return result;
}

console.log('🔄 Backfill Order → Booking Match for Dec 2023 + 2024 (via Square API)\n');
console.log('='.repeat(70));
console.log('📅 Date Range: 2023-12-01 to 2024-12-31');
console.log('');

async function findBookingForOrder(customerId, orderClosedAt, lineItems) {
  if (!customerId || !orderClosedAt) {
    return { found: false, reason: 'missing_customer_or_date' };
  }
  
  // Get service_variation_ids from line items
  const serviceVariationIds = lineItems
    .map(li => li.service_variation_id)
    .filter(Boolean);
  
  if (serviceVariationIds.length === 0) {
    return { found: false, reason: 'no_service_variations' };
  }
  
  // Calculate time window: booking should end around order closed time
  // Booking start + duration ≈ order closed time
  // Search 12 hours before and 2 hours after (wider window for reliability)
  const orderTime = new Date(orderClosedAt);
  const startAtMin = new Date(orderTime.getTime() - 12 * 60 * 60 * 1000); // 12 hours before
  const startAtMax = new Date(orderTime.getTime() + 2 * 60 * 60 * 1000); // 2 hours after
  
  try {
    // Call Square API to list bookings for this customer
    const url = `/bookings?customer_id=${customerId}&start_at_min=${startAtMin.toISOString()}&start_at_max=${startAtMax.toISOString()}&limit=50`;
    const result = await squareApi(url);
    
    const bookings = result.bookings || [];
    
    if (bookings.length === 0) {
      return { found: false, reason: 'no_bookings_found' };
    }
    
    // Find best matching booking by service_variation_id overlap
    let bestMatch = null;
    let bestMatchScore = 0;
    
    for (const booking of bookings) {
      const segments = booking.appointment_segments || [];
      const bookingServiceIds = segments.map(s => s.service_variation_id).filter(Boolean);
      
      // Count how many of our line item services match this booking
      const matchCount = serviceVariationIds.filter(svi => bookingServiceIds.includes(svi)).length;
      
      if (matchCount > bestMatchScore) {
        bestMatchScore = matchCount;
        bestMatch = booking;
      }
    }
    
    if (!bestMatch || bestMatchScore === 0) {
      return { found: false, reason: 'no_service_match' };
    }
    
    // Build segment map: service_variation_id -> team_member_id
    const segmentMap = {};
    const segments = bestMatch.appointment_segments || [];
    for (const segment of segments) {
      if (segment.service_variation_id && segment.team_member_id) {
        segmentMap[segment.service_variation_id] = segment.team_member_id;
      }
    }
    
    // Primary technician (from first segment)
    const primaryTechnicianSquareId = segments[0]?.team_member_id || null;
    
    return {
      found: true,
      squareBookingId: bestMatch.id,
      primaryTechnicianSquareId,
      segmentMap, // service_variation_id -> square_team_member_id
      matchScore: bestMatchScore,
      totalSegments: segments.length
    };
    
  } catch (err) {
    return { found: false, reason: 'api_error', error: err.message };
  }
}

// Second attempt: Try Square API with wider time window (24 hours)
async function findBookingForOrderWider(customerId, orderClosedAt, lineItems) {
  if (!customerId || !orderClosedAt) {
    return { found: false, reason: 'missing_data' };
  }
  
  const serviceVariationIds = lineItems
    .map(li => li.service_variation_id)
    .filter(Boolean);
  
  // Wider time window: 24 hours before, 4 hours after
  const orderTime = new Date(orderClosedAt);
  const startAtMin = new Date(orderTime.getTime() - 24 * 60 * 60 * 1000);
  const startAtMax = new Date(orderTime.getTime() + 4 * 60 * 60 * 1000);
  
  try {
    const url = `/bookings?customer_id=${customerId}&start_at_min=${startAtMin.toISOString()}&start_at_max=${startAtMax.toISOString()}&limit=50`;
    const result = await squareApi(url);
    
    const bookings = result.bookings || [];
    
    if (bookings.length === 0) {
      return { found: false, reason: 'no_bookings_wider' };
    }
    
    // Find best matching booking
    let bestMatch = null;
    let bestMatchScore = 0;
    
    for (const booking of bookings) {
      const segments = booking.appointment_segments || [];
      const bookingServiceIds = segments.map(s => s.service_variation_id).filter(Boolean);
      
      const matchCount = serviceVariationIds.filter(svi => bookingServiceIds.includes(svi)).length;
      
      if (matchCount > bestMatchScore) {
        bestMatchScore = matchCount;
        bestMatch = booking;
      }
    }
    
    // If no service match, take first booking (same customer, close time)
    if (!bestMatch && bookings.length > 0) {
      bestMatch = bookings[0];
    }
    
    if (!bestMatch) {
      return { found: false, reason: 'no_match_wider' };
    }
    
    const segmentMap = {};
    const segments = bestMatch.appointment_segments || [];
    for (const segment of segments) {
      if (segment.service_variation_id && segment.team_member_id) {
        segmentMap[segment.service_variation_id] = segment.team_member_id;
      }
    }
    
    const primaryTechnicianSquareId = segments[0]?.team_member_id || null;
    
    return {
      found: true,
      squareBookingId: bestMatch.id,
      primaryTechnicianSquareId,
      segmentMap,
      matchScore: bestMatchScore,
      fromWiderSearch: true
    };
    
  } catch (err) {
    return { found: false, reason: 'api_error_wider', error: err.message };
  }
}

// Fallback: Try matching via local database when Square API fails
async function findBookingInLocalDB(customerId, orderClosedAt) {
  if (!customerId || !orderClosedAt) {
    return null;
  }
  
  const orderTime = new Date(orderClosedAt);
  const startMin = new Date(orderTime.getTime() - 12 * 60 * 60 * 1000); // 12 hours before
  const startMax = new Date(orderTime.getTime() + 2 * 60 * 60 * 1000); // 2 hours after
  
  // Find booking in our database for this customer in this time window
  const bookings = await prisma.$queryRaw`
    SELECT id, booking_id, technician_id, start_at
    FROM bookings
    WHERE customer_id = ${customerId}
      AND start_at >= ${startMin}
      AND start_at <= ${startMax}
    ORDER BY start_at
    LIMIT 1
  `;
  
  if (bookings.length === 0) {
    return null;
  }
  
  return {
    internalId: bookings[0].id,
    squareBookingId: bookings[0].booking_id,
    technicianId: bookings[0].technician_id
  };
}

async function backfillOrderBookings() {
  // Get orders with customer_id but missing booking_id (2025)
  console.log('📋 Step 1: Fetching 2025 orders without booking_id...\n');
  
  const orders = await prisma.$queryRaw`
    SELECT DISTINCT ON (o.id)
      o.id, 
      o.order_id, 
      o.customer_id, 
      o.organization_id,
      oli.order_closed_at
    FROM orders o
    JOIN order_line_items oli ON oli.order_id = o.id
    WHERE o.customer_id IS NOT NULL
      AND o.booking_id IS NULL
      AND oli.order_closed_at >= '2023-12-01'
      AND oli.order_closed_at < '2025-01-01'
    ORDER BY o.id, oli.order_closed_at
  `;
  
  console.log(`   Found ${orders.length} orders to process\n`);
  
  if (orders.length === 0) {
    console.log('   No orders to process!');
    return;
  }
  
  let matched = 0;
  let updated = 0;
  let notMatched = 0;
  let errors = 0;
  
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    
    // Progress update every 100 orders
    if ((i + 1) % 100 === 0) {
      console.log(`📊 Progress: ${i + 1}/${orders.length} (${matched} matched, ${updated} updated, ${errors} errors)`);
    }
    
    // Get line items for this order
    const lineItems = await prisma.$queryRaw`
      SELECT id, service_variation_id, name, uid
      FROM order_line_items
      WHERE order_id = ${order.id}::uuid
    `;
    
    const result = await findBookingForOrder(order.customer_id, order.order_closed_at, lineItems);
    
    let internalBookingId = null;
    let primaryTechnicianId = null;
    let segmentMap = {};
    
    if (result.found) {
      // Square API found a match
      const bookingRecord = await getInternalBookingId(result.squareBookingId);
      if (bookingRecord) {
        internalBookingId = bookingRecord.id;
        primaryTechnicianId = bookingRecord.technician_id;
        segmentMap = result.segmentMap || {};
        
        if (!primaryTechnicianId && result.primaryTechnicianSquareId) {
          primaryTechnicianId = await getInternalTeamMemberId(result.primaryTechnicianSquareId);
        }
      }
    }
    
    // Second attempt: Try Square API with wider time window
    if (!internalBookingId) {
      const widerResult = await findBookingForOrderWider(order.customer_id, order.order_closed_at, lineItems);
      if (widerResult.found) {
        const bookingRecord = await getInternalBookingId(widerResult.squareBookingId);
        if (bookingRecord) {
          internalBookingId = bookingRecord.id;
          primaryTechnicianId = bookingRecord.technician_id;
          segmentMap = widerResult.segmentMap || {};
          
          if (!primaryTechnicianId && widerResult.primaryTechnicianSquareId) {
            primaryTechnicianId = await getInternalTeamMemberId(widerResult.primaryTechnicianSquareId);
          }
        }
      }
    }
    
    // Final fallback: Try local database if Square API still didn't find a match
    if (!internalBookingId) {
      const localMatch = await findBookingInLocalDB(order.customer_id, order.order_closed_at);
      if (localMatch) {
        internalBookingId = localMatch.internalId;
        primaryTechnicianId = localMatch.technicianId;
      }
    }
    
    if (!internalBookingId) {
      notMatched++;
      continue;
    }
    
    matched++;
    
    try {
      // Update order with booking_id and technician_id
      if (primaryTechnicianId) {
        await prisma.$executeRaw`
          UPDATE orders 
          SET 
            booking_id = ${internalBookingId}::uuid,
            technician_id = ${primaryTechnicianId}::uuid,
            updated_at = NOW()
          WHERE id = ${order.id}::uuid
        `;
      } else {
        await prisma.$executeRaw`
          UPDATE orders 
          SET 
            booking_id = ${internalBookingId}::uuid,
            updated_at = NOW()
          WHERE id = ${order.id}::uuid
        `;
      }
      
      // Update each line item with its specific technician
      for (const lineItem of lineItems) {
        const serviceVariationId = lineItem.service_variation_id;
        
        // Find technician for this specific service
        let lineItemTechnicianId = primaryTechnicianId; // default to primary
        
        if (serviceVariationId && segmentMap[serviceVariationId]) {
          const segmentTechSquareId = segmentMap[serviceVariationId];
          const segmentTechId = await getInternalTeamMemberId(segmentTechSquareId);
          if (segmentTechId) {
            lineItemTechnicianId = segmentTechId;
          }
        }
        
        if (lineItemTechnicianId) {
          await prisma.$executeRaw`
            UPDATE order_line_items
            SET 
              booking_id = ${internalBookingId}::uuid,
              technician_id = ${lineItemTechnicianId}::uuid,
              updated_at = NOW()
            WHERE id = ${lineItem.id}
          `;
        } else {
          await prisma.$executeRaw`
            UPDATE order_line_items
            SET 
              booking_id = ${internalBookingId}::uuid,
              updated_at = NOW()
            WHERE id = ${lineItem.id}
          `;
        }
      }
      
      updated++;
      
    } catch (updateErr) {
      errors++;
      if (errors <= 5) {
        console.log(`   ⚠️ Error updating ${order.order_id}: ${updateErr.message.substring(0, 60)}`);
      }
    }
    
    // Rate limiting - small delay between API calls
    await new Promise(r => setTimeout(r, 50));
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('\n📊 FINAL SUMMARY:');
  console.log('='.repeat(70));
  console.log(`   📦 Total orders processed: ${orders.length}`);
  console.log(`   ✅ Matched with booking: ${matched}`);
  console.log(`   📝 Updated in database: ${updated}`);
  console.log(`   ❌ Not matched: ${notMatched}`);
  console.log(`   ⚠️ Errors: ${errors}`);
  console.log('='.repeat(70));
}

// Run
backfillOrderBookings()
  .then(() => {
    console.log('\n✅ Backfill completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error.message);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });

