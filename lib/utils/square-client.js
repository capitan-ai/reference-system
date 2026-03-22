const { Client, Environment, WebhooksHelper } = require('square')
const { getSquareEnvironmentName } = require('./square-env')

let squareClientInstance = null

/**
 * Get a singleton Square Client instance
 * @returns {Client} Square Client
 */
function getSquareClient() {
  if (squareClientInstance) return squareClientInstance

  const squareEnvName = getSquareEnvironmentName()
  const resolvedEnvironment = squareEnvName === 'sandbox' ? Environment.Sandbox : Environment.Production
  
  let accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()
  if (accessToken && accessToken.startsWith('Bearer ')) {
    accessToken = accessToken.slice(7)
  }

  if (!accessToken) {
    console.error('[square] ⚠️ SQUARE_ACCESS_TOKEN is not set')
  }

  squareClientInstance = new Client({
    accessToken: accessToken,
    environment: resolvedEnvironment,
  })

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[square] Initialized Square client for ${squareEnvName} environment`)
  }

  return squareClientInstance
}

/**
 * Get Square WebhooksHelper
 */
const getWebhooksHelper = () => WebhooksHelper

/**
 * Get specific Square APIs
 */
const getCustomersApi = () => getSquareClient().customersApi
const getGiftCardsApi = () => getSquareClient().giftCardsApi
const getGiftCardActivitiesApi = () => getSquareClient().giftCardActivitiesApi
const getCustomerCustomAttributesApi = () => getSquareClient().customerCustomAttributesApi
const getBookingCustomAttributesApi = () => getSquareClient().bookingCustomAttributesApi
const getOrdersApi = () => getSquareClient().ordersApi
const getPaymentsApi = () => getSquareClient().paymentsApi
const getLocationsApi = () => getSquareClient().locationsApi
const getBookingsApi = () => getSquareClient().bookingsApi

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

