/**
 * Check locations table for organization_id issues
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function checkLocations() {
  console.log('🔍 Checking Locations Table for Organization ID Issues\n')
  console.log('='.repeat(60))

  try {
    // 1. Check if any locations have NULL organization_id
    console.log('\n1. Locations with NULL organization_id:')
    const nullOrgLocations = await prisma.$queryRaw`
      SELECT square_location_id, organization_id, name 
      FROM locations 
      WHERE organization_id IS NULL
    `
    if (nullOrgLocations.length > 0) {
      console.log(`   ❌ Found ${nullOrgLocations.length} locations with NULL organization_id:`)
      nullOrgLocations.forEach(loc => {
        console.log(`   - ${loc.square_location_id} (${loc.name || 'unnamed'})`)
      })
    } else {
      console.log('   ✅ No locations with NULL organization_id')
    }

    // 2. Check for duplicate square_location_ids with different organization_ids
    console.log('\n2. Duplicate square_location_ids with different organization_ids:')
    const duplicates = await prisma.$queryRaw`
      SELECT square_location_id, COUNT(DISTINCT organization_id) as org_count
      FROM locations
      GROUP BY square_location_id
      HAVING COUNT(DISTINCT organization_id) > 1
    `
    if (duplicates.length > 0) {
      console.log(`   ⚠️ Found ${duplicates.length} square_location_ids with multiple organization_ids:`)
      for (const dup of duplicates) {
        const details = await prisma.$queryRaw`
          SELECT square_location_id, organization_id, name 
          FROM locations
          WHERE square_location_id = ${dup.square_location_id}
        `
        console.log(`   - ${dup.square_location_id} (${dup.org_count} different orgs):`)
        details.forEach(d => {
          console.log(`     * org_id: ${d.organization_id?.substring(0, 8)}..., name: ${d.name || 'unnamed'}`)
        })
      }
    } else {
      console.log('   ✅ No duplicate square_location_ids found')
    }

    // 3. Check all locations
    console.log('\n3. All locations in database:')
    const allLocations = await prisma.$queryRaw`
      SELECT square_location_id, organization_id, name 
      FROM locations
      ORDER BY square_location_id
    `
    console.log(`   Total locations: ${allLocations.length}`)
    if (allLocations.length > 0) {
      console.log('   Locations:')
      allLocations.forEach(loc => {
        const orgId = loc.organization_id ? `${loc.organization_id.substring(0, 8)}...` : 'NULL'
        console.log(`   - ${loc.square_location_id} → org: ${orgId}, name: ${loc.name || 'unnamed'}`)
      })
    }

    // 4. Check if organization_ids in locations point to valid organizations
    console.log('\n4. Locations with invalid organization_id (pointing to non-existent org):')
    const invalidOrgs = await prisma.$queryRaw`
      SELECT l.square_location_id, l.organization_id, l.name
      FROM locations l
      LEFT JOIN organizations o ON l.organization_id = o.id
      WHERE l.organization_id IS NOT NULL
        AND o.id IS NULL
    `
    if (invalidOrgs.length > 0) {
      console.log(`   ❌ Found ${invalidOrgs.length} locations with invalid organization_id:`)
      invalidOrgs.forEach(loc => {
        console.log(`   - ${loc.square_location_id} (org_id: ${loc.organization_id?.substring(0, 8)}..., name: ${loc.name || 'unnamed'})`)
      })
    } else {
      console.log('   ✅ All locations have valid organization_id references')
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n✅ Check complete\n')

  } catch (error) {
    console.error('❌ Error checking locations:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

checkLocations()
  .then(() => {
    console.log('Script completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Script failed:', error)
    process.exit(1)
  })



