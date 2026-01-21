// Apple Wallet Pass Generator
// Generates .pkpass files for gift cards

let PKPass
try {
  console.log('🧩 Loading passkit-generator PKPass class...')
  ;({ PKPass } = require('passkit-generator'))
  console.log('✅ passkit-generator PKPass class loaded')
} catch (error) {
  console.error('💥 Failed to load passkit-generator PKPass class:', error)
  throw error
}
const path = require('path')
const fs = require('fs')

const PASS_TYPE_ID = process.env.APPLE_PASS_TYPE_ID
const CERT_PATH = process.env.APPLE_PASS_CERTIFICATE_PATH
const CERT_PASSWORD = process.env.APPLE_PASS_CERTIFICATE_PASSWORD
const WWDR_PATH = process.env.APPLE_WWDR_CERTIFICATE_PATH
const TEAM_ID = process.env.APPLE_PASS_TEAM_ID

console.log('🔐 Apple Wallet env summary (sanitized):', {
  PASS_TYPE_ID: !!PASS_TYPE_ID,
  TEAM_ID: !!TEAM_ID,
  CERT_PEM_BASE64: !!process.env.APPLE_PASS_CERTIFICATE_PEM_BASE64,
  KEY_PEM_BASE64: !!process.env.APPLE_PASS_KEY_PEM_BASE64,
  CERT_P12_BASE64: !!process.env.APPLE_PASS_CERTIFICATE_BASE64,
  CERT_PATH: !!CERT_PATH,
  WWDR_BASE64: !!process.env.APPLE_WWDR_CERTIFICATE_BASE64,
  WWDR_PATH: !!WWDR_PATH,
  WWDR_ABSOLUTE_PATH: !!process.env.APPLE_WWDR_CERTIFICATE_ABSOLUTE_PATH
})

const CUSTOM_ASSET_DIR = process.env.APPLE_WALLET_ASSET_PATH
const APPLE_WALLET_ASSET_DIRS = [
  CUSTOM_ASSET_DIR,
  path.join(process.cwd(), 'assets', 'apple-wallet'),
  path.join(process.cwd(), 'lib', 'wallet', 'pass-template')
].filter(Boolean).filter((dir, index, array) => array.indexOf(dir) === index)

/**
 * Generate an Apple Wallet pass for a gift card
 * @param {Object} options
 * @param {string} options.giftCardGan - Gift card account number
 * @param {number} options.balanceCents - Current balance in cents
 * @param {string} options.customerName - Customer name
 * @param {string} options.serialNumber - Unique serial number for the pass
 * @param {string} options.webServiceUrl - URL for pass updates (optional)
 * @returns {Promise<Buffer>} - .pkpass file as buffer
 */
async function generateGiftCardPass({
  giftCardGan,
  balanceCents,
  customerName,
  serialNumber,
  webServiceUrl = null
}) {
  // Validate configuration
  // Check if we have either file paths OR base64 encoded certificates
  // NEW: PEM format (preferred) - separate cert and key
  const hasCertPemBase64 = process.env.APPLE_PASS_CERTIFICATE_PEM_BASE64
  const hasKeyPemBase64 = process.env.APPLE_PASS_KEY_PEM_BASE64
  // LEGACY: .p12 format support
  const hasCertPath = CERT_PATH && CERT_PATH.trim()
  const hasCertBase64 = process.env.APPLE_PASS_CERTIFICATE_BASE64
  const hasWwdrPath = WWDR_PATH && WWDR_PATH.trim()
  const hasWwdrBase64 = process.env.APPLE_WWDR_CERTIFICATE_BASE64
  
  // New PEM format (preferred) or legacy .p12 format
  const hasCertificates = (hasCertPemBase64 && hasKeyPemBase64) || (hasCertPath || hasCertBase64) && (hasWwdrPath || hasWwdrBase64)
  
  if (!PASS_TYPE_ID || !TEAM_ID || !hasCertificates) {
    const missing = []
    if (!PASS_TYPE_ID) missing.push('APPLE_PASS_TYPE_ID')
    if (!TEAM_ID) missing.push('APPLE_PASS_TEAM_ID')
    if (!hasCertPemBase64 && !hasKeyPemBase64 && !hasCertPath && !hasCertBase64) {
      missing.push('APPLE_PASS_CERTIFICATE_PEM_BASE64 and APPLE_PASS_KEY_PEM_BASE64 (or APPLE_PASS_CERTIFICATE_BASE64 for legacy)')
    }
    if (!hasWwdrPath && !hasWwdrBase64) missing.push('APPLE_WWDR_CERTIFICATE_PATH or APPLE_WWDR_CERTIFICATE_BASE64')
    
    throw new Error(`Apple Wallet certificates not configured. Missing: ${missing.join(', ')}. Please check your environment variables in Vercel.`)
  }

  // Variables to hold Buffer or file path
  // passkit-generator accepts Buffer directly, which is more reliable than file paths
  let certPemBuffer = null
  let keyPemBuffer = null
  let wwdrBuffer = null
  let certPemPath = null
  let keyPemPath = null
  let certPath = null // Legacy .p12 support
  let wwdrPath = null
  
  // NEW: Check for PEM format certificates (preferred)
  if (hasCertPemBase64 && hasKeyPemBase64) {
    const tempDir = require('os').tmpdir()
    certPemPath = path.join(tempDir, 'pass-cert.pem')
    keyPemPath = path.join(tempDir, 'pass-key.pem')
    
    // Decode certificate (PEM) and write to temp file
    // Using file paths is more reliable than Buffer on Vercel
    try {
      const cleanCertBase64 = process.env.APPLE_PASS_CERTIFICATE_PEM_BASE64.replace(/\s/g, '')
      const certBuffer = Buffer.from(cleanCertBase64, 'base64')
      const certPem = certBuffer.toString('utf8')
      
      // Normalize PEM format
      const normalizedCert = certPem
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim() + '\n'
      
      if (!normalizedCert.includes('-----BEGIN CERTIFICATE-----')) {
        console.error('❌ Certificate validation failed:')
        console.error(`   First 100 chars: ${certPem.substring(0, 100)}`)
        console.error(`   Base64 length: ${process.env.APPLE_PASS_CERTIFICATE_PEM_BASE64.length}`)
        throw new Error('Certificate is not in valid PEM format - missing BEGIN CERTIFICATE marker')
      }
      if (!normalizedCert.includes('-----END CERTIFICATE-----')) {
        throw new Error('Certificate is not in valid PEM format - missing END CERTIFICATE marker')
      }
      
      // Write to temp file (passkit-generator can read from file path)
      fs.writeFileSync(certPemPath, normalizedCert, 'utf8')
      console.log('✅ Using base64 encoded certificate (PEM) from environment variable')
      console.log(`   Certificate written to: ${certPemPath} (${normalizedCert.length} chars)`)
      console.log(`   Certificate preview: ${normalizedCert.substring(0, 50)}...`)
    } catch (error) {
      console.error('❌ Error decoding certificate (PEM):', error.message)
      throw new Error(`Failed to decode certificate (PEM): ${error.message}`)
    }
    
    // Decode private key (PEM) and write to temp file
    try {
      const cleanKeyBase64 = process.env.APPLE_PASS_KEY_PEM_BASE64.replace(/\s/g, '')
      const keyBuffer = Buffer.from(cleanKeyBase64, 'base64')
      const keyPem = keyBuffer.toString('utf8')
      
      // Normalize PEM format
      const normalizedKey = keyPem
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim() + '\n'
      
      if (!normalizedKey.includes('-----BEGIN') || !normalizedKey.includes('PRIVATE KEY')) {
        console.error('❌ Private key validation failed:')
        console.error(`   First 100 chars: ${keyPem.substring(0, 100)}`)
        console.error(`   Base64 length: ${process.env.APPLE_PASS_KEY_PEM_BASE64.length}`)
        throw new Error('Private key is not in valid PEM format - missing BEGIN/END PRIVATE KEY markers')
      }
      if (!normalizedKey.includes('-----END') || !normalizedKey.includes('PRIVATE KEY')) {
        throw new Error('Private key is not in valid PEM format - missing END PRIVATE KEY marker')
      }
      
      // Write to temp file (passkit-generator can read from file path)
      fs.writeFileSync(keyPemPath, normalizedKey, 'utf8')
      console.log('✅ Using base64 encoded private key (PEM) from environment variable')
      console.log(`   Private key written to: ${keyPemPath} (${normalizedKey.length} chars)`)
      console.log(`   Key preview: ${normalizedKey.substring(0, 50)}...`)
    } catch (error) {
      console.error('❌ Error decoding private key (PEM):', error.message)
      throw new Error(`Failed to decode private key (PEM): ${error.message}`)
    }
  } 
  // LEGACY: Check for .p12 format (for backward compatibility)
  else if (process.env.APPLE_PASS_CERTIFICATE_BASE64) {
    // Write base64 certificate to temp file
    const tempDir = require('os').tmpdir()
    certPath = path.join(tempDir, 'pass-cert.p12')
    
    // Clean base64 string (remove whitespace, newlines)
    const cleanBase64 = process.env.APPLE_PASS_CERTIFICATE_BASE64.replace(/\s/g, '')
    
    try {
      const certBuffer = Buffer.from(cleanBase64, 'base64')
      fs.writeFileSync(certPath, certBuffer)
      console.log('⚠️ Using legacy .p12 certificate format. Consider migrating to PEM format.')
    } catch (error) {
      console.error('❌ Error decoding certificate:', error.message)
      throw new Error(`Failed to decode certificate: ${error.message}`)
    }
  } else {
    // Try file path
    certPath = path.resolve(process.cwd(), CERT_PATH)
    if (!fs.existsSync(certPath) && process.env.APPLE_PASS_CERTIFICATE_ABSOLUTE_PATH) {
      certPath = process.env.APPLE_PASS_CERTIFICATE_ABSOLUTE_PATH
    }
  }
  
  if (process.env.APPLE_WWDR_CERTIFICATE_BASE64) {
    // Write base64 WWDR certificate to temp file
    // Using file paths is more reliable than Buffer on Vercel
    const tempDir = require('os').tmpdir()
    wwdrPath = path.join(tempDir, 'wwdr-cert.pem')
    
    const cleanBase64 = process.env.APPLE_WWDR_CERTIFICATE_BASE64.replace(/\s/g, '')
    
    try {
      const wwdrBufferDecoded = Buffer.from(cleanBase64, 'base64')
      const wwdrContent = wwdrBufferDecoded.toString('utf8')
      
      // Normalize PEM format
      const normalizedWwdr = wwdrContent
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim() + '\n'
      
      // Check if it's already PEM format (starts with -----BEGIN)
      if (!normalizedWwdr.includes('-----BEGIN CERTIFICATE-----')) {
        throw new Error('WWDR certificate is not in valid PEM format')
      }
      
      // Write to temp file (passkit-generator can read from file path)
      fs.writeFileSync(wwdrPath, normalizedWwdr, 'utf8')
      console.log('✅ Using base64 encoded WWDR certificate from environment variable')
      console.log(`   WWDR certificate written to: ${wwdrPath} (${normalizedWwdr.length} chars)`)
      console.log(`   WWDR certificate starts with: ${normalizedWwdr.substring(0, 30)}...`)
    } catch (error) {
      console.error('❌ Error decoding WWDR certificate:', error.message)
      throw new Error(`Failed to decode WWDR certificate: ${error.message}`)
    }
  } else {
    // Try file path
    wwdrPath = path.resolve(process.cwd(), WWDR_PATH)
    if (!fs.existsSync(wwdrPath) && process.env.APPLE_WWDR_CERTIFICATE_ABSOLUTE_PATH) {
      wwdrPath = process.env.APPLE_WWDR_CERTIFICATE_ABSOLUTE_PATH
    }
  }

  // Final validation checks
  if (!certPemPath && !certPath) {
    throw new Error(`Certificate not found. Please ensure certificates are available via APPLE_PASS_CERTIFICATE_PEM_BASE64/APPLE_PASS_KEY_PEM_BASE64 or APPLE_PASS_CERTIFICATE_BASE64.`)
  }
  if (certPemPath && !keyPemPath) {
    throw new Error(`Private key not found. Please ensure APPLE_PASS_KEY_PEM_BASE64 is set when using PEM format.`)
  }
  if (!wwdrPath) {
    throw new Error(`WWDR certificate not found. Please ensure APPLE_WWDR_CERTIFICATE_BASE64 is set or APPLE_WWDR_CERTIFICATE_PATH points to a valid file.`)
  }
  
  // Ensure files exist
  if (wwdrPath && !fs.existsSync(wwdrPath)) {
    throw new Error(`WWDR certificate file not found at: ${wwdrPath}`)
  }
  if (certPemPath && !fs.existsSync(certPemPath)) {
    throw new Error(`Certificate file not found at: ${certPemPath}`)
  }
  if (keyPemPath && !fs.existsSync(keyPemPath)) {
    throw new Error(`Private key file not found at: ${keyPemPath}`)
  }
  if (certPath && !fs.existsSync(certPath)) {
    throw new Error(`Certificate file not found at: ${certPath}`)
  }

  // Format balance
  const balance = (balanceCents / 100).toFixed(2)
  const balanceFormatted = `$${balance}`
  const customerDisplayName = customerName && customerName.trim()
    ? customerName.trim()
    : 'Guest'

  // Use UTF-8 encoding for QR code barcode (more standard for numeric-only data)
  // Ensure GAN is clean (numeric only) before encoding
  const cleanGan = giftCardGan.toString().trim().replace(/\D/g, '')
  const barcodePayload = {
    message: cleanGan || giftCardGan, // Use cleaned GAN, fallback to original
    format: 'PKBarcodeFormatQR',
    messageEncoding: 'utf-8' // Modern standard encoding
  }

  const passPayload = {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE_ID,
    teamIdentifier: TEAM_ID,
    serialNumber,
    organizationName: 'Zorina Nail Studio',
    description: `Zorina Nail Studio Gift Card - ${balanceFormatted}`,
    foregroundColor: 'rgb(33, 33, 33)',
    backgroundColor: 'rgb(242, 235, 221)',
    labelColor: 'rgb(92, 107, 80)',
    storeCard: {
      primaryFields: [
        {
          key: 'balance',
          label: 'Balance',
          value: balanceFormatted
        }
      ],
      secondaryFields: [
        {
          key: 'cardNumber',
          label: 'Gift Card Number',
          value: giftCardGan
        },
        {
          key: 'customerName',
          label: 'Customer',
          value: customerDisplayName
        },
        {
          key: 'validAt',
          label: 'Valid at',
          value: 'Zorina Nail Studio'
        }
      ],
      auxiliaryFields: []
    },
    barcode: barcodePayload
  }

  if (webServiceUrl) {
    passPayload.webServiceURL = webServiceUrl
    passPayload.authenticationToken = generateAuthToken(serialNumber)
    console.log(`✅ Added webServiceURL to pass:`)
    console.log(`   webServiceURL: ${webServiceUrl}`)
    console.log(`   Authentication token generated for serial: ${serialNumber}`)
    console.log(`   Token preview: ${passPayload.authenticationToken.substring(0, 10)}...`)
  } else {
    console.warn(`⚠️ webServiceUrl is null/undefined - Apple Wallet push notifications will NOT work!`)
    console.warn(`   Serial number: ${serialNumber}`)
  }

  try {
    // Always create pass programmatically (without template file)
    // This works better on Vercel/serverless environments
    
    console.log(`📝 Creating PKPass programmatically (no template)`)
    
    console.log('   Pass payload type before PKPass:', typeof passPayload)
    
    // Verify webServiceURL is in passPayload before creating buffer
    if (passPayload.webServiceURL) {
      console.log(`✅ VERIFIED: webServiceURL is in passPayload: ${passPayload.webServiceURL}`)
    } else {
      console.error(`❌ ERROR: webServiceURL is MISSING from passPayload!`)
      console.error(`   This pass will NOT register with Apple Wallet!`)
    }
    
    const passJsonBuffer = Buffer.from(JSON.stringify(passPayload, null, 2))
    const passJsonString = passJsonBuffer.toString('utf-8')
    
    // Verify webServiceURL is in the actual JSON string
    if (passJsonString.includes('webServiceURL')) {
      const webServiceUrlMatch = passJsonString.match(/"webServiceURL"\s*:\s*"([^"]+)"/)
      if (webServiceUrlMatch) {
        console.log(`✅ VERIFIED: webServiceURL found in pass.json: ${webServiceUrlMatch[1]}`)
      } else {
        console.error(`❌ ERROR: webServiceURL key exists but value is missing!`)
      }
    } else {
      console.error(`❌ CRITICAL ERROR: webServiceURL NOT found in pass.json buffer!`)
      console.error(`   Pass will NOT register with Apple Wallet!`)
    }
    
    console.log(`   pass.json buffer size: ${passJsonBuffer.length} bytes`)
    const passTemplateFiles = {
      'pass.json': passJsonBuffer
    }
    
    // Use PEM format if available, otherwise fall back to .p12
    let pass
    if (certPemPath && keyPemPath) {
      console.log(`   Using PEM certificates from files (Buffer mode)`)
      console.log(`   WWDR: ${wwdrPath}`)
      console.log(`   Cert: ${certPemPath}`)
      console.log(`   Key: ${keyPemPath}`)
      
      // Read files as Buffer for consistency
      const wwdrBuffer = fs.readFileSync(wwdrPath)
      const certBuffer = fs.readFileSync(certPemPath)
      const keyBuffer = fs.readFileSync(keyPemPath)
      
      console.log(`   WWDR Buffer: ${wwdrBuffer.length} bytes`)
      console.log(`   Cert Buffer: ${certBuffer.length} bytes`)
      console.log(`   Key Buffer: ${keyBuffer.length} bytes`)
      
      // Verify PEM format in buffers via string preview
      const wwdrText = wwdrBuffer.toString('utf-8')
      const certText = certBuffer.toString('utf-8')
      const keyText = keyBuffer.toString('utf-8')
      
      if (!wwdrText.includes('-----BEGIN CERTIFICATE-----')) {
        throw new Error('WWDR certificate is not in valid PEM format')
      }
      if (!certText.includes('-----BEGIN CERTIFICATE-----')) {
        throw new Error('Signer certificate is not in valid PEM format')
      }
      if (!keyText.includes('-----BEGIN') || !keyText.includes('PRIVATE KEY')) {
        throw new Error('Private key is not in valid PEM format')
      }
      
      const certificatesConfig = {
        wwdr: wwdrBuffer,
        signerCert: certBuffer,
        signerKey: keyBuffer,
        signerKeyPassphrase: CERT_PASSWORD || undefined
      }
      
      pass = new PKPass(passTemplateFiles, certificatesConfig)
      console.log('   ✅ PKPass created successfully with PEM certificates (Buffer input)')
    } else {
      // Legacy .p12 format
      if (!fs.existsSync(certPath)) {
        throw new Error(`Certificate file not found at: ${certPath}`)
      }
      
      console.log(`   Cert (.p12): ${certPath} (${fs.statSync(certPath).size} bytes)`)
      
      pass = new PKPass(
        passTemplateFiles,
        {
          wwdr: wwdrPath,
          signerCert: certPath,
          signerKey: certPath,
          signerKeyPassphrase: CERT_PASSWORD
        }
      )
    }
    
    console.log('✅ Created pass programmatically')

    // CRITICAL: Explicitly set webServiceURL and authenticationToken on PKPass instance
    // PKPass might not preserve these from pass.json, so set them explicitly
    if (webServiceUrl) {
      // Some PKPass versions need webServiceURL set after instantiation
      if (typeof pass.setWebServiceURL === 'function') {
        pass.setWebServiceURL(webServiceUrl)
        console.log(`✅ Set webServiceURL via PKPass.setWebServiceURL(): ${webServiceUrl}`)
      } else {
        console.log(`ℹ️ PKPass.setWebServiceURL() not available, relying on pass.json`)
      }
      
      // Set authenticationToken explicitly if method exists
      if (typeof pass.setAuthenticationToken === 'function') {
        const authToken = generateAuthToken(serialNumber)
        pass.setAuthenticationToken(authToken)
        console.log(`✅ Set authenticationToken via PKPass.setAuthenticationToken()`)
      } else {
        console.log(`ℹ️ PKPass.setAuthenticationToken() not available, relying on pass.json`)
      }
      
      // Verify it's still in the pass object after PKPass instantiation
      try {
        const passJsonAfterCreation = JSON.parse(JSON.stringify(pass))
        if (passJsonAfterCreation.webServiceURL) {
          console.log(`✅ VERIFIED: webServiceURL still present after PKPass creation: ${passJsonAfterCreation.webServiceURL}`)
        } else {
          console.error(`❌ WARNING: webServiceURL missing from pass after PKPass creation!`)
        }
      } catch (e) {
        console.warn(`⚠️ Could not verify pass contents after PKPass creation: ${e.message}`)
      }
    }

    // Ensure barcode array is set using the validated object (no array wrapper)
    if (barcodePayload) {
      pass.setBarcodes(barcodePayload)
    }

    // Embed required Apple Wallet assets
    const requiredIconFiles = ['icon.png', 'icon@2x.png']
    requiredIconFiles.forEach((fileName) => {
      attachAssetToPass(pass, fileName, { required: true })
    })
    attachAssetToPass(pass, 'logo.png')
    attachAssetToPass(pass, 'logo@2x.png')

    // Generate pass
    const buffer = pass.getAsBuffer()
    
    // Final verification: Check if webServiceURL is in the generated buffer
    // (This is approximate since we can't easily parse .pkpass without unzipping)
    console.log(`✅ Generated .pkpass file (${buffer.length} bytes)`)
    
    return buffer
  } catch (error) {
    console.error('Error generating Apple Wallet pass:', error)
    throw new Error(`Failed to generate pass: ${error.message}`)
  }
}

/**
 * Generate authentication token for pass updates
 */
function generateAuthToken(serialNumber) {
  const crypto = require('crypto')
  const secret = process.env.APPLE_PASS_AUTH_SECRET || process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || 'default-secret'
  return crypto
    .createHmac('sha256', secret)
    .update(serialNumber)
    .digest('hex')
}

function findAssetBuffer(fileName) {
  for (const dir of APPLE_WALLET_ASSET_DIRS) {
    const assetPath = path.join(dir, fileName)
    if (fs.existsSync(assetPath)) {
      return {
        buffer: fs.readFileSync(assetPath),
        path: assetPath
      }
    }
  }
  return null
}

function attachAssetToPass(pass, fileName, options = {}) {
  const { required = false } = options
  const asset = findAssetBuffer(fileName)
  if (!asset) {
    const message = `Asset ${fileName} was not found in: ${APPLE_WALLET_ASSET_DIRS.join(', ')}`
    if (required) {
      throw new Error(message)
    }
    console.warn(`   ⚠️ ${message}`)
    return false
  }

  pass.addBuffer(fileName, asset.buffer)
  console.log(`   ✅ Added ${fileName} from ${asset.path} (${asset.buffer.length} bytes)`)
  return true
}

module.exports = {
  generateGiftCardPass,
  generateAuthToken
}

