#!/usr/bin/env node
require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkMigrationHistory() {
  console.log('📋 Checking Migration History\n')
  console.log('=' .repeat(60))
  
  try {
    // Get all migrations from database
    const dbMigrations = await prisma.$queryRaw`
      SELECT 
        migration_name,
        finished_at,
        applied_steps_count
      FROM _prisma_migrations
      ORDER BY finished_at DESC
    `
    
    console.log(`\n📊 Migrations in Database (${dbMigrations.length} total):\n`)
    dbMigrations.forEach((m, idx) => {
      console.log(`${idx + 1}. ${m.migration_name}`)
      console.log(`   Applied: ${m.finished_at || 'PENDING'}`)
      console.log(`   Steps: ${m.applied_steps_count}`)
      console.log('')
    })
    
    // Check for broken migration names
    const brokenMigrations = dbMigrations.filter(m => 
      m.migration_name.includes('$(date') || 
      m.migration_name.includes('$(')
    )
    
    if (brokenMigrations.length > 0) {
      console.log(`\n⚠️  Found ${brokenMigrations.length} migrations with broken names:\n`)
      brokenMigrations.forEach(m => {
        console.log(`   - ${m.migration_name}`)
      })
    }
    
    // Get local migrations
    const fs = require('fs')
    const path = require('path')
    const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations')
    const localMigrations = fs.readdirSync(migrationsDir)
      .filter(f => fs.statSync(path.join(migrationsDir, f)).isDirectory())
      .filter(f => f !== 'migration_lock.toml')
      .sort()
    
    console.log(`\n📁 Local Migrations (${localMigrations.length} total):\n`)
    localMigrations.forEach((m, idx) => {
      console.log(`${idx + 1}. ${m}`)
    })
    
    // Find mismatches
    const dbNames = new Set(dbMigrations.map(m => m.migration_name))
    const localNames = new Set(localMigrations)
    
    const inDbNotLocal = Array.from(dbNames).filter(n => !localNames.has(n))
    const inLocalNotDb = Array.from(localNames).filter(n => !dbNames.has(n))
    
    if (inDbNotLocal.length > 0) {
      console.log(`\n❌ In Database but NOT in Local Files:\n`)
      inDbNotLocal.forEach(m => {
        console.log(`   - ${m}`)
      })
    }
    
    if (inLocalNotDb.length > 0) {
      console.log(`\n❌ In Local Files but NOT in Database:\n`)
      inLocalNotDb.forEach(m => {
        console.log(`   - ${m}`)
      })
    }
    
    if (inDbNotLocal.length === 0 && inLocalNotDb.length === 0) {
      console.log(`\n✅ All migrations are in sync!`)
    }
    
  } catch (error) {
    console.error('\n❌ Error checking migration history:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkMigrationHistory()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })



