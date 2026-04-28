require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const { getBookingsApi, getBookingCustomAttributesApi } = require('../lib/utils/square-client');

const prisma = new PrismaClient();

async function main() {
  const bookingsApi = getBookingsApi();
  const bookingCustomAttributesApi = getBookingCustomAttributesApi();

  // 1. List all booking custom attribute definitions (intake form questions show up here)
  console.log('\n=== Booking Custom Attribute Definitions ===');
  try {
    const { result } = await bookingCustomAttributesApi.listBookingCustomAttributeDefinitions();
    if (result.customAttributeDefinitions?.length) {
      result.customAttributeDefinitions.forEach(def => {
        console.log(`  key:         ${def.key}`);
        console.log(`  name:        ${def.name}`);
        console.log(`  description: ${def.description || '(none)'}`);
        console.log('  ---');
      });
    } else {
      console.log('  No custom attribute definitions found.');
    }
  } catch (e) {
    console.error('  Error:', e.message, JSON.stringify(e.errors));
  }

  // 2. Fetch recent bookings from DB and check both custom_fields and custom attributes
  console.log('\n=== Custom Fields & Attributes on Recent Bookings ===');
  const recentBookings = await prisma.$queryRaw`
    SELECT booking_id, customer_id, start_at
    FROM bookings
    WHERE booking_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 5
  `;

  for (const booking of recentBookings) {
    console.log(`\n  Booking ${booking.booking_id} | customer ${booking.customer_id}`);

    // Fetch full booking from Square (includes custom_fields = intake form answers)
    try {
      const { result: bookingResult } = await bookingsApi.retrieveBooking(booking.booking_id);
      const b = bookingResult.booking;
      const customFields = b?.custom_fields;
      if (Array.isArray(customFields) && customFields.length) {
        console.log('  ✅ custom_fields (intake form answers):');
        customFields.forEach(f => {
          const name = f.title || f.name || f.label || '(no name)';
          const value = f.string_value ?? f.value ?? '(no value)';
          const key = f.booking_custom_field_id || f.custom_field_id || '(no key)';
          console.log(`    [${key}] "${name}" = "${value}"`);
        });
      } else {
        console.log('  No custom_fields on this booking.');
      }
    } catch (e) {
      console.log(`  retrieveBooking error: ${e.message}`);
    }

    // Also check custom attributes endpoint
    try {
      const { result: attrResult } = await bookingCustomAttributesApi.listBookingCustomAttributes(booking.booking_id);
      if (attrResult.customAttributes?.length) {
        console.log('  Custom attributes (via attributes API):');
        attrResult.customAttributes.forEach(attr => {
          const value = attr.value?.string_value ?? attr.value ?? '(no value)';
          console.log(`    key="${attr.key}" value="${JSON.stringify(value)}"`);
        });
      } else {
        console.log('  No custom attributes via attributes API.');
      }
    } catch (e) {
      console.log(`  listBookingCustomAttributes error: ${e.message}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
