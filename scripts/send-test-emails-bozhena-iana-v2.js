#!/usr/bin/env node

// Send test emails to Bozhena V and Iana Zorina with their actual referral codes
require('dotenv').config()

const { PrismaClient } = require('@prisma/client')
const nodemailer = require('nodemailer')
const QRCode = require('qrcode')

// Test email credentials
const TEST_EMAIL = 'rakhimbekova1112@gmail.com'
const TEST_EMAIL_PASSWORD = 'vwmfyatavrfjoozu'

const prisma = new PrismaClient()

const CUSTOMERS = [
  {
    name: 'Iana Zorina',
    email: 'yana@studiozorina.com',
    squareId: '70WNH5QYS71S32NG7Z77YW4DA8'
  },
  {
    name: 'Bozhena V',
    email: 'Goddbbaby@gmail.com',
    squareId: 'BG84AFYW767H4Y3XZB8S8P8ME4'
  }
]

const formatUsd = (amountCents) => {
  if (!Number.isFinite(amountCents)) return '$0.00'
  return `$${(amountCents / 100).toFixed(2)}`
}

async function sendEmails() {
  try {
    console.log('📧 Sending test emails to Bozhena V and Iana Zorina (with actual referral codes)')
    console.log('='.repeat(60))
    console.log('')
    
    // Create transporter with test email
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: TEST_EMAIL,
        pass: TEST_EMAIL_PASSWORD
      }
    })
    
    for (const customerInfo of CUSTOMERS) {
      console.log(`\n📬 Processing: ${customerInfo.name}`)
      console.log(`   Email: ${customerInfo.email}`)
      console.log(`   Square ID: ${customerInfo.squareId}`)
      
      // Get customer from database with referral links
      const customer = await prisma.customer.findUnique({
        where: {
          squareCustomerId: customerInfo.squareId
        },
        include: {
          RefLinks: {
            where: {
              status: 'ACTIVE'
            }
          }
        }
      })
      
      if (!customer) {
        console.log(`   ❌ Customer not found in database`)
        continue
      }
      
      const customerName = customer.fullName || customerInfo.name
      
      // Get referral code
      let referralCode = null
      let referralUrl = null
      
      if (customer.RefLinks.length > 0) {
        referralCode = customer.RefLinks[0].refCode
        referralUrl = customer.RefLinks[0].url
        console.log(`   ✅ Found referral code: ${referralCode}`)
      } else {
        console.log(`   ⚠️  No referral code found`)
        continue
      }
      
      // 1. Send referral code email
      console.log(`\n   1️⃣  Sending referral code email...`)
      try {
        const referralEmailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Your Referral Code</title>
          </head>
          <body style="margin:0;padding:0;background:#F2EBDD;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#333;">
            <div style="max-width:700px;margin:0 auto;background:#F2EBDD;padding:10px;">
              <div style="text-align:center;padding:20px 0;">
                <img src="https://referral-system-salon.vercel.app/logo.png" alt="Zorina Nail Studio" style="height:150px;width:260px;max-width:260px;object-fit:cover;object-position:center;display:block;margin:0 auto;padding:0;" />
              </div>
              <div style="text-align:center;margin-bottom:25px;padding:0 10px;">
                <h1 style="font-size:18px;color:#333;font-weight:500;margin-bottom:12px;">Hi ${customerName}! 👋</h1>
                <p style="font-size:13px;color:#333;line-height:1.6;">Thank you for being a valued customer at Zorina Nail Studio!</p>
              </div>
              <div style="background:white;border:2px solid #5C6B50;border-radius:12px;padding:25px;margin-bottom:25px;text-align:center;">
                <h2 style="font-size:14px;color:#333;margin-bottom:10px;font-weight:500;">💖 Zorina Nail Studio Referral Code</h2>
                <p style="font-size:12px;color:#333;line-height:1.5;margin-bottom:10px;">When your friend visits us for the first time using your referral link or code, they'll receive $10 off their service, and you'll get $10 off your next appointment too!</p>
                <div style="background:#5C6B50;color:white;padding:12px;border-radius:10px;font-size:14px;font-weight:600;letter-spacing:2px;margin:15px 0;font-family:monospace;">${referralCode}</div>
                <a href="${referralUrl}?copy=1" style="display:inline-block;background:#5C6B50;color:white;padding:15px 30px;border-radius:8px;font-size:0.9rem;font-weight:600;text-decoration:none;margin:20px 0;">Copy & Share Your Link</a>
              </div>
            </div>
          </body>
          </html>
        `
        
        await transporter.sendMail({
          from: TEST_EMAIL,
          to: customerInfo.email,
          subject: '💖 Zorina Nail Studio Referral Code',
          html: referralEmailHtml
        })
        
        console.log(`   ✅ Referral code email sent!`)
      } catch (error) {
        console.log(`   ❌ Failed to send referral code email: ${error.message}`)
      }
      
      // 2. Generate QR code for gift card email
      const testGiftCardGan = '7783323035637945'
      console.log(`\n   2️⃣  Generating QR code...`)
      const qrDataUri = await QRCode.toDataURL(`sqgc://${testGiftCardGan}`, {
        margin: 1,
        scale: 4,
        errorCorrectionLevel: 'M'
      })
      console.log(`   ✅ QR code generated`)
      
      // 3. Send gift card email with QR code
      console.log(`\n   3️⃣  Sending gift card email with QR code...`)
      try {
        const amountCents = 1000
        const amountLabel = formatUsd(amountCents)
        
        const giftCardEmailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>🎁 ${amountLabel} gift card from Zorina Nail Studio</title>
          </head>
          <body style="margin:0;padding:0;background:#F2EBDD;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#333;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#F2EBDD;">
              <tr>
                <td align="center" style="padding:20px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;background:#F2EBDD;">
                    <tr>
                      <td style="text-align:center;padding:0 0 18px;">
                        <img src="https://referral-system-salon.vercel.app/logo.png" alt="Zorina Nail Studio" style="height:350px;width:600px;max-width:600px;object-fit:cover;object-position:center;display:block;margin:0 auto;padding:0;" />
                      </td>
                    </tr>
                    <tr>
                      <td style="background:#FFFFFF;border:2px solid #5C6B50;border-radius:14px;padding:28px;">
                        <h1 style="margin:0 0 12px;font-size:22px;font-weight:600;color:#333;text-align:center;">Your ${amountLabel} gift card is ready</h1>
                        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;text-align:center;">Hi ${customerName},</p>
                        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;text-align:center;">
                          Thank you! We've added <strong>${amountLabel}</strong> to your Zorina gift card.
                        </p>
                        <div style="background:#f9f9f9;border:1px dashed #5C6B50;border-radius:10px;padding:14px;margin:18px 0;text-align:center;font-family:'SFMono-Regular','Menlo',monospace;font-size:18px;letter-spacing:2px;color:#333;">
                          ${testGiftCardGan}
                        </div>
                        <div style="text-align:center;margin:18px 0;">
                          <a href="https://squareup.com/gift/activate/test123" style="display:inline-block;background:#5C6B50;color:#fff;padding:14px 28px;border-radius:8px;font-weight:600;text-decoration:none;margin:8px 6px;">
                            View digital gift card
                          </a>
                          <a href="https://squareup.com/gift/passkit/test123" style="display:inline-block;background:#333;color:#fff;padding:14px 28px;border-radius:8px;font-weight:600;text-decoration:none;margin:8px 6px;">
                            Add to Apple Wallet
                          </a>
                        </div>
                        <div style="text-align:center;margin:24px 0;">
                          <img src="${qrDataUri}" alt="Gift card QR code" width="180" height="180" style="width:180px;height:180px;image-rendering:pixelated;border-radius:12px;border:1px solid #E4DCCA;padding:12px;background:#fff;" />
                          <p style="font-size:12px;color:#666;margin-top:10px;">Scan this code at checkout</p>
                        </div>
                        <div style="background:#fff;border:2px solid #5C6B50;border-radius:12px;padding:22px;margin:22px 0;">
                          <h3 style="margin:0 0 14px 0;font-size:16px;color:#333;font-weight:600;text-align:center;">How to redeem</h3>
                          <ul style="margin:0;padding-left:18px;color:#333;font-size:13px;line-height:1.6;">
                            <li>Show this email at the studio and we'll scan the QR code or enter the number.</li>
                            <li>You can also book online and apply the card at checkout.</li>
                            <li>Balance now: <strong>${amountLabel}</strong></li>
                          </ul>
                        </div>
                        <p style="margin:0;font-size:13px;color:#555;text-align:center;">Need help? Reply to this email or call us any time.</p>
                      </td>
                    </tr>
                    <tr>
                      <td style="text-align:center;padding:20px 10px 0;font-size:12px;color:#666;">
                        <strong>Zorina Nail Studio</strong><br />
                        2266 Union St, San Francisco, CA<br />
                        550 Pacific Ave, San Francisco, CA<br />
                        <a href="https://studio-zorina.square.site" style="color:#5C6B50;text-decoration:none;">studio-zorina.square.site</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
          </html>
        `
        
        await transporter.sendMail({
          from: TEST_EMAIL,
          to: customerInfo.email,
          subject: `🎁 ${amountLabel} gift card from Zorina Nail Studio`,
          html: giftCardEmailHtml
        })
        
        console.log(`   ✅ Gift card email sent!`)
      } catch (error) {
        console.log(`   ❌ Failed to send gift card email: ${error.message}`)
      }
      
      console.log(`\n   ✅ Completed for ${customerName}`)
      console.log(`   Referral Code: ${referralCode}`)
      console.log('   ' + '─'.repeat(50))
    }
    
    console.log('\n✅ All emails sent!')
    console.log(`\n📧 Sent from: ${TEST_EMAIL}`)
    console.log('📬 Sent to:')
    CUSTOMERS.forEach(c => {
      console.log(`   - ${c.name}: ${c.email}`)
    })
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

sendEmails()

