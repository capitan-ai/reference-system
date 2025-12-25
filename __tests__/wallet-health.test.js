describe('wallet health endpoint', () => {
  const env = { ...process.env }

  afterEach(() => {
    process.env = { ...env }
  })

  test('reports degraded when required env vars are missing', async () => {
    delete process.env.APPLE_PASS_TYPE_ID
    delete process.env.APPLE_PASS_TEAM_ID
    delete process.env.APPLE_PASS_CERTIFICATE_PEM_BASE64
    delete process.env.APPLE_PASS_KEY_PEM_BASE64
    delete process.env.APPLE_PASS_CERTIFICATE_BASE64
    delete process.env.APPLE_PASS_CERTIFICATE_PATH
    delete process.env.APPLE_WWDR_CERTIFICATE_BASE64
    delete process.env.APPLE_WWDR_CERTIFICATE_PATH
    delete process.env.APPLE_WWDR_CERTIFICATE_ABSOLUTE_PATH

    const { GET } = require('../app/api/health/wallet/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('degraded')
    expect(body.wallet.ok).toBe(false)
    expect(Array.isArray(body.wallet.missing)).toBe(true)
    expect(body.wallet.missing).toEqual(expect.arrayContaining(['APPLE_PASS_TYPE_ID', 'APPLE_PASS_TEAM_ID']))
  })

  test('reports ok when required env vars are present (synthetic values)', async () => {
    process.env.APPLE_PASS_TYPE_ID = 'pass.com.example.test'
    process.env.APPLE_PASS_TEAM_ID = 'TEAMID1234'
    process.env.APPLE_PASS_CERTIFICATE_PEM_BASE64 = 'Zg=='
    process.env.APPLE_PASS_KEY_PEM_BASE64 = 'Zg=='
    process.env.APPLE_WWDR_CERTIFICATE_BASE64 = 'Zg=='
    delete process.env.APPLE_PASS_CERTIFICATE_BASE64
    delete process.env.APPLE_PASS_CERTIFICATE_PATH
    delete process.env.APPLE_WWDR_CERTIFICATE_PATH
    delete process.env.APPLE_WWDR_CERTIFICATE_ABSOLUTE_PATH

    const { GET } = require('../app/api/health/wallet/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.wallet.ok).toBe(true)
    expect(body.wallet.certMode).toBe('pem')
    expect(Array.isArray(body.wallet.missing)).toBe(true)
    expect(body.wallet.missing.length).toBe(0)
  })
})


