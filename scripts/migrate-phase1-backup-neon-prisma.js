#!/usr/bin/env node

/**
 * Phase 1: Backup Neon Database (Prisma-based)
 * 
 * Creates backups using Prisma instead of pg_dump
 * This avoids version compatibility issues
 * 
 * Usage:
 *   node scripts/migrate-phase1-backup-neon-prisma.js
 * 
 * Environment Variables:
 *   NEON_DATABASE_URL - Neon database connection string
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const path = require('path')

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL

if (!NEON_DATABASE_URL) {
  console.error('❌ Error: NEON_DATABASE_URL or DATABASE_URL environment variable is required')
  process.exit(1)
}

// Create backup directory
const backupDir = path.join(process.cwd(), 'backups', new Date().toISOString().split('T')[0].replace(/-/g, ''))
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true })
}
console.log(`📁 Backup directory: ${backupDir}`)

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0]
const schemaBackup = path.join(backupDir, `neon_schema_${timestamp}.sql`)
const dataBackup = path.join(backupDir, `neon_data_${timestamp}.json`)

console.log('\n🔄 Starting Neon database backup (using Prisma)...\n')

async function backupSchema(prisma, outputFile) {
  console.log('📋 Exporting schema...')
  
  // Get all table creation statements
  const tables = await prisma.$queryRaw`
    SELECT 
      tablename,
      schemaname
    FROM pg_tables 
    WHERE schemaname = 'public'
    ORDER BY tablename
  `

  let schemaSQL = `-- Schema backup from Neon Database\n`
  schemaSQL += `-- Generated: ${new Date().toISOString()}\n\n`
  schemaSQL += `-- Note: This is a simplified schema export.\n`
  schemaSQL += `-- For full schema, use Prisma migrations instead.\n\n`

  for (const table of tables) {
    const createTable = await prisma.$queryRawUnsafe(`
      SELECT 
        'CREATE TABLE IF NOT EXISTS ' || quote_ident(table_name) || ' (' || 
        string_agg(
          quote_ident(column_name) || ' ' || 
          CASE 
            WHEN data_type = 'character varying' THEN 'VARCHAR(' || character_maximum_length || ')'
            WHEN data_type = 'numeric' THEN 'NUMERIC(' || numeric_precision || ',' || numeric_scale || ')'
            ELSE UPPER(data_type)
          END ||
          CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END,
          ', '
        ) || ');' as create_stmt
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      GROUP BY table_name
    `, table.tablename)

    if (createTable && createTable[0]?.create_stmt) {
      schemaSQL += `-- Table: ${table.tablename}\n`
      schemaSQL += createTable[0].create_stmt + '\n\n'
    }
  }

  fs.writeFileSync(outputFile, schemaSQL)
  console.log(`✅ Schema backup created: ${(fs.statSync(outputFile).size / 1024).toFixed(2)} KB`)
  return tables.length
}

async function backupData(prisma, outputFile) {
  console.log('💾 Exporting data...')
  
  // Get all tables from public schema
  const tables = await prisma.$queryRaw`
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public'
    ORDER BY tablename
  `

  const data = {}
  let totalRecords = 0

  for (const table of tables) {
    const tableName = table.tablename
    try {
      // Use raw SQL to get all data
      const records = await prisma.$queryRawUnsafe(`SELECT * FROM ${tableName}`)
      if (records.length > 0) {
        data[tableName] = records
        totalRecords += records.length
        console.log(`   ${tableName}: ${records.length} records`)
      }
    } catch (error) {
      console.log(`   ${tableName}: skipped (${error.message.substring(0, 50)})`)
    }
  }

  // Handle BigInt serialization
  const jsonString = JSON.stringify(data, (key, value) => {
    if (typeof value === 'bigint') {
      return value.toString()
    }
    // Handle Date objects
    if (value instanceof Date) {
      return value.toISOString()
    }
    return value
  }, 2)
  fs.writeFileSync(outputFile, jsonString)
  console.log(`✅ Data backup created: ${(fs.statSync(outputFile).size / 1024 / 1024).toFixed(2)} MB`)
  console.log(`   Total records: ${totalRecords}`)
  
  return totalRecords
}

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: NEON_DATABASE_URL } }
  })

  try {
    // Test connection
    await prisma.$connect()
    console.log('✅ Connected to Neon database\n')

    // Backup schema
    const tableCount = await backupSchema(prisma, schemaBackup)
    console.log(`   Found ${tableCount} tables\n`)

    // Backup data
    const recordCount = await backupData(prisma, dataBackup)

    console.log('\n✅ Backup completed successfully!')
    console.log(`\n📁 Backup files:`)
    console.log(`   Schema: ${schemaBackup}`)
    console.log(`   Data: ${dataBackup}`)
    console.log(`\n💡 Note: Schema backup is simplified.`)
    console.log(`   We'll use Prisma migrations to create the full schema on Supabase.`)
    console.log(`\n💡 Next step: Run migrate-phase1-migrate-schema.js to migrate schema`)

  } catch (error) {
    console.error('\n❌ Backup failed:', error.message)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()

