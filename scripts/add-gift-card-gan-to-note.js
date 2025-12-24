#!/usr/bin/env node
require('dotenv').config()
const { Client, Environment } = require('square')

function normalizePhone(input) {
  if (!input) {
    return null
  }
  const cleaned = input.toString().replace(/[\s()-]/g, '')
  if (cleaned.startsWith('+')) {
    return cleaned
  }
  const digitsOnly = cleaned.replace(/\D/g, '')
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return `+${digitsOnly}`
  }
  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`
  }
  if (digitsOnly.length > 0) {
    return `+${digitsOnly}`
  }
  return null
}

async function appendGiftCardGanToNote({ phoneNumber, customerId: explicitCustomerId, noteLabel, ganOverride }) {
  let normalizedPhone = null
  if (phoneNumber) {
    normalizedPhone = normalizePhone(phoneNumber)
    if (!normalizedPhone) {
      throw new Error('Invalid phone number input')
    }
  }

  const squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
    environment: Environment.Production,
  })

  const customersApi = squareClient.customersApi
  const accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()
  if (!accessToken) {
    throw new Error('SQUARE_ACCESS_TOKEN is not configured')
  }

  let customer = null
  let customerId = explicitCustomerId || null

  if (normalizedPhone) {
    const searchResponse = await customersApi.searchCustomers({
      query: {
        filter: {
          phoneNumber: {
            exact: normalizedPhone,
          },
        },
      },
      limit: 1,
    })

    customer = searchResponse.result?.customers?.[0] || null
    if (!customer) {
      throw new Error(`No Square customer found for phone ${normalizedPhone}`)
    }
    customerId = customer.id
  }

  if (!customerId) {
    throw new Error('A phone number or customer ID must be provided')
  }

  if (!customer) {
    const retrieved = await customersApi.retrieveCustomer(customerId)
    customer = retrieved.result?.customer
    if (!customer) {
      throw new Error(`Square customer ${customerId} not found`)
    }
  }

  console.log(`Customer: ${customer.givenName || ''} ${customer.familyName || ''} (${customerId})`)
  const stringify = (value) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2)
  console.log(`Square customer payload: ${stringify(customer)}`)

  const baseUrl = 'https://connect.squareup.com'
  const apiVersion = process.env.SQUARE_API_VERSION?.trim() || '2024-08-21'
  async function fetchGiftCards(endpointSuffix) {
    const response = await fetch(`${baseUrl}/v2/gift-cards${endpointSuffix}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Square-Version': apiVersion,
        'Content-Type': 'application/json'
      }
    })
    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Square gift card lookup failed (${response.status}): ${errorBody}`)
    }
    return response.json()
  }
  let giftCard = null

  if (ganOverride) {
    const normalizedGan = ganOverride.replace(/\s+/g, '')
    const response = await fetch(`${baseUrl}/v2/gift-cards/from-gan`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Square-Version': apiVersion,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ gan: normalizedGan })
    })
    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Square GAN lookup failed (${response.status}): ${errorBody}`)
    }
    const payload = await response.json()
    giftCard = payload.gift_card
    if (!giftCard) {
      throw new Error(`No gift card returned for GAN ${normalizedGan}`)
    }
  } else {
    const filteredPayload = await fetchGiftCards(`?customer_id=${encodeURIComponent(customerId)}`)
    let giftCards = Array.isArray(filteredPayload.gift_cards) ? filteredPayload.gift_cards : []
    giftCard = giftCards.find(card => Array.isArray(card.customer_ids) ? card.customer_ids.includes(customerId) : false) || giftCards[0]
    const inspectedCards = [...giftCards]
    if (!giftCard) {
      let cursor = null
      do {
        const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=200` : '?limit=200'
        const page = await fetchGiftCards(suffix)
        const pageCards = Array.isArray(page.gift_cards) ? page.gift_cards : []
        console.log(`Fetched ${pageCards.length} gift cards from Square${cursor ? ` (cursor ${cursor})` : ''}`)
        inspectedCards.push(...pageCards)
        giftCard = pageCards.find(card => Array.isArray(card.customer_ids) ? card.customer_ids.includes(customerId) : false)
        if (giftCard) {
          giftCards = pageCards
          break
        }
        cursor = page.cursor || null
        if (!cursor) {
          break
        }
      } while (!giftCard)
    }
    if (!giftCard) {
      const sample = inspectedCards.slice(0, 5).map(card => ({
        id: card.id,
        gan: card.gan,
        customers: card.customer_ids,
        balance: card.balance_money,
        state: card.state
      }))
      const recent = inspectedCards
        .filter(card => {
          if (!card.created_at) return false
          const created = new Date(card.created_at)
          const now = new Date()
          const diffDays = (now - created) / (1000 * 60 * 60 * 24)
          return diffDays <= 7
        })
        .slice(0, 20)
        .map(card => ({
          id: card.id,
          gan: card.gan,
          created_at: card.created_at,
          customers: card.customer_ids,
          balance: card.balance_money,
          state: card.state
        }))
      const sameDay = inspectedCards
        .filter(card => typeof card.created_at === 'string' && card.created_at.startsWith('2025-11-04'))
        .slice(0, 20)
        .map(card => ({
          id: card.id,
          gan: card.gan,
          created_at: card.created_at,
          customers: card.customer_ids,
          balance: card.balance_money,
          state: card.state
        }))
      const activeTenDollar = inspectedCards
        .filter(card => card.state === 'ACTIVE' && Number(card.balance_money?.amount || 0) === 1000)
        .slice(0, 20)
        .map(card => ({
          id: card.id,
          gan: card.gan,
          created_at: card.created_at,
          customers: card.customer_ids,
          balance: card.balance_money
        }))
      console.log('No linked gift card found. Sample cards:', JSON.stringify(sample, null, 2))
      console.log('Recent gift cards (last 7 days):', JSON.stringify(recent, null, 2))
      console.log('Gift cards created on 2025-11-04:', JSON.stringify(sameDay, null, 2))
      console.log('Active $10 gift cards:', JSON.stringify(activeTenDollar, null, 2))
      throw new Error(`No gift card found for customer ${customerId}`)
    }
  }

  if (!giftCard.gan) {
    throw new Error(`Gift card ${giftCard.id} does not expose a GAN`)
  }

  const existingNote = (customer.note || '').trim()
  if (existingNote.includes(giftCard.gan)) {
    console.log('Customer note already includes this GAN. No update needed.')
    return
  }

  const balanceMoney = giftCard.balanceMoney || giftCard.balance_money || {}
  const amountCents = Number(balanceMoney.amount || 0)
  const amountDisplay = (amountCents / 100).toFixed(2)
  const today = new Date().toISOString().split('T')[0]
  const label = noteLabel || 'Gift card on file'
  const entry = `[${today}] ${label}: ${giftCard.gan} ($${amountDisplay})`
  const updatedNote = existingNote ? `${existingNote}\n${entry}` : entry

  await customersApi.updateCustomer(customerId, {
    note: updatedNote,
  })

  console.log(`Note updated with GAN ${giftCard.gan}`)
}

async function main() {
  const identifierArg = process.argv[2]
  const labelArg = process.argv[3]
  const ganArg = process.argv[4]

  if (!identifierArg) {
    console.error('Usage: node scripts/add-gift-card-gan-to-note.js <phone|customerId> [label] [ganOverride]')
    process.exit(1)
  }

  const looksLikePhone = identifierArg.startsWith('+') || /^\d+$/.test(identifierArg.replace(/[\s()-]/g, ''))
  const phoneNumber = looksLikePhone ? identifierArg : null
  const customerId = looksLikePhone ? null : identifierArg

  try {
    await appendGiftCardGanToNote({
      phoneNumber,
      customerId,
      noteLabel: labelArg,
      ganOverride: ganArg
    })
  } catch (error) {
    console.error(`Failed to append GAN to note: ${error.message}`)
    if (error.errors) {
      console.error(JSON.stringify(error.errors, null, 2))
    }
    process.exit(1)
  }
}

main()


