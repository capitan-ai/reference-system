const path = require('path')
const fs = require('fs')
const prisma = require('../prisma-client')

let apnModule = null
let apnLoadError = null
let apnProvider = null
let apnInitAttempted = false
let apnInitError = null

const INVALID_REASONS = new Set(['Unregistered', 'BadDeviceToken', 'DeviceTokenNotForTopic'])

function loadApnModule() {
  if (apnModule || apnLoadError) {
    return apnModule
  }

  try {
    // Lazy-load to avoid executing heavy crypto dependencies during build
    // eslint-disable-next-line global-require
    apnModule = require('apn')
    return apnModule
  } catch (error) {
    apnLoadError = error
    console.warn('⚠️ APNs module not available, wallet push disabled:', error.message)
    return null
  }
}

function decodePemFromBase64(value) {
  if (!value) return null
  try {
    const cleaned = value.replace(/\s/g, '')
    return Buffer.from(cleaned, 'base64').toString('utf8')
  } catch (error) {
    console.error('❌ Failed to decode PEM base64 value for APNs:', error.message)
    return null
  }
}

function resolveFileBuffer(filePath) {
  if (!filePath) return null
  try {
    return fs.readFileSync(path.resolve(filePath))
  } catch (error) {
    console.error(`❌ Failed to read certificate file at ${filePath}:`, error.message)
    return null
  }
}

function getApnProvider() {
  const apn = loadApnModule()
  if (!apn) {
    apnInitError = apnInitError || 'APNs module not available'
    return null
  }

  if (apnProvider) {
    return apnProvider
  }

  if (apnInitAttempted && !apnProvider) {
    return null
  }

  apnInitAttempted = true

  const options = {
    production: process.env.NODE_ENV === 'production'
  }

  let configured = false

  if (process.env.APPLE_PASS_CERTIFICATE_PEM_BASE64 && process.env.APPLE_PASS_KEY_PEM_BASE64) {
    const cert = decodePemFromBase64(process.env.APPLE_PASS_CERTIFICATE_PEM_BASE64)
    const key = decodePemFromBase64(process.env.APPLE_PASS_KEY_PEM_BASE64)
    if (cert && key) {
      options.cert = cert
      options.key = key
      if (process.env.APPLE_PASS_CERTIFICATE_PASSWORD) {
        options.passphrase = process.env.APPLE_PASS_CERTIFICATE_PASSWORD
      }
      configured = true
    }
  } else if (process.env.APPLE_PASS_CERTIFICATE_BASE64) {
    try {
      options.pfx = Buffer.from(process.env.APPLE_PASS_CERTIFICATE_BASE64, 'base64')
      if (process.env.APPLE_PASS_CERTIFICATE_PASSWORD) {
        options.passphrase = process.env.APPLE_PASS_CERTIFICATE_PASSWORD
      }
      configured = true
    } catch (error) {
      console.error('❌ Failed to decode APPLE_PASS_CERTIFICATE_BASE64 for APNs:', error.message)
    }
  } else if (process.env.APPLE_PASS_CERTIFICATE_PEM_PATH && process.env.APPLE_PASS_KEY_PEM_PATH) {
    const certPath = path.resolve(process.env.APPLE_PASS_CERTIFICATE_PEM_PATH)
    const keyPath = path.resolve(process.env.APPLE_PASS_KEY_PEM_PATH)
    options.cert = resolveFileBuffer(certPath)
    options.key = resolveFileBuffer(keyPath)
    if (options.cert && options.key) {
      if (process.env.APPLE_PASS_CERTIFICATE_PASSWORD) {
        options.passphrase = process.env.APPLE_PASS_CERTIFICATE_PASSWORD
      }
      configured = true
    }
  } else if (process.env.APPLE_PASS_CERTIFICATE_PATH) {
    const pfxBuffer = resolveFileBuffer(process.env.APPLE_PASS_CERTIFICATE_PATH)
    if (pfxBuffer) {
      options.pfx = pfxBuffer
      if (process.env.APPLE_PASS_CERTIFICATE_PASSWORD) {
        options.passphrase = process.env.APPLE_PASS_CERTIFICATE_PASSWORD
      }
      configured = true
    }
  }

  if (!configured) {
    apnInitError = 'Missing Apple pass certificate/ key configuration for push notifications'
    console.warn('⚠️ Apple Wallet push notifications are disabled:', apnInitError)
    return null
  }

  try {
    apnProvider = new apn.Provider(options)
    apnProvider.on('error', (err) => {
      console.error('❌ APNs provider error:', err)
    })
    console.log('📡 APNs provider initialized (topic:', process.env.APPLE_PASS_TYPE_ID || 'unknown', ')')
  } catch (error) {
    apnInitError = error.message
    console.error('❌ Failed to initialize APNs provider:', error)
    apnProvider = null
  }

  return apnProvider
}

async function sendWalletPassUpdate(giftCardGan, { prismaClient, reason, metadata } = {}) {
  if (!giftCardGan) {
    return
  }

  if (process.env.APPLE_WALLET_PUSH_ENABLED === 'false') {
    console.log(`ℹ️ Wallet push disabled, skipping notification for ${giftCardGan}`)
    return
  }

  const passTypeIdentifier = process.env.APPLE_PASS_TYPE_ID
  if (!passTypeIdentifier) {
    console.warn('⚠️ Cannot send wallet push notification – APPLE_PASS_TYPE_ID is missing')
    return
  }

  const provider = getApnProvider()
  if (!provider) {
    return
  }

  const db = prismaClient || prisma

  // Check if devicePassRegistration model is available
  if (!db || !db.devicePassRegistration) {
    console.warn(`⚠️ devicePassRegistration model not available, skipping push for ${giftCardGan}`)
    return
  }

  let registrations = []
  try {
    registrations = await db.devicePassRegistration.findMany({
      where: {
        passTypeIdentifier,
        serialNumber: giftCardGan,
        NOT: {
          pushToken: null
        }
      },
      select: {
        pushToken: true
      }
    })
  } catch (error) {
    // Handle case where devicePassRegistration model might not be available or query fails
    console.warn(`⚠️ Could not query device registrations for ${giftCardGan}:`, error.message)
    return
  }

  // Ensure registrations is an array (findMany should always return array, but be safe)
  if (!Array.isArray(registrations)) {
    console.warn(`⚠️ Invalid registrations result for ${giftCardGan}, expected array, got:`, typeof registrations)
    return
  }

  const tokens = Array.from(
    new Set(
      registrations
        .map((reg) => reg?.pushToken)
        .filter((token) => typeof token === 'string' && token.trim().length > 0)
    )
  )

  if (!tokens.length) {
    console.log(`ℹ️ No registered devices for pass ${giftCardGan}, skipping push`)
    return
  }

  const apn = loadApnModule()
  if (!apn) {
    return
  }

  const note = new apn.Notification()
  note.topic = passTypeIdentifier
  note.pushType = 'background'
  note.priority = 5
  note.expiry = Math.floor(Date.now() / 1000) + 3600
  note.payload = {
    aps: {
      'content-available': 1
    },
    serialNumber: giftCardGan,
    passTypeIdentifier,
    reason: reason || 'update',
    ...(metadata ? { meta: metadata } : {})
  }

  try {
    console.log(`📣 Sending wallet push for ${giftCardGan} to ${tokens.length} device(s)`)
    const response = await provider.send(note, tokens)

    if (response.sent?.length) {
      console.log(`✅ Wallet push delivered to ${response.sent.length} device(s) for ${giftCardGan}`)
    }

    if (response.failed?.length) {
      for (const failure of response.failed) {
        const token = failure.device
        const reasonText = failure.response?.reason || failure.error?.message || 'unknown'
        console.warn(`⚠️ Wallet push failed for token ${token}: ${reasonText}`)
        if (
          failure.status === '410' ||
          INVALID_REASONS.has(reasonText) ||
          failure.error?.name === 'GatewayNotificationError'
        ) {
          try {
            await db.devicePassRegistration.deleteMany({
              where: { pushToken: token }
            })
            console.log(`🧹 Removed invalid push token ${token}`)
          } catch (cleanupError) {
            console.error('❌ Failed to remove invalid push token:', cleanupError)
          }
        }
      }
    }
  } catch (error) {
    console.error(`❌ Failed to send wallet push for ${giftCardGan}:`, error)
  }
}

function queueWalletPassUpdate(giftCardGan, options = {}) {
  if (!giftCardGan) return
  sendWalletPassUpdate(giftCardGan, options).catch((error) => {
    console.error(`❌ Wallet push queue error for ${giftCardGan}:`, error)
  })
}

module.exports = {
  sendWalletPassUpdate,
  queueWalletPassUpdate
}


