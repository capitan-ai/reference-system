#!/usr/bin/env node
/**
 * Скрипт для поиска источника предупреждения url.parse()
 * Запускает указанный скрипт с --trace-deprecation и анализирует вывод
 */

const { spawn } = require('child_process')
const path = require('path')

const scriptToRun = process.argv[2] || 'scripts/retry-failed-emails.js'

console.log('🔍 Поиск источника предупреждения url.parse()...\n')
console.log(`Запускаю: ${scriptToRun}\n`)
console.log('='.repeat(60))

const child = spawn('node', ['--trace-deprecation', scriptToRun], {
  cwd: process.cwd(),
  stdio: 'pipe',
  env: { ...process.env }
})

let output = ''
let errorOutput = ''

child.stdout.on('data', (data) => {
  const text = data.toString()
  output += text
  // Показываем обычный вывод
  process.stdout.write(text)
})

child.stderr.on('data', (data) => {
  const text = data.toString()
  errorOutput += text
  
  // Если это предупреждение о url.parse(), выделяем его
  if (text.includes('url.parse()') || text.includes('DEP0169')) {
    console.error('\n' + '='.repeat(60))
    console.error('⚠️  НАЙДЕНО ПРЕДУПРЕЖДЕНИЕ:')
    console.error('='.repeat(60))
    console.error(text)
    console.error('='.repeat(60) + '\n')
  } else {
    // Показываем остальные ошибки
    process.stderr.write(text)
  }
})

child.on('close', (code) => {
  console.log('\n' + '='.repeat(60))
  console.log('📊 АНАЛИЗ ЗАВЕРШЕН')
  console.log('='.repeat(60))
  
  if (errorOutput.includes('url.parse()') || errorOutput.includes('DEP0169')) {
    console.log('\n✅ Предупреждение найдено в выводе выше')
    console.log('\n💡 Для подавления предупреждения:')
    console.log('   1. Добавьте в .env: NODE_OPTIONS="--no-deprecation"')
    console.log('   2. Или обновите зависимости: npm update')
  } else {
    console.log('\n⚠️  Предупреждение не найдено в этом запуске')
    console.log('   Возможно, оно появляется только в определенных условиях')
  }
  
  process.exit(code)
})

child.on('error', (error) => {
  console.error('❌ Ошибка запуска:', error.message)
  process.exit(1)
})

