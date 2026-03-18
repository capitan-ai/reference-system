require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function comprehensiveAudit() {
  console.log('🔍 ПОЛНЫЙ АУДИТ АДМИН АНАЛИТИКИ\n')
  console.log('='.repeat(80))
  console.log(`Дата аудита: ${new Date().toISOString()}\n`)

  const issues = []
  const warnings = []
  const recommendations = []

  try {
    // ============================================================================
    // 1. ПРОВЕРКА СТРУКТУРЫ ТАБЛИЦЫ
    // ============================================================================
    console.log('\n📊 1. ПРОВЕРКА СТРУКТУРЫ ТАБЛИЦЫ admin_analytics_daily')
    console.log('-'.repeat(80))

    const tableInfo = await prisma.$queryRaw`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = 'admin_analytics_daily'
        AND table_schema = 'public'
      ORDER BY ordinal_position
    `

    console.log('Колонки таблицы:')
    const colNames = tableInfo.map(c => c.column_name)
    tableInfo.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'YES' ? '(nullable)' : '(NOT NULL)'}`)
    })
    const hasMonthCols = colNames.includes('bookings_current_month_count') && colNames.includes('bookings_future_months_count')
    if (!hasMonthCols) {
      recommendations.push('Отсутствуют колонки bookings_current_month_count / bookings_future_months_count')
      console.log(`\n⚠️  Отсутствуют колонки same/future month`)
    } else {
      console.log(`\n✅ Колонки bookings_current_month_count, bookings_future_months_count присутствуют`)
    }

    // Проверка индексов
    const indexes = await prisma.$queryRaw`
      SELECT 
        indexname,
        indexdef
      FROM pg_indexes
      WHERE tablename = 'admin_analytics_daily'
        AND schemaname = 'public'
    `

    console.log('\nИндексы:')
    indexes.forEach(idx => {
      console.log(`  - ${idx.indexname}`)
    })

    // ============================================================================
    // 2. ПРОВЕРКА КОНСИСТЕНТНОСТИ ДАННЫХ
    // ============================================================================
    console.log('\n\n📈 2. ПРОВЕРКА КОНСИСТЕНТНОСТИ ДАННЫХ')
    console.log('-'.repeat(80))

    // 2.1 Проверка: bookings_created_count vs appointments_total (разные метрики — created vs visits)
    const bookingCountCheck = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE bookings_created_count > appointments_total) as created_gt_visits
      FROM admin_analytics_daily
      WHERE date_pacific >= CURRENT_DATE - interval '90 days'
    `

    const bookingCountIssue = bookingCountCheck[0]
    if (bookingCountIssue.created_gt_visits > 0) {
      warnings.push({
        severity: 'WARNING',
        category: 'Data Consistency',
        issue: 'bookings_created_count > appointments_total (разные метрики: created vs visits — допустимо)',
        count: bookingCountIssue.created_gt_visits,
        total: bookingCountIssue.total_records
      })
      console.log(`⚠️  Найдено ${bookingCountIssue.created_gt_visits} записей где bookings_created_count > appointments_total (допустимо — разные метрики)`)
    } else {
      console.log(`✅ bookings_created_count <= appointments_total (проверено ${bookingCountIssue.total_records} записей)`)
    }

    // 2.2 Проверка: appointments_accepted <= appointments_total
    const acceptedCheck = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE appointments_accepted > appointments_total) as inconsistent_records
      FROM admin_analytics_daily
      WHERE date_pacific >= CURRENT_DATE - interval '90 days'
    `

    const acceptedIssue = acceptedCheck[0]
    if (acceptedIssue.inconsistent_records > 0) {
      issues.push({
        severity: 'ERROR',
        category: 'Data Consistency',
        issue: 'appointments_accepted > appointments_total',
        count: acceptedIssue.inconsistent_records
      })
      console.log(`❌ Найдено ${acceptedIssue.inconsistent_records} записей где appointments_accepted > appointments_total`)
    } else {
      console.log(`✅ appointments_accepted <= appointments_total`)
    }

    // 2.3 Проверка: creator_revenue_cents == cashier_revenue_cents (для appointment-linked payments)
    const revenueCheck = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE creator_revenue_cents != cashier_revenue_cents) as different_revenue,
        SUM(ABS(creator_revenue_cents - cashier_revenue_cents)) as total_difference
      FROM admin_analytics_daily
      WHERE date_pacific >= CURRENT_DATE - interval '30 days'
        AND creator_payments_count > 0
        AND cashier_payments_count > 0
    `

    const revenueIssue = revenueCheck[0]
    if (revenueIssue.different_revenue > 0) {
      warnings.push({
        severity: 'WARNING',
        category: 'Data Consistency',
        issue: 'creator_revenue_cents != cashier_revenue_cents',
        count: revenueIssue.different_revenue,
        total_difference: revenueIssue.total_difference
      })
      console.log(`⚠️  Найдено ${revenueIssue.different_revenue} записей где creator_revenue != cashier_revenue`)
      console.log(`   Общая разница: ${revenueIssue.total_difference} центов`)
    } else {
      console.log(`✅ creator_revenue == cashier_revenue (для appointment-linked payments)`)
    }

    // 2.4 Проверка: creator_payments_count == cashier_payments_count
    const paymentsCountCheck = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE creator_payments_count != cashier_payments_count) as different_counts
      FROM admin_analytics_daily
      WHERE date_pacific >= CURRENT_DATE - interval '30 days'
        AND creator_payments_count > 0
        AND cashier_payments_count > 0
    `

    const paymentsCountIssue = paymentsCountCheck[0]
    if (paymentsCountIssue.different_counts > 0) {
      warnings.push({
        severity: 'WARNING',
        category: 'Data Consistency',
        issue: 'creator_payments_count != cashier_payments_count',
        count: paymentsCountIssue.different_counts
      })
      console.log(`⚠️  Найдено ${paymentsCountIssue.different_counts} записей где creator_payments_count != cashier_payments_count`)
    } else {
      console.log(`✅ creator_payments_count == cashier_payments_count`)
    }

    // 2.5 Проверка: admin_analytics_daily new/rebook vs admin_created_booking_facts
    try {
      const factsCheck = await prisma.$queryRaw`
        WITH admin_totals AS (
          SELECT
            organization_id, team_member_id, location_id, date_pacific,
            new_customers_booked_count, rebookings_count
          FROM admin_analytics_daily
          WHERE date_pacific >= CURRENT_DATE - interval '14 days'
        ),
        facts_totals AS (
          SELECT
            organization_id,
            administrator_id_snapshot AS team_member_id,
            location_id,
            created_day_pacific AS date_pacific,
            COUNT(*) FILTER (WHERE classification_snapshot = 'NEW_CLIENT') AS new_count,
            COUNT(*) FILTER (WHERE classification_snapshot = 'REBOOKING') AS rebook_count
          FROM admin_created_booking_facts
          WHERE created_day_pacific >= CURRENT_DATE - interval '14 days'
          GROUP BY 1, 2, 3, 4
        )
        SELECT
          COUNT(*) FILTER (WHERE a.new_customers_booked_count != COALESCE(f.new_count, 0) OR a.rebookings_count != COALESCE(f.rebook_count, 0)) AS mismatch_count,
          COUNT(*) AS total_checked
        FROM admin_totals a
        LEFT JOIN facts_totals f ON a.organization_id = f.organization_id
          AND a.team_member_id = f.team_member_id
          AND a.location_id = f.location_id
          AND a.date_pacific = f.date_pacific
      `
      const fc = factsCheck[0]
      if (fc && Number(fc.mismatch_count) > 0) {
        warnings.push({
          severity: 'WARNING',
          category: 'Data Consistency',
          issue: 'admin_analytics_daily new/rebook != admin_created_booking_facts',
          count: fc.mismatch_count,
          total: fc.total_checked
        })
        console.log(`⚠️  Найдено ${fc.mismatch_count} записей где new/rebook не совпадает с admin_created_booking_facts`)
      } else {
        console.log(`✅ new_customers_booked_count и rebookings_count совпадают с admin_created_booking_facts (prior-paid)`)
      }
    } catch (e) {
      if (e.code === 'P2021' || e.message?.includes('admin_created_booking_facts')) {
        console.log(`⚠️  Таблица admin_created_booking_facts не найдена — выполните миграцию`)
      } else {
        throw e
      }
    }

    // 2.6 Проверка: admin_created_booking_facts — только source FIRST_PARTY_MERCHANT или NULL
    try {
      const sourceCheck = await prisma.$queryRaw`
        SELECT COUNT(*)::int as bad_count
        FROM admin_created_booking_facts f
        JOIN bookings b ON f.booking_id = b.id
        WHERE COALESCE(b.source, b.raw_json->>'source') IS NOT NULL
          AND COALESCE(b.source, b.raw_json->>'source') <> 'FIRST_PARTY_MERCHANT'
      `
      const badSource = sourceCheck[0]?.bad_count ?? 0
      if (badSource > 0) {
        issues.push({
          severity: 'ERROR',
          category: 'Source Filter',
          issue: 'admin_created_booking_facts содержит букинги с source != FIRST_PARTY_MERCHANT',
          count: badSource
        })
        console.log(`❌ Найдено ${badSource} facts с source != FIRST_PARTY_MERCHANT (запустите refresh для очистки)`)
      } else {
        console.log(`✅ admin_created_booking_facts: все букинги с source = FIRST_PARTY_MERCHANT или NULL`)
      }
    } catch (e) {
      if (e.code === 'P2021' || e.message?.includes('admin_created_booking_facts')) {
        console.log(`⚠️  Таблица admin_created_booking_facts не найдена`)
      } else {
        throw e
      }
    }

    // ============================================================================
    // 3. ПРОВЕРКА СВЯЗИ С ИСХОДНЫМИ ДАННЫМИ
    // ============================================================================
    console.log('\n\n🔗 3. ПРОВЕРКА СВЯЗИ С ИСХОДНЫМИ ДАННЫМИ')
    console.log('-'.repeat(80))

    // 3.1 Сравнение с bookings
    const bookingsComparison = await prisma.$queryRaw`
      WITH admin_totals AS (
        SELECT 
          DATE(date_pacific) as date,
          SUM(appointments_total) as total_appointments
        FROM admin_analytics_daily
        WHERE date_pacific >= CURRENT_DATE - interval '7 days'
        GROUP BY DATE(date_pacific)
      ),
      booking_totals AS (
        SELECT 
          DATE(b.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') as date,
          COUNT(*) as total_bookings
        FROM bookings b
        WHERE b.created_at >= CURRENT_DATE - interval '7 days'
        GROUP BY DATE(b.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')
      )
      SELECT 
        COALESCE(a.date, b.date) as date,
        COALESCE(a.total_appointments, 0) as admin_total,
        COALESCE(b.total_bookings, 0) as booking_total,
        ABS(COALESCE(a.total_appointments, 0) - COALESCE(b.total_bookings, 0)) as difference
      FROM admin_totals a
      FULL OUTER JOIN booking_totals b ON a.date = b.date
      ORDER BY date DESC
    `

    console.log('\nСравнение appointments_total с bookings (последние 7 дней):')
    console.log('Дата       | Admin Total | Booking Total | Разница')
    console.log('-'.repeat(60))

    let totalDifference = 0
    bookingsComparison.forEach(row => {
      const diff = Number(row.difference)
      totalDifference += diff
      const dateStr = row.date.toISOString().split('T')[0]
      const status = diff === 0 ? '✅' : '⚠️'
      console.log(`${dateStr} | ${String(row.admin_total).padEnd(11)} | ${String(row.booking_total).padEnd(13)} | ${String(diff).padEnd(7)} ${status}`)
    })

    if (totalDifference > 0) {
      warnings.push({
        severity: 'WARNING',
        category: 'Data Source Comparison',
        issue: 'appointments_total не совпадает с bookings',
        total_difference: totalDifference
      })
    }

    // 3.2 Сравнение revenue с payments
    const revenueComparison = await prisma.$queryRaw`
      WITH admin_revenue AS (
        SELECT 
          DATE(date_pacific) as date,
          SUM(cashier_revenue_cents) as total_revenue_cents
        FROM admin_analytics_daily
        WHERE date_pacific >= CURRENT_DATE - interval '7 days'
        GROUP BY DATE(date_pacific)
      ),
      payment_revenue AS (
        SELECT 
          DATE(b.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') as date,
          SUM(p.total_money_amount) as total_payment_cents
        FROM payments p
        INNER JOIN bookings b ON p.booking_id = b.id
        WHERE p.status = 'COMPLETED'
          AND b.created_at >= CURRENT_DATE - interval '7 days'
        GROUP BY DATE(b.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')
      )
      SELECT 
        COALESCE(a.date, p.date) as date,
        COALESCE(a.total_revenue_cents, 0) as admin_revenue,
        COALESCE(p.total_payment_cents, 0) as payment_revenue,
        ABS(COALESCE(a.total_revenue_cents, 0) - COALESCE(p.total_payment_cents, 0)) as difference
      FROM admin_revenue a
      FULL OUTER JOIN payment_revenue p ON a.date = p.date
      ORDER BY date DESC
    `

    console.log('\n\nСравнение cashier_revenue с payments (последние 7 дней):')
    console.log('Дата       | Admin Revenue | Payment Revenue | Разница (cents)')
    console.log('-'.repeat(70))

    let revenueDifference = 0
    revenueComparison.forEach(row => {
      const diff = Number(row.difference)
      revenueDifference += diff
      const dateStr = row.date.toISOString().split('T')[0]
      const status = diff === 0 ? '✅' : '⚠️'
      console.log(`${dateStr} | ${String(row.admin_revenue).padEnd(13)} | ${String(row.payment_revenue).padEnd(15)} | ${String(diff).padEnd(15)} ${status}`)
    })

    if (revenueDifference > 0) {
      warnings.push({
        severity: 'WARNING',
        category: 'Data Source Comparison',
        issue: 'cashier_revenue не совпадает с payments',
        total_difference_cents: revenueDifference
      })
    }

    // ============================================================================
    // 4. ПРОВЕРКА NULL ЗНАЧЕНИЙ
    // ============================================================================
    console.log('\n\n🔍 4. ПРОВЕРКА NULL ЗНАЧЕНИЙ')
    console.log('-'.repeat(80))

    const nullCheck = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE given_name IS NULL) as null_given_name,
        COUNT(*) FILTER (WHERE family_name IS NULL) as null_family_name,
        COUNT(*) FILTER (WHERE role IS NULL) as null_role
      FROM admin_analytics_daily
      WHERE date_pacific >= CURRENT_DATE - interval '30 days'
    `

    const nullIssues = nullCheck[0]
    console.log(`Всего записей (последние 30 дней): ${nullIssues.total_records}`)
    console.log(`  - NULL given_name: ${nullIssues.null_given_name}`)
    console.log(`  - NULL family_name: ${nullIssues.null_family_name}`)
    console.log(`  - NULL role: ${nullIssues.null_role}`)

    if (nullIssues.null_given_name > 0 || nullIssues.null_family_name > 0) {
      warnings.push({
        severity: 'WARNING',
        category: 'Data Quality',
        issue: 'NULL значения в именах team_members',
        null_given_name: nullIssues.null_given_name,
        null_family_name: nullIssues.null_family_name
      })
    }

    // ============================================================================
    // 5. ПРОВЕРКА ПРОИЗВОДИТЕЛЬНОСТИ
    // ============================================================================
    console.log('\n\n⚡ 5. ПРОВЕРКА ПРОИЗВОДИТЕЛЬНОСТИ')
    console.log('-'.repeat(80))

    // 5.1 Размер таблицы
    const tableSize = await prisma.$queryRaw`
      SELECT 
        pg_size_pretty(pg_total_relation_size('admin_analytics_daily')) as total_size,
        pg_size_pretty(pg_relation_size('admin_analytics_daily')) as table_size,
        pg_size_pretty(pg_indexes_size('admin_analytics_daily')) as indexes_size
    `

    console.log('Размер таблицы:')
    tableSize.forEach(size => {
      console.log(`  - Общий размер: ${size.total_size}`)
      console.log(`  - Размер таблицы: ${size.table_size}`)
      console.log(`  - Размер индексов: ${size.indexes_size}`)
    })

    // 5.2 Количество записей
    const recordCount = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total_records,
        COUNT(DISTINCT organization_id) as unique_orgs,
        COUNT(DISTINCT team_member_id) as unique_team_members,
        COUNT(DISTINCT location_id) as unique_locations,
        MIN(date_pacific) as earliest_date,
        MAX(date_pacific) as latest_date
      FROM admin_analytics_daily
    `

    const counts = recordCount[0]
    console.log('\nСтатистика записей:')
    console.log(`  - Всего записей: ${counts.total_records}`)
    console.log(`  - Уникальных организаций: ${counts.unique_orgs}`)
    console.log(`  - Уникальных team members: ${counts.unique_team_members}`)
    console.log(`  - Уникальных локаций: ${counts.unique_locations}`)
    console.log(`  - Период данных: ${counts.earliest_date} - ${counts.latest_date}`)

    // ============================================================================
    // 6. ПРОВЕРКА VIEWS
    // ============================================================================
    console.log('\n\n👁️  6. ПРОВЕРКА VIEWS')
    console.log('-'.repeat(80))

    // Проверка существования views
    const viewsCheck = await prisma.$queryRaw`
      SELECT 
        table_name,
        view_definition
      FROM information_schema.views
      WHERE table_schema = 'public'
        AND table_name IN ('analytics_appointments_by_location_daily', 'analytics_revenue_by_location_daily')
    `

    console.log('Найденные views:')
    viewsCheck.forEach(view => {
      console.log(`  ✅ ${view.table_name}`)
      const usesCustomerAnalytics = view.view_definition.includes('customer_analytics')
      if (usesCustomerAnalytics) {
        console.log(`     - Использует customer_analytics`)
      }
    })

    if (viewsCheck.length < 2) {
      issues.push({
        severity: 'ERROR',
        category: 'Views',
        issue: 'Отсутствуют необходимые views'
      })
    }

    // ============================================================================
    // 7. ПРОВЕРКА ДАННЫХ ЗА ПОСЛЕДНИЕ ДНИ
    // ============================================================================
    console.log('\n\n📅 7. ПРОВЕРКА ДАННЫХ ЗА ПОСЛЕДНИЕ ДНИ')
    console.log('-'.repeat(80))

    const recentData = await prisma.$queryRaw`
      SELECT 
        date_pacific,
        COUNT(DISTINCT organization_id) as orgs,
        COUNT(DISTINCT team_member_id) as team_members,
        SUM(appointments_total) as total_appointments,
        SUM(cashier_revenue_cents) as total_revenue_cents
      FROM admin_analytics_daily
      WHERE date_pacific >= CURRENT_DATE - interval '7 days'
      GROUP BY date_pacific
      ORDER BY date_pacific DESC
    `

    console.log('Данные за последние 7 дней:')
    console.log('Дата       | Орг | Team Members | Appointments | Revenue (cents)')
    console.log('-'.repeat(70))

    recentData.forEach(row => {
      const dateStr = row.date_pacific.toISOString().split('T')[0]
      const hasData = Number(row.total_appointments) > 0 || Number(row.total_revenue_cents) > 0
      const status = hasData ? '✅' : '⚠️'
      console.log(`${dateStr} | ${String(row.orgs).padEnd(3)} | ${String(row.team_members).padEnd(13)} | ${String(row.total_appointments).padEnd(13)} | ${String(row.total_revenue_cents).padEnd(15)} ${status}`)
    })

    // Проверка на пропущенные даты
    const today = new Date()
    const sevenDaysAgo = new Date(today)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    
    const expectedDates = []
    for (let d = new Date(sevenDaysAgo); d <= today; d.setDate(d.getDate() + 1)) {
      expectedDates.push(d.toISOString().split('T')[0])
    }

    const actualDates = recentData.map(r => r.date_pacific.toISOString().split('T')[0])
    const missingDates = expectedDates.filter(d => !actualDates.includes(d))

    if (missingDates.length > 0) {
      warnings.push({
        severity: 'WARNING',
        category: 'Data Completeness',
        issue: 'Пропущенные даты в данных',
        missing_dates: missingDates
      })
      console.log(`\n⚠️  Пропущенные даты: ${missingDates.join(', ')}`)
    }

    // ============================================================================
    // 8. ИТОГОВЫЙ ОТЧЕТ
    // ============================================================================
    console.log('\n\n' + '='.repeat(80))
    console.log('📋 ИТОГОВЫЙ ОТЧЕТ')
    console.log('='.repeat(80))

    console.log(`\n❌ Критические проблемы: ${issues.length}`)
    issues.forEach((issue, idx) => {
      console.log(`  ${idx + 1}. [${issue.severity}] ${issue.category}: ${issue.issue}`)
      if (issue.count) console.log(`     Затронуто записей: ${issue.count}`)
    })

    console.log(`\n⚠️  Предупреждения: ${warnings.length}`)
    warnings.forEach((warning, idx) => {
      console.log(`  ${idx + 1}. [${warning.severity}] ${warning.category}: ${warning.issue}`)
      if (warning.count) console.log(`     Затронуто записей: ${warning.count}`)
    })

    console.log(`\n💡 Рекомендации: ${recommendations.length}`)
    recommendations.forEach((rec, idx) => {
      console.log(`  ${idx + 1}. ${rec}`)
    })

    // Сохранение отчета
    const report = {
      audit_date: new Date().toISOString(),
      issues,
      warnings,
      recommendations,
      summary: {
        total_issues: issues.length,
        total_warnings: warnings.length,
        total_recommendations: recommendations.length
      }
    }

    console.log('\n✅ Аудит завершен')
    console.log('\nДля сохранения отчета в файл, раскомментируйте код сохранения в скрипте.')

    return report

  } catch (error) {
    console.error('\n❌ Ошибка во время аудита:', error.message)
    console.error(error.stack)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Запуск аудита
if (require.main === module) {
  comprehensiveAudit()
    .then(() => {
      console.log('\n✅ Аудит завершен успешно')
      process.exit(0)
    })
    .catch((error) => {
      console.error('\n❌ Ошибка при выполнении аудита:', error)
      process.exit(1)
    })
}

module.exports = { comprehensiveAudit }

