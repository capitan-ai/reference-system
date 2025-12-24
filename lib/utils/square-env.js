const DEFAULT_ENV = 'production'

function getSquareEnvironmentName() {
  const raw =
    process.env.SQUARE_ENVIRONMENT ||
    process.env.SQUARE_ENV ||
    process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT

  if (!raw) {
    return DEFAULT_ENV
  }

  const normalized = raw.trim().toLowerCase()
  return normalized === 'sandbox' ? 'sandbox' : DEFAULT_ENV
}

module.exports = {
  getSquareEnvironmentName
}


