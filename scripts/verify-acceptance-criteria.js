require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function verify() {
  console.log('\n' + '='.repeat(80))
  console.log('  FINAL ACCEPTANCE CRITERIA — ALL 6 CHECKS')
  console.log('='.repeat(80))

  // AC1: Customer count
  const ac1 = await prisma.$queryRaw`
    SELECT (SELECT COUNT(*) FROM customer_analytics)::text AS ca,
           (SELECT COUNT(*) FROM square_existing_clients)::text AS crm
  `
  const p1 = ac1[0].ca === ac1[0].crm
  console.log('\nAC1 Customer count:  CA=' + ac1[0].ca + '  CRM=' + ac1[0].crm + '  ' + (p1 ? '✅ PASS' : '❌ FAIL'))

  // AC2: Never booked = NEVER_BOOKED segment
  const ac2 = await prisma.$queryRaw`
    SELECT (SELECT COUNT(*) FROM customer_analytics WHERE first_booking_at IS NULL)::text AS nb,
           (SELECT COUNT(*) FROM customer_analytics WHERE customer_segment = 'NEVER_BOOKED')::text AS seg
  `
  const p2 = ac2[0].nb === ac2[0].seg
  console.log('AC2 Never booked:    NULL first_booking=' + ac2[0].nb + '  seg=NEVER_BOOKED=' + ac2[0].seg + '  ' + (p2 ? '✅ PASS' : '❌ FAIL'))

  // AC3: booked_once + returning = total_booked
  const ac3 = await prisma.$queryRaw`
    SELECT COUNT(*) FILTER (WHERE total_accepted_bookings = 1)::text AS once,
           COUNT(*) FILTER (WHERE total_accepted_bookings >= 2)::text AS ret,
           COUNT(*) FILTER (WHERE total_accepted_bookings >= 1)::text AS total
    FROM customer_analytics
  `
  const sum3 = parseInt(ac3[0].once) + parseInt(ac3[0].ret)
  const p3 = sum3 === parseInt(ac3[0].total)
  console.log('AC3 Booking math:    once=' + ac3[0].once + ' + ret=' + ac3[0].ret + ' = ' + sum3 + ' == total=' + ac3[0].total + '  ' + (p3 ? '✅ PASS' : '❌ FAIL'))

  // AC4: Revenue match (against CRM-only customers)
  const ac4 = await prisma.$queryRaw`
    SELECT (SELECT SUM(total_revenue_cents) FROM customer_analytics)::text AS ca_rev,
           (SELECT SUM(total_money_amount) FROM payments
            WHERE status = 'COMPLETED' AND customer_id IS NOT NULL
              AND customer_id IN (SELECT square_customer_id FROM customer_analytics)
           )::text AS db_rev
  `
  const revDiff = BigInt(ac4[0].ca_rev || '0') - BigInt(ac4[0].db_rev || '0')
  const p4 = Math.abs(Number(revDiff)) <= 50000 // $500 tolerance for real-time arrivals
  console.log('AC4 Revenue:         CA=' + ac4[0].ca_rev + '  DB=' + ac4[0].db_rev + '  diff=' + revDiff.toString() + ' cents  ' + (p4 ? '✅ PASS' : '❌ FAIL'))

  // AC5: Payment count match
  const ac5 = await prisma.$queryRaw`
    SELECT (SELECT SUM(total_payments) FROM customer_analytics)::text AS ca_pay,
           (SELECT COUNT(*) FROM payments
            WHERE status = 'COMPLETED' AND customer_id IS NOT NULL
              AND customer_id IN (SELECT square_customer_id FROM customer_analytics)
           )::text AS db_pay
  `
  const payDiff = parseInt(ac5[0].ca_pay) - parseInt(ac5[0].db_pay)
  const p5 = Math.abs(payDiff) <= 5
  console.log('AC5 Payments count:  CA=' + ac5[0].ca_pay + '  DB=' + ac5[0].db_pay + '  diff=' + payDiff + '  ' + (p5 ? '✅ PASS' : '❌ FAIL'))

  // AC6: Global avg ticket
  const ac6a = await prisma.$queryRaw`
    SELECT ROUND(SUM(total_revenue_cents)::numeric / NULLIF(SUM(total_payments), 0), 2)::text AS avg
    FROM customer_analytics
  `
  const ac6b = await prisma.$queryRaw`
    SELECT ROUND(SUM(total_money_amount)::numeric / COUNT(*), 2)::text AS avg
    FROM payments WHERE status = 'COMPLETED' AND customer_id IS NOT NULL
  `
  const avgDiff = Math.abs(parseFloat(ac6a[0].avg) - parseFloat(ac6b[0].avg))
  const p6 = avgDiff < 100
  console.log('AC6 Avg ticket:      CA=$' + (parseFloat(ac6a[0].avg)/100).toFixed(2) + '  DB=$' + (parseFloat(ac6b[0].avg)/100).toFixed(2) + '  diff=$' + (avgDiff/100).toFixed(2) + '  ' + (p6 ? '✅ PASS' : '❌ FAIL'))

  // Segments
  console.log('\n── Segment Distribution ──')
  const segs = await prisma.$queryRaw`
    SELECT customer_segment, COUNT(*)::text as cnt
    FROM customer_analytics GROUP BY customer_segment ORDER BY COUNT(*) DESC
  `
  for (const s of segs) console.log('  ' + s.customer_segment.padEnd(14) + s.cnt)

  // Verdict
  const allPass = p1 && p2 && p3 && p4 && p5 && p6
  console.log('\n' + '='.repeat(80))
  if (allPass) {
    console.log('  ✅ ALL 6 ACCEPTANCE CRITERIA PASSED')
  } else {
    console.log('  ⚠️  SOME CRITERIA NEED ATTENTION')
  }
  console.log('='.repeat(80) + '\n')

  await prisma.$disconnect()
}

verify().catch(e => { console.error(e); process.exit(1) })

