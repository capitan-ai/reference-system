const prisma = require('../lib/prisma-client')

async function checkBookingRunDetails() {
  const correlationId = 'booking-created:cecf6055971ee0c06d02204f'
  
  console.log(`🔍 Checking details for correlation ID: ${correlationId}`)
  console.log('=' .repeat(60))
  
  try {
    // Get the full run record
    const run = await prisma.$queryRaw`
      SELECT 
        correlation_id,
        square_event_id,
        square_event_type,
        trigger_type,
        stage,
        status,
        last_error,
        attempts,
        payload,
        context,
        created_at,
        updated_at
      FROM giftcard_runs
      WHERE correlation_id = ${correlationId}
      LIMIT 1
    `
    
    if (run.length === 0) {
      console.log(`❌ Run not found`)
      return
    }
    
    const r = run[0]
    console.log(`\n📊 Run Details:`)
    console.log(`   - Correlation ID: ${r.correlation_id}`)
    console.log(`   - Event ID: ${r.square_event_id}`)
    console.log(`   - Event Type: ${r.square_event_type}`)
    console.log(`   - Stage: ${r.stage}`)
    console.log(`   - Status: ${r.status}`)
    console.log(`   - Attempts: ${r.attempts}`)
    console.log(`   - Error: ${r.last_error || 'None'}`)
    console.log(`   - Created: ${r.created_at}`)
    console.log(`   - Updated: ${r.updated_at}`)
    
    // Parse payload
    if (r.payload) {
      const payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload
      console.log(`\n📦 Payload:`)
      console.log(`   - Booking ID: ${payload?.id || payload?.bookingId || 'N/A'}`)
      console.log(`   - Customer ID: ${payload?.customer_id || payload?.customerId || 'N/A'}`)
      console.log(`   - Location ID: ${payload?.location_id || payload?.locationId || 'N/A'}`)
      console.log(`   - Merchant ID: ${payload?.merchant_id || payload?.merchantId || 'N/A'}`)
      console.log(`   - Status: ${payload?.status || 'N/A'}`)
      console.log(`   - Start At: ${payload?.start_at || payload?.startAt || 'N/A'}`)
      console.log(`   - Has Segments: ${!!(payload?.appointment_segments || payload?.appointmentSegments)}`)
      
      if (payload?.appointment_segments || payload?.appointmentSegments) {
        const segments = payload.appointment_segments || payload.appointmentSegments
        console.log(`   - Segments Count: ${segments.length}`)
        segments.forEach((seg, i) => {
          console.log(`     Segment ${i + 1}:`)
          console.log(`       - Service Variation ID: ${seg.service_variation_id || seg.serviceVariationId || 'N/A'}`)
          console.log(`       - Team Member ID: ${seg.team_member_id || seg.teamMemberId || 'N/A'}`)
          console.log(`       - Duration: ${seg.duration_minutes || seg.durationMinutes || 'N/A'} minutes`)
        })
      }
    }
    
    // Parse context
    if (r.context) {
      const context = typeof r.context === 'string' ? JSON.parse(r.context) : r.context
      console.log(`\n🔧 Context:`)
      console.log(`   - Customer ID: ${context?.customerId || 'N/A'}`)
      console.log(`   - Booking ID: ${context?.bookingId || 'N/A'}`)
      console.log(`   - Merchant ID: ${context?.merchantId || 'N/A'}`)
      console.log(`   - Organization ID: ${context?.organizationId || 'N/A'}`)
    }
    
    // Check if there's a job for this correlation
    const job = await prisma.$queryRaw`
      SELECT 
        id,
        stage,
        status,
        attempts,
        last_error,
        scheduled_at,
        locked_at,
        created_at,
        updated_at
      FROM giftcard_jobs
      WHERE correlation_id = ${correlationId}
        AND stage = 'booking'
      LIMIT 1
    `
    
    if (job.length > 0) {
      const j = job[0]
      console.log(`\n📦 Job Details:`)
      console.log(`   - Job ID: ${j.id}`)
      console.log(`   - Stage: ${j.stage}`)
      console.log(`   - Status: ${j.status}`)
      console.log(`   - Attempts: ${j.attempts}`)
      console.log(`   - Error: ${j.last_error || 'None'}`)
      console.log(`   - Scheduled: ${j.scheduled_at}`)
      console.log(`   - Locked: ${j.locked_at || 'Not locked'}`)
      console.log(`   - Created: ${j.created_at}`)
      console.log(`   - Updated: ${j.updated_at}`)
    } else {
      console.log(`\n⚠️  No job found for this correlation ID`)
    }
    
    console.log(`\n${'='.repeat(60)}`)
    console.log(`\n🔍 Analysis:`)
    if (r.stage === 'booking:received' && r.status === 'running') {
      console.log(`   ⚠️  ISSUE: Run is stuck at 'booking:received' stage`)
      console.log(`   This means:`)
      console.log(`   1. processBookingCreated was called but didn't complete`)
      console.log(`   2. It likely returned early or threw an error that was caught`)
      console.log(`   3. Possible causes:`)
      console.log(`      - Missing organization_id (couldn't resolve from merchant_id or customer)`)
      console.log(`      - Missing location_id in booking data`)
      console.log(`      - Error in saveBookingToDatabase that was caught silently`)
      console.log(`      - Error in processBookingCreated that wasn't properly logged`)
    }
    
  } catch (error) {
    console.error(`❌ Error:`, error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkBookingRunDetails()



