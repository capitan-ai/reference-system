#!/usr/bin/env node
// Verify Apple Wallet certificates from Vercel environment variables
// This helps diagnose certificate formatting issues

require('dotenv').config()

console.log('🔍 Verifying Apple Wallet Certificates')
console.log('='.repeat(60))
console.log('')

// Check if variables are set
const hasCertPem = !!process.env.APPLE_PASS_CERTIFICATE_PEM_BASE64
const hasKeyPem = !!process.env.APPLE_PASS_KEY_PEM_BASE64
const hasWwdr = !!process.env.APPLE_WWDR_CERTIFICATE_BASE64
const hasLegacyCert = !!process.env.APPLE_PASS_CERTIFICATE_BASE64

console.log('📋 Environment Variables:')
console.log(`   APPLE_PASS_CERTIFICATE_PEM_BASE64: ${hasCertPem ? '✅ Set' : '❌ Not set'}`)
console.log(`   APPLE_PASS_KEY_PEM_BASE64: ${hasKeyPem ? '✅ Set' : '❌ Not set'}`)
console.log(`   APPLE_WWDR_CERTIFICATE_BASE64: ${hasWwdr ? '✅ Set' : '❌ Not set'}`)
console.log(`   APPLE_PASS_CERTIFICATE_BASE64 (legacy): ${hasLegacyCert ? '✅ Set' : '❌ Not set'}`)
console.log('')

if (!hasCertPem || !hasKeyPem || !hasWwdr) {
  console.error('❌ Missing required certificate variables!')
  console.error('   You need all three:')
  console.error('   - APPLE_PASS_CERTIFICATE_PEM_BASE64')
  console.error('   - APPLE_PASS_KEY_PEM_BASE64')
  console.error('   - APPLE_WWDR_CERTIFICATE_BASE64')
  process.exit(1)
}

// Verify certificate (PEM)
console.log('🔐 Verifying Certificate (PEM)...')
try {
  const cleanCertBase64 = process.env.APPLE_PASS_CERTIFICATE_PEM_BASE64.replace(/\s/g, '')
  const certBuffer = Buffer.from(cleanCertBase64, 'base64')
  const certPem = certBuffer.toString('utf8')
  
  console.log(`   Base64 length: ${process.env.APPLE_PASS_CERTIFICATE_PEM_BASE64.length} chars`)
  console.log(`   Decoded length: ${certPem.length} chars`)
  
  if (!certPem.includes('-----BEGIN CERTIFICATE-----')) {
    console.error('   ❌ Invalid: Missing BEGIN CERTIFICATE marker')
    process.exit(1)
  }
  if (!certPem.includes('-----END CERTIFICATE-----')) {
    console.error('   ❌ Invalid: Missing END CERTIFICATE marker')
    process.exit(1)
  }
  
  const lines = certPem.split('\n').filter(l => l.trim())
  console.log(`   ✅ Valid PEM format (${lines.length} lines)`)
  console.log(`   First line: ${lines[0]}`)
  console.log(`   Last line: ${lines[lines.length - 1]}`)
} catch (error) {
  console.error(`   ❌ Error: ${error.message}`)
  process.exit(1)
}

// Verify private key (PEM)
console.log('')
console.log('🔑 Verifying Private Key (PEM)...')
try {
  const cleanKeyBase64 = process.env.APPLE_PASS_KEY_PEM_BASE64.replace(/\s/g, '')
  const keyBuffer = Buffer.from(cleanKeyBase64, 'base64')
  const keyPem = keyBuffer.toString('utf8')
  
  console.log(`   Base64 length: ${process.env.APPLE_PASS_KEY_PEM_BASE64.length} chars`)
  console.log(`   Decoded length: ${keyPem.length} chars`)
  
  if (!keyPem.includes('-----BEGIN') || !keyPem.includes('PRIVATE KEY')) {
    console.error('   ❌ Invalid: Missing BEGIN PRIVATE KEY marker')
    process.exit(1)
  }
  if (!keyPem.includes('-----END') || !keyPem.includes('PRIVATE KEY')) {
    console.error('   ❌ Invalid: Missing END PRIVATE KEY marker')
    process.exit(1)
  }
  
  const lines = keyPem.split('\n').filter(l => l.trim())
  console.log(`   ✅ Valid PEM format (${lines.length} lines)`)
  console.log(`   First line: ${lines[0]}`)
  console.log(`   Last line: ${lines[lines.length - 1]}`)
} catch (error) {
  console.error(`   ❌ Error: ${error.message}`)
  process.exit(1)
}

// Verify WWDR certificate
console.log('')
console.log('🌐 Verifying WWDR Certificate...')
try {
  const cleanWwdrBase64 = process.env.APPLE_WWDR_CERTIFICATE_BASE64.replace(/\s/g, '')
  const wwdrBuffer = Buffer.from(cleanWwdrBase64, 'base64')
  const wwdrPem = wwdrBuffer.toString('utf8')
  
  console.log(`   Base64 length: ${process.env.APPLE_WWDR_CERTIFICATE_BASE64.length} chars`)
  console.log(`   Decoded length: ${wwdrPem.length} chars`)
  
  if (!wwdrPem.includes('-----BEGIN CERTIFICATE-----')) {
    console.error('   ❌ Invalid: Missing BEGIN CERTIFICATE marker')
    process.exit(1)
  }
  if (!wwdrPem.includes('-----END CERTIFICATE-----')) {
    console.error('   ❌ Invalid: Missing END CERTIFICATE marker')
    process.exit(1)
  }
  
  const lines = wwdrPem.split('\n').filter(l => l.trim())
  console.log(`   ✅ Valid PEM format (${lines.length} lines)`)
  console.log(`   First line: ${lines[0]}`)
  console.log(`   Last line: ${lines[lines.length - 1]}`)
} catch (error) {
  console.error(`   ❌ Error: ${error.message}`)
  process.exit(1)
}

// Check for common issues
console.log('')
console.log('🔍 Checking for common issues...')
const issues = []

// Check for extra whitespace/newlines in base64
if (process.env.APPLE_PASS_CERTIFICATE_PEM_BASE64.includes('\n')) {
  issues.push('⚠️  Certificate base64 contains newlines (will be cleaned automatically)')
}
if (process.env.APPLE_PASS_KEY_PEM_BASE64.includes('\n')) {
  issues.push('⚠️  Key base64 contains newlines (will be cleaned automatically)')
}
if (process.env.APPLE_WWDR_CERTIFICATE_BASE64.includes('\n')) {
  issues.push('⚠️  WWDR base64 contains newlines (will be cleaned automatically)')
}

if (issues.length > 0) {
  issues.forEach(issue => console.log(`   ${issue}`))
} else {
  console.log('   ✅ No common issues found')
}

console.log('')
console.log('✅ All certificates are valid!')
console.log('')
console.log('💡 If you still get errors in production:')
console.log('   1. Check Vercel function logs for detailed error messages')
console.log('   2. Verify certificates are set in Production environment (not just Preview)')
console.log('   3. Make sure to redeploy after adding environment variables')
console.log('   4. Check that base64 strings don\'t have extra characters at start/end')

