const prisma = require('../lib/prisma-client')

async function checkBookingCreatedLogs() {
  const bookingId = 'gb2c2hdlkqguo4'
  const customerId = 'NR74ABD2W5PBXC46R41B9HPA4M'
  
  console.log(`🔍 Checking logs for booking.created webhook`)
  console.log(`   Booking ID: ${bookingId}`)
  console.log(`   Customer ID: ${customerId}`)
  console.log('=' .repeat(60))
  
  try {
    // Check giftcard_runs for booking.created events
    console.log(`\n📊 Checking giftcard_runs for booking.created events...`)
    const runs = await prisma.$queryRaw`
      SELECT 
        correlation_id,
        square_event_id,
        square_event_type,
        trigger_type,
        stage,
        status,
        last_error,
        attempts,
        created_at,
        updated_at,
        payload
      FROM giftcard_runs
      WHERE square_event_type = 'booking.created'
        AND created_at >= '2026-01-27'::date
        AND created_at < '2026-01-28'::date
      ORDER BY created_at DESC
      LIMIT 20
    `
    
    console.log(`   Found ${runs.length} booking.created run(s) on 2026-01-27`)
    
    runs.forEach((run, index) => {
      console.log(`\n   Run ${index + 1}:`)
      console.log(`   - Correlation ID: ${run.correlation_id}`)
      console.log(`   - Event ID: ${run.square_event_id}`)
      console.log(`   - Stage: ${run.stage || 'N/A'}`)
      console.log(`   - Status: ${run.status}`)
      console.log(`   - Attempts: ${run.attempts}`)
      console.log(`   - Error: ${run.last_error || 'None'}`)
      console.log(`   - Created: ${run.created_at}`)
      
      // Check if payload contains our booking
      if (run.payload) {
        const payload = typeof run.payload === 'string' ? JSON.parse(run.payload) : run.payload
        const payloadBookingId = payload?.id || payload?.bookingId
        if (payloadBookingId && payloadBookingId.includes(bookingId)) {
          console.log(`   ✅ THIS RUN CONTAINS OUR BOOKING!`)
        }
      }
    })
    
    // Check giftcard_jobs for booking stage
    console.log(`\n📦 Checking giftcard_jobs for booking stage...`)
    const jobs = await prisma.$queryRaw`
      SELECT 
        id,
        correlation_id,
        stage,
        status,
        attempts,
        last_error,
        scheduled_at,
        locked_at,
        created_at,
        updated_at
      FROM giftcard_jobs
      WHERE stage = 'booking'
        AND created_at >= '2026-01-27'::date
        AND created_at < '2026-01-28'::date
      ORDER BY created_at DESC
      LIMIT 20
    `
    
    console.log(`   Found ${jobs.length} booking job(s) on 2026-01-27`)
    
    jobs.forEach((job, index) => {
      console.log(`\n   Job ${index + 1}:`)
      console.log(`   - Job ID: ${job.id}`)
      console.log(`   - Correlation ID: ${job.correlation_id}`)
      console.log(`   - Status: ${job.status}`)
      console.log(`   - Attempts: ${job.attempts}`)
      console.log(`   - Error: ${job.last_error || 'None'}`)
      console.log(`   - Scheduled: ${job.scheduled_at}`)
      console.log(`   - Locked: ${job.locked_at || 'Not locked'}`)
      console.log(`   - Created: ${job.created_at}`)
    })
    
    // Check for any errors related to this customer
    console.log(`\n❌ Checking for errors related to this customer...`)
    const customerErrors = await prisma.$queryRaw`
      SELECT 
        correlation_id,
        square_event_type,
        stage,
        status,
        last_error,
        created_at
      FROM giftcard_runs
      WHERE (
        last_error IS NOT NULL
        AND last_error != ''
      )
        AND created_at >= '2026-01-27'::date
        AND created_at < '2026-01-28'::date
        AND (
          context::text LIKE ${`%${customerId}%`}
          OR payload::text LIKE ${`%${customerId}%`}
          OR payload::text LIKE ${`%${bookingId}%`}
        )
      ORDER BY created_at DESC
      LIMIT 10
    `
    
    console.log(`   Found ${customerErrors.length} error(s) related to this customer/booking`)
    customerErrors.forEach((error, index) => {
      console.log(`\n   Error ${index + 1}:`)
      console.log(`   - Correlation ID: ${error.correlation_id}`)
      console.log(`   - Event Type: ${error.square_event_type || 'N/A'}`)
      console.log(`   - Stage: ${error.stage || 'N/A'}`)
      console.log(`   - Status: ${error.status}`)
      console.log(`   - Error: ${error.last_error}`)
      console.log(`   - Created: ${error.created_at}`)
    })
    
    console.log(`\n${'='.repeat(60)}`)
    console.log(`\n📝 Summary:`)
    console.log(`   - booking.created runs: ${runs.length}`)
    console.log(`   - booking jobs: ${jobs.length}`)
    console.log(`   - Related errors: ${customerErrors.length}`)
    
    if (runs.length === 0) {
      console.log(`\n⚠️  ISSUE: No booking.created runs found!`)
      console.log(`   This means either:`)
      console.log(`   1. The webhook went to the wrong endpoint (/api/webhooks/square/route.js instead of /referrals)`)
      console.log(`   2. The webhook was never received`)
      console.log(`   3. The webhook failed before creating a run record`)
    }
    
  } catch (error) {
    console.error(`❌ Error checking logs:`, error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkBookingCreatedLogs()



