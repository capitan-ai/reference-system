#!/usr/bin/env node
// Create Apple Wallet pass images from logo
// This script resizes the logo to create icon and logo images for the pass

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const sourceLogo = path.join(__dirname, '../public/logo.png')
const templateDir = path.join(__dirname, '../lib/wallet/pass-template')

console.log('🎨 Creating Apple Wallet Pass Images')
console.log('='.repeat(60))
console.log('')

// Check if source logo exists
if (!fs.existsSync(sourceLogo)) {
  console.error('❌ Source logo not found:', sourceLogo)
  process.exit(1)
}

console.log('✅ Source logo found:', sourceLogo)
console.log('')

// Check if ImageMagick or sips is available
let hasImageMagick = false
let hasSips = false

try {
  execSync('which convert', { stdio: 'ignore' })
  hasImageMagick = true
  console.log('✅ ImageMagick found')
} catch (e) {
  try {
    execSync('which sips', { stdio: 'ignore' })
    hasSips = true
    console.log('✅ sips (macOS) found')
  } catch (e2) {
    console.error('❌ Neither ImageMagick nor sips found')
    console.error('   Please install ImageMagick: brew install imagemagick')
    console.error('   Or use macOS sips (already available)')
    process.exit(1)
  }
}

// Create template directory if it doesn't exist
if (!fs.existsSync(templateDir)) {
  fs.mkdirSync(templateDir, { recursive: true })
}

console.log('')
console.log('📐 Creating images...')

// Create icon.png (29x29)
try {
  if (hasImageMagick) {
    execSync(`convert "${sourceLogo}" -resize 29x29 -background none -gravity center -extent 29x29 "${path.join(templateDir, 'icon.png')}"`)
  } else if (hasSips) {
    execSync(`sips -z 29 29 "${sourceLogo}" --out "${path.join(templateDir, 'icon.png')}"`)
  }
  console.log('   ✅ Created icon.png (29x29)')
} catch (error) {
  console.error('   ❌ Failed to create icon.png:', error.message)
}

// Create icon@2x.png (58x58)
try {
  if (hasImageMagick) {
    execSync(`convert "${sourceLogo}" -resize 58x58 -background none -gravity center -extent 58x58 "${path.join(templateDir, 'icon@2x.png')}"`)
  } else if (hasSips) {
    execSync(`sips -z 58 58 "${sourceLogo}" --out "${path.join(templateDir, 'icon@2x.png')}"`)
  }
  console.log('   ✅ Created icon@2x.png (58x58)')
} catch (error) {
  console.error('   ❌ Failed to create icon@2x.png:', error.message)
}

// Create logo.png (160x50) - maintain aspect ratio, center
try {
  if (hasImageMagick) {
    execSync(`convert "${sourceLogo}" -resize 160x50 -background none -gravity center -extent 160x50 "${path.join(templateDir, 'logo.png')}"`)
  } else if (hasSips) {
    execSync(`sips -z 50 160 "${sourceLogo}" --out "${path.join(templateDir, 'logo.png')}"`)
  }
  console.log('   ✅ Created logo.png (160x50)')
} catch (error) {
  console.error('   ❌ Failed to create logo.png:', error.message)
}

// Create logo@2x.png (320x100)
try {
  if (hasImageMagick) {
    execSync(`convert "${sourceLogo}" -resize 320x100 -background none -gravity center -extent 320x100 "${path.join(templateDir, 'logo@2x.png')}"`)
  } else if (hasSips) {
    execSync(`sips -z 100 320 "${sourceLogo}" --out "${path.join(templateDir, 'logo@2x.png')}"`)
  }
  console.log('   ✅ Created logo@2x.png (320x100)')
} catch (error) {
  console.error('   ❌ Failed to create logo@2x.png:', error.message)
}

console.log('')
console.log('✅ Done! Images created in:', templateDir)
console.log('')
console.log('📋 Next steps:')
console.log('   1. Review the images in lib/wallet/pass-template/')
console.log('   2. Adjust if needed (crop, resize, etc.)')
console.log('   3. Redeploy - passes will now include your logo!')

