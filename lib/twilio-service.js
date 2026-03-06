const twilio = require('twilio')

const smsExplicitlyDisabled =
  process.env.DISABLE_SMS_SENDING === 'true' || process.env.SMS_ENABLED === 'false'
const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim()
const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim()
const fromPhoneNumber = process.env.TWILIO_PHONE_NUMBER?.trim()

const REFERRAL_PROGRAM_SMS_TEMPLATE = [
  '✨ New Referral Program at Zorina! ✨',
  '',
  '[Name],',
  '',
  '✨ You can now earn a referral discount — for you and your friend! ✨',
  '',
  'Share your personal link, give your friend $10 off her first visit, and once she comes in, you receive $10 on your account too 🤍',
  '',
  'Follow the link below to see your code and full details ✨',
  '',
  '[referral_url]'
].join('\n')

const hasSender = Boolean(messagingServiceSid || fromPhoneNumber)
const hasCredentials = Boolean(accountSid && authToken)
const smsReady = !smsExplicitlyDisabled && hasSender && hasCredentials

let twilioClient = null
if (smsReady) {
  twilioClient = twilio(accountSid, authToken)
} else {
  console.log('ℹ️ Twilio SMS sending not fully configured. Set TWILIO_* env vars and SMS_ENABLED.')
}

const PLACEHOLDER_VARIANTS = [
  /\[name\]/gi,
  /\{name\}/gi,
  /\[customer name\]/gi,
  /\{customer name\}/gi
]
const URL_PLACEHOLDER_VARIANTS = [
  /\[referral_url\]/gi,
  /\{referral_url\}/gi,
  /\[referral url\]/gi,
  /\{referral url\}/gi
]

const OPT_OUT_FOOTER = 'Reply STOP to opt out'

function normalizePhone(to) {
  if (!to) return null
  const trimmed = to.toString().trim()
  if (!trimmed) return null
  if (!trimmed.startsWith('+')) {
    console.warn(`⚠️ Phone number ${trimmed} is not in E.164 format`)
  }
  return trimmed
}

function ensureOptOut(body) {
  if (!body) return null
  const normalized = body.trim()
  if (!normalized) return null
  if (normalized.toLowerCase().includes('reply stop')) {
    return normalized
  }
  return `${normalized} ${OPT_OUT_FOOTER}`
}

function applyPlaceholders(template, { name, referralUrl }) {
  if (!template) return null
  let body = template
  const safeName = name?.toString().trim() || 'friend'
  const safeUrl = referralUrl?.toString().trim() || ''

  PLACEHOLDER_VARIANTS.forEach((pattern) => {
    body = body.replace(pattern, safeName)
  })
  URL_PLACEHOLDER_VARIANTS.forEach((pattern) => {
    body = body.replace(pattern, safeUrl)
  })
  return body
}

function buildDefaultReferralBody({ name, referralUrl }) {
  const safeName = name?.toString().trim() || 'friend'
  const safeUrl = referralUrl?.toString().trim() || ''
  const base = `Zorina Referral ✨ ${safeName}, share your link: friend gets $10 off first visit, you get $10 after. Your code: ${safeUrl}`
  return base
}

function resolveReferralMessage({ name, referralUrl, body }) {
  if (body && body.trim().length > 0) {
    const templated = applyPlaceholders(body, { name, referralUrl })
    return ensureOptOut(templated)
  }
  const defaultBody = buildDefaultReferralBody({ name, referralUrl })
  return ensureOptOut(defaultBody)
}

async function sendReferralCodeSms({
  to,
  name,
  referralUrl,
  body,
  customerId,
  referrerCustomerId,
  referralEventId,
  templateType,
  metadata,
  organizationId
}) {
  const normalizedTo = normalizePhone(to)
  if (!normalizedTo) {
    console.log('⚠️ SMS skipped – destination phone is missing')
    return { success: false, skipped: true, reason: 'missing-phone' }
  }

  if (!smsReady || !twilioClient) {
    console.log(`ℹ️ SMS sending disabled. Would send referral link to ${normalizedTo}`)
    return { success: true, skipped: true, reason: 'sms-disabled' }
  }

  const messageBody = resolveReferralMessage({ name, referralUrl, body })
  if (!messageBody) {
    return { success: false, skipped: true, reason: 'empty-body' }
  }

  try {
    const payload = {
      to: normalizedTo,
      body: messageBody
    }

    if (messagingServiceSid) {
      payload.messagingServiceSid = messagingServiceSid
    } else if (fromPhoneNumber) {
      payload.from = fromPhoneNumber
    }

    const result = await twilioClient.messages.create(payload)
    console.log(`📲 SMS sent to ${normalizedTo} (sid: ${result.sid})`)

    return { success: true, sid: result.sid }
  } catch (error) {
    console.error(`❌ Failed to send SMS to ${normalizedTo}:`, error.message)
    if (error?.code) {
      console.error(`   Twilio error code: ${error.code}`)
    }

    return { success: false, error: error.message, code: error.code }
  }
}

/**
 * Send Gift Card details via SMS (Fallback when email is missing)
 */
async function sendGiftCardSmsNotification({
  to,
  customerName,
  giftCardGan,
  amountCents,
  activationUrl,
  organizationId,
  customerId
}) {
  const normalizedTo = normalizePhone(to)
  if (!normalizedTo) {
    console.log('⚠️ SMS skipped – destination phone is missing')
    return { success: false, skipped: true, reason: 'missing-phone' }
  }

  if (!smsReady || !twilioClient) {
    console.log(`ℹ️ SMS sending disabled. Would send gift card ${giftCardGan} to ${normalizedTo}`)
    return { success: true, skipped: true, reason: 'sms-disabled' }
  }

  const amount = ((amountCents || 0) / 100).toFixed(2)
  const messageBody = `✨ Your $${amount} Zorina reward is ready! Use card: ${giftCardGan} at checkout. View details: ${activationUrl || 'studiozorina.com'} 🤍 Reply STOP to opt out`

  try {
    const payload = {
      to: normalizedTo,
      body: messageBody
    }

    if (messagingServiceSid) {
      payload.messagingServiceSid = messagingServiceSid
    } else if (fromPhoneNumber) {
      payload.from = fromPhoneNumber
    }

    const result = await twilioClient.messages.create(payload)
    console.log(`📲 Gift card SMS sent to ${normalizedTo} (sid: ${result.sid})`)

    return { success: true, sid: result.sid }
  } catch (error) {
    console.error(`❌ Failed to send gift card SMS to ${normalizedTo}:`, error.message)
    return { success: false, error: error.message, code: error.code }
  }
}

/**
 * Send verification code SMS (for phone verification in lookup page)
 */
async function sendVerificationCodeSms({ to, code }) {
  const normalizedTo = normalizePhone(to)
  if (!normalizedTo) {
    console.log('⚠️ SMS skipped – destination phone is missing')
    return { success: false, skipped: true, reason: 'missing-phone' }
  }

  if (!smsReady || !twilioClient) {
    console.log(`ℹ️ SMS sending disabled. Would send verification code to ${normalizedTo}`)
    return { success: true, skipped: true, reason: 'sms-disabled' }
  }

  const messageBody = `Your Zorina verification code is: ${code}. This code expires in 10 minutes. ${OPT_OUT_FOOTER}`

  try {
    const payload = {
      to: normalizedTo,
      body: messageBody
    }

    if (messagingServiceSid) {
      payload.messagingServiceSid = messagingServiceSid
    } else if (fromPhoneNumber) {
      payload.from = fromPhoneNumber
    }

    const result = await twilioClient.messages.create(payload)
    console.log(`📲 Verification SMS sent to ${normalizedTo} (sid: ${result.sid})`)

    return { success: true, sid: result.sid }
  } catch (error) {
    console.error(`❌ Failed to send verification SMS to ${normalizedTo}:`, error.message)
    if (error?.code) {
      console.error(`   Twilio error code: ${error.code}`)
    }

    return { success: false, error: error.message, code: error.code }
  }
}

module.exports = {
  sendReferralCodeSms,
  sendGiftCardSmsNotification,
  sendVerificationCodeSms,
  REFERRAL_PROGRAM_SMS_TEMPLATE
}

