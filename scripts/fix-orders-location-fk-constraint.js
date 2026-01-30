#!/usr/bin/env node
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const prisma = require('../lib/prisma-client')

async function runMigration() {
  console.log('🔧 Fixing orders_location_id_fkey Foreign Key Constraint')
  console.log('='.repeat(60))
  console.log('')

  try {
    // Step 1: Check current constraint state
    console.log('📋 Step 1: Checking current constraint state...')
    const currentConstraint = await prisma.$queryRaw`
      SELECT
        tc.constraint_name,
        tc.table_name AS source_table,
        kcu.column_name AS source_column,
        ccu.table_name AS referenced_table,
        ccu.column_name AS referenced_column
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.constraint_name = 'orders_location_id_fkey';
    `

    if (!currentConstraint || currentConstraint.length === 0) {
      console.log('   ⚠️  Constraint not found. It may have already been dropped.')
      console.log('   Proceeding to create correct constraint...')
    } else {
      const constraint = currentConstraint[0]
      console.log(`   Current constraint:`)
      console.log(`      ${constraint.source_table}.${constraint.source_column} → ${constraint.referenced_table}.${constraint.referenced_column}`)
      
      if (constraint.referenced_table === 'locations' && constraint.referenced_column === 'id') {
        console.log('   ✅ Constraint is already correct! No migration needed.')
        return
      }
      
      if (constraint.referenced_column === 'square_location_id') {
        console.log('   ❌ Constraint points to wrong column: square_location_id')
        console.log('   ✅ This is the issue we need to fix!')
      }
    }
    console.log('')

    // Step 2: Check data type and migrate if needed
    console.log('📋 Step 2: Checking column data type and data...')
    const columnInfo = await prisma.$queryRaw`
      SELECT 
        column_name,
        data_type,
        udt_name
      FROM information_schema.columns
      WHERE table_name = 'orders'
        AND column_name = 'location_id'
    `
    
    const needsTypeConversion = columnInfo && columnInfo.length > 0 && 
      columnInfo[0].data_type !== 'uuid' && columnInfo[0].udt_name !== 'uuid'
    
    if (needsTypeConversion) {
      const col = columnInfo[0]
      console.log(`   Column type: ${col.data_type} (${col.udt_name})`)
      console.log('   ⚠️  Column is not UUID type - need to convert data and type')
      
      // Check how many orders have location_id
      const orderCount = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM orders WHERE location_id IS NOT NULL
      `
      const totalOrders = parseInt(orderCount[0]?.count || 0)
      console.log(`   Found ${totalOrders} orders with location_id`)
      
      // Check how many are valid UUIDs vs Square IDs
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      const sampleData = await prisma.$queryRaw`
        SELECT location_id FROM orders WHERE location_id IS NOT NULL LIMIT 10
      `
      
      let needsDataMigration = false
      if (sampleData && sampleData.length > 0) {
        const hasNonUUID = sampleData.some(row => !uuidPattern.test(row.location_id))
        if (hasNonUUID) {
          needsDataMigration = true
          console.log('   ⚠️  Found non-UUID values (likely Square IDs) - need data migration')
        } else {
          console.log('   ✅ All sample values are valid UUIDs')
        }
      }
      
      if (needsDataMigration) {
        console.log('   Migrating Square IDs to UUIDs...')
        // Convert Square IDs to UUIDs by looking up in locations table
        await prisma.$executeRaw`
          UPDATE orders o
          SET location_id = l.id::text
          FROM locations l
          WHERE o.location_id = l.square_location_id
            AND o.location_id IS NOT NULL
            AND o.location_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        `
        console.log('   ✅ Migrated Square IDs to UUIDs')
      }
      
      // Drop dependent view first
      console.log('   Dropping dependent view analytics_revenue_by_location_daily...')
      await prisma.$executeRaw`
        DROP VIEW IF EXISTS analytics_revenue_by_location_daily CASCADE
      `
      console.log('   ✅ Dropped view')
      
      // Change column type to UUID
      console.log('   Converting column type from TEXT to UUID...')
      await prisma.$executeRaw`
        ALTER TABLE orders 
        ALTER COLUMN location_id TYPE uuid USING location_id::uuid
      `
      console.log('   ✅ Column type converted to UUID')
      
      // Recreate the view
      console.log('   Recreating view analytics_revenue_by_location_daily...')
      await prisma.$executeRaw`
        CREATE OR REPLACE VIEW analytics_revenue_by_location_daily AS
        WITH payment_locations AS (
          -- Payments with direct location_id
          SELECT 
            p.id as payment_id,
            p.organization_id,
            p.location_id::uuid as location_id,
            p.created_at,
            p.total_money_amount,
            p.customer_id,
            p.status
          FROM payments p
          WHERE p.status = 'COMPLETED'
            AND p.location_id IS NOT NULL
          
          UNION ALL
          
          -- Payments without location_id but linked to orders with location_id
          SELECT 
            p.id as payment_id,
            p.organization_id,
            o.location_id::uuid as location_id,
            p.created_at,
            p.total_money_amount,
            p.customer_id,
            p.status
          FROM payments p
          INNER JOIN orders o ON p.order_id::uuid = o.id::uuid
          WHERE p.status = 'COMPLETED'
            AND p.location_id IS NULL
            AND p.order_id IS NOT NULL
            AND o.location_id IS NOT NULL
        )
        SELECT
          pl.organization_id,
          pl.location_id,
          l.name as location_name,
          DATE(pl.created_at) as date,
          SUM(pl.total_money_amount) as revenue_cents,
          SUM(pl.total_money_amount)::DECIMAL / 100.0 as revenue_dollars,
          COUNT(DISTINCT pl.payment_id) as payment_count,
          COUNT(DISTINCT pl.customer_id) as unique_customers
        FROM payment_locations pl
        INNER JOIN locations l 
          ON pl.location_id = l.id
          AND pl.organization_id = l.organization_id
        GROUP BY pl.organization_id, pl.location_id, l.name, DATE(pl.created_at)
      `
      console.log('   ✅ Recreated view')
    } else {
      console.log('   ✅ Column is already UUID type')
    }
    console.log('')

    // Step 3: Drop old constraint and create new one
    console.log('📋 Step 3: Fixing FK constraint...')
    console.log('   Dropping incorrect constraint...')
    await prisma.$executeRaw`
      ALTER TABLE orders 
      DROP CONSTRAINT IF EXISTS orders_location_id_fkey;
    `
    console.log('   ✅ Dropped old constraint')
    
    console.log('   Creating correct constraint...')
    await prisma.$executeRaw`
      ALTER TABLE orders 
      ADD CONSTRAINT orders_location_id_fkey 
      FOREIGN KEY (location_id) 
      REFERENCES locations(id) 
      ON DELETE RESTRICT;
    `
    console.log('   ✅ Created new constraint')
    console.log('')

    // Step 4: Verify the fix
    console.log('📋 Step 4: Verifying new constraint...')
    const newConstraint = await prisma.$queryRaw`
      SELECT
        tc.constraint_name,
        tc.table_name AS source_table,
        kcu.column_name AS source_column,
        ccu.table_name AS referenced_table,
        ccu.column_name AS referenced_column
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.constraint_name = 'orders_location_id_fkey';
    `

    if (!newConstraint || newConstraint.length === 0) {
      throw new Error('Failed to verify new constraint!')
    }

    const constraint = newConstraint[0]
    console.log(`   New constraint:`)
    console.log(`      ${constraint.source_table}.${constraint.source_column} → ${constraint.referenced_table}.${constraint.referenced_column}`)
    
    if (constraint.referenced_table === 'locations' && constraint.referenced_column === 'id') {
      console.log('   ✅ Constraint is now correct!')
    } else {
      throw new Error(`Constraint verification failed! Points to ${constraint.referenced_table}.${constraint.referenced_column} instead of locations.id`)
    }
    console.log('')

    // Final verification
    console.log('📋 Step 5: Final verification...')
    console.log('   ✅ Constraint successfully updated')
    console.log('   Note: If orders.location_id contains non-UUID values,')
    console.log('         they will need to be migrated separately.')

    console.log('')
    console.log('='.repeat(60))
    console.log('✅ Migration completed successfully!')
    console.log('')
    console.log('The foreign key constraint now correctly points to:')
    console.log('  orders.location_id → locations.id')

  } catch (error) {
    console.error('')
    console.error('❌ Migration failed:', error.message)
    console.error('   Stack:', error.stack)
    console.error('')
    console.error('⚠️  The database may be in an inconsistent state.')
    console.error('   Review the error and manually fix if needed.')
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run migration
runMigration()

