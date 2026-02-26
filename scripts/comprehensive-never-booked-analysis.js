require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function analyzeNeverBooked() {
  console.log('--- ANALYZING NEVER_BOOKED CUSTOMERS ---')

  // 1. Get all NEVER_BOOKED customers
  const neverBooked = await prisma.$queryRaw`
    SELECT 
      ca.square_customer_id,
      ca.given_name,
      ca.family_name,
      ca.email_address,
      ca.phone_number,
      ca.total_revenue_cents,
      ca.total_payments,
      ca.total_accepted_bookings,
      sec.raw_json,
      sec.created_at as profile_created_at
    FROM customer_analytics ca
    JOIN square_existing_clients sec ON ca.square_customer_id = sec.square_customer_id AND ca.organization_id = sec.organization_id
    WHERE ca.customer_segment = 'NEVER_BOOKED'
  `

  console.log(`Total NEVER_BOOKED customers: ${neverBooked.length}`)

  // 2. Analyze by categories
  const analysis = {
    with_payments: [],
    with_gift_cards: [],
    with_orders: [],
    with_referrals: [],
    duplicates: [],
    students: [],
    packages: [],
    absolute_zero: []
  }

  // Get all gift cards to check for egifting
  const giftCards = await prisma.giftCard.findMany()
  const giftCardCustomerIds = new Set(giftCards.map(gc => gc.square_customer_id))

  // Get all referral profiles
  const referralProfiles = await prisma.referralProfile.findMany()
  const referralCustomerIds = new Set(referralProfiles.map(rp => rp.square_customer_id))
  const referralMap = new Map(referralProfiles.map(rp => [rp.square_customer_id, rp]))

  for (const customer of neverBooked) {
    let hasActivity = false
    const id = customer.square_customer_id

    // Check payments
    if (Number(customer.total_payments) > 0) {
      analysis.with_payments.push(customer)
      hasActivity = true
    }

    // Check gift cards (egifting)
    if (giftCardCustomerIds.has(id)) {
      analysis.with_gift_cards.push(customer)
      hasActivity = true
    }

    // Check referrals
    if (referralCustomerIds.has(id)) {
      const rp = referralMap.get(id)
      // Only count as "active" referral if they actually referred someone or used a code
      if (Number(rp.total_referrals_count) > 0 || rp.used_referral_code || rp.activated_as_referrer) {
        analysis.with_referrals.push(customer)
        hasActivity = true
      }
    }
    
    // Check for orders (some might have orders but no payments recorded in ca)
    const orders = await prisma.order.findMany({ where: { customer_id: id } })
    if (orders.length > 0) {
      analysis.with_orders.push(customer)
      hasActivity = true
    }

    // Check for "Student" or "Training" in notes or names (common for students)
    const rawJsonStr = JSON.stringify(customer.raw_json || {}).toLowerCase()
    const givenName = (customer.given_name || '').toLowerCase()
    const familyName = (customer.family_name || '').toLowerCase()
    
    if (rawJsonStr.includes('student') || rawJsonStr.includes('training') || rawJsonStr.includes('course') || rawJsonStr.includes('обучение') ||
        givenName.includes('student') || familyName.includes('student') ||
        givenName.includes('обучение') || familyName.includes('обучение')) {
      analysis.students.push(customer)
      hasActivity = true
    }

    // Check for "Package" in raw_json (common for package buyers)
    if (rawJsonStr.includes('package') || rawJsonStr.includes('pass') || rawJsonStr.includes('membership') ||
        rawJsonStr.includes('пакет') || rawJsonStr.includes('абонемент')) {
      analysis.packages.push(customer)
      hasActivity = true
    }

    // Check for duplicates (same email or phone but different ID)
    // This is a bit slow to do in a loop, but for a script it's okay
    if (customer.email_address || customer.phone_number) {
      const dupes = neverBooked.filter(c => 
        c.square_customer_id !== customer.square_customer_id && 
        ((customer.email_address && c.email_address === customer.email_address) || 
         (customer.phone_number && c.phone_number === customer.phone_number))
      )
      if (dupes.length > 0) {
        analysis.duplicates.push({ customer, dupes })
        // We don't mark hasActivity = true here because duplicates might still be "zero activity"
      }
    }

    // Absolute zero: no payments, no gift cards, no referrals, no bookings (already filtered by segment)
    if (!hasActivity) {
      analysis.absolute_zero.push(customer)
    }
  }

  console.log('\n--- RESULTS ---')
  console.log(`With Payments: ${analysis.with_payments.length}`)
  console.log(`With Gift Cards (eGifting): ${analysis.with_gift_cards.length}`)
  console.log(`With Referrals: ${analysis.with_referrals.length}`)
  console.log(`Potential Students: ${analysis.students.length}`)
  console.log(`Potential Package Buyers: ${analysis.packages.length}`)
  console.log(`Potential Duplicates: ${analysis.duplicates.length}`)
  console.log(`Absolute Zero (No activity found): ${analysis.absolute_zero.length}`)

  // Sample of Absolute Zero
  if (analysis.absolute_zero.length > 0) {
    console.log('\n--- SAMPLE ABSOLUTE ZERO (First 5) ---')
    analysis.absolute_zero.slice(0, 5).forEach(c => {
      console.log(`- ${c.given_name} ${c.family_name} (${c.square_customer_id}) | Created: ${c.profile_created_at}`)
      // console.log(`  Raw JSON: ${JSON.stringify(c.raw_json).substring(0, 100)}...`)
    })
  }

  // Sample of Students
  if (analysis.students.length > 0) {
    console.log('\n--- SAMPLE STUDENTS (First 5) ---')
    analysis.students.slice(0, 5).forEach(c => {
      console.log(`- ${c.given_name} ${c.family_name} (${c.square_customer_id}) | Rev: $${(Number(c.total_revenue_cents)/100).toFixed(2)}`)
    })
  }

  await prisma.$disconnect()
}

analyzeNeverBooked().catch(console.error)

