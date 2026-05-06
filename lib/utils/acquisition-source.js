const HOW_DID_YOU_HEAR_ATTRIBUTE_KEY = 'square:c11dd5ac-8382-4570-9c7b-2bdcb1c781f1'

const HOW_DID_YOU_HEAR_OPTIONS = {
  '0826aee4-d259-434d-be44-511ac61b3629': 'Instagram',
  'a7b40271-729a-41aa-801b-fb1fffb83650': 'Google Maps',
  'af5791f8-348a-422e-98d1-5e865121bb19': 'Friend referral',
  'c0f2ee04-4762-42c6-a593-a4e745a81c92': 'Influencer post',
  'cb289afd-ba17-4a65-a12b-b7bbae60a65e': 'Online ad',
  'ea55658e-be3e-4b86-a64a-9d499c3b4b8c': 'Returning client',
  'fd306114-9968-4fe0-9bde-53f9bf837f39': 'Other',
}

function resolveAcquisitionSource(attributes) {
  const raw = attributes?.[HOW_DID_YOU_HEAR_ATTRIBUTE_KEY]
  if (!raw) return null
  const uuid = Array.isArray(raw) ? raw[0] : raw
  return HOW_DID_YOU_HEAR_OPTIONS[uuid] || null
}

async function fetchAcquisitionSourceFromSquare(customerId) {
  const token = process.env.SQUARE_ACCESS_TOKEN?.replace(/^Bearer /, '').replace(/"/g, '').trim()
  if (!token || !customerId) return null

  const url = `https://connect.squareup.com/v2/customers/${customerId}/custom-attributes/${encodeURIComponent(HOW_DID_YOU_HEAR_ATTRIBUTE_KEY)}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Square-Version': '2024-12-18',
    },
  })

  if (!res.ok) return null
  const data = await res.json()
  const raw = data.custom_attribute?.value
  if (!raw) return null
  const uuid = Array.isArray(raw) ? raw[0] : raw
  return HOW_DID_YOU_HEAR_OPTIONS[uuid] || null
}

async function saveAcquisitionSourceIfMissing(prisma, organizationId, squareCustomerId, source) {
  if (!source) return 0
  return prisma.$executeRaw`
    UPDATE square_existing_clients
    SET acquisition_source = ${source}
    WHERE square_customer_id = ${squareCustomerId}
      AND organization_id = ${organizationId}::uuid
      AND acquisition_source IS NULL
  `
}

module.exports = {
  HOW_DID_YOU_HEAR_ATTRIBUTE_KEY,
  HOW_DID_YOU_HEAR_OPTIONS,
  resolveAcquisitionSource,
  fetchAcquisitionSourceFromSquare,
  saveAcquisitionSourceIfMissing,
}
