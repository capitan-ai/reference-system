#!/usr/bin/env node

/**
 * Safe cleanup of unused columns in Supabase
 * Uses Prisma introspection to identify truly unused columns
 * 
 * WARNING: This script only identifies - you must review and execute SQL manually!
 */

require('dotenv').config()
const { Pool } = require('pg')
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const SUPABASE_DIRECT_URL = process.env.SUPABASE_DIRECT_URL || 
  'postgres://postgres:Step7nett.Umit@db.fqkrigvliyphjwpokwbl.supabase.co:5432/postgres'

async function introspectDatabase(pool) {
  // Get all tables and their columns from database
  const tablesResult = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
    AND table_name NOT LIKE '_prisma%'
    ORDER BY table_name
  `)
  
  const dbStructure = {}
  
  for (const row of tablesResult.rows) {
    const tableName = row.table_name
    
    const columnsResult = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' 
      AND table_name = $1
      ORDER BY ordinal_position
    `, [tableName])
    
    dbStructure[tableName] = columnsResult.rows.map(r => ({
      name: r.column_name,
      type: r.data_type
    }))
  }
  
  return dbStructure
}

async function getPrismaExpectedStructure() {
  // Use prisma db pull to get what Prisma expects
  // Save current schema
  const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma')
  const backupPath = path.join(process.cwd(), 'prisma', 'schema.prisma.backup')
  
  // Backup current schema
  if (fs.existsSync(schemaPath)) {
    fs.copyFileSync(schemaPath, backupPath)
  }
  
  try {
    // Temporarily set DATABASE_URL and pull schema
    process.env.DATABASE_URL = SUPABASE_DIRECT_URL
    
    // Run prisma db pull to introspect
    execSync('npx prisma db pull --force', {
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: SUPABASE_DIRECT_URL }
    })
    
    // Read the pulled schema
    const pulledSchema = fs.readFileSync(schemaPath, 'utf8')
    
    // Parse to get expected structure
    const expected = {}
    const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g
    let match
    
    while ((match = modelRegex.exec(pulledSchema)) !== null) {
      const modelName = match[1]
      const modelBody = match[2]
      
      // Find @@map
      const mapMatch = modelBody.match(/@@map\("([^"]+)"\)/)
      const tableName = mapMatch ? mapMatch[1] : modelName.toLowerCase()
      
      // Extract fields
      const fieldRegex = /^\s*(\w+)\s+[^\n]+/gm
      const columns = []
      let fieldMatch
      
      while ((fieldMatch = fieldRegex.exec(modelBody)) !== null) {
        const fieldLine = fieldMatch[0]
        if (fieldLine.includes('@relation')) continue
        
        // Get column name from @map or use field name
        const fieldMapMatch = fieldLine.match(/@map\("([^"]+)"\)/)
        const columnName = fieldMapMatch ? fieldMapMatch[1] : fieldMatch[1]
        
        columns.push(columnName)
      }
      
      expected[tableName] = columns
    }
    
    return expected
    
  } finally {
    // Restore original schema
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, schemaPath)
      fs.unlinkSync(backupPath)
    }
  }
}

async function main() {
  const pool = new Pool({
    connectionString: SUPABASE_DIRECT_URL,
    ssl: { rejectUnauthorized: false }
  })

  try {
    console.log('🔍 Analyzing database structure...\n')
    console.log('   This may take a minute (introspecting with Prisma)...\n')
    
    // Get actual database structure
    const dbStructure = await introspectDatabase(pool)
    console.log(`   Found ${Object.keys(dbStructure).length} tables in database\n`)
    
    // Get what Prisma expects
    const expectedStructure = await getPrismaExpectedStructure()
    console.log(`   Prisma expects ${Object.keys(expectedStructure).length} tables\n`)
    
    // Compare
    const unusedColumns = {}
    const unusedTables = []
    
    for (const [tableName, dbColumns] of Object.entries(dbStructure)) {
      if (!expectedStructure[tableName]) {
        unusedTables.push(tableName)
        continue
      }
      
      const expectedColumns = expectedStructure[tableName]
      const dbColumnNames = dbColumns.map(c => c.name)
      
      const unused = dbColumnNames.filter(col => !expectedColumns.includes(col))
      if (unused.length > 0) {
        unusedColumns[tableName] = unused
      }
    }
    
    // Print results
    console.log('='.repeat(80))
    if (unusedTables.length === 0 && Object.keys(unusedColumns).length === 0) {
      console.log('✅ No unused tables or columns found!')
      console.log('   Database structure matches Prisma schema.')
    } else {
      if (unusedTables.length > 0) {
        console.log('UNUSED TABLES (not in Prisma schema):')
        unusedTables.forEach(table => console.log(`  - ${table}`))
        console.log()
      }
      
      if (Object.keys(unusedColumns).length > 0) {
        console.log('UNUSED COLUMNS (not in Prisma schema):')
        for (const [table, columns] of Object.entries(unusedColumns)) {
          console.log(`\n  ${table}:`)
          columns.forEach(col => console.log(`    - ${col}`))
        }
        console.log()
      }
      
      // Generate cleanup SQL
      console.log('='.repeat(80))
      console.log('CLEANUP SQL:')
      console.log('='.repeat(80))
      console.log('-- Review this SQL carefully before executing!')
      console.log('-- Save to a file and execute manually\n')
      
      if (unusedTables.length > 0) {
        console.log('-- Drop unused tables')
        unusedTables.forEach(table => {
          console.log(`DROP TABLE IF EXISTS "${table}" CASCADE;`)
        })
        console.log()
      }
      
      if (Object.keys(unusedColumns).length > 0) {
        console.log('-- Drop unused columns')
        for (const [table, columns] of Object.entries(unusedColumns)) {
          columns.forEach(col => {
            console.log(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${col}";`)
          })
        }
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

main()


