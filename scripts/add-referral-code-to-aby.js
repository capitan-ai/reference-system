#!/usr/bin/env node
require('dotenv').config()
const { Client, Environment } = require('square')

const environment = Environment.Production
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment,
})

const customAttributesApi = squareClient.customAttributesApi

async function addReferralCodeToAby() {
  try {
    const abyCustomerId = 'Y4BV3AGY3NXYCK63PA4ZA2ZJ14'
    const referralCode = 'CUST_MHA4LEYB5ERA' // Umi's code
    
    console.log('🔧 Adding referral code to Aby\'s profile...')
    console.log('=' .repeat(80))
    console.log(`Customer ID: ${abyCustomerId}`)
    console.log(`Referral Code: ${referralCode}`)
    console.log('=' .repeat(80) + '\n')
    
    // First, try to get or create the definition
    let definitionId
    try {
      definitionId = await getOrCreateDefinitionId()
      console.log(`Using definition ID: ${definitionId}\n`)
    } catch (error) {
      console.error('Error getting definition:', error.message)
      return
    }
    
    // Upsert custom attribute
    console.log('Upserting custom attribute...')
    const response = await customAttributesApi.upsertCustomerCustomAttribute(
      abyCustomerId,
      'referral_code', // key
      {
        value: referralCode,
        definitionId: definitionId
      }
    )
    
    console.log('\n✅ Successfully added referral code to Aby\'s profile!')
    console.log('\n📦 Response:')
    console.log(JSON.stringify(response.result, null, 2))
    
    // Verify it was added
    console.log('\n🔍 Verifying the custom attribute was added...')
    const verifyResponse = await customAttributesApi.retrieveCustomerCustomAttribute(
      abyCustomerId,
      'referral_code'
    )
    console.log('Verification:', JSON.stringify(verifyResponse.result, null, 2))
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error('Stack:', error.stack)
  }
}

async function getOrCreateDefinitionId() {
  // First try to get existing definition
  try {
    const defResponse = await customAttributesApi.listCustomerCustomAttributeDefinitions()
    
    console.log('Checking for existing custom attribute definitions...')
    if (defResponse.result.customAttributeDefinitions) {
      const referralDef = defResponse.result.customAttributeDefinitions.find(
        def => def.key === 'referral_code'
      )
      
      if (referralDef) {
        console.log('✅ Found existing definition')
        return referralDef.id
      }
    }
    
    console.log('No existing definition found')
  } catch (error) {
    console.log('Could not get existing definitions:', error.message)
  }
  
  // Create new definition
  console.log('\nCreating new custom attribute definition...')
  const createResponse = await customAttributesApi.createCustomerCustomAttributeDefinition({
    customAttributeDefinition: {
      key: 'referral_code',
      name: 'Referral Code',
      description: 'Customer referral code used during booking',
      visibility: 'VISIBILITY_READ_WRITE_VALUES',
      schema: {
        key1: 'STRING' // Custom attributes need a schema
      }
    }
  })
  
  console.log('✅ Created new definition')
  return createResponse.result.customAttributeDefinition?.id
}

addReferralCodeToAby()
