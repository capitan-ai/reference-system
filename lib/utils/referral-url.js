/**
 * Get the base URL for referral links
 * Uses environment variable or falls back to default
 */
function getReferralBaseUrl() {
  // Check for custom domain first
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '') // Remove trailing slash
  }
  
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/$/, '')
  }
  
  // Fallback to Vercel preview URL (for development/testing)
  return 'https://referral-system-salon.vercel.app'
}

/**
 * Generate a referral URL from a referral code
 * @param {string} referralCode - The referral code
 * @returns {string} Full referral URL
 */
function generateReferralUrl(referralCode) {
  const baseUrl = getReferralBaseUrl()
  return `${baseUrl}/ref/${referralCode}`
}

module.exports = {
  getReferralBaseUrl,
  generateReferralUrl
}

