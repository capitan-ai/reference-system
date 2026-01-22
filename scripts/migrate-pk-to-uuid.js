#!/usr/bin/env node

/**
 * Migration Script: Square IDs → UUID Primary Keys + Add organization_id
 * 
 * This script migrates:
 * 1. bookings.booking_id (Square ID) → bookings.id (UUID)
 * 2. orders.id (Square ID) → orders.id (UUID)
 * 3. payments.id (Square ID) → payments.id (UUID)
 * 4. Adds organization_id (nullable) to all tenant tables
 * 
 * IMPORTANT: 
 * - Backup database before running!
 * - Run in transaction mode for safety
 * - Verify results after migration
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function runMigration() {
  console.log('🚀 Starting PK migration: Square IDs → UUID...\n');

  try {
    // Read SQL file
    const sqlPath = path.join(__dirname, 'migrate-pk-to-uuid.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Split by COMMIT to get migration and verification parts
    const parts = sql.split('COMMIT;');
    const migrationSQL = parts[0] + 'COMMIT;';
    const verificationSQL = parts[1] || '';

    console.log('📋 Executing migration SQL...\n');
    console.log('⚠️  This will modify production database!');
    console.log('   Tables: bookings, orders, payments\n');

    // Execute migration using transaction
    // Remove BEGIN/COMMIT as Prisma handles transactions differently
    const migrationSQLClean = migrationSQL
      .replace(/^BEGIN;?\s*/i, '')
      .replace(/COMMIT;?\s*$/i, '');

    console.log('🔄 Executing migration (SQL transaction)...\n');

    // Execute entire SQL file as one transaction (SQL file has BEGIN/COMMIT)
    // Increase timeout for long-running migration
    await prisma.$executeRawUnsafe(`
      SET statement_timeout = '300s';
    `);

    // Execute migration (SQL file already has BEGIN/COMMIT)
    await prisma.$transaction(async (tx) => {
      // Increase transaction timeout
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '300s'`);
      // Split by statements, handling DO blocks properly
      const statements = [];
      let currentStatement = '';
      let inDoBlock = false;
      let dollarTag = '';

      const lines = migrationSQLClean.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip comments and empty lines
        if (!line || line.startsWith('--')) {
          continue;
        }

        currentStatement += line + '\n';

        // Detect DO $$ blocks
        if (line.match(/^\s*DO\s+\$\$/i)) {
          inDoBlock = true;
          const match = line.match(/\$\$(\w*)/);
          dollarTag = match ? match[1] : '';
          continue;
        }

        // Detect END of DO block
        if (inDoBlock && line.match(new RegExp(`^\\s*END\\s+\\$\\$${dollarTag}\\s*;?`, 'i'))) {
          inDoBlock = false;
          statements.push(currentStatement.trim());
          currentStatement = '';
          continue;
        }

        // Regular statement end
        if (!inDoBlock && line.endsWith(';')) {
          statements.push(currentStatement.trim());
          currentStatement = '';
        }
      }

      // Execute each statement
      for (const statement of statements) {
        if (statement && !statement.startsWith('--')) {
          try {
            await tx.$executeRawUnsafe(statement);
            const preview = statement.substring(0, 60).replace(/\n/g, ' ');
            console.log('✅', preview + '...');
          } catch (error) {
            // Some statements might fail if constraints don't exist - that's OK
            if (error.message.includes('does not exist') || 
                error.message.includes('already exists') ||
                error.message.includes('duplicate')) {
              const preview = statement.substring(0, 60).replace(/\n/g, ' ');
              console.log('⚠️  Skipped (expected):', preview + '...');
            } else {
              throw error;
            }
          }
        }
      }
    });

    console.log('✅ Migration completed successfully!\n');

    // Run verification queries
    if (verificationSQL.trim()) {
      console.log('🔍 Running verification queries...\n');
      
      const verificationQueries = verificationSQL
        .split('--')
        .map(q => q.trim())
        .filter(q => q && q.startsWith('SELECT'));

      for (const query of verificationQueries) {
        try {
          const result = await prisma.$queryRawUnsafe(query);
          console.log('Result:', JSON.stringify(result, null, 2));
        } catch (error) {
          console.warn('Verification query failed:', error.message);
        }
      }
    }

    console.log('\n✨ Migration complete!');
    console.log('\n📝 Next steps:');
    console.log('   1. Verify data integrity');
    console.log('   2. Create organizations table');
    console.log('   3. Backfill organization_id values');
    console.log('   4. Add foreign key constraints');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('\n⚠️  Database may be in inconsistent state!');
    console.error('   Review error and restore from backup if needed.');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
if (require.main === module) {
  runMigration().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { runMigration };

