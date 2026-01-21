#!/usr/bin/env node

/**
 * Analyze unused columns and tables in Supabase
 * Compares Prisma schema with actual database structure
 */

require('dotenv').config()
const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')

const SUPABASE_DIRECT_URL = process.env.SUPABASE_DIRECT_URL || 
  'postgres://postgres:Step7nett.Umit@db.fqkrigvliyphjwpokwbl.supabase.co:5432/postgres'

// Read Prisma schema to get expected tables
function getPrismaTables() {
  const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma')
  const schema = fs.readFileSync(schemaPath, 'utf8')
  
  // Extract table names from @@map directives
  const tableMap = {}
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g
  let match
  
  while ((match = modelRegex.exec(schema)) !== null) {
    const modelName = match[1]
    const modelBody = match[2]
    
    // Find @@map directive
    const mapMatch = modelBody.match(/@@map\("([^"]+)"\)/)
    const tableName = mapMatch ? mapMatch[1] : modelName.toLowerCase()
    
    // Extract field names - improved regex to handle all field types
    const fieldRegex = /^\s*(\w+)\s+([^\n]+)/gm
    const fields = []
    let fieldMatch
    
    while ((fieldMatch = fieldRegex.exec(modelBody)) !== null) {
      const fieldName = fieldMatch[1]
      const fieldBody = fieldMatch[0]
      
      // Skip if it's a relation (has @relation)
      if (fieldBody.includes('@relation')) continue
      
      // Check for @map directive
      const fieldMapMatch = fieldBody.match(/@map\("([^"]+)"\)/)
      let columnName
      
      if (fieldMapMatch) {
        columnName = fieldMapMatch[1]
      } else {
        // Convert camelCase to snake_case for database column name
        columnName = fieldName.replace(/([A-Z])/g, '_$1').toLowerCase()
      }
      
      fields.push(columnName)
    }
    
    tableMap[tableName] = {
      modelName,
      columns: fields
    }
  }
  
  return tableMap
}

async function getDatabaseTables(pool) {
  // Get all tables in public schema
  const tablesResult = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `)
  
  const tables = {}
  
  for (const row of tablesResult.rows) {
    const tableName = row.table_name
    
    // Get columns for this table
    const columnsResult = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' 
      AND table_name = $1
      ORDER BY ordinal_position
    `, [tableName])
    
    tables[tableName] = columnsResult.rows.map(r => r.column_name)
  }
  
  return tables
}

async function main() {
  const pool = new Pool({
    connectionString: SUPABASE_DIRECT_URL,
    ssl: { rejectUnauthorized: false }
  })

  try {
    console.log('🔍 Analyzing database structure...\n')
    
    // Get expected structure from Prisma schema
    const prismaTables = getPrismaTables()
    console.log(`📋 Prisma schema defines ${Object.keys(prismaTables).length} tables\n`)
    
    // Get actual database structure
    const dbTables = await getDatabaseTables(pool)
    console.log(`🗄️  Database has ${Object.keys(dbTables).length} tables\n`)
    
    // Find unused tables (in DB but not in Prisma schema)
    const unusedTables = []
    for (const tableName of Object.keys(dbTables)) {
      if (!prismaTables[tableName] && !tableName.startsWith('_prisma')) {
        unusedTables.push(tableName)
      }
    }
    
    // Find unused columns
    const unusedColumns = {}
    for (const [tableName, prismaInfo] of Object.entries(prismaTables)) {
      if (dbTables[tableName]) {
        const dbColumns = dbTables[tableName]
        const prismaColumns = prismaInfo.columns
        
        const unused = dbColumns.filter(col => !prismaColumns.includes(col))
        if (unused.length > 0) {
          unusedColumns[tableName] = unused
        }
      }
    }
    
    // Print results
    console.log('='.repeat(80))
    console.log('UNUSED TABLES (in database but not in Prisma schema)')
    console.log('='.repeat(80))
    if (unusedTables.length === 0) {
      console.log('✅ No unused tables found')
    } else {
      unusedTables.forEach(table => {
        console.log(`  - ${table}`)
      })
    }
    
    console.log('\n' + '='.repeat(80))
    console.log('UNUSED COLUMNS (in database but not in Prisma schema)')
    console.log('='.repeat(80))
    if (Object.keys(unusedColumns).length === 0) {
      console.log('✅ No unused columns found')
    } else {
      for (const [table, columns] of Object.entries(unusedColumns)) {
        console.log(`\n  Table: ${table}`)
        columns.forEach(col => {
          console.log(`    - ${col}`)
        })
      }
    }
    
    // Generate cleanup SQL
    if (unusedTables.length > 0 || Object.keys(unusedColumns).length > 0) {
      console.log('\n' + '='.repeat(80))
      console.log('CLEANUP SQL (review before running!)')
      console.log('='.repeat(80))
      console.log('-- Unused tables')
      unusedTables.forEach(table => {
        console.log(`DROP TABLE IF EXISTS "${table}" CASCADE;`)
      })
      
      console.log('\n-- Unused columns')
      for (const [table, columns] of Object.entries(unusedColumns)) {
        columns.forEach(col => {
          console.log(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${col}";`)
        })
      }
      
      console.log('\n💡 Save this SQL to a file and review before executing!')
    }
    
    console.log('\n✅ Analysis complete!')

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

main()

