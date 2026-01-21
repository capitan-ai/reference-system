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
  const authHeader = request.headers.get('authorization')
  const authToken = authHeader?.replace('ApplePass ', '')
  
  if (!authToken) {
    console.warn(`⚠️ No auth token in header. Header: ${authHeader || 'missing'}`)
    return false
  }
  
  const expectedToken = generateAuthToken(serialNumber)
  const matches = authToken === expectedToken
  
  if (!matches) {
    console.warn(`⚠️ Auth token mismatch for serial: ${serialNumber}`)
    console.warn(`   Received: ${authToken.substring(0, 10)}...`)
    console.warn(`   Expected: ${expectedToken.substring(0, 10)}...`)
  }
  
  return matches
}

// Handle OPTIONS requests for CORS preflight (Apple Wallet may send these)
export async function OPTIONS(request, { params }) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`📱 [${new Date().toISOString()}] OPTIONS (CORS preflight) REQUEST`)
  console.log(`   URL: ${request.url}`)
  console.log(`   Method: ${request.method}`)
  console.log(`   Headers:`, Object.fromEntries(request.headers.entries()))
  console.log(`${'='.repeat(60)}\n`)
  
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  })
}

export async function POST(request, { params }) {
  // Log IMMEDIATELY at the start - before any processing
  console.log(`\n${'='.repeat(60)}`)
  console.log(`📱 [${new Date().toISOString()}] REGISTRATION ENDPOINT HIT`)
  console.log(`   URL: ${request.url}`)
  console.log(`   Method: ${request.method}`)
  console.log(`   Headers:`, Object.fromEntries(request.headers.entries()))
  console.log(`${'='.repeat(60)}\n`)
  
  const startTime = Date.now()
  
  try {
    const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = params

    // Detailed logging at start
    console.log(`📱 [${new Date().toISOString()}] Registration attempt:`)
    console.log(`   Device ID: ${deviceLibraryIdentifier}`)
    console.log(`   Pass Type: ${passTypeIdentifier}`)
    console.log(`   Serial Number: ${serialNumber}`)
    console.log(`   Expected Pass Type: ${process.env.APPLE_PASS_TYPE_ID || 'NOT SET'}`)
    console.log(`   Request URL: ${request.url}`)
    console.log(`   Request Method: ${request.method}`)

    // Verify pass type identifier
    if (passTypeIdentifier !== process.env.APPLE_PASS_TYPE_ID) {
      console.error(`❌ Pass type mismatch:`)
      console.error(`   Got: "${passTypeIdentifier}"`)
      console.error(`   Expected: "${process.env.APPLE_PASS_TYPE_ID || 'NOT SET'}"`)
      return new Response('Invalid pass type identifier', { status: 401 })
    }

    // Verify authentication token
    if (!verifyAuthToken(request, serialNumber)) {
      console.error(`❌ Auth token verification failed for serial: ${serialNumber}`)
      return new Response('Unauthorized', { status: 401 })
    }

    console.log(`✅ Auth token verified successfully`)

    // Get push token from request body
    let body = {}
    try {
      body = await request.json()
    } catch (parseError) {
      console.warn(`⚠️ Could not parse request body: ${parseError.message}`)
    }
    
    const pushToken = body.pushToken || null
    console.log(`   Push token present: ${!!pushToken}`)
    if (pushToken) {
      console.log(`   Push token preview: ${pushToken.substring(0, 20)}...`)
    }

    console.log(`📱 Registering device: ${deviceLibraryIdentifier} for pass: ${serialNumber}`)

    // Register or update device registration
    const result = await prisma.devicePassRegistration.upsert({
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

    const duration = Date.now() - startTime
    console.log(`✅ Device registered successfully in ${duration}ms`)
    console.log(`   Device: ${deviceLibraryIdentifier}`)
    console.log(`   Serial: ${serialNumber}`)
    console.log(`   Push token saved: ${!!pushToken}`)

    return new Response('', { 
      status: 201,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    })
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`❌ [${new Date().toISOString()}] Error registering device (${duration}ms):`)
    console.error(`   Error message: ${error.message}`)
    console.error(`   Error code: ${error.code || 'N/A'}`)
    console.error(`   Error stack: ${error.stack}`)
    console.error(`   Params:`, JSON.stringify(params, null, 2))
    console.error(`   Device: ${params?.deviceLibraryIdentifier}`)
    console.error(`   Pass Type: ${params?.passTypeIdentifier}`)
    console.error(`   Serial: ${params?.serialNumber}`)
    return new Response('Internal Server Error', { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  try {
    const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = params

    console.log(`📱 [${new Date().toISOString()}] Unregistration attempt:`)
    console.log(`   Device: ${deviceLibraryIdentifier}`)
    console.log(`   Pass Type: ${passTypeIdentifier}`)
    console.log(`   Serial: ${serialNumber}`)

    // Verify pass type identifier
    if (passTypeIdentifier !== process.env.APPLE_PASS_TYPE_ID) {
      console.error(`❌ Pass type mismatch: got "${passTypeIdentifier}", expected "${process.env.APPLE_PASS_TYPE_ID || 'NOT SET'}"`)
      return new Response('Invalid pass type identifier', { status: 401 })
    }

    // Verify authentication token
    if (!verifyAuthToken(request, serialNumber)) {
      console.error(`❌ Auth token verification failed`)
      return new Response('Unauthorized', { status: 401 })
    }

    console.log(`📱 Unregistering device: ${deviceLibraryIdentifier} for pass: ${serialNumber}`)

    // Delete device registration
    const result = await prisma.devicePassRegistration.deleteMany({
      where: {
        deviceLibraryIdentifier: deviceLibraryIdentifier,
        passTypeIdentifier: passTypeIdentifier,
        serialNumber: serialNumber
      }
    })

    console.log(`✅ Device unregistered successfully (deleted ${result.count || 0} records)`)

    return new Response('', { 
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    })
  } catch (error) {
    console.error('❌ Error unregistering device:', error)
    console.error(`   Error message: ${error.message}`)
    // If record doesn't exist, that's okay - return success
    return new Response('', { 
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    })
  }
}

