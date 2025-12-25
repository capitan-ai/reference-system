const sgMail = require('@sendgrid/mail')
const {
  recordNotificationEvent,
  NotificationChannel,
  NotificationStatus,
  NotificationTemplateType
} = require('./analytics-service')

const REFERRAL_SUPPRESSION_GROUP_ID = Number(process.env.SENDGRID_REFERRAL_GROUP_ID || 28008)
const REFERRAL_TEMPLATE_ID = process.env.SENDGRID_TEMPLATE_REFERRAL?.trim()
const ACTIVATION_REFERRER_TEMPLATE_ID = process.env.SENDGRID_TEMPLATE_ACTIVATION_REFERRER?.trim()
const ACTIVATION_FRIEND_TEMPLATE_ID = process.env.SENDGRID_TEMPLATE_ACTIVATION_NEW?.trim()

// SendGrid Configuration
const initSendGrid = () => {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('⚠️ SENDGRID_API_KEY not configured')
    return false
  }
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)
  return true
}

const formatUsd = (amountCents) => {
  if (!Number.isFinite(amountCents)) return '$0.00'
  return `$${(amountCents / 100).toFixed(2)}`
}

// Email template matching referral page design
const emailTemplates = {
  referralCode: (customerName, referralCode, referralUrl) => ({
      subject: '🥰💅🏼 Zorina Nail Studio Referral Code',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Referral Code</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            line-height: 1.6; 
            color: #333; 
            background-color: #F2EBDD;
          }
          .email-container {
            max-width: 700px;
            margin: 0 auto;
            background-color: #F2EBDD;
            padding: 0;
          }
          .content-wrapper {
            background-color: #F2EBDD;
            padding: 10px;
            width: 100%;
          }
          .header {
            text-align: center;
            padding: 20px 0;
          }
          .logo-container {
            margin-bottom: 20px;
          }
          .logo {
            max-width: 200px;
            height: auto;
          }
          .welcome-section {
            text-align: center;
            margin-bottom: 30px;
            padding: 0 10px;
          }
          .welcome-title {
            font-size: 1.75rem;
            color: #333;
            font-weight: 500;
            margin-bottom: 1rem;
            line-height: 1.3;
          }
          .welcome-text {
            font-size: 1rem;
            color: #333;
            line-height: 1.6;
            font-weight: 400;
            margin-bottom: 20px;
          }
          .main-message {
            background: white;
            border: 2px solid #5C6B50;
            border-radius: 12px;
            padding: 30px;
            margin-bottom: 30px;
            text-align: center;
            width: 100%;
            box-sizing: border-box;
          }
          .main-message h2 {
            font-size: 1.5rem;
            color: #333;
            margin-bottom: 15px;
            font-weight: 500;
          }
          .main-message p {
            font-size: 1rem;
            color: #333;
            line-height: 1.8;
            margin-bottom: 15px;
          }
          .referral-box {
            background: white;
            border: 2px solid #5C6B50;
            border-radius: 12px;
            padding: 25px;
            margin: 30px 0;
            text-align: center;
            width: 100%;
            box-sizing: border-box;
          }
          .referral-box-title {
            font-size: 13px;
            color: #333;
            margin-bottom: 15px;
            font-weight: 500;
          }
          .referral-code {
            background: #5C6B50;
            color: white;
            padding: 15px;
            border-radius: 8px;
            font-size: 1.2rem;
            font-weight: 600;
            letter-spacing: 2px;
            margin-bottom: 15px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          }
          .referral-url {
            background: #f9f9f9;
            border: 1px solid #5C6B50;
            border-radius: 8px;
            padding: 15px;
            margin: 15px 0;
            word-break: break-all;
            font-size: 16px;
            color: #5C6B50;
            font-weight: 500;
          }
          .referral-url a {
            color: #5C6B50;
            text-decoration: none;
          }
          .how-it-works {
            background: white;
            border: 2px solid #5C6B50;
            border-radius: 12px;
            padding: 25px;
            margin: 30px 0;
          }
          .how-it-works h3 {
            font-size: 1.1rem;
            color: #333;
            margin-bottom: 20px;
            font-weight: 500;
            text-align: center;
          }
          .steps {
            width: 100%;
            display: block;
          }
          .step {
            display: flex;
            align-items: flex-start;
            border: 1.5px solid #5C6B50;
            border-radius: 12px;
            box-shadow: 0 3px 8px rgba(92, 107, 80, 0.05);
            background: #fff;
            padding: 12px 16px;
            margin-bottom: 15px;
            width: 100%;
            box-sizing: border-box;
          }
          .step-dot {
            color: #5C6B50;
            font-weight: 700;
            font-size: 1.4rem;
            margin-right: 12px;
            line-height: 1;
          }
          .button-link {
            display: inline-block;
            background: #5C6B50;
            color: white;
            padding: 15px 30px;
            border-radius: 8px;
            font-size: 0.9rem;
            font-weight: 600;
            text-decoration: none;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            margin: 20px 0;
          }
          .footer {
            text-align: center;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #5C6B50;
            color: #666;
            font-size: 12px;
          }
          /* Mobile responsive styles - using fixed pixels for stability */
          @media only screen and (max-width: 600px) {
            body { 
              background-color: #F2EBDD !important;
              -webkit-text-size-adjust: 100%;
              -ms-text-size-adjust: 100%;
            }
            table[role="presentation"] { 
              width: 100% !important;
              max-width: 100% !important;
            }
            /* Inner table with fixed 700px width */
            table[role="presentation"] table[role="presentation"] {
              width: 700px !important;
              max-width: 700px !important;
            }
            td[align="center"] { 
              padding: 10px !important;
            }
            .content-wrapper { 
              padding: 10px !important;
              width: 100% !important;
            }
            /* Make all boxes wider on mobile */
            .main-message,
            div[style*="background: white"][style*="border: 2px solid #5C6B50"],
            .referral-box {
              width: 100% !important;
              box-sizing: border-box !important;
            }
            /* Logo - smaller for mobile */
            img[alt="Zorina Nail Studio"] {
              height: 120px !important;
              width: 220px !important;
              max-width: 220px !important;
            }
            /* Welcome section - smaller for mobile */
            h1 { 
              font-size: 16px !important;
              line-height: 1.3 !important;
              margin-bottom: 8px !important;
            }
            /* Main message box */
            .main-message,
            div[style*="background: white"][style*="border: 2px solid #5C6B50"] {
              padding: 15px 10px !important;
              margin-bottom: 18px !important;
            }
            /* Heading in main message */
            h2 {
              font-size: 13px !important;
              line-height: 1.4 !important;
              margin-bottom: 8px !important;
            }
            /* Paragraph text */
            p {
              font-size: 12px !important;
              line-height: 1.5 !important;
              margin-bottom: 8px !important;
            }
            /* Referral box */
            .referral-box {
              padding: 20px 15px !important;
            }
            /* Referral code display */
            .referral-code {
              font-size: 12px !important;
              padding: 8px !important;
              letter-spacing: 1px !important;
            }
            /* Referral URL */
            .referral-url {
              font-size: 10px !important;
              padding: 8px !important;
              word-break: break-all !important;
            }
            /* Button */
            .button-link {
              padding: 8px 16px !important;
              font-size: 10px !important;
            }
            /* Steps */
            .step-text {
              font-size: 12px !important;
              line-height: 1.4 !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="content-wrapper">
            <!-- Logo Section -->
            <div style="text-align: center; padding: 0; margin: 0 0 5px 0;">
              <img src="https://referral-system-salon.vercel.app/logo.png" alt="Zorina Nail Studio" style="height: 150px; width: 260px; max-width: 260px; object-fit: cover; object-position: center; display: block; margin: 0 auto; padding: 0;" />
            </div>

            <!-- Welcome Section -->
            <div style="text-align: center; margin-bottom: 25px; padding: 0 10px;">
              <h1 style="font-size: 18px; color: #333; font-weight: 500; margin-bottom: 12px; line-height: 1.3; margin-top: 0; padding: 0;">Hi ${customerName || 'Valued Customer'}! 👋</h1>
              <p style="font-size: 13px; color: #333; line-height: 1.6; font-weight: 400; margin-bottom: 12px; margin-top: 0; padding: 0;">🤍 Thank you for being a valued customer at Zorina Nail Studio!</p>
            </div>

            <!-- Main Message -->
            <div style="background: white; border: 2px solid #5C6B50; border-radius: 12px; padding: 25px; margin-bottom: 25px; text-align: center; width: 100%; box-sizing: border-box;">
              <h2 style="font-size: 14px; color: #333; margin-bottom: 10px; font-weight: 500; margin-top: 0; padding: 0; line-height: 1.4;">Zorina Nail Studio Referral Code</h2>
              <p style="font-size: 12px; color: #333; line-height: 1.5; margin-bottom: 10px; margin-top: 0; padding: 0;">When your friend visits us for the first time using your referral link or code, they'll receive $10 off their service, and you'll get $10 off your next appointment too!</p>
              <p style="font-size: 12px; color: #333; line-height: 1.5; margin-bottom: 10px; margin-top: 0; padding: 0;">🤍 It's our little way to say thank you for spreading the love.</p>
              <p style="font-size: 12px; color: #333; line-height: 1.5; margin-bottom: 10px; margin-top: 0; padding: 0;"><strong>There's no limit — invite as many friends as you like!</strong></p>
            </div>

            <!-- Referral Information Box -->
            <div class="referral-box" style="width: 100%; box-sizing: border-box; padding: 18px 22px;">
              <div class="referral-box-title">🥰💅🏼 Your Personalized Referral Information</div>
              
              <div style="margin-bottom: 14px;">
                <div style="font-size: 11px; color: #666; margin-bottom: 6px; padding: 0; margin-top: 0;">Your Referral Code:</div>
                <div class="referral-code" style="background: #5C6B50; color: white; padding: 12px; border-radius: 10px; font-size: 14px; font-weight: 600; letter-spacing: 2px; margin-bottom: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; width: 100%; box-sizing: border-box;">${referralCode}</div>
              </div>

              <div style="margin-bottom: 16px;">
                <div style="font-size: 11px; color: #666; margin-bottom: 6px; padding: 0; margin-top: 0;">Your Referral Link:</div>
                <div class="referral-url" style="background: #f9f9f9; border: 1px solid #5C6B50; border-radius: 10px; padding: 12px; font-size: 12px; color: #5C6B50; font-weight: 600; word-break: break-all;">
                  <a href="${referralUrl}" style="color: #5C6B50; text-decoration: none;">${referralUrl}</a>
                </div>
              </div>

              <a href="${referralUrl}?copy=1" class="button-link" style="color: #FFFFFF !important; width: 100%; box-sizing: border-box; display: inline-block; text-align: center;">Copy & Share Your Link</a>
            </div>

            <!-- How It Works -->
            <div class="how-it-works" style="background: white; border: 2px solid #5C6B50; border-radius: 12px; padding: 25px; margin: 30px 0;">
              <h3 style="font-size: 1.1rem; color: #333; margin-bottom: 20px; font-weight: 500; text-align: center; margin-top: 0; padding: 0;">How it works:</h3>
              <div class="steps">
                <div class="step">
                  <div class="step-dot">&#8226;</div>
                  <p class="step-text">Share your unique url with a friend.</p>
                </div>
                <div class="step">
                  <div class="step-dot">&#8226;</div>
                  <p class="step-text">They make their first visit using your link or code.</p>
                </div>
                <div class="step">
                  <div class="step-dot">&#8226;</div>
                  <p class="step-text">You will receive $10 credits automatically when your friend visits us first time.</p>
                </div>
              </div>
            </div>

            <!-- Footer -->
            <div class="footer">
              <p><strong>📍 Zorina Nail Studio</strong></p>
              <p>2266 Union St, San Francisco, CA</p>
              <p>550 Pacific Ave, San Francisco, CA</p>
              <p style="margin-top: 10px;">
                <a href="https://studio-zorina.square.site" style="color: #5C6B50; text-decoration: none;">studio-zorina.square.site</a>
              </p>
              <p style="margin-top: 15px; font-size: 12px; color: #999;">
                This referral code is valid for new customers only. One discount per customer.
              </p>
              <p style="margin-top: 10px; font-size: 12px; color: #999;">
                Prefer not to get referral emails? <a href="<%asm_group_unsubscribe_url%>" style="color: #5C6B50; text-decoration: none;">Unsubscribe here</a>.
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
      🥰💅🏼 Zorina Nail Studio Referral Code

      Hi ${customerName || 'Valued Customer'},

      🤍 Thank you for being a valued customer at Zorina Nail Studio!

      When your friend visits us for the first time using your referral link or code, they'll receive $10 off their service, and you'll get $10 off your next appointment too!

      🤍 It's our little way to say thank you for spreading the love.

      There's no limit — invite as many friends as you like!

      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      🥰💅🏼 Your Personalized Referral Information:

      Your Referral Code: ${referralCode}
      Your Referral Link: ${referralUrl}

      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      How it works:

      • Share your unique url with a friend.
      • They make their first visit using your link or code.
      • You will receive $10 credits automatically when your friend visits us first time.

      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      📍 Zorina Nail Studio
      2266 Union St, San Francisco, CA
      550 Pacific Ave, San Francisco, CA
      studio-zorina.square.site

      This referral code is valid for new customers only. One discount per customer.

      Unsubscribe: <%asm_group_unsubscribe_url%>
    `
  })
}

const stripUndefined = (value) => (value === undefined ? null : value)

emailTemplates.giftCardDelivery = ({
  customerName,
  giftCardGan,
  amountCents,
  balanceCents,
  qrDataUri,
  activationUrl,
  passKitUrl,
  isReminder = false
}) => {
  const amountLabel = formatUsd(amountCents ?? 0)
  const balanceLabel = balanceCents ? formatUsd(balanceCents) : amountLabel
  const heading = isReminder
    ? `Reminder: ${amountLabel} is waiting for you`
    : `Your ${amountLabel} gift card is ready`
  const subject = isReminder
    ? `⏰ Reminder: ${amountLabel} gift card still available`
    : `🎁 ${amountLabel} gift card from Zorina Nail Studio`

  const walletButtonsHtml = []
  const { getReferralBaseUrl } = require('./utils/referral-url')
  const resolvedBaseUrl = getReferralBaseUrl()
  const productionBaseUrl = resolvedBaseUrl.includes('vercel.app')
    ? 'https://zorinastudio-referral.com'
    : resolvedBaseUrl
  const digitalCardUrl = giftCardGan
    ? `${productionBaseUrl}/wallet/digital/${giftCardGan}`
    : activationUrl || null

  if (digitalCardUrl) {
    walletButtonsHtml.push(`
      <a href="${digitalCardUrl}" style="display:inline-block;background:#5C6B50;color:#fff;padding:14px 28px;border-radius:8px;font-weight:600;text-decoration:none;margin:8px 6px;">
        View digital gift card
      </a>
    `)
  }
  
  // Custom Apple Wallet pass (our own implementation)
  // Using official Apple "Add to Wallet" badge style
  const appleWalletBadgeLowResUrl = `${productionBaseUrl}/apple-wallet/US-UK_Add_to_Apple_Wallet_RGB_101421.png?v=3`
  const appleWalletBadgeHiResUrl = `${productionBaseUrl}/apple-wallet/US-UK_Add_to_Apple_Wallet_RGB_101421_2x.png?v=1`

  if (giftCardGan) {
    // Always use production domain for wallet URLs (not preview deployments)
    // This ensures passes work correctly even if APP_BASE_URL points to preview
    const customWalletUrl = `${productionBaseUrl}/api/wallet/pass/${giftCardGan}`
    
    if (process.env.NODE_ENV !== 'test') {
      console.log('🔗 Generating wallet URL:', customWalletUrl)
      console.log('   Base URL:', productionBaseUrl)
      console.log('   GAN:', giftCardGan)
    }
    
    // Official Apple Wallet badge (per marketing guidelines)
    walletButtonsHtml.push(`
      <div style="text-align:center;margin:20px 0;">
        <a href="${customWalletUrl}" style="display:inline-block;text-decoration:none;" target="_blank" rel="noopener">
          <img 
            src="${appleWalletBadgeLowResUrl}" 
            srcset="${appleWalletBadgeLowResUrl} 1x, ${appleWalletBadgeHiResUrl} 2x"
            alt="Add to Apple Wallet" 
            width="200" 
            height="62" 
            style="display:block;margin:0 auto;width:200px;max-width:90%;height:auto;border:0;"
          />
        </a>
      </div>
    `)
  }
  
  const walletButtonsBlock = walletButtonsHtml.length
    ? `<div style="text-align:center;margin:18px 0;">${walletButtonsHtml.join('')}</div>`
    : ''

  const qrBlock = qrDataUri
    ? `
      <div style="text-align:center;margin:24px 0;">
        <img src="${qrDataUri}" alt="Gift card QR code" width="180" height="180" style="width:180px;height:180px;image-rendering:pixelated;border-radius:12px;border:1px solid #E4DCCA;padding:12px;background:#fff;" />
        <p style="font-size:12px;color:#666;margin-top:10px;">Scan this code at checkout</p>
      </div>
    `
    : ''

  const cardNumberBlock = giftCardGan
    ? `
      <div style="background:#f9f9f9;border:1px dashed #5C6B50;border-radius:10px;padding:14px;margin:18px 0;text-align:center;font-family:'SFMono-Regular','Menlo',monospace;font-size:18px;letter-spacing:2px;color:#333;">
        <div style="font-size:12px;letter-spacing:0;color:#4C5B47;margin-bottom:6px;">Gift card number</div>
        ${giftCardGan}
      </div>
    `
    : ''

  const howToUseBlock = `
    <div style="background:#fff;border:2px solid #5C6B50;border-radius:12px;padding:22px;margin:22px 0;">
      <h3 style="margin:0 0 14px 0;font-size:16px;color:#333;font-weight:600;text-align:center;">How to redeem</h3>
      <ul style="margin:0;padding-left:18px;color:#333;font-size:13px;line-height:1.6;">
        <li>Show this email at the studio and we’ll scan the QR code or enter the number.</li>
        <li>You can also book online and apply the card at checkout.</li>
        <li>Balance now: <strong>${balanceLabel}</strong></li>
      </ul>
    </div>
  `

  return {
    subject,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${subject}</title>
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
                      <h1 style="margin:0 0 12px;font-size:22px;font-weight:600;color:#333;text-align:center;">${heading}</h1>
                      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;text-align:center;">Hi ${customerName || 'there'},</p>
                      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;text-align:center;">
                        ${isReminder
                          ? `Just a reminder that your Zorina gift card still has <strong>${amountLabel}</strong> ready to use.`
                          : `Thank you! We’ve added <strong>${amountLabel}</strong> to your Zorina gift card.`}
                      </p>
                      ${cardNumberBlock}
                      ${walletButtonsBlock}
                      ${qrBlock}
                      ${howToUseBlock}
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
    `,
    text: [
      subject,
      '',
      `Hi ${customerName || 'there'},`,
      '',
      isReminder
        ? `This is a friendly reminder that your Zorina gift card still has ${amountLabel} ready to use.`
        : `We've added ${amountLabel} to your Zorina gift card. Thank you for being part of the studio!`,
      '',
      giftCardGan ? `Gift card number: ${giftCardGan}` : null,
      `Balance now: ${balanceLabel}`,
      '',
      'How to redeem:',
      '- Show this email at the studio so we can scan the QR code or enter the number.',
      '- Book online and apply the card at checkout.',
      activationUrl ? `View digital gift card: ${activationUrl}` : null,
      passKitUrl ? `Add to Apple Wallet: ${passKitUrl}` : null,
      '',
      'Zorina Nail Studio',
      '2266 Union St, San Francisco, CA',
      '550 Pacific Ave, San Francisco, CA',
      'studio-zorina.square.site'
    ]
      .filter(Boolean)
      .join('\n')
  }
}

function buildGiftCardEmailPreview(options = {}) {
  return emailTemplates.giftCardDelivery(options)
}

function trackEmailNotification({
  templateType,
  status,
  customerId,
  referrerCustomerId,
  referralEventId,
  templateId,
  metadata,
  errorMessage,
  errorCode,
  externalId
}) {
  return recordNotificationEvent({
    channel: NotificationChannel.EMAIL,
    templateType: templateType || NotificationTemplateType.OTHER,
    status: status || NotificationStatus.sent,
    customerId,
    referrerCustomerId,
    referralEventId,
    templateId,
    metadata,
    errorMessage,
    errorCode,
    externalId,
    sentAt: status === NotificationStatus.sent ? new Date() : undefined
  })
}

// Send referral code email via SendGrid
async function sendReferralCodeEmail(customerName, email, referralCode, referralUrl, options = {}) {
  const {
    customerId,
    referrerCustomerId,
    referralEventId,
    templateId = REFERRAL_TEMPLATE_ID,
    metadata
  } = options || {}

  const baseAnalytics = {
    templateType: NotificationTemplateType.REFERRAL_INVITE,
    customerId,
    referrerCustomerId,
    referralEventId,
    templateId,
    metadata: {
      email,
      referralCode,
      referralUrl,
      ...metadata
    }
  }

  if (process.env.DISABLE_EMAIL_SENDING === 'true' || process.env.EMAIL_ENABLED === 'false') {
    console.log(`⏸️ Email sending is disabled. Would send to ${email} with code ${referralCode}`)
    await trackEmailNotification({
      ...baseAnalytics,
      status: NotificationStatus.sent,
      metadata: { ...baseAnalytics.metadata, simulated: true, reason: 'email-disabled' }
    })
    return { success: true, messageId: 'disabled', skipped: true }
  }
  
  if (!process.env.SENDGRID_API_KEY) {
    console.log(`ℹ️ SendGrid API key not configured. Would send referral code to ${email}: ${referralCode}`)
    console.log(`   Referral URL: ${referralUrl}`)
    console.log(`   To enable email sending, configure SENDGRID_API_KEY environment variable`)
    await trackEmailNotification({
      ...baseAnalytics,
      status: NotificationStatus.sent,
      metadata: { ...baseAnalytics.metadata, simulated: true, reason: 'sendgrid-not-configured' }
    })
    return { success: true, messageId: 'not-configured', skipped: true, reason: 'email-service-not-configured' }
  }

  if (!process.env.FROM_EMAIL) {
    console.log(`⚠️ FROM_EMAIL not configured. Using default sender.`)
  }

  const suppressionGroupId = Number.isFinite(REFERRAL_SUPPRESSION_GROUP_ID)
    ? REFERRAL_SUPPRESSION_GROUP_ID
    : undefined

  try {
    if (!initSendGrid()) {
      throw new Error('SendGrid initialization failed')
    }

    const template = emailTemplates.referralCode(customerName, referralCode, referralUrl)
    
    const msg = {
      to: email,
      from: process.env.FROM_EMAIL || 'info@studiozorina.com',
      subject: template.subject,
      html: template.html,
      text: template.text,
    }
    if (suppressionGroupId) {
      msg.asm = { group_id: suppressionGroupId }
    }

    const result = await sgMail.send(msg)
    const messageId = result[0]?.headers?.['x-message-id'] || 'sent'
    console.log(`✅ Referral email sent to ${email}`)

    await trackEmailNotification({
      ...baseAnalytics,
      status: NotificationStatus.sent,
      externalId: messageId,
      metadata: { ...baseAnalytics.metadata, suppressionGroupId }
    })

    return { success: true, messageId }
  } catch (error) {
    console.error(`❌ Error sending referral email to ${email}:`, error.message)
    if (error.response) {
      console.error('SendGrid error details:', error.response.body)
    }

    await trackEmailNotification({
      ...baseAnalytics,
      status: NotificationStatus.failed,
      errorMessage: error.message,
      errorCode: error.code,
      metadata: { ...baseAnalytics.metadata, suppressionGroupId }
    })
    return { success: false, error: error.message }
  }
}

async function sendGiftCardIssuedEmail(customerName, email, payload, options = {}) {
  const {
    customerId,
    referrerCustomerId,
    referralEventId,
    templateType = NotificationTemplateType.OTHER,
    templateId: templateIdOverride,
    metadata
  } = options || {}

  const templateId =
    templateIdOverride ||
    (payload?.role === 'friend' ? ACTIVATION_FRIEND_TEMPLATE_ID : ACTIVATION_REFERRER_TEMPLATE_ID)

  const baseAnalytics = {
    templateType,
    customerId,
    referrerCustomerId,
    referralEventId,
    templateId,
    metadata: {
      email,
      giftCardGan: payload?.giftCardGan,
      amountCents: payload?.amountCents,
      isReminder: payload?.isReminder,
      ...metadata
    }
  }

  if (!email) {
    console.log('⚠️ No email provided for gift card notification, skipping send.')
    await trackEmailNotification({
      ...baseAnalytics,
      status: NotificationStatus.failed,
      errorMessage: 'missing-email'
    })
    return { success: false, skipped: true, reason: 'missing-email' }
  }

  if (process.env.DISABLE_EMAIL_SENDING === 'true' || process.env.EMAIL_ENABLED === 'false') {
    console.log(`⏸️ Email sending is disabled. Would send gift card email to ${email}`)
    await trackEmailNotification({
      ...baseAnalytics,
      status: NotificationStatus.sent,
      metadata: { ...baseAnalytics.metadata, simulated: true, reason: 'email-disabled' }
    })
    return { success: true, messageId: 'disabled', skipped: true }
  }

  if (!process.env.SENDGRID_API_KEY) {
    console.log(`ℹ️ SendGrid API key not configured. Would send gift card to ${email}`)
    console.log(`   Gift Card GAN: ${payload.giftCardGan}`)
    console.log(`   Amount: $${((payload.amountCents || 0) / 100).toFixed(2)}`)
    if (payload.activationUrl) {
      console.log(`   Activation URL: ${payload.activationUrl}`)
    }
    console.log(`   To enable email sending, configure SENDGRID_API_KEY environment variable`)
    await trackEmailNotification({
      ...baseAnalytics,
      status: NotificationStatus.sent,
      metadata: { ...baseAnalytics.metadata, simulated: true, reason: 'sendgrid-not-configured' }
    })
    return { success: true, messageId: 'not-configured', skipped: true, reason: 'email-service-not-configured' }
  }

  if (!process.env.FROM_EMAIL) {
    console.log(`⚠️ FROM_EMAIL not configured. Using default sender.`)
  }

  try {
    if (!initSendGrid()) {
      throw new Error('SendGrid initialization failed')
    }

    const template = emailTemplates.giftCardDelivery({
      customerName,
      giftCardGan: payload.giftCardGan,
      amountCents: stripUndefined(payload.amountCents),
      balanceCents: stripUndefined(payload.balanceCents),
      qrDataUri: payload.qrDataUri,
      activationUrl: stripUndefined(payload.activationUrl),
      passKitUrl: stripUndefined(payload.passKitUrl),
      isReminder: Boolean(payload.isReminder)
    })

    const msg = {
      to: email,
      from: process.env.FROM_EMAIL || 'info@studiozorina.com',
      subject: template.subject,
      html: template.html,
      text: template.text,
    }

    const result = await sgMail.send(msg)
    const messageId = result[0]?.headers?.['x-message-id'] || 'sent'
    console.log(`✅ Gift card email sent to ${email}`)

    await trackEmailNotification({
      ...baseAnalytics,
      status: NotificationStatus.sent,
      externalId: messageId
    })

    return { success: true, messageId }
  } catch (error) {
    console.error(`❌ Error sending gift card email to ${email}:`, error.message)
    if (error.response) {
      console.error('SendGrid error details:', error.response.body)
    }

    await trackEmailNotification({
      ...baseAnalytics,
      status: NotificationStatus.failed,
      errorMessage: error.message,
      errorCode: error.code
    })
    return { success: false, error: error.message }
  }
}

module.exports = {
  sendReferralCodeEmail,
  sendGiftCardIssuedEmail,
  buildGiftCardEmailPreview
}
