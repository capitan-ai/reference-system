#!/usr/bin/env node
/**
 * Retrieve order details from Square API using curl
 * Usage: node scripts/get-order-details.js <order_id>
 */

// Load environment variables (same order as working test)
require('dotenv').config()
require('dotenv').config({ path: '.env.local' })

const { execSync } = require('child_process')

const orderId = process.argv[2] || '0cvO8sSQgXWZbOjc9rqu2UreV'
const accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()

if (!accessToken) {
  console.error('❌ SQUARE_ACCESS_TOKEN not found in environment')
  process.exit(1)
}

const url = `https://connect.squareup.com/v2/orders/${orderId}`
const command = `curl -s "${url}" -H "Square-Version: 2025-10-16" -H "Authorization: Bearer ${accessToken.trim()}" -H "Content-Type: application/json"`

try {
  const result = execSync(command, { encoding: 'utf-8', shell: true })
  const json = JSON.parse(result)
  console.log(JSON.stringify(json, null, 2))
} catch (error) {
  if (error.stdout) {
    try {
      const json = JSON.parse(error.stdout)
      console.log(JSON.stringify(json, null, 2))
    } catch (e) {
      console.error('Raw output:', error.stdout)
    }
  } else {
    console.error('Error:', error.message)
  }
  process.exit(1)
}
