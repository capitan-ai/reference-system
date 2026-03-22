// Apple Wallet Web Service API
// POST /v1/log
// Receives diagnostic logs from devices

export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    const logs = await request.json().catch(() => ({}))
    
    // Log diagnostic messages from devices - THIS IS CRITICAL for debugging pass validation issues
    console.log('\n' + '='.repeat(60))
    console.log('📱 [Apple Wallet Device Log]')
    console.log(`   Time: ${new Date().toISOString()}`)
    console.log('   This endpoint receives errors/warnings from Apple Wallet')
    console.log('   If you see errors here, it indicates pass validation issues!')
    console.log('='.repeat(60))
    console.log(JSON.stringify(logs, null, 2))
    console.log('='.repeat(60) + '\n')
    
    // Return 200 OK (Apple expects this)
    return new Response('', { status: 200 })
  } catch (error) {
    console.error('❌ Error processing log:', error)
    // Still return 200 to avoid retries
    return new Response('', { status: 200 })
  }
}

