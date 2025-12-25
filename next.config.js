/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client'],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: 'www.zorinastudio-referral.com',
          },
        ],
        destination: 'https://zorinastudio-referral.com/:path*',
        permanent: true,
      },
    ]
  },
}

module.exports = nextConfig
