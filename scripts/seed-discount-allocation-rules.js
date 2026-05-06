const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

/**
 * Seeds DiscountAllocationRule for all known discount types.
 *
 * master_share_percent = how much of the discount the master pays
 * salon_share_percent  = how much of the discount the salon/owner pays
 *
 * Usage: node scripts/seed-discount-allocation-rules.js [orgId]
 */
async function seedDiscountAllocationRules(organizationId) {
  const rules = [
    // Points / Loyalty — owner pays 100%
    { discount_name: 'points', master_share_percent: 0, salon_share_percent: 100 },
    { discount_name: 'loyalty', master_share_percent: 0, salon_share_percent: 100 },
    { discount_name: 'loyalty discount', master_share_percent: 0, salon_share_percent: 100 },

    // Blogger / Influencer — owner pays 100% (marketing expense)
    { discount_name: 'blogger', master_share_percent: 0, salon_share_percent: 100 },
    { discount_name: 'blogger discount', master_share_percent: 0, salon_share_percent: 100 },

    // Package — owner pays 100% (master already gets commission from snapshot price)
    { discount_name: 'package', master_share_percent: 0, salon_share_percent: 100 },

    // Overcharge / Correction — owner pays 100% (billing error)
    { discount_name: 'overcharge', master_share_percent: 0, salon_share_percent: 100 },
    { discount_name: 'correction', master_share_percent: 0, salon_share_percent: 100 },

    // Complaint — master at fault pays 100%
    // Note: fault attribution (which master) is handled by admin API MasterAdjustment
    { discount_name: 'complaint', master_share_percent: 100, salon_share_percent: 0 },

    // Master delay / waiting — late master pays 100%
    { discount_name: 'delay', master_share_percent: 100, salon_share_percent: 0 },
    { discount_name: 'late', master_share_percent: 100, salon_share_percent: 0 },
    { discount_name: 'waiting', master_share_percent: 100, salon_share_percent: 0 },

    // Gift card — owner pays 100%
    { discount_name: 'gift card', master_share_percent: 0, salon_share_percent: 100 },
    { discount_name: 'gift_card', master_share_percent: 0, salon_share_percent: 100 },

    // Referral — owner pays 100%
    { discount_name: 'referral', master_share_percent: 0, salon_share_percent: 100 },
    { discount_name: 'referral discount', master_share_percent: 0, salon_share_percent: 100 },
  ]

  console.log(`[SEED] Seeding ${rules.length} discount allocation rules for org: ${organizationId}`)

  let created = 0
  let updated = 0

  for (const rule of rules) {
    const result = await prisma.discountAllocationRule.upsert({
      where: {
        organization_id_discount_name: {
          organization_id: organizationId,
          discount_name: rule.discount_name
        }
      },
      update: {
        master_share_percent: rule.master_share_percent,
        salon_share_percent: rule.salon_share_percent,
        is_active: true
      },
      create: {
        organization_id: organizationId,
        discount_name: rule.discount_name,
        master_share_percent: rule.master_share_percent,
        salon_share_percent: rule.salon_share_percent,
        is_active: true
      }
    })

    // Check if it was created or updated by looking at created_at
    const isNew = (new Date() - result.created_at) < 5000
    if (isNew) created++
    else updated++

    console.log(`  ${isNew ? '✅ Created' : '🔄 Updated'}: "${rule.discount_name}" → master: ${rule.master_share_percent}%, salon: ${rule.salon_share_percent}%`)
  }

  console.log(`\n[SEED] Done. Created: ${created}, Updated: ${updated}`)
}

if (require.main === module) {
  const orgId = process.argv[2] || 'd0e24178-2f94-4033-bc91-41f22df58278'
  seedDiscountAllocationRules(orgId)
    .catch(console.error)
    .finally(() => prisma.$disconnect())
}

module.exports = { seedDiscountAllocationRules }
