// Apple Wallet Web Service API
// POST /v1/log
// Receives diagnostic logs from devices

export async function POST(request) {
  try {
    const logs = await request.json().catch(() => ({}))
    
    // Log diagnostic messages from devices
    console.log('📱 Apple Wallet device log:', JSON.stringify(logs, null, 2))
    
    // Return 200 OK (Apple expects this)
    return new Response('', { status: 200 })
  } catch (error) {
    console.error('❌ Error processing log:', error)
    // Still return 200 to avoid retries
    return new Response('', { status: 200 })
  }
}

