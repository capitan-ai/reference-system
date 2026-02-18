/**
 * FIXED analytics_appointments_by_location_daily view
 * Now properly shows bookings by location and date
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function fixView() {
  console.log('🔧 Исправляем VIEW analytics_appointments_by_location_daily\n')
  console.log('='.repeat(80))

  try {
    // First drop the view if exists
    await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS analytics_appointments_by_location_daily CASCADE`)
    console.log('✅ Старая VIEW удалена')
    
    // Then create the fixed view
    const fixedViewSQL = `
CREATE VIEW analytics_appointments_by_location_daily AS
SELECT
  b.organization_id,
  b.location_id,
  l.name as location_name,
  DATE(b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') as date,
  COUNT(*) FILTER (WHERE b.status = 'ACCEPTED') as appointments_count,
  COUNT(*) FILTER (WHERE b.status = 'ACCEPTED') as accepted_appointments,
  COUNT(*) FILTER (WHERE b.status IN ('CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER')) as cancelled_appointments,
  COUNT(*) FILTER (WHERE b.status = 'NO_SHOW') as no_show_appointments,
  COUNT(*) FILTER (WHERE b.status = 'CANCELLED_BY_CUSTOMER') as cancelled_by_customer,
  COUNT(*) FILTER (WHERE b.status = 'CANCELLED_BY_SELLER') as cancelled_by_seller,
  COUNT(DISTINCT b.customer_id) FILTER (WHERE b.customer_id IS NOT NULL AND b.status = 'ACCEPTED') as unique_customers,
  COUNT(DISTINCT b.customer_id) FILTER (WHERE b.customer_id IS NOT NULL AND b.status = 'ACCEPTED') as new_customers
FROM bookings b
INNER JOIN locations l 
  ON b.location_id = l.id
  AND b.organization_id = l.organization_id
GROUP BY 
  b.organization_id, 
  b.location_id, 
  l.name, 
  DATE(b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')
    `
    
    await prisma.$executeRawUnsafe(fixedViewSQL)
    console.log('✅ Новая VIEW создана\n')

    // Verify
    console.log('🔍 Проверяем исправленный VIEW:\n')
    
    const orgId = 'd0e24178-2f94-4033-bc91-41f22df58278'
    
    const stats = await prisma.$queryRaw`
      SELECT 
        SUM(appointments_count)::int as accepted,
        SUM(cancelled_appointments)::int as cancelled,
        SUM(no_show_appointments)::int as no_show
      FROM analytics_appointments_by_location_daily
      WHERE organization_id = ${orgId}::uuid
        AND EXTRACT(YEAR FROM date) = 2026
        AND EXTRACT(MONTH FROM date) = 2
    `
    
    const s = stats[0]
    const total = (s.accepted || 0) + (s.cancelled || 0) + (s.no_show || 0)
    
    console.log(`Февраль 2026 - после исправления:`)
    console.log(`  ACCEPTED: ${s.accepted}`)
    console.log(`  CANCELLED: ${s.cancelled}`)
    console.log(`  NO-SHOW: ${s.no_show}`)
    console.log(`  ВСЕГО: ${total}`)
    
    // Проверим первый день
    console.log('\n\nПроверка Feb 1:')
    const feb1 = await prisma.$queryRaw`
      SELECT 
        location_name,
        appointments_count,
        cancelled_appointments,
        no_show_appointments
      FROM analytics_appointments_by_location_daily
      WHERE organization_id = ${orgId}::uuid
        AND date = '2026-02-01'::date
      ORDER BY location_name
    `
    
    feb1.forEach(row => {
      const total = row.appointments_count + row.cancelled_appointments + row.no_show_appointments
      console.log(`  ${row.location_name}: ${row.appointments_count} ACCEPTED, ${row.cancelled_appointments} CANCELLED, ВСЕГО ${total}`)
    })
    
    console.log('\n' + '='.repeat(80))
    console.log('✅ VIEW исправлена и проверена!')
    
    await prisma.$disconnect()
  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

fixView()

