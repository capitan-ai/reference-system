const prisma = require('../lib/prisma-client')

// All tables from schema
const tables = [
  { name: 'customers', model: 'Customer', description: 'Основные клиенты системы' },
  { name: 'ref_clicks', model: 'RefClick', description: 'Клики по реферальным ссылкам' },
  { name: 'giftcard_runs', model: 'GiftCardRun', description: 'Запуски обработки подарочных карт' },
  { name: 'giftcard_jobs', model: 'GiftCardJob', description: 'Задачи обработки подарочных карт' },
  { name: 'notification_events', model: 'NotificationEvent', description: 'События уведомлений' },
  { name: 'analytics_dead_letter', model: 'AnalyticsDeadLetter', description: 'Необработанные аналитические события' },
  { name: 'device_pass_registrations', model: 'DevicePassRegistration', description: 'Регистрации устройств для Apple Wallet' },
  { name: 'square_existing_clients', model: 'square_existing_clients', description: 'Клиенты из Square (legacy)' },
  { name: 'square_gift_card_gan_audit', model: 'square_gift_card_gan_audit', description: 'Аудит GAN подарочных карт' },
]

async function analyzeTable(tableInfo) {
  try {
    const { name, model, description } = tableInfo
    
    // Get count
    const countResult = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM ${name}`)
    const count = parseInt(countResult[0]?.count || 0)
    
    let sampleData = null
    let recentData = null
    let oldestData = null
    
    if (count > 0) {
      // Get sample data (first 3 rows)
      try {
        sampleData = await prisma.$queryRawUnsafe(`SELECT * FROM ${name} LIMIT 3`)
      } catch (e) {
        // Some tables might have complex structures
        sampleData = null
      }
      
      // Try to get recent and oldest records (if there's a created_at or createdAt field)
      try {
        const dateField = name.includes('square_') ? 'created_at' : 
                         name === 'giftcard_runs' || name === 'giftcard_jobs' ? 'created_at' :
                         'createdAt'
        
        recentData = await prisma.$queryRawUnsafe(
          `SELECT * FROM ${name} ORDER BY ${dateField} DESC LIMIT 1`
        )
        oldestData = await prisma.$queryRawUnsafe(
          `SELECT * FROM ${name} ORDER BY ${dateField} ASC LIMIT 1`
        )
      } catch (e) {
        // Ignore if date field doesn't exist
      }
    }
    
    return {
      name,
      model,
      description,
      count,
      hasData: count > 0,
      sampleData: sampleData ? sampleData.length : 0,
      recentData: recentData ? recentData.length : 0,
      oldestData: oldestData ? oldestData.length : 0
    }
  } catch (error) {
    return {
      name: tableInfo.name,
      model: tableInfo.model,
      description: tableInfo.description,
      count: -1,
      hasData: false,
      error: error.message
    }
  }
}

async function getTableDetails(tableName) {
  try {
    // Get column information
    const columns = await prisma.$queryRawUnsafe(`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = '${tableName}'
      ORDER BY ordinal_position
    `)
    return columns
  } catch (error) {
    return []
  }
}

async function main() {
  console.log('🔍 Анализ всех таблиц базы данных...\n')
  console.log('=' .repeat(80))
  
  const results = []
  
  for (const table of tables) {
    const result = await analyzeTable(table)
    results.push(result)
    
    const status = result.count > 0 ? '✅' : result.count === 0 ? '⚪' : '❌'
    console.log(`${status} ${table.name.padEnd(35)} | ${String(result.count).padStart(8)} записей | ${table.description}`)
    
    if (result.error) {
      console.log(`   ⚠️  Ошибка: ${result.error}`)
    }
  }
  
  console.log('\n' + '='.repeat(80))
  console.log('\n📊 СВОДКА:\n')
  
  const withData = results.filter(r => r.count > 0)
  const empty = results.filter(r => r.count === 0)
  const errors = results.filter(r => r.count === -1)
  
  console.log(`✅ Таблицы с данными (${withData.length}):`)
  withData.forEach(r => {
    console.log(`   - ${r.name}: ${r.count} записей`)
  })
  
  console.log(`\n⚪ Пустые таблицы (${empty.length}):`)
  empty.forEach(r => {
    console.log(`   - ${r.name} (${r.description})`)
  })
  
  if (errors.length > 0) {
    console.log(`\n❌ Таблицы с ошибками (${errors.length}):`)
    errors.forEach(r => {
      console.log(`   - ${r.name}: ${r.error}`)
    })
  }
  
  // Detailed analysis for empty tables
  console.log('\n' + '='.repeat(80))
  console.log('\n🔎 ДЕТАЛЬНЫЙ АНАЛИЗ ПУСТЫХ ТАБЛИЦ:\n')
  
  for (const emptyTable of empty) {
    console.log(`\n📋 ${emptyTable.name} (${emptyTable.description})`)
    console.log('   Возможные причины:')
    
    // Analyze based on table name
    if (emptyTable.name === 'analytics_dead_letter') {
      console.log('   - Таблица для необработанных аналитических событий')
      console.log('   - Пустота означает, что все события обрабатываются успешно')
    } else if (emptyTable.name === 'device_pass_registrations') {
      console.log('   - Регистрации устройств для Apple Wallet')
      console.log('   - Пустота означает, что никто не зарегистрировал устройство')
      console.log('   - Это нормально, если пользователи не используют Apple Wallet')
    } else if (emptyTable.name === 'square_gift_card_gan_audit') {
      console.log('   - Аудит GAN подарочных карт')
      console.log('   - Заполняется только при специальных проверках')
    } else {
      console.log('   - Проверьте, есть ли код, который должен заполнять эту таблицу')
      console.log('   - Возможно, функциональность еще не используется')
    }
  }
  
  // Check relationships
  console.log('\n' + '='.repeat(80))
  console.log('\n🔗 АНАЛИЗ СВЯЗЕЙ МЕЖДУ ТАБЛИЦАМИ:\n')
  
  // Check square_existing_clients vs customers
  const customersCount = results.find(r => r.name === 'customers')?.count || 0
  const squareClientsCount = results.find(r => r.name === 'square_existing_clients')?.count || 0
  if (squareClientsCount > 0 && customersCount === 0) {
    console.log('⚠️  Обнаружена проблема:')
    console.log(`   - Есть ${squareClientsCount} клиентов в square_existing_clients, но нет в customers`)
    console.log('   - Возможно, нужна миграция данных между таблицами')
  }
  
  // Sample data from important tables
  console.log('\n' + '='.repeat(80))
  console.log('\n📝 ПРИМЕРЫ ДАННЫХ ИЗ ВАЖНЫХ ТАБЛИЦ:\n')
  
  const importantTables = ['customers', 'square_existing_clients']
  
  for (const tableName of importantTables) {
    const tableResult = results.find(r => r.name === tableName)
    if (tableResult && tableResult.count > 0) {
      try {
        const sample = await prisma.$queryRawUnsafe(`SELECT * FROM ${tableName} LIMIT 1`)
        if (sample && sample.length > 0) {
          console.log(`\n${tableName}:`)
          // Show only first few fields to avoid too much output
          const record = sample[0]
          const keys = Object.keys(record).slice(0, 5)
          const sampleObj = {}
          keys.forEach(key => {
            sampleObj[key] = record[key]
          })
          console.log(JSON.stringify(sampleObj, null, 2))
        }
      } catch (e) {
        console.log(`\n${tableName}: (не удалось получить пример)`)
      }
    }
  }
  
  await prisma.$disconnect()
}

main().catch(console.error)

