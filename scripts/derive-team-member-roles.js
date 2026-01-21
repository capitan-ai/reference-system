#!/usr/bin/env node
/**
 * Derive team member roles (technician/admin/both) based on usage
 * - Technician: appears on booking_appointment_segments.team_member_id
 * - Cashier/Admin: appears on payments.team_member_id
 * - role is set:
 *     BOTH if both flags true
 *     TECHNICIAN if technician only
 *     ADMIN if cashier only
 *     UNKNOWN otherwise
 *
 * Usage:
 *   node scripts/derive-team-member-roles.js
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  console.log('🔍 Deriving team member roles from bookings and payments')
  console.log('='.repeat(60))

  console.log('No usage flags to derive (is_technician/is_cashier removed).')
  console.log('\n✨ Done.')
}

main()
  .catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

