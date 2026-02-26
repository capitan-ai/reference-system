require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function runAudit() {
  console.log('--- STARTING CANONICAL ANALYTICS AUDIT ---')
  
  const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278' // ZORINA
  
  // 1. Total NEVER_BOOKED count
  const totalNeverBooked = await prisma.customerAnalytics.count({
    where: { 
      organization_id: ORG_ID,
      customer_segment: 'NEVER_BOOKED'
    }
  })
  console.log(`1. Total NEVER_BOOKED: ${totalNeverBooked}`)

  // 2. Bookings check (Cancelled/No-show only)
  const bookingsStats = await prisma.$queryRaw`
    SELECT 
      COUNT(DISTINCT b.customer_id) as total_customers,
      COUNT(*) FILTER (WHERE b.status = 'ACCEPTED') as accepted,
      COUNT(*) FILTER (WHERE b.status IN ('CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER')) as cancelled,
      COUNT(*) FILTER (WHERE b.status = 'NO_SHOW') as no_show
    FROM bookings b
    JOIN customer_analytics ca ON b.customer_id = ca.square_customer_id
    WHERE ca.customer_segment = 'NEVER_BOOKED'
      AND ca.organization_id = ${ORG_ID}::uuid
  `
  console.log('2. Bookings Stats for NEVER_BOOKED:', bookingsStats)

  // 3. Orders & Payments check
  const activityStats = await prisma.$queryRaw`
    SELECT 
      COUNT(DISTINCT ca.square_customer_id) FILTER (WHERE ca.total_payments > 0) as with_payments,
      COUNT(DISTINCT o.customer_id) as with_orders,
      COUNT(DISTINCT gc.square_customer_id) as with_gift_cards
    FROM customer_analytics ca
    LEFT JOIN orders o ON ca.square_customer_id = o.customer_id
    LEFT JOIN gift_cards gc ON ca.square_customer_id = gc.square_customer_id
    WHERE ca.customer_segment = 'NEVER_BOOKED'
      AND ca.organization_id = ${ORG_ID}::uuid
  `
  console.log('3. Activity Stats for NEVER_BOOKED:', activityStats)

  // 4. Duplicates check
  const duplicates = await prisma.$queryRaw`
    WITH dup_groups AS (
      SELECT email_address, phone_number
      FROM square_existing_clients
      WHERE organization_id = ${ORG_ID}::uuid
      GROUP BY email_address, phone_number
      HAVING COUNT(*) > 1
    )
    SELECT COUNT(DISTINCT ca.square_customer_id) as dup_count
    FROM customer_analytics ca
    JOIN square_existing_clients sec ON ca.square_customer_id = sec.square_customer_id
    JOIN dup_groups dg ON (sec.email_address = dg.email_address OR sec.phone_number = dg.phone_number)
    WHERE ca.customer_segment = 'NEVER_BOOKED'
      AND ca.organization_id = ${ORG_ID}::uuid
  `
  console.log('4. Duplicates in NEVER_BOOKED:', duplicates)

  // 5. Package buyers check (using order_line_items)
  const packageBuyers = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT oli.customer_id) as package_buyer_count
    FROM order_line_items oli
    JOIN customer_analytics ca ON oli.customer_id = ca.square_customer_id
    WHERE ca.customer_segment = 'NEVER_BOOKED'
      AND (
        oli.name ILIKE '%package%' OR 
        oli.name ILIKE '%abonement%' OR 
        oli.name ILIKE '%pass%' OR
        oli.name ILIKE '%абонемент%' OR
        oli.name ILIKE '%пакет%'
      )
      AND ca.organization_id = ${ORG_ID}::uuid
  `
  console.log('5. Package Buyers in NEVER_BOOKED:', packageBuyers)

  // 5b. Check ALL packages in the system to see what names they have
  const allPackages = await prisma.$queryRaw`
    SELECT name, COUNT(*) as count
    FROM order_line_items
    WHERE (
        name ILIKE '%package%' OR 
        name ILIKE '%abonement%' OR 
        name ILIKE '%pass%' OR
        name ILIKE '%абонемент%' OR
        name ILIKE '%пакет%'
      )
    GROUP BY name
    ORDER BY count DESC
  `
  console.log('5b. All Package-like items in system:', allPackages)

  // 5c. Check for package buyers in NEVER_BOOKED by joining on order_id
  const packageBuyersInNeverBooked = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT o.customer_id) as package_buyer_count
    FROM orders o
    JOIN order_line_items oli ON o.id = oli.order_id
    JOIN customer_analytics ca ON o.customer_id = ca.square_customer_id
    WHERE ca.customer_segment = 'NEVER_BOOKED'
      AND (
        oli.name ILIKE '%package%' OR 
        oli.name ILIKE '%abonement%' OR 
        oli.name ILIKE '%pass%' OR
        oli.name ILIKE '%абонемент%' OR
        oli.name ILIKE '%пакет%'
      )
      AND ca.organization_id = ${ORG_ID}::uuid
  `
  console.log('5c. Package Buyers (via Orders) in NEVER_BOOKED:', packageBuyersInNeverBooked)

  // 7b. Student check (expanded keywords and checking line items)
  const studentLineItems = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT o.customer_id) as student_count
    FROM orders o
    JOIN order_line_items oli ON o.id = oli.order_id
    JOIN customer_analytics ca ON o.customer_id = ca.square_customer_id
    WHERE ca.customer_segment = 'NEVER_BOOKED'
      AND (
        oli.name ILIKE '%student%' OR 
        oli.name ILIKE '%training%' OR 
        oli.name ILIKE '%course%' OR
        oli.name ILIKE '%обучение%' OR
        oli.name ILIKE '%ученик%'
      )
      AND ca.organization_id = ${ORG_ID}::uuid
  `
  console.log('7b. Students (via Order Items) in NEVER_BOOKED:', studentLineItems)
  
  // 7c. Check all student-like items
  const allStudentItems = await prisma.$queryRaw`
    SELECT name, COUNT(*) as count
    FROM order_line_items
    WHERE (
        name ILIKE '%student%' OR 
        name ILIKE '%training%' OR 
        name ILIKE '%course%' OR
        name ILIKE '%обучение%' OR
        name ILIKE '%ученик%'
      )
    GROUP BY name
    ORDER BY count DESC
  `
  console.log('7c. All Student-like items in system:', allStudentItems)

  // 9. Detailed classification (Mutually Exclusive)
  const classification = await prisma.$queryRaw`
    WITH customer_data AS (
      SELECT 
        ca.square_customer_id as id,
        ca.total_payments,
        ca.total_accepted_bookings,
        COALESCE(sec.raw_json->>'creation_source', 'UNKNOWN') as source,
        (sec.given_name IS NULL OR sec.given_name = '') AND (sec.family_name IS NULL OR sec.family_name = '') AND (sec.email_address IS NULL OR sec.email_address = '') AND (sec.phone_number IS NULL OR sec.phone_number = '') as is_ghost,
        EXISTS(SELECT 1 FROM bookings b WHERE b.customer_id = ca.square_customer_id AND b.status IN ('CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER', 'NO_SHOW')) as has_cancelled,
        EXISTS(SELECT 1 FROM gift_cards gc WHERE gc.square_customer_id = ca.square_customer_id) as has_gift_card,
        EXISTS(SELECT 1 FROM square_existing_clients sec2 WHERE sec2.square_customer_id != ca.square_customer_id AND (sec2.email_address = sec.email_address OR sec2.phone_number = sec.phone_number) AND sec2.email_address IS NOT NULL AND sec2.email_address != '') as is_duplicate,
        EXISTS(SELECT 1 FROM order_line_items oli JOIN orders o ON o.id = oli.order_id WHERE o.customer_id = ca.square_customer_id AND (oli.name ILIKE '%package%' OR oli.name ILIKE '%abonement%' OR oli.name ILIKE '%pass%' OR oli.name ILIKE '%абонемент%' OR oli.name ILIKE '%пакет%')) as is_package_buyer,
        EXISTS(SELECT 1 FROM order_line_items oli JOIN orders o ON o.id = oli.order_id WHERE o.customer_id = ca.square_customer_id AND (oli.name ILIKE '%student%' OR oli.name ILIKE '%training%' OR oli.name ILIKE '%course%' OR oli.name ILIKE '%обучение%' OR oli.name ILIKE '%ученик%')) as is_student
      FROM customer_analytics ca
      JOIN square_existing_clients sec ON ca.square_customer_id = sec.square_customer_id
      WHERE ca.customer_segment = 'NEVER_BOOKED'
        AND ca.organization_id = ${ORG_ID}::uuid
    )
    SELECT 
      CASE 
        WHEN is_duplicate THEN 'ACTIVE_DUPLICATE'
        WHEN is_student THEN 'STUDENT_ONLY'
        WHEN is_package_buyer THEN 'PACKAGE_PREPAID_NO_REDEMPTION'
        WHEN source = 'EGIFTING' OR has_gift_card THEN 'GIFT_GIVER_PROFILE'
        WHEN total_payments > 0 THEN 'RETAIL_ONLY'
        WHEN has_cancelled THEN 'CANCELLED_OR_NOSHOW_ONLY'
        WHEN source = 'MERGE' THEN 'MERGE_TAIL'
        WHEN is_ghost THEN 'GHOST_PROFILE'
        ELSE 'TRULY_NEVER_BOOKED_LEAD'
      END as category,
      COUNT(*) as count
    FROM customer_data
    GROUP BY category
    ORDER BY count DESC
  `
  console.log('9. Mutually Exclusive Classification:', classification)

  // 6. Ghost profiles check
  const ghosts = await prisma.$queryRaw`
    SELECT COUNT(*) as ghost_count
    FROM square_existing_clients sec
    JOIN customer_analytics ca ON sec.square_customer_id = ca.square_customer_id
    WHERE ca.customer_segment = 'NEVER_BOOKED'
      AND (sec.given_name IS NULL OR sec.given_name = '')
      AND (sec.family_name IS NULL OR sec.family_name = '')
      AND (sec.email_address IS NULL OR sec.email_address = '')
      AND (sec.phone_number IS NULL OR sec.phone_number = '')
      AND ca.total_payments = 0
      AND ca.total_accepted_bookings = 0
      AND ca.organization_id = ${ORG_ID}::uuid
  `
  console.log('6. Ghost Profiles in NEVER_BOOKED:', ghosts)

  await prisma.$disconnect()
}

runAudit().catch(console.error)

