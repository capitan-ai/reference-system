#!/usr/bin/env node

/**
 * Check employee_id vs administrator_id in payments table
 * to determine which field to keep
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkFields() {
  try {
    console.log('🔍 Checking employee_id vs administrator_id in payments table...\n')
    
    // Check total count
    const totalCount = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count FROM payments
    `
    console.log(`Total payments: ${totalCount[0].count}\n`)
    
    // Check employee_id
    const employeeStats = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total,
        COUNT(employee_id)::int as not_null
      FROM payments
    `
    const employeeData = employeeStats[0]
    console.log('employee_id field:')
    console.log(`  Total records: ${employeeData.total}`)
    console.log(`  Non-null values: ${employeeData.not_null}`)
    console.log(`  Null values: ${employeeData.total - employeeData.not_null}`)
    
    // Check administrator_id
    const adminStats = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total,
        COUNT(administrator_id)::int as not_null
      FROM payments
    `
    
    const adminData = adminStats[0]
    console.log('\nadministrator_id field:')
    console.log(`  Total records: ${adminData.total}`)
    console.log(`  Non-null values: ${adminData.not_null}`)
    console.log(`  Null values: ${adminData.total - adminData.not_null}`)
    
    // Sample data from both fields
    console.log('\n' + '='.repeat(60))
    console.log('Sample data:\n')
    
    // Sample employee_id
    if (employeeData.not_null > 0) {
      const employeeSamples = await prisma.$queryRaw`
        SELECT employee_id 
        FROM payments 
        WHERE employee_id IS NOT NULL 
        LIMIT 5
      `
      console.log('employee_id samples:')
      employeeSamples.forEach((row, idx) => {
        console.log(`  ${idx + 1}. ${row.employee_id}`)
      })
    }
    
    // Sample administrator_id
    if (adminData.not_null > 0) {
      const adminSamples = await prisma.$queryRaw`
        SELECT administrator_id 
        FROM payments 
        WHERE administrator_id IS NOT NULL 
        LIMIT 5
      `
      console.log('\nadministrator_id samples:')
      adminSamples.forEach((row, idx) => {
        console.log(`  ${idx + 1}. ${row.administrator_id}`)
      })
    }
    
    // Check overlap
    console.log('\n' + '='.repeat(60))
    console.log('Overlap analysis:\n')
    
    const overlap = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as both_null,
        COUNT(*) FILTER (WHERE employee_id IS NOT NULL AND administrator_id IS NULL)::int as only_employee,
        COUNT(*) FILTER (WHERE employee_id IS NULL AND administrator_id IS NOT NULL)::int as only_admin,
        COUNT(*) FILTER (WHERE employee_id IS NOT NULL AND administrator_id IS NOT NULL)::int as both_set,
        COUNT(*) FILTER (WHERE employee_id = administrator_id AND employee_id IS NOT NULL)::int as same_value
      FROM payments
    `
    
    const overlapData = overlap[0]
    console.log(`Both NULL: ${overlapData.both_null}`)
    console.log(`Only employee_id set: ${overlapData.only_employee}`)
    console.log(`Only administrator_id set: ${overlapData.only_admin}`)
    console.log(`Both set: ${overlapData.both_set}`)
    console.log(`Same value (when both set): ${overlapData.same_value}`)
    
    // Recommendation
    console.log('\n' + '='.repeat(60))
    console.log('Recommendation:\n')
    
    if (employeeData.not_null > 0 && adminData.not_null === 0) {
      console.log('✅ employee_id has data, administrator_id is empty')
      console.log('   → Keep employee_id, rename it, remove administrator_id')
    } else if (employeeData.not_null === 0 && adminData.not_null > 0) {
      console.log('✅ administrator_id has data, employee_id is empty')
      console.log('   → Keep administrator_id, remove employee_id')
    } else if (employeeData.not_null > adminData.not_null) {
      console.log('✅ employee_id has more data than administrator_id')
      console.log('   → Keep employee_id, rename it, remove administrator_id')
    } else if (adminData.not_null > employeeData.not_null) {
      console.log('✅ administrator_id has more data than employee_id')
      console.log('   → Keep administrator_id, remove employee_id')
    } else {
      console.log('⚠️  Both fields have similar amounts of data')
      console.log('   → Check overlap to decide')
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkFields()

