describe('next.config redirects', () => {
  test('redirects www to apex domain', async () => {
    const config = require('../next.config.js')
    expect(typeof config.redirects).toBe('function')
    const redirects = await config.redirects()
    expect(redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          destination: 'https://zorinastudio-referral.com/:path*',
          permanent: true,
        }),
      ]),
    )
  })
})


