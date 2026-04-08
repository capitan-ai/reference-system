require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function setupSystemMembersAndFixIds() {
  console.log('🔧 Setting up system members and fixing administrator/technician IDs\n')
  console.log('='.repeat(80))

  try {
    // 1. Setup System Members for each organization
    console.log('\n🏢 Setting up system members...')
    const organizations = await prisma.organization.findMany({
      select: { id: true, name: true }
    })

    for (const org of organizations) {
      const systemMember = await prisma.teamMember.findFirst({
        where: {
          organization_id: org.id,
          is_system: true
        }
      })

      if (!systemMember) {
        const newSystemMember = await prisma.teamMember.create({
          data: {
            organization_id: org.id,
            given_name: 'Online',
            family_name: 'Booking',
            is_system: true,
            role: 'UNKNOWN',
            status: 'ACTIVE',
            square_team_member_id: `SYSTEM_UNATTRIBUTED_${org.id.substring(0, 8)}`
          }
        })
        console.log(`   ✅ Created system member for ${org.name || org.id}: ${newSystemMember.id}`)
      } else {
        console.log(`   ℹ️ System member already exists for ${org.name || org.id}: ${systemMember.id}`)
      }
    }

    // 2. Fix administrator_id and technician_id in bookings and payments
    console.log('\n🔄 Normalizing administrator_id and technician_id...')

    // Helper for normalization
    const normalizeField = async (table, column) => {
      console.log(`   Processing ${table}.${column}...`)
      
      // Diagnostics
      const diagnostics = await prisma.$queryRawUnsafe(`
        SELECT 
          COUNT(*) FILTER (WHERE ${column} IS NOT NULL) AS total_with_value,
          COUNT(*) FILTER (
            WHERE ${column} IS NOT NULL 
            AND ${column}::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          ) AS square_ids
        FROM ${table}
      `)
      
      console.log(`      Total with ${column}: ${diagnostics[0].total_with_value}`)
      console.log(`      Square raw IDs (need fixing): ${diagnostics[0].square_ids}`)

      if (Number(diagnostics[0].square_ids) > 0) {
        const updateResult = await prisma.$executeRawUnsafe(`
          UPDATE ${table} t
          SET 
            ${column} = tm.id,
            updated_at = NOW()
          FROM team_members tm
          WHERE tm.square_team_member_id = t.${column}::text
            AND tm.organization_id = t.organization_id
            AND t.${column}::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        `)
        console.log(`      ✅ Updated ${updateResult} records in ${table}.${column}`)

        // Set remaining non-UUID values to NULL (unresolvable)
        const nullResult = await prisma.$executeRawUnsafe(`
          UPDATE ${table}
          SET 
            ${column} = NULL,
            updated_at = NOW()
          WHERE ${column} IS NOT NULL
            AND ${column}::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        `)
        if (Number(nullResult) > 0) {
          console.log(`      ⚠️ Set ${nullResult} unresolvable ${column} values to NULL`)
        }
      } else {
        console.log(`      ℹ️ No Square IDs found in ${table}.${column}`)
      }
    }

    await normalizeField('bookings', 'administrator_id')
    await normalizeField('bookings', 'technician_id')
    await normalizeField('payments', 'administrator_id')

    console.log('\n' + '='.repeat(80))
    console.log('✅ DONE')

  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

setupSystemMembersAndFixIds()
