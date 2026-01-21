// Apple Wallet Web Service API
// POST /v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}
// Register a device to receive push notifications for a pass
// DELETE /v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}
// Unregister a device from receiving push notifications for a pass

import { createRequire } from 'module'
import prisma from '@/lib/prisma-client'

const require = createRequire(import.meta.url)
const { generateAuthToken } = require('../../../../../../../../../lib/wallet/pass-generator.js')

// Verify authentication token
function verifyAuthToken(request, serialNumber) {
  const authToken = request.headers.get('authorization')?.replace('ApplePass ', '')
  if (!authToken) {
    return false
  }
  
  const expectedToken = generateAuthToken(serialNumber)
  return authToken === expectedToken
}

export async function POST(request, { params }) {
  try {
    const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = params

    // Verify pass type identifier
    if (passTypeIdentifier !== process.env.APPLE_PASS_TYPE_ID) {
      return new Response('Invalid pass type identifier', { status: 401 })
    }

    // Verify authentication token
    if (!verifyAuthToken(request, serialNumber)) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Get push token from request body
    const body = await request.json().catch(() => ({}))
    const pushToken = body.pushToken || null

    console.log(`📱 Registering device: ${deviceLibraryIdentifier} for pass: ${serialNumber}`)

    // Register or update device registration
    await prisma.devicePassRegistration.upsert({
      where: {
        deviceLibraryIdentifier_passTypeIdentifier_serialNumber: {
          deviceLibraryIdentifier: deviceLibraryIdentifier,
          passTypeIdentifier: passTypeIdentifier,
          serialNumber: serialNumber
        }
      },
      update: {
        pushToken: pushToken,
        updatedAt: new Date()
      },
      create: {
        deviceLibraryIdentifier: deviceLibraryIdentifier,
        passTypeIdentifier: passTypeIdentifier,
        serialNumber: serialNumber,
        pushToken: pushToken
      }
    })

    console.log(`✅ Device registered successfully`)

    return new Response('', { status: 201 })
  } catch (error) {
    console.error('❌ Error registering device:', error)
    return new Response('Internal Server Error', { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  try {
    const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = params

    // Verify pass type identifier
    if (passTypeIdentifier !== process.env.APPLE_PASS_TYPE_ID) {
      return new Response('Invalid pass type identifier', { status: 401 })
    }

    // Verify authentication token
    if (!verifyAuthToken(request, serialNumber)) {
      return new Response('Unauthorized', { status: 401 })
    }

    console.log(`📱 Unregistering device: ${deviceLibraryIdentifier} for pass: ${serialNumber}`)

    // Delete device registration
    await prisma.devicePassRegistration.deleteMany({
      where: {
        deviceLibraryIdentifier: deviceLibraryIdentifier,
        passTypeIdentifier: passTypeIdentifier,
        serialNumber: serialNumber
      }
    })

    console.log(`✅ Device unregistered successfully`)

    return new Response('', { status: 200 })
  } catch (error) {
    console.error('❌ Error unregistering device:', error)
    // If record doesn't exist, that's okay - return success
    return new Response('', { status: 200 })
  }
}

