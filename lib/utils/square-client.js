const { SquareClient, SquareEnvironment, WebhooksHelper } = require('square')
const { getSquareEnvironmentName } = require('./square-env')

let squareClientInstance = null

/**
 * Get a singleton Square Client instance (v44+ SDK)
 * @returns {SquareClient} Square Client
 */
function getSquareClient() {
  if (squareClientInstance) return squareClientInstance

  const squareEnvName = getSquareEnvironmentName()
  const resolvedEnvironment = squareEnvName === 'sandbox' ? SquareEnvironment.Sandbox : SquareEnvironment.Production

  let accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()
  if (accessToken && accessToken.startsWith('Bearer ')) {
    accessToken = accessToken.slice(7)
  }

  if (!accessToken) {
    console.error('[square] ⚠️ SQUARE_ACCESS_TOKEN is not set')
  }

  squareClientInstance = new SquareClient({
    token: accessToken,
    environment: resolvedEnvironment,
  })

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[square] Initialized Square client (v44) for ${squareEnvName} environment`)
  }

  return squareClientInstance
}

/**
 * Get Square WebhooksHelper
 */
const getWebhooksHelper = () => WebhooksHelper

/**
 * Get specific Square API resources (v44 style: client.resource)
 */
const getCustomersApi = () => getSquareClient().customers
const getGiftCardsApi = () => getSquareClient().giftCards
const getGiftCardActivitiesApi = () => getSquareClient().giftCards // v44: activities accessed via giftCards sub-resource
const getCustomerCustomAttributesApi = () => getSquareClient().customers.customAttributes
const getBookingCustomAttributesApi = () => getSquareClient().bookings.customAttributes
const getOrdersApi = () => getSquareClient().orders
const getPaymentsApi = () => getSquareClient().payments
const getLocationsApi = () => getSquareClient().locations
const getBookingsApi = () => getSquareClient().bookings

module.exports = {
  getSquareClient,
  getWebhooksHelper,
  getCustomersApi,
  getGiftCardsApi,
  getGiftCardActivitiesApi,
  getCustomerCustomAttributesApi,
  getBookingCustomAttributesApi,
  getOrdersApi,
  getPaymentsApi,
  getLocationsApi,
  getBookingsApi
}

