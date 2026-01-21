#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const CUSTOMER_ID = '5Q1A2BG073YPWP8G6H0FGQE9VG'

async function check() {
  try {
    const customer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        gift_card_id,
        gift_card_gan,
        gift_card_delivery_channel,
        got_signup_bonus,
        used_referral_code
      FROM square_existing_clients 
      WHERE square_customer_id = ${CUSTOMER_ID}
    `
    
    console.log('Customer Data:')
    console.log(JSON.stringify(customer[0], null, 2))
    
    // Check for notification events
    const notifications = await prisma.$queryRaw`
      SELECT * FROM notification_events 
      WHERE "customerId" = ${CUSTOMER_ID}
      ORDER BY "createdAt" DESC
    `
    
    console.log('\nNotification Events:')
    console.log(notifications.length > 0 ? JSON.stringify(notifications, null, 2) : 'None found')
    
    await prisma.$disconnect()
  } catch (error) {
    console.error('Error:', error.message)
    await prisma.$disconnect()
  }
}

check()


