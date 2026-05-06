#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const FormData = require('form-data')
const fetch = require('node-fetch')
const { generateExcelReport } = require('./generate-feedback-excel')

async function sendExcelToTelegram() {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID

    if (!botToken || !chatId) {
      throw new Error('Telegram credentials not configured')
    }

    console.log('📊 Generating Excel report...')
    const excelFile = await generateExcelReport()

    console.log('📤 Sending to Telegram...')

    // Read file
    const fileStream = fs.createReadStream(excelFile)
    const fileSize = fs.statSync(excelFile).size

    // Create form data
    const form = new FormData()
    form.append('chat_id', chatId)
    form.append('document', fileStream, path.basename(excelFile))
    form.append('caption', '📊 Daily Feedback Report')
    form.append('parse_mode', 'HTML')

    // Send to Telegram
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendDocument`,
      {
        method: 'POST',
        body: form,
        headers: form.getHeaders()
      }
    )

    const result = await response.json()

    if (!result.ok) {
      throw new Error(`Telegram error: ${result.description}`)
    }

    console.log('✅ Excel report sent to Telegram!')
    console.log(`📁 File: ${path.basename(excelFile)} (${(fileSize / 1024).toFixed(1)} KB)`)

    // Clean up
    setTimeout(() => {
      fs.unlink(excelFile, err => {
        if (err) console.error('Failed to delete temp file:', err)
      })
    }, 1000)

  } catch (err) {
    console.error('❌ Error:', err.message)
    process.exit(1)
  }
}

if (require.main === module) {
  sendExcelToTelegram()
}

module.exports = { sendExcelToTelegram }
