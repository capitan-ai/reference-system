const {
  validateAdminKeyInput,
  createAdminSessionCookie,
  buildExpiredSessionCookie,
  SESSION_COOKIE_NAME,
} = require('../lib/admin-auth')

describe('admin-auth helpers', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    process.env.ANALYTICS_ADMIN_KEY = 'super-secret'
    process.env.NEXTAUTH_SECRET = 'another-secret'
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  test('validateAdminKeyInput accepts the correct key', () => {
    const result = validateAdminKeyInput('super-secret')
    expect(result.valid).toBe(true)
  })

  test('validateAdminKeyInput rejects missing key', () => {
    const result = validateAdminKeyInput('')
    expect(result.valid).toBe(false)
    expect(result.status).toBe(400)
  })

  test('validateAdminKeyInput rejects wrong key', () => {
    const result = validateAdminKeyInput('bad-key')
    expect(result.valid).toBe(false)
    expect(result.status).toBe(401)
  })

  test('createAdminSessionCookie issues signed cookie', () => {
    const cookie = createAdminSessionCookie()
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Max-Age=')
  })

  test('buildExpiredSessionCookie invalidates the session cookie', () => {
    const cookie = buildExpiredSessionCookie()
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=deleted`)
    expect(cookie).toContain('Max-Age=0')
  })
})

