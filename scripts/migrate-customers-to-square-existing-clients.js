/**
 * Migration script: Convert customer UUID references to square_customer_id
 * 
 * This script migrates data from customers table (UUID-based) to square_existing_clients
 * by converting all UUID references to square_customer_id strings.
 * 
 * Run this BEFORE updating the Prisma schema.
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function migrateCustomerReferences() {
  try {
    console.log('🔄 Migrating customer references from UUIDs to square_customer_ids')
    console.log('='.repeat(60))
    console.log('')

    // Step 1: Migrate ref_links
    console.log('📋 Step 1: Migrating ref_links...')
    const refLinksToMigrate = await prisma.$queryRaw`
      SELECT 
        rl.id,
        rl.customer_id as current_customer_id,
        c.square_customer_id
      FROM ref_links rl
      INNER JOIN customers c ON c.id = rl.customer_id::uuid
      WHERE c.square_customer_id IS NOT NULL
    `
    
    console.log(`   Found ${refLinksToMigrate.length} ref_links to migrate`)
    let refLinksUpdated = 0
    
    for (const link of refLinksToMigrate) {
      try {
        await prisma.$executeRaw`
          UPDATE ref_links
          SET customer_id = ${link.square_customer_id}
          WHERE id = ${link.id}
        `
        refLinksUpdated++
        if (refLinksUpdated <= 5) {
          console.log(`   ✅ Updated ref_link ${link.id}: ${link.current_customer_id} → ${link.square_customer_id}`)
        }
      } catch (error) {
        console.error(`   ❌ Error updating ref_link ${link.id}: ${error.message}`)
      }
    }
    console.log(`   ✅ Migrated ${refLinksUpdated}/${refLinksToMigrate.length} ref_links`)
    console.log('')

    // Step 2: Migrate ref_matches
    console.log('📋 Step 2: Migrating ref_matches...')
    const refMatchesToMigrate = await prisma.$queryRaw`
      SELECT 
        rm.id,
        rm.customer_id as current_customer_id,
        c.square_customer_id
      FROM ref_matches rm
      INNER JOIN customers c ON c.id = rm.customer_id::uuid
      WHERE c.square_customer_id IS NOT NULL
    `
    
    console.log(`   Found ${refMatchesToMigrate.length} ref_matches to migrate`)
    let refMatchesUpdated = 0
    
    for (const match of refMatchesToMigrate) {
      try {
        await prisma.$executeRaw`
          UPDATE ref_matches
          SET customer_id = ${match.square_customer_id}
          WHERE id = ${match.id}
        `
        refMatchesUpdated++
        if (refMatchesUpdated <= 5) {
          console.log(`   ✅ Updated ref_match ${match.id}: ${match.current_customer_id} → ${match.square_customer_id}`)
        }
      } catch (error) {
        console.error(`   ❌ Error updating ref_match ${match.id}: ${error.message}`)
      }
    }
    console.log(`   ✅ Migrated ${refMatchesUpdated}/${refMatchesToMigrate.length} ref_matches`)
    console.log('')

    // Step 3: Migrate ref_rewards (referrer and friend)
    console.log('📋 Step 3: Migrating ref_rewards...')
    
    // Migrate referrer_customer_id
    const referrerRewardsToMigrate = await prisma.$queryRaw`
      SELECT 
        rr.id,
        rr.referrer_customer_id as current_customer_id,
        c.square_customer_id
      FROM ref_rewards rr
      INNER JOIN customers c ON c.id = rr.referrer_customer_id::uuid
      WHERE rr.referrer_customer_id IS NOT NULL
        AND c.square_customer_id IS NOT NULL
    `
    
    console.log(`   Found ${referrerRewardsToMigrate.length} referrer rewards to migrate`)
    let referrerRewardsUpdated = 0
    
    for (const reward of referrerRewardsToMigrate) {
      try {
        await prisma.$executeRaw`
          UPDATE ref_rewards
          SET referrer_customer_id = ${reward.square_customer_id}
          WHERE id = ${reward.id}
        `
        referrerRewardsUpdated++
        if (referrerRewardsUpdated <= 5) {
          console.log(`   ✅ Updated referrer in ref_reward ${reward.id}: ${reward.current_customer_id} → ${reward.square_customer_id}`)
        }
      } catch (error) {
        console.error(`   ❌ Error updating referrer in ref_reward ${reward.id}: ${error.message}`)
      }
    }
    console.log(`   ✅ Migrated ${referrerRewardsUpdated}/${referrerRewardsToMigrate.length} referrer rewards`)
    
    // Migrate friend_customer_id
    const friendRewardsToMigrate = await prisma.$queryRaw`
      SELECT 
        rr.id,
        rr.friend_customer_id as current_customer_id,
        c.square_customer_id
      FROM ref_rewards rr
      INNER JOIN customers c ON c.id = rr.friend_customer_id::uuid
      WHERE rr.friend_customer_id IS NOT NULL
        AND c.square_customer_id IS NOT NULL
    `
    
    console.log(`   Found ${friendRewardsToMigrate.length} friend rewards to migrate`)
    let friendRewardsUpdated = 0
    
    for (const reward of friendRewardsToMigrate) {
      try {
        await prisma.$executeRaw`
          UPDATE ref_rewards
          SET friend_customer_id = ${reward.square_customer_id}
          WHERE id = ${reward.id}
        `
        friendRewardsUpdated++
        if (friendRewardsUpdated <= 5) {
          console.log(`   ✅ Updated friend in ref_reward ${reward.id}: ${reward.current_customer_id} → ${reward.square_customer_id}`)
        }
      } catch (error) {
        console.error(`   ❌ Error updating friend in ref_reward ${reward.id}: ${error.message}`)
      }
    }
    console.log(`   ✅ Migrated ${friendRewardsUpdated}/${friendRewardsToMigrate.length} friend rewards`)
    console.log('')

    // Step 4: Migrate ref_clicks
    console.log('📋 Step 4: Migrating ref_clicks...')
    const refClicksToMigrate = await prisma.$queryRaw`
      SELECT 
        rc.id,
        rc.customer_id as current_customer_id,
        c.square_customer_id
      FROM ref_clicks rc
      INNER JOIN customers c ON c.id = rc.customer_id::uuid
      WHERE rc.customer_id IS NOT NULL
        AND c.square_customer_id IS NOT NULL
    `
    
    console.log(`   Found ${refClicksToMigrate.length} ref_clicks to migrate`)
    let refClicksUpdated = 0
    
    for (const click of refClicksToMigrate) {
      try {
        await prisma.$executeRaw`
          UPDATE ref_clicks
          SET customer_id = ${click.square_customer_id}
          WHERE id = ${click.id}
        `
        refClicksUpdated++
        if (refClicksUpdated <= 5) {
          console.log(`   ✅ Updated ref_click ${click.id}: ${click.current_customer_id} → ${click.square_customer_id}`)
        }
      } catch (error) {
        console.error(`   ❌ Error updating ref_click ${click.id}: ${error.message}`)
      }
    }
    console.log(`   ✅ Migrated ${refClicksUpdated}/${refClicksToMigrate.length} ref_clicks`)
    console.log('')

    // Summary
    console.log('='.repeat(60))
    console.log('✅ Migration Summary:')
    console.log(`   - ref_links: ${refLinksUpdated}/${refLinksToMigrate.length}`)
    console.log(`   - ref_matches: ${refMatchesUpdated}/${refMatchesToMigrate.length}`)
    console.log(`   - ref_rewards (referrer): ${referrerRewardsUpdated}/${referrerRewardsToMigrate.length}`)
    console.log(`   - ref_rewards (friend): ${friendRewardsUpdated}/${friendRewardsToMigrate.length}`)
    console.log(`   - ref_clicks: ${refClicksUpdated}/${refClicksToMigrate.length}`)
    console.log('')
    console.log('✅ Data migration completed!')
    console.log('   Next step: Update Prisma schema to use square_existing_clients')
    
  } catch (error) {
    console.error('❌ Migration failed:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run migration
migrateCustomerReferences()
  .then(() => {
    console.log('')
    console.log('✅ Migration script completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Migration script failed:', error)
    process.exit(1)
  })




