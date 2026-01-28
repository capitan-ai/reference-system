const prisma = require('../lib/prisma-client')

async function checkBooking() {
  const bookingId = 'gb2c2hdlkqguo4'
  
  console.log(`🔍 Checking booking: ${bookingId}`)
  console.log('=' .repeat(60))
  
  try {
    // Check for booking in database
    const bookings = await prisma.$queryRaw`
      SELECT 
        id,
        booking_id,
        organization_id,
        customer_id,
        location_id,
        service_variation_id,
        technician_id,
        status,
        start_at,
        created_at,
        updated_at,
        raw_json
      FROM bookings
      WHERE booking_id LIKE ${`${bookingId}%`}
      ORDER BY created_at ASC
    `
    
    console.log(`\n📊 Database Results:`)
    console.log(`   Found ${bookings.length} booking record(s)`)
    
    if (bookings.length === 0) {
      console.log(`   ❌ Booking NOT found in database`)
    } else {
      bookings.forEach((booking, index) => {
        console.log(`\n   Booking ${index + 1}:`)
        console.log(`   - UUID: ${booking.id}`)
        console.log(`   - Booking ID: ${booking.booking_id}`)
        console.log(`   - Customer ID: ${booking.customer_id}`)
        console.log(`   - Status: ${booking.status}`)
        console.log(`   - Start At: ${booking.start_at}`)
        console.log(`   - Created: ${booking.created_at}`)
        console.log(`   - Updated: ${booking.updated_at}`)
      })
    }
    
    // Check for related customer
    const customerId = 'NR74ABD2W5PBXC46R41B9HPA4M'
    console.log(`\n👤 Checking customer: ${customerId}`)
    const customers = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        organization_id
      FROM square_existing_clients
      WHERE square_customer_id = ${customerId}
    `
    
    if (customers.length === 0) {
      console.log(`   ❌ Customer NOT found in database`)
    } else {
      console.log(`   ✅ Customer found:`)
      customers.forEach(customer => {
        console.log(`   - Name: ${customer.given_name || ''} ${customer.family_name || ''}`)
        console.log(`   - Email: ${customer.email_address || 'N/A'}`)
        console.log(`   - Organization ID: ${customer.organization_id}`)
      })
    }
    
    // Check for related orders
    console.log(`\n📦 Checking for related orders...`)
    const orders = await prisma.$queryRaw`
      SELECT 
        o.id,
        o.order_id,
        o.customer_id,
        o.booking_id,
        o.created_at
      FROM orders o
      INNER JOIN square_existing_clients c ON o.customer_id = c.square_customer_id
      WHERE c.square_customer_id = ${customerId}
        AND o.created_at >= '2026-01-27'::date
        AND o.created_at < '2026-01-28'::date
      ORDER BY o.created_at DESC
      LIMIT 10
    `
    
    console.log(`   Found ${orders.length} order(s) for this customer on 2026-01-27`)
    orders.forEach(order => {
      console.log(`   - Order ID: ${order.order_id}`)
      console.log(`     Booking ID: ${order.booking_id || 'NULL'}`)
      console.log(`     Created: ${order.created_at}`)
    })
    
    // Check for related payments
    console.log(`\n💳 Checking for related payments...`)
    const payments = await prisma.$queryRaw`
      SELECT 
        p.id,
        p.customer_id,
        p.booking_id,
        p.order_id,
        p.created_at
      FROM payments p
      INNER JOIN square_existing_clients c ON p.customer_id = c.square_customer_id
      WHERE c.square_customer_id = ${customerId}
        AND p.created_at >= '2026-01-27'::date
        AND p.created_at < '2026-01-28'::date
      ORDER BY p.created_at DESC
      LIMIT 10
    `
    
    console.log(`   Found ${payments.length} payment(s) for this customer on 2026-01-27`)
    payments.forEach(payment => {
      console.log(`   - Payment ID: ${payment.id}`)
      console.log(`     Booking ID: ${payment.booking_id || 'NULL'}`)
      console.log(`     Order ID: ${payment.order_id || 'NULL'}`)
      console.log(`     Created: ${payment.created_at}`)
    })
    
    // Check webhook logs or giftcard_runs for this booking
    console.log(`\n🔔 Checking webhook processing logs...`)
    const webhookRuns = await prisma.$queryRaw`
      SELECT 
        correlation_id,
        square_event_id,
        square_event_type,
        trigger_type,
        stage,
        status,
        last_error,
        created_at,
        updated_at
      FROM giftcard_runs
      WHERE square_event_type = 'booking.updated'
        AND created_at >= '2026-01-27'::date
        AND created_at < '2026-01-28'::date
      ORDER BY created_at DESC
      LIMIT 20
    `
    
    console.log(`   Found ${webhookRuns.length} booking.updated webhook run(s) on 2026-01-27`)
    webhookRuns.forEach(run => {
      console.log(`   - Event ID: ${run.square_event_id}`)
      console.log(`     Status: ${run.status}`)
      console.log(`     Stage: ${run.stage || 'N/A'}`)
      console.log(`     Error: ${run.last_error || 'None'}`)
      console.log(`     Created: ${run.created_at}`)
    })
    
    console.log(`\n${'='.repeat(60)}`)
    console.log(`\n📝 Summary:`)
    console.log(`   - Booking ${bookingId} exists in DB: ${bookings.length > 0 ? '✅ YES' : '❌ NO'}`)
    console.log(`   - Customer exists: ${customers.length > 0 ? '✅ YES' : '❌ NO'}`)
    console.log(`   - Related orders: ${orders.length}`)
    console.log(`   - Related payments: ${payments.length}`)
    
    if (bookings.length === 0) {
      console.log(`\n⚠️  ISSUE: Booking was NOT created in database`)
      console.log(`   This means:`)
      console.log(`   1. The booking.created webhook was never received, OR`)
      console.log(`   2. The booking.created webhook failed to process, OR`)
      console.log(`   3. The booking was created before webhook handling was implemented`)
      console.log(`\n   When booking.updated arrived, it couldn't find the booking and just logged a warning.`)
      console.log(`   The booking data was NOT saved to the database.`)
    }
    
  } catch (error) {
    console.error(`❌ Error checking booking:`, error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkBooking()



