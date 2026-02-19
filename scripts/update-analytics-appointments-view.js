require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function updateAnalyticsView() {
  console.log('📊 Updating analytics_appointments_by_location_daily VIEW...\n')
  console.log('='.repeat(80))

  try {
    // Updated view definition - using customer_analytics for correct new_customers logic
    const updatedViewSQL = `
-- ============================================================================
-- ANALYTICS APPOINTMENTS BY LOCATION DAILY VIEW
-- Shows bookings/appointments by location and date (Pacific timezone)
-- UPDATED: new_customers now correctly uses customer_analytics.first_booking_at
-- ============================================================================

CREATE OR REPLACE VIEW analytics_appointments_by_location_daily AS
WITH booking_daily AS (
  SELECT
    b.organization_id,
    b.location_id,
    b.customer_id,
    b.status,
    DATE(b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') as booking_date_pacific
  FROM bookings b
)
SELECT
  bd.organization_id,
  bd.location_id,
  l.name as location_name,
  bd.booking_date_pacific as date,
  
  COUNT(*) FILTER (WHERE bd.status = 'ACCEPTED') as appointments_count,
  COUNT(*) FILTER (WHERE bd.status = 'ACCEPTED') as accepted_appointments,
  COUNT(*) FILTER (WHERE bd.status IN ('CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER')) as cancelled_appointments,
  COUNT(*) FILTER (WHERE bd.status = 'NO_SHOW') as no_show_appointments,
  COUNT(*) FILTER (WHERE bd.status = 'CANCELLED_BY_CUSTOMER') as cancelled_by_customer,
  COUNT(*) FILTER (WHERE bd.status = 'CANCELLED_BY_SELLER') as cancelled_by_seller,
  
  COUNT(DISTINCT bd.customer_id) FILTER (WHERE bd.customer_id IS NOT NULL AND bd.status = 'ACCEPTED') as unique_customers,
  
  -- NEW CUSTOMERS: customers whose first_booking_at == booking_date (using customer_analytics)
  COUNT(DISTINCT ca.square_customer_id) FILTER (
    WHERE ca.square_customer_id IS NOT NULL
      AND DATE(ca.first_booking_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') = bd.booking_date_pacific
  ) as new_customers

FROM booking_daily bd
INNER JOIN locations l 
  ON bd.location_id = l.id
  AND bd.organization_id = l.organization_id
LEFT JOIN customer_analytics ca
  ON bd.organization_id = ca.organization_id
  AND bd.customer_id = ca.square_customer_id

GROUP BY bd.organization_id, bd.location_id, l.name, bd.booking_date_pacific;
    `

    console.log('Executing CREATE OR REPLACE VIEW...')
    await prisma.$executeRawUnsafe(updatedViewSQL)

    console.log('✅ VIEW updated successfully!')
    console.log('='.repeat(80))

    // Verify the view was created
    const viewCheck = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.views 
        WHERE table_name = 'analytics_appointments_by_location_daily'
      ) as exists
    `

    if (viewCheck[0].exists) {
      console.log('✅ VIEW verification passed!')
    } else {
      console.error('❌ VIEW verification failed!')
      process.exit(1)
    }

  } catch (error) {
    console.error('❌ Error updating view:', error.message)
    console.error(error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

updateAnalyticsView()

