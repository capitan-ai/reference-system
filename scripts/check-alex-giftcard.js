/**
 * Check Alex Robertson's gift card actual state in Square API
 * Uses direct fetch (square SDK was hanging)
 */
process.stdout.write('Starting...\n')
require('dotenv').config({ path: '.env.local' })
require('dotenv').config({ path: '.env' })
const dotenv = require('dotenv')
const envFile = dotenv.config({ path: '.env' })
if (envFile.parsed?.SQUARE_ACCESS_TOKEN) {
  process.env.SQUARE_ACCESS_TOKEN = envFile.parsed.SQUARE_ACCESS_TOKEN
}

const ALEX_GIFT_CARD_ID = 'gftc:3b0621d6a5e24269aee6084c78542e8a'
const SQUARE_API = 'https://connect.squareup.com/v2'

async function main() {
  let accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()
  if (accessToken?.startsWith('Bearer ')) accessToken = accessToken.slice(7)
  process.stdout.write(`Token len: ${accessToken?.length}\n`)

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Square-Version': '2024-04-17',
  }

  process.stdout.write(`\nFetching gift card...\n`)
  const cardRes = await fetch(`${SQUARE_API}/gift-cards/${encodeURIComponent(ALEX_GIFT_CARD_ID)}`, { headers })
  const cardJson = await cardRes.json()
  if (!cardJson.gift_card) {
    process.stdout.write(`Error: ${JSON.stringify(cardJson)}\n`)
    return
  }
  const gc = cardJson.gift_card
  process.stdout.write(`State: ${gc.state}\n`)
  process.stdout.write(`GAN: ${gc.gan}\n`)
  process.stdout.write(`Balance: $${(Number(gc.balance_money?.amount || 0) / 100).toFixed(2)}\n`)
  process.stdout.write(`Customer IDs: ${(gc.customer_ids || []).join(', ')}\n`)

  process.stdout.write(`\nActivities:\n`)
  const actRes = await fetch(
    `${SQUARE_API}/gift-cards/activities?gift_card_id=${encodeURIComponent(ALEX_GIFT_CARD_ID)}`,
    { headers }
  )
  const actJson = await actRes.json()
  const activities = (actJson.gift_card_activities || []).sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  )
  if (activities.length === 0) process.stdout.write('  (none)\n')
  for (const act of activities) {
    const bal = Number(act.gift_card_balance_money?.amount || 0)
    process.stdout.write(`  ${act.created_at} | ${act.type.padEnd(20)} | balance: $${(bal / 100).toFixed(2)}\n`)
  }
  process.stdout.write('Done.\n')
}

main().then(() => process.exit(0)).catch((err) => {
  process.stderr.write(`Error: ${err.message}\n${err.stack}\n`)
  process.exit(1)
})
