#!/usr/bin/env node
require('dotenv').config()
const { Client, Environment } = require('square')

const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production
})

async function findAbyBooking() {
  try {
    console.log('🔍 Searching for Aby\'s recent bookings...')
    
    // Search for customers with "aby" or similar
    const { result } = await client.customersApi.searchCustomers({
      query: {
        filter: {
          emailAddress: {
            exact: 'aby@example.com' // We need to know Aby's email
          }
        }
      }
    })
    
    console.log('Results:', JSON.stringify(result, null, 2))
    
    // Or search by name
    const { result: nameResult } = await client.customersApi.searchCustomers({
      query: {
        filter: {
          familyName: {
            exact: 'aby'
          }
        }
      }
    })
    
    console.log('By name:', JSON.stringify(nameResult, null, 2))
    
  } catch (error) {
    console.error('Error:', error.message)
  }
}

// Better: search recent bookings
async function findRecentBookings() {
  try {
    console.log('🔍 Searching for recent bookings...')
    
    const { result } = await client.bookingsApi.searchBookings({
      query: {
        filter: {
          startAt: {
            startAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // Last 24 hours
          }
        }
      },
      limit: 10
    })
    
    console.log('\n📅 Recent bookings (last 24 hours):')
    console.log(JSON.stringify(result, null, 2))
    
  } catch (error) {
    console.error('Error:', error.message)
    console.error(error.response?.body || error.stack)
  }
}

findRecentBookings()
