#!/usr/bin/env node
/**
 * Повторная отправка email клиентам, которым не удалось отправить из-за ошибки IP whitelist
 * Находит всех клиентов с неудачными попытками отправки и отправляет email заново
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { sendReferralCodeEmail } = require('../lib/email-service-simple')

// Дата начала проблемы с IP whitelist (примерно когда начались ошибки)
const PROBLEM_START_DATE = new Date('2025-12-29T00:00:00Z')

async function retryFailedEmails() {
  console.log('🔄 Повторная отправка email клиентам с неудачными попытками\n')
  console.log('='.repeat(60))

  try {
    // 1. Найти все неудачные попытки отправки email из-за IP whitelist
    console.log('\n1️⃣ Поиск неудачных попыток отправки email...')
    
    const failedNotifications = await prisma.notificationEvent.findMany({
      where: {
        channel: 'EMAIL',
        status: 'failed',
        createdAt: { gte: PROBLEM_START_DATE },
        OR: [
          { errorMessage: { contains: 'Unauthorized' } },
          { errorMessage: { contains: 'IP Address is not whitelisted' } },
          { errorCode: '401' }
        ]
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        customerId: true,
        referrerCustomerId: true,
        errorMessage: true,
        errorCode: true,
        metadata: true,
        createdAt: true
      }
    })

    console.log(`   Найдено ${failedNotifications.length} неудачных попыток отправки email`)

    if (failedNotifications.length > 0) {
      console.log(`\n   Детали неудачных попыток:`)
      failedNotifications.slice(0, 5).forEach((notif, idx) => {
        console.log(`   ${idx + 1}. Customer ID: ${notif.customerId || 'N/A'}, Referrer ID: ${notif.referrerCustomerId || 'N/A'}`)
        console.log(`      Error: ${notif.errorMessage || 'N/A'}`)
        console.log(`      Date: ${notif.createdAt.toISOString()}`)
        if (notif.metadata) {
          const meta = notif.metadata
          if (meta.email) {
            console.log(`      Email: ${meta.email}`)
          }
        }
      })
    }

    // 2. Найти клиентов, которым нужно отправить email
    console.log('\n2️⃣ Поиск клиентов для повторной отправки...')
    
    // Получить уникальные customerId из неудачных попыток
    const customerIds = [...new Set(
      failedNotifications
        .map(n => n.customerId || n.referrerCustomerId)
        .filter(Boolean)
    )]

    console.log(`   Найдено ${customerIds.length} уникальных customerId из неудачных попыток`)
    
    // Также попробуем найти по email из metadata
    const emailsFromMetadata = [...new Set(
      failedNotifications
        .map(n => n.metadata?.email)
        .filter(Boolean)
    )]
    
    console.log(`   Найдено ${emailsFromMetadata.length} уникальных email из metadata`)

    // Также найти клиентов с referral code, но без отправленного email
    // Расширим поиск - не только после PROBLEM_START_DATE, но и за последние 7 дней
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    
    const customersWithoutEmail = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        personal_code,
        referral_url,
        activated_as_referrer,
        referral_email_sent,
        created_at
      FROM square_existing_clients
      WHERE activated_as_referrer = true
        AND personal_code IS NOT NULL
        AND personal_code != ''
        AND email_address IS NOT NULL
        AND email_address != ''
        AND COALESCE(referral_email_sent, FALSE) = FALSE
        AND created_at >= ${sevenDaysAgo}
      ORDER BY created_at DESC
    `

    console.log(`   Найдено ${customersWithoutEmail.length} клиентов с referral code, но без отправленного email`)

    // Также попробуем найти клиентов по email из metadata
    let customersByEmail = []
    if (emailsFromMetadata.length > 0) {
      console.log(`   Ищем клиентов по email: ${emailsFromMetadata.slice(0, 3).join(', ')}...`)
      
      // Используем параметризованный запрос для безопасности
      const emailPlaceholders = emailsFromMetadata.map((_, i) => `$${i + 1}`).join(',')
      const query = `
        SELECT 
          square_customer_id,
          given_name,
          family_name,
          email_address,
          personal_code,
          referral_url,
          referral_email_sent
        FROM square_existing_clients
        WHERE LOWER(TRIM(email_address)) = ANY(ARRAY[${emailPlaceholders}])
          AND personal_code IS NOT NULL
          AND personal_code != ''
      `
      
      const emailValues = emailsFromMetadata.map(e => e.toLowerCase().trim())
      customersByEmail = await prisma.$queryRawUnsafe(
        query.replace(/\$\d+/g, (match, offset) => {
          const index = parseInt(match.substring(1)) - 1
          return `'${emailValues[index].replace(/'/g, "''")}'`
        })
      )
      
      console.log(`   Найдено ${customersByEmail.length} клиентов по email из metadata`)
      
      if (customersByEmail.length > 0) {
        console.log(`   Примеры найденных клиентов:`)
        customersByEmail.slice(0, 3).forEach((c, idx) => {
          console.log(`     ${idx + 1}. ${c.email_address} - ${c.given_name || ''} ${c.family_name || ''}`)
          console.log(`        Code: ${c.personal_code}, Email sent: ${c.referral_email_sent}`)
        })
      }
      
      // НЕ фильтруем по referral_email_sent - отправляем всем, у кого была ошибка
      // даже если они помечены как отправленные (потому что email не был отправлен из-за ошибки)
      console.log(`   Клиентов для повторной отправки: ${customersByEmail.length} (включая помеченных как отправленные)`)
    }

    // Объединить списки
    const allCustomerIds = new Set([
      ...customerIds,
      ...customersWithoutEmail.map(c => c.square_customer_id),
      ...customersByEmail.map(c => c.square_customer_id)
    ])

    console.log(`   Всего уникальных клиентов для обработки: ${allCustomerIds.size}`)

    if (allCustomerIds.size === 0) {
      console.log('\n✅ Нет клиентов для повторной отправки email')
      return
    }

    // 3. Получить данные клиентов
    console.log('\n3️⃣ Загрузка данных клиентов...')
    
    let customers = []
    
    if (allCustomerIds.size > 0) {
      // Если есть customerId, ищем по ним
      customers = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          given_name,
          family_name,
          email_address,
          personal_code,
          referral_url
        FROM square_existing_clients
        WHERE square_customer_id = ANY(${Array.from(allCustomerIds)})
          AND email_address IS NOT NULL
          AND email_address != ''
          AND personal_code IS NOT NULL
          AND personal_code != ''
      `
    }
    
    // Также добавим клиентов, найденных по email
    if (customersByEmail.length > 0) {
      const existingIds = new Set(customers.map(c => c.square_customer_id))
      const newCustomers = customersByEmail.filter(c => !existingIds.has(c.square_customer_id))
      customers = [...customers, ...newCustomers]
    }
    
    // Если все еще нет клиентов, но есть клиенты по email - используем их
    if (customers.length === 0 && customersByEmail.length > 0) {
      console.log(`   Используем клиентов, найденных по email из неудачных попыток`)
      customers = customersByEmail.map(c => ({
        square_customer_id: c.square_customer_id,
        given_name: c.given_name,
        family_name: c.family_name,
        email_address: c.email_address,
        personal_code: c.personal_code,
        referral_url: c.referral_url
      }))
    }
    
    // Если все еще нет клиентов, попробуем найти всех клиентов без отправленного email за последние 7 дней
    if (customers.length === 0) {
      console.log(`   Не найдено клиентов по ID или email, ищем всех клиентов без отправленного email...`)
      customers = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          given_name,
          family_name,
          email_address,
          personal_code,
          referral_url
        FROM square_existing_clients
        WHERE activated_as_referrer = true
          AND personal_code IS NOT NULL
          AND personal_code != ''
          AND email_address IS NOT NULL
          AND email_address != ''
          AND COALESCE(referral_email_sent, FALSE) = FALSE
          AND created_at >= ${sevenDaysAgo}
        ORDER BY created_at DESC
        LIMIT 50
      `
      console.log(`   Найдено ${customers.length} клиентов без отправленного email за последние 7 дней`)
    }

    console.log(`   Загружено ${customers.length} клиентов с полными данными`)

    if (customers.length === 0) {
      console.log('\n⚠️ Нет клиентов с полными данными для отправки email')
      return
    }

    // 4. Отправить email клиентам
    console.log('\n4️⃣ Отправка email клиентам...')
    console.log('='.repeat(60))

    let successCount = 0
    let errorCount = 0
    const errors = []

    const BATCH_SIZE = 5
    const DELAY_BETWEEN_BATCHES = 2000 // 2 секунды между батчами

    for (let i = 0; i < customers.length; i += BATCH_SIZE) {
      const batch = customers.slice(i, i + BATCH_SIZE)
      const batchNum = Math.floor(i / BATCH_SIZE) + 1
      const totalBatches = Math.ceil(customers.length / BATCH_SIZE)

      console.log(`\n📦 Батч ${batchNum}/${totalBatches} (${batch.length} клиентов)`)

      const promises = batch.map(async (customer) => {
        try {
          const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Valued Customer'
          const referralCode = customer.personal_code
          const referralUrl = customer.referral_url || `https://www.zorinastudio-referral.com/ref/${referralCode}`

          console.log(`   📧 Отправка email ${customer.email_address}...`)

          const emailResult = await sendReferralCodeEmail(
            customerName,
            customer.email_address,
            referralCode,
            referralUrl,
            {
              customerId: customer.square_customer_id
            }
          )

          if (emailResult.success && !emailResult.skipped) {
            successCount++
            
            // Обновить базу данных
            try {
              await prisma.$executeRaw`
                UPDATE square_existing_clients
                SET referral_email_sent = TRUE,
                    updated_at = NOW()
                WHERE square_customer_id = ${customer.square_customer_id}
              `
            } catch (updateError) {
              console.log(`   ⚠️  Email отправлен, но не удалось обновить базу: ${updateError.message}`)
            }

            console.log(`   ✅ Отправлено: ${customer.email_address} (${referralCode})`)
            return { success: true, email: customer.email_address, code: referralCode }
          } else if (emailResult.skipped) {
            console.log(`   ⏭️  Пропущено: ${customer.email_address} (${emailResult.reason || 'email disabled'})`)
            return { success: true, skipped: true, email: customer.email_address }
          } else {
            errorCount++
            const errorMsg = emailResult.error || 'Unknown error'
            console.log(`   ❌ Ошибка: ${customer.email_address} - ${errorMsg}`)
            errors.push({ email: customer.email_address, error: errorMsg })
            return { success: false, email: customer.email_address, error: errorMsg }
          }
        } catch (error) {
          errorCount++
          console.log(`   ❌ Исключение: ${customer.email_address} - ${error.message}`)
          errors.push({ email: customer.email_address, error: error.message })
          return { success: false, email: customer.email_address, error: error.message }
        }
      })

      await Promise.all(promises)

      // Задержка между батчами (кроме последнего)
      if (i + BATCH_SIZE < customers.length) {
        console.log(`   ⏳ Ожидание ${DELAY_BETWEEN_BATCHES}ms перед следующим батчем...`)
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES))
      }
    }

    // 5. Итоговая статистика
    console.log('\n' + '='.repeat(60))
    console.log('📊 ИТОГОВАЯ СТАТИСТИКА')
    console.log('='.repeat(60))
    console.log(`✅ Успешно отправлено: ${successCount}`)
    console.log(`❌ Ошибок: ${errorCount}`)
    console.log(`📧 Всего обработано: ${customers.length}`)

    if (errors.length > 0) {
      console.log('\n❌ Ошибки:')
      errors.slice(0, 10).forEach((err, idx) => {
        console.log(`   ${idx + 1}. ${err.email}: ${err.error}`)
      })
      if (errors.length > 10) {
        console.log(`   ... и еще ${errors.length - 10} ошибок`)
      }
    }

    console.log('\n✅ Повторная отправка завершена!')
    console.log('\n💡 Проверьте логи Vercel для деталей отправки')

  } catch (error) {
    console.error('\n❌ Критическая ошибка:', error)
    console.error('Stack:', error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

retryFailedEmails()
  .catch((error) => {
    console.error('\n❌ Фатальная ошибка:', error)
    process.exit(1)
  })

