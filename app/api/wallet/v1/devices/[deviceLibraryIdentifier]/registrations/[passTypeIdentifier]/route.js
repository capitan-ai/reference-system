// Apple Wallet Web Service API
// GET /v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}
// Returns list of serial numbers for passes registered to this device

import prisma from '@/lib/prisma-client'

export async function GET(request, { params }) {
  try {
    const { deviceLibraryIdentifier, passTypeIdentifier } = params

    // Verify pass type identifier
    if (passTypeIdentifier !== process.env.APPLE_PASS_TYPE_ID) {
      return new Response('Invalid pass type identifier', { status: 401 })
    }

    console.log(`📱 Getting registrations for device: ${deviceLibraryIdentifier}`)

    // Get all passes registered to this device
    const registrations = await prisma.devicePassRegistration.findMany({
      where: {
        deviceLibraryIdentifier: deviceLibraryIdentifier,
        passTypeIdentifier: passTypeIdentifier
      },
      select: {
        serialNumber: true
      }
    })

    const serialNumbers = registrations.map(r => r.serialNumber)

    console.log(`✅ Found ${serialNumbers.length} registered passes for device`)

    // Return JSON array of serial numbers
    return new Response(JSON.stringify(serialNumbers), {
      headers: {
        'Content-Type': 'application/json'
      }
    })
  } catch (error) {
    console.error('❌ Error getting device registrations:', error)
    return new Response('Internal Server Error', { status: 500 })
  }
}

