#!/usr/bin/env node
// Script to encode Apple Wallet certificates for Vercel environment variables
// Usage: node scripts/encode-certificates-for-vercel.js

const fs = require('fs')
const path = require('path')

const certPath = path.join(process.cwd(), 'certs', 'Certificates.p12')
const wwdrPath = path.join(process.cwd(), 'certs', 'wwdr.pem')

console.log('🔐 Encoding Apple Wallet Certificates for Vercel')
console.log('='.repeat(60))
console.log('')

// Check if files exist
if (!fs.existsSync(certPath)) {
  console.error(`❌ Certificate not found: ${certPath}`)
  console.error('   Please ensure Certificates.p12 is in the certs/ folder')
  process.exit(1)
}

if (!fs.existsSync(wwdrPath)) {
  console.error(`❌ WWDR certificate not found: ${wwdrPath}`)
  console.error('   Please ensure wwdr.pem is in the certs/ folder')
  process.exit(1)
}

// Read and encode certificates
console.log('📄 Reading certificates...')
const certBuffer = fs.readFileSync(certPath)
const wwdrBuffer = fs.readFileSync(wwdrPath)

const certBase64 = certBuffer.toString('base64')
const wwdrBase64 = wwdrBuffer.toString('base64')

console.log('✅ Certificates encoded successfully!')
console.log('')
console.log('📋 Add these to Vercel Environment Variables:')
console.log('')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('Variable Name: APPLE_PASS_CERTIFICATE_BASE64')
console.log('Value:')
console.log(certBase64)
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('Variable Name: APPLE_WWDR_CERTIFICATE_BASE64')
console.log('Value:')
console.log(wwdrBase64)
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('')
console.log('📝 Instructions:')
console.log('   1. Copy each value above')
console.log('   2. Go to Vercel Dashboard → Your Project → Settings → Environment Variables')
console.log('   3. Add each variable with the corresponding value')
console.log('   4. Redeploy your application')
console.log('')
console.log('⚠️  Note: These are sensitive credentials. Keep them secure!')
console.log('')

