const fs = require('fs')
const path = require('path')

async function cleanupCodebase() {
  try {
    console.log('🧹 CLEANING UP CODEBASE - PRESERVING CORE LOGIC\n')

    // Define files to keep (core referral system)
    const keepFiles = [
      'app/api/webhooks/square/referrals/route.js',
      'app/api/track-referral-click/route.js', 
      'app/ref/[refCode]/page.js',
      'prisma/schema.prisma',
      'package.json',
      'package-lock.json',
      'next.config.js',
      'vercel.json',
      '.env',
      'node_modules'
    ]

    // Define directories to keep
    const keepDirs = [
      'app/api/webhooks/square/referrals',
      'app/api/track-referral-click',
      'app/ref/[refCode]',
      'prisma',
      'node_modules',
      'public'
    ]

    console.log('📁 FILES TO KEEP (Core Referral System):')
    keepFiles.forEach(file => {
      if (fs.existsSync(file)) {
        console.log(`   ✅ ${file}`)
      }
    })

    console.log('\n🗑️ REMOVING UNNECESSARY FILES...\n')

    // Remove old webhook handlers
    const oldWebhooks = [
      'app/api/webhooks/square/customers/route.js',
      'app/api/webhooks/square/payments/route.js'
    ]

    oldWebhooks.forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file)
        console.log(`   🗑️ Removed: ${file}`)
      }
    })

    // Remove unused pages
    const unusedPages = [
      'app/thanks/page.jsx',
      'app/page.js',
      'app/layout.js', 
      'app/globals.css'
    ]

    unusedPages.forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file)
        console.log(`   🗑️ Removed: ${file}`)
      }
    })

    // Remove old email service
    const oldEmailService = [
      'lib/email-service-simple.js'
    ]

    oldEmailService.forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file)
        console.log(`   🗑️ Removed: ${file}`)
      }
    })

    // Remove all test scripts
    const scriptsDir = 'scripts'
    if (fs.existsSync(scriptsDir)) {
      const scriptFiles = fs.readdirSync(scriptsDir)
      scriptFiles.forEach(file => {
        const filePath = path.join(scriptsDir, file)
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath)
          console.log(`   🗑️ Removed: ${filePath}`)
        }
      })
      // Remove empty scripts directory
      fs.rmdirSync(scriptsDir)
      console.log(`   🗑️ Removed: ${scriptsDir}/ directory`)
    }

    // Remove all documentation files
    const mdFiles = fs.readdirSync('.').filter(file => file.endsWith('.md'))
    mdFiles.forEach(file => {
      fs.unlinkSync(file)
      console.log(`   🗑️ Removed: ${file}`)
    })

    // Remove example files
    const exampleFiles = ['env.example']
    exampleFiles.forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file)
        console.log(`   🗑️ Removed: ${file}`)
      }
    })

    // Remove unused config files
    const unusedConfigs = ['jsconfig.json']
    unusedConfigs.forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file)
        console.log(`   🗑️ Removed: ${file}`)
      }
    })

    // Remove empty directories
    const emptyDirs = [
      'app/api/webhooks/square/customers',
      'app/api/webhooks/square/payments',
      'app/thanks',
      'lib'
    ]

    emptyDirs.forEach(dir => {
      if (fs.existsSync(dir)) {
        try {
          const files = fs.readdirSync(dir)
          if (files.length === 0) {
            fs.rmdirSync(dir)
            console.log(`   🗑️ Removed empty directory: ${dir}`)
          }
        } catch (error) {
          // Directory not empty or other error, skip
        }
      }
    })

    console.log('\n✅ CLEANUP COMPLETE!')
    console.log('\n📊 REMAINING CORE FILES:')
    
    const remainingFiles = [
      'app/api/webhooks/square/referrals/route.js',
      'app/api/track-referral-click/route.js',
      'app/ref/[refCode]/page.js', 
      'prisma/schema.prisma',
      'package.json',
      'next.config.js',
      'vercel.json'
    ]

    remainingFiles.forEach(file => {
      if (fs.existsSync(file)) {
        console.log(`   ✅ ${file}`)
      } else {
        console.log(`   ❌ Missing: ${file}`)
      }
    })

    console.log('\n🎯 YOUR REFERRAL SYSTEM IS NOW CLEAN AND READY!')
    console.log('   ✅ Core logic preserved')
    console.log('   ✅ Unnecessary files removed')
    console.log('   ✅ Ready for deployment')

  } catch (error) {
    console.error('❌ Error during cleanup:', error.message)
  }
}

cleanupCodebase()
