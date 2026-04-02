let Client
let Environment

try {
  console.log('🧩 Loading square SDK...')
  const squareModule = require('square/legacy')
  const squareSdk = squareModule?.default || squareModule
  ;({ Client, Environment } = squareSdk)
  console.log('✅ Square SDK loaded')
} catch (error) {
  console.error('💥 Failed to load square SDK:', error)
  throw error
}

const prismaClient = require('../prisma-client')

let squareClient
function getPrisma() {
  return prismaClient
}

function getSquareClient() {
  if (!squareClient) {
    let accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()
    if (accessToken && accessToken.startsWith('Bearer ')) {
      accessToken = accessToken.slice(7)
    }
    squareClient = new Client({
      accessToken: accessToken,
      environment: Environment.Production
    })
  }
  return squareClient
}

function getGiftCardsApi() {
  return getSquareClient().giftCardsApi
}

module.exports = {
  getPrisma,
  getGiftCardsApi
}
