import fs from 'fs'
import path from 'path'

function hasValue(name) {
  return Boolean(process.env[name]?.toString().trim())
}

function resolvePassJson() {
  const candidates = [
    process.env.APPLE_WALLET_ASSET_PATH,
    path.join(process.cwd(), 'assets', 'apple-wallet'),
    path.join(process.cwd(), 'lib', 'wallet', 'pass-template'),
  ]
    .filter(Boolean)
    .map((dir) => path.join(dir, 'pass.json'))

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return { exists: true, candidate }
      }
    } catch (_error) {
      // ignore
    }
  }
  return { exists: false, candidate: candidates[0] || null }
}

function getWalletBaseUrl() {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || 'https://referral-system-salon.vercel.app'
  const normalized = base.replace(/\/$/, '')
  if (normalized.includes('vercel.app')) {
    return 'https://zorinastudio-referral.com'
  }
  return normalized
}

function computeWalletHealth() {
  const passTypeId = hasValue('APPLE_PASS_TYPE_ID')
  const teamId = hasValue('APPLE_PASS_TEAM_ID')

  const certPem = hasValue('APPLE_PASS_CERTIFICATE_PEM_BASE64')
  const keyPem = hasValue('APPLE_PASS_KEY_PEM_BASE64')
  const wwdrBase64 = hasValue('APPLE_WWDR_CERTIFICATE_BASE64')
  const wwdrPath = hasValue('APPLE_WWDR_CERTIFICATE_PATH') || hasValue('APPLE_WWDR_CERTIFICATE_ABSOLUTE_PATH')

  const certP12Base64 = hasValue('APPLE_PASS_CERTIFICATE_BASE64')
  const certP12Path = hasValue('APPLE_PASS_CERTIFICATE_PATH') || hasValue('APPLE_PASS_CERTIFICATE_ABSOLUTE_PATH')

  const hasPem = certPem && keyPem && (wwdrBase64 || wwdrPath)
  const hasP12 = (certP12Base64 || certP12Path) && (wwdrBase64 || wwdrPath)

  const missing = []
  if (!passTypeId) missing.push('APPLE_PASS_TYPE_ID')
  if (!teamId) missing.push('APPLE_PASS_TEAM_ID')
  if (!hasPem && !hasP12) {
    if (!certPem) missing.push('APPLE_PASS_CERTIFICATE_PEM_BASE64')
    if (!keyPem) missing.push('APPLE_PASS_KEY_PEM_BASE64')
    if (!certP12Base64 && !certP12Path) missing.push('APPLE_PASS_CERTIFICATE_BASE64 or APPLE_PASS_CERTIFICATE_PATH')
    if (!wwdrBase64 && !wwdrPath) missing.push('APPLE_WWDR_CERTIFICATE_BASE64 or APPLE_WWDR_CERTIFICATE_PATH')
  }

  const passJson = resolvePassJson()
  if (!passJson.exists) {
    missing.push('pass-template/pass.json')
  }

  const certMode = hasPem ? 'pem' : hasP12 ? 'p12' : 'missing'
  const baseUrl = getWalletBaseUrl()

  return {
    ok: missing.length === 0,
    baseUrl,
    certMode,
    missing,
    template: {
      passJsonExists: passJson.exists,
    },
  }
}

export async function GET() {
  const health = computeWalletHealth()
  return Response.json(
    {
      status: health.ok ? 'ok' : 'degraded',
      wallet: health,
    },
    { status: health.ok ? 200 : 200 },
  )
}


