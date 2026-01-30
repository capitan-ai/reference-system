/**
 * Environment Variable Validator
 * Validates all required environment variables are set
 */

const REQUIRED_ENV_VARS = {
  SQUARE_ACCESS_TOKEN: {
    name: 'SQUARE_ACCESS_TOKEN',
    description: 'Square API access token',
    required: true
  },
  SQUARE_LOCATION_ID: {
    name: 'SQUARE_LOCATION_ID',
    description: 'Square location ID',
    required: true
  },
  SQUARE_WEBHOOK_SIGNATURE_KEY: {
    name: 'SQUARE_WEBHOOK_SIGNATURE_KEY',
    description: 'Square webhook signature key for verification',
    required: true
  }
}

const OPTIONAL_ENV_VARS = {
  // Email service configuration (optional - system works without email)
  BUSINESS_EMAIL: {
    name: 'BUSINESS_EMAIL',
    description: 'Business email address for sending emails (optional - email service not configured yet)',
    required: false
  },
  GMAIL_APP_PASSWORD: {
    name: 'GMAIL_APP_PASSWORD',
    description: 'Gmail app password for SMTP authentication (optional - email service not configured yet)',
    required: false
  },
  DISABLE_EMAIL_SENDING: {
    name: 'DISABLE_EMAIL_SENDING',
    description: 'Disable email sending (set to "true" to disable)',
    required: false,
    defaultValue: 'false'
  },
  EMAIL_ENABLED: {
    name: 'EMAIL_ENABLED',
    description: 'Enable email sending (set to "false" to disable)',
    required: false,
    defaultValue: 'true'
  },
  // URL configuration
  NEXT_PUBLIC_APP_URL: {
    name: 'NEXT_PUBLIC_APP_URL',
    description: 'Public app URL (client-side)',
    required: false
  },
  APP_BASE_URL: {
    name: 'APP_BASE_URL',
    description: 'Base URL for server-side operations',
    required: false
  },
  ENABLE_REFERRAL_ANALYTICS: {
    name: 'ENABLE_REFERRAL_ANALYTICS',
    description: 'Enable referral analytics event logging when set to "true"',
    required: false,
    defaultValue: 'false'
  },
  REFERRAL_LOCATION_MAP: {
    name: 'REFERRAL_LOCATION_MAP',
    description: 'Comma-separated mapping of friendly location IDs to Square location IDs (e.g. union=LOC_A,pacific=LOC_B)',
    required: false
  },
  DEFAULT_ANALYTICS_LOCATION_ID: {
    name: 'DEFAULT_ANALYTICS_LOCATION_ID',
    description: 'Fallback friendly location ID when a Square location cannot be mapped',
    required: false
  },
  SQUARE_ENV: {
    name: 'SQUARE_ENV',
    description: 'Square environment (production/sandbox)',
    required: false,
    defaultValue: 'production'
  }
}

/**
 * Validate all required environment variables
 * @returns {Object} { valid: boolean, missing: string[], errors: string[] }
 */
function validateEnvironmentVariables() {
  const missing = []
  const errors = []

  // Check required variables
  for (const [key, config] of Object.entries(REQUIRED_ENV_VARS)) {
    const value = process.env[config.name]?.trim()
    
    if (!value || value.length === 0) {
      missing.push(config.name)
      errors.push(`Missing required environment variable: ${config.name} (${config.description})`)
    }
  }

  // Check that at least one URL variable is set
  const hasNextPublicUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  const hasAppBaseUrl = process.env.APP_BASE_URL?.trim()
  
  if (!hasNextPublicUrl && !hasAppBaseUrl) {
    errors.push('Missing URL configuration: Either NEXT_PUBLIC_APP_URL or APP_BASE_URL must be set')
  }

  return {
    valid: missing.length === 0 && errors.length === 0,
    missing,
    errors
  }
}

/**
 * Get validation status with details
 * @returns {Object} Detailed validation status
 */
function getValidationStatus() {
  const validation = validateEnvironmentVariables()
  const status = {
    valid: validation.valid,
    timestamp: new Date().toISOString(),
    required: {},
    optional: {},
    errors: validation.errors
  }

  // Check required variables
  for (const [key, config] of Object.entries(REQUIRED_ENV_VARS)) {
    const value = process.env[config.name]?.trim()
    status.required[config.name] = {
      set: !!value && value.length > 0,
      description: config.description,
      value: value ? `${value.substring(0, 10)}...` : null // Show first 10 chars only
    }
  }

  // Check optional variables
  for (const [key, config] of Object.entries(OPTIONAL_ENV_VARS)) {
    const value = process.env[config.name]?.trim()
    status.optional[config.name] = {
      set: !!value && value.length > 0,
      description: config.description,
      value: value || config.defaultValue || null
    }
  }

  // Check URL configuration
  status.url = {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL?.trim() || null,
    APP_BASE_URL: process.env.APP_BASE_URL?.trim() || null,
    configured: !!(process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_BASE_URL?.trim())
  }

  return status
}

/**
 * Validate and throw error if invalid (for startup validation)
 * @throws {Error} If validation fails
 */
function validateOrThrow() {
  const validation = validateEnvironmentVariables()
  
  if (!validation.valid) {
    const errorMessage = [
      'Environment variable validation failed:',
      ...validation.errors
    ].join('\n')
    
    throw new Error(errorMessage)
  }
}

module.exports = {
  validateEnvironmentVariables,
  getValidationStatus,
  validateOrThrow,
  REQUIRED_ENV_VARS,
  OPTIONAL_ENV_VARS
}

