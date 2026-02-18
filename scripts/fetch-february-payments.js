#!/usr/bin/env node
/**
 * Fetch all payments for February 2026 from Square API
 * Uses List Payments endpoint with date range filtering
 * Reference: https://developer.squareup.com/reference/square/payments-api/list-payments
 */

require('dotenv').config();
const axios = require('axios');

const squareAccessToken = process.env.SQUARE_ACCESS_TOKEN;
const squareVersion = '2026-01-22';

if (!squareAccessToken) {
  console.error('❌ SQUARE_ACCESS_TOKEN not found in environment');
  process.exit(1);
}

async function fetchPayments(cursor = null) {
  const beginTime = '2026-02-01T00:00:00Z';
  const endTime = '2026-02-28T23:59:59Z';
  
  const params = {
    begin_time: beginTime,
    end_time: endTime,
    limit: 100,
    sort_order: 'ASC'
  };
  
  if (cursor) {
    params.cursor = cursor;
  }

  try {
    const response = await axios.get('https://connect.squareup.com/v2/payments', {
      params,
      headers: {
        'Square-Version': squareVersion,
        'Authorization': `Bearer ${squareAccessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data;
  } catch (error) {
    throw new Error(`Square API error: ${error.response?.status} - ${error.response?.data?.errors?.[0]?.detail || error.message}`);
  }
}

async function getAllPayments() {
  console.log('📊 Fetching all February 2026 payments from Square API...\n');
  console.log('='.repeat(120));
  
  let allPayments = [];
  let cursor = null;
  let pageNum = 1;

  try {
    do {
      console.log(`\nFetching page ${pageNum}...`);
      const response = await fetchPayments(cursor);
      
      if (response.payments && response.payments.length > 0) {
        allPayments = allPayments.concat(response.payments);
        console.log(`✅ Page ${pageNum}: ${response.payments.length} payments`);
      }
      
      cursor = response.cursor;
      pageNum++;
      
    } while (cursor);

    console.log(`\n${'='.repeat(120)}`);
    console.log(`✅ Total payments fetched: ${allPayments.length}`);
    
    // Summary statistics
    let totalAmount = 0;
    let completedCount = 0;
    let locationMap = {};
    let statusMap = {};

    allPayments.forEach(payment => {
      if (payment.amount_money) {
        totalAmount += payment.amount_money.amount;
      }
      if (payment.status === 'COMPLETED') {
        completedCount++;
      }
      
      statusMap[payment.status] = (statusMap[payment.status] || 0) + 1;
      
      if (payment.location_id) {
        locationMap[payment.location_id] = (locationMap[payment.location_id] || 0) + 1;
      }
    });

    console.log(`\n💰 Summary:`);
    console.log(`  Total Amount: $${(totalAmount / 100).toFixed(2)}`);
    console.log(`  Completed: ${completedCount}`);
    console.log(`\n📍 By Status:`);
    Object.entries(statusMap).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });

    console.log(`\n📍 By Location:`);
    Object.entries(locationMap).forEach(([locId, count]) => {
      console.log(`  ${locId}: ${count} payments`);
    });

    console.log(`\n${'='.repeat(120)}`);
    console.log(`\nFirst 10 Payments (sorted by date):`);
    console.log('-'.repeat(120));
    console.log('Date | Status | Amount | Location ID | Card Last 4 | Receipt # | Order ID');
    console.log('-'.repeat(120));
    
    allPayments.slice(0, 10).forEach(p => {
      const date = new Date(p.created_at).toLocaleDateString();
      const amount = p.amount_money ? (p.amount_money.amount / 100).toFixed(2) : 'N/A';
      const last4 = p.card_details?.card?.last_4 || 'N/A';
      const receipt = p.receipt_number || 'N/A';
      const orderId = p.order_id ? p.order_id.substring(0, 8) + '...' : 'N/A';
      console.log(`${date} | ${p.status} | $${amount} | ${p.location_id?.substring(0, 8) || 'N/A'} | ${last4} | ${receipt} | ${orderId}`);
    });

    // Group by location
    console.log(`\n${'='.repeat(120)}`);
    console.log(`\nPayments by Location:`);
    console.log('-'.repeat(120));

    const locationDetails = {};
    allPayments.forEach(p => {
      if (p.location_id) {
        if (!locationDetails[p.location_id]) {
          locationDetails[p.location_id] = {
            count: 0,
            totalAmount: 0,
            completed: 0
          };
        }
        locationDetails[p.location_id].count++;
        if (p.amount_money) {
          locationDetails[p.location_id].totalAmount += p.amount_money.amount;
        }
        if (p.status === 'COMPLETED') {
          locationDetails[p.location_id].completed++;
        }
      }
    });

    Object.entries(locationDetails).forEach(([locId, details]) => {
      const avgAmount = (details.totalAmount / details.count / 100).toFixed(2);
      console.log(`Location ${locId}:`);
      console.log(`  Payments: ${details.count}`);
      console.log(`  Completed: ${details.completed}`);
      console.log(`  Total Amount: $${(details.totalAmount / 100).toFixed(2)}`);
      console.log(`  Average: $${avgAmount}\n`);
    });

    console.log(`${'='.repeat(120)}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

getAllPayments();

