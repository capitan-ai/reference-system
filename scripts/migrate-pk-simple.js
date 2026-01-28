#!/usr/bin/env node

/**
 * Simple migration script - executes SQL file directly
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function runMigration() {
  console.log('🚀 Starting PK migration: Square IDs → UUID...\n');
  console.log('⚠️  This will modify production database!\n');

  try {
    // Read SQL file
    const sqlPath = path.join(__dirname, 'migrate-pk-to-uuid.sql');
    let sql = fs.readFileSync(sqlPath, 'utf8');

    // Remove BEGIN/COMMIT - we'll use Prisma transaction
    sql = sql.replace(/^BEGIN;?\s*/i, '');
    sql = sql.replace(/COMMIT;?\s*$/i, '');

    // Split verification queries (after COMMIT)
    const parts = sql.split('-- ============================================================================\n-- VERIFICATION');
    const migrationSQL = parts[0];
    const verificationSQL = parts[1] ? '-- VERIFICATION' + parts[1] : '';

    console.log('📋 Executing migration in transaction (5 min timeout)...\n');

    // Execute in Prisma transaction with extended timeout
    await prisma.$transaction(async (tx) => {
      // Execute entire SQL as one query
      // PostgreSQL will handle multiple statements
      await tx.$executeRawUnsafe(migrationSQL);
    }, {
      timeout: 300000, // 5 minutes
      isolationLevel: 'ReadCommitted',
    });

    console.log('✅ Migration completed successfully!\n');

    // Run verification
    if (verificationSQL.trim()) {
      console.log('🔍 Running verification queries...\n');
      const queries = verificationSQL
        .split('--')
        .map(q => q.trim())
        .filter(q => q && q.startsWith('SELECT'));

      for (const query of queries) {
        try {
          const result = await prisma.$queryRawUnsafe(query);
          console.log(JSON.stringify(result, null, 2));
        } catch (error) {
          console.warn('Query failed:', error.message);
        }
      }
    }

    console.log('\n✨ Migration complete!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('\n⚠️  Review error and restore from backup if needed.');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };



