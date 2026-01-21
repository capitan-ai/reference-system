describe('email wallet url', () => {
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...ORIGINAL_ENV }
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  test('gift card email uses APP_BASE_URL for /api/wallet/pass link (no www hardcode)', () => {
    process.env.APP_BASE_URL = 'https://zorinastudio-referral.com'
    const { buildGiftCardEmailPreview } = require('../lib/email-service-simple')

    const template = buildGiftCardEmailPreview({
      customerName: 'Test',
      giftCardGan: 'GAN123',
      amountCents: 1000,
      balanceCents: 1000,
      activationUrl: null,
      passKitUrl: null,
      qrDataUri: null,
    })

    expect(template.html).toContain('https://zorinastudio-referral.com/api/wallet/pass/GAN123')
    expect(template.html).not.toContain('www.zorinastudio-referral.com')
  })
})


