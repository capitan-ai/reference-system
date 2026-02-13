#!/usr/bin/env node

/**
 * Fix gift_cards table unique constraint
 * Adds composite unique constraint (organization_id, square_gift_card_id)
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function fixConstraint() {
  console.log('🔧 Fixing gift_cards unique constraint...\n');

  try {
    // Read the migration SQL
    const sqlPath = path.join(__dirname, '../prisma/migrations/20260213190000_add_gift_cards_composite_unique_constraint/migration.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('📋 Executing migration SQL...\n');

    // Execute the migration
    await prisma.$executeRawUnsafe(sql);

    console.log('✅ Migration executed successfully!\n');

    // Verify the constraint exists
    const constraintCheck = await prisma.$queryRaw`
      SELECT conname 
      FROM pg_constraint 
      WHERE conrelid = 'gift_cards'::regclass
      AND contype = 'u'
      AND conname = 'gift_cards_organization_id_square_gift_card_id_key'
    `;

    if (constraintCheck && constraintCheck.length > 0) {
      console.log('✅ Verified: Composite unique constraint exists\n');
    } else {
      console.warn('⚠️  Warning: Constraint not found after migration\n');
    }

    console.log('✨ Fix complete!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('already exists') || error.message.includes('does not exist')) {
      console.log('ℹ️  This is expected if the constraint already exists or was already dropped\n');
    } else {
      throw error;
    }
  } finally {
    await prisma.$disconnect();
  }
}

fixConstraint().catch(console.error);

