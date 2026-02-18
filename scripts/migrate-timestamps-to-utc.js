#!/usr/bin/env node

/**
 * Migration: Convert timestamp columns to timestamptz (with timezone)
 * 
 * This migration changes all timestamp columns to timestamptz to properly handle UTC timestamps.
 * 
 * Context:
 * - Square sends all timestamps in UTC
 * - Database columns need to be timestamptz to preserve timezone information
 * - Analytics queries will use AT TIME ZONE 'America/Los_Angeles' for Pacific time display
 * 
 * Tables affected:
 * - bookings: created_at, updated_at, start_at
 * - booking_segments: created_at, updated_at, booking_created_at, booking_start_at
 * - payments: created_at, updated_at
 * - orders: created_at, updated_at
 * - order_line_items: created_at, updated_at
 * - payments: created_at, updated_at
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting timestamp migration to timestamptz...\n');

  try {
    // Bookings table
    console.log('📅 Migrating bookings table...');
    await prisma.$executeRaw`
      ALTER TABLE bookings
        ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
        ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC',
        ALTER COLUMN start_at TYPE timestamptz USING start_at AT TIME ZONE 'UTC';
    `;
    console.log('   ✅ bookings table migrated');

    // BookingSegments table
    console.log('📅 Migrating booking_segments table...');
    await prisma.$executeRaw`
      ALTER TABLE booking_segments
        ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
        ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC',
        ALTER COLUMN booking_created_at TYPE timestamptz USING booking_created_at AT TIME ZONE 'UTC',
        ALTER COLUMN booking_start_at TYPE timestamptz USING booking_start_at AT TIME ZONE 'UTC',
        ALTER COLUMN deleted_at TYPE timestamptz USING deleted_at AT TIME ZONE 'UTC';
    `;
    console.log('   ✅ booking_segments table migrated');

    // Payments table
    console.log('📅 Migrating payments table...');
    await prisma.$executeRaw`
      ALTER TABLE payments
        ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
        ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
    `;
    console.log('   ✅ payments table migrated');

    // Orders table
    console.log('📅 Migrating orders table...');
    await prisma.$executeRaw`
      ALTER TABLE orders
        ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
        ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
    `;
    console.log('   ✅ orders table migrated');

    // OrderLineItems table
    console.log('📅 Migrating order_line_items table...');
    await prisma.$executeRaw`
      ALTER TABLE order_line_items
        ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
        ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC',
        ALTER COLUMN order_created_at TYPE timestamptz USING order_created_at AT TIME ZONE 'UTC';
    `;
    console.log('   ✅ order_line_items table migrated');

    // SquareExistingClients table
    console.log('📅 Migrating square_existing_clients table...');
    await prisma.$executeRaw`
      ALTER TABLE square_existing_clients
        ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
        ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
    `;
    console.log('   ✅ square_existing_clients table migrated');

    console.log('\n✨ All timestamp columns successfully migrated to timestamptz!\n');
    console.log('📝 Summary:');
    console.log('   - All timestamps now include timezone information');
    console.log('   - UTC timestamps are preserved correctly');
    console.log('   - Analytics queries can now use AT TIME ZONE for Pacific time conversion');
    console.log('   - Existing data treated as UTC (which is correct since Square sends UTC)');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

