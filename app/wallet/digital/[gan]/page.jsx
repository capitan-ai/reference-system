import { notFound } from 'next/navigation'
import { createRequire } from 'module'
import QRCode from 'qrcode'

const require = createRequire(import.meta.url)
const { getPrisma, getGiftCardsApi } = require('../../../../lib/wallet/clients.js')
const { resolveGiftCardContext } = require('../../../../lib/wallet/giftcard-context.js')

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }) {
  return {
    title: `Zorina Wallet Card • ${params.gan}`
  }
}

export default async function DigitalWalletCard({ params }) {
  const { gan } = params
  if (!gan) {
    notFound()
  }

  const prisma = getPrisma()
  const giftCardsApi = getGiftCardsApi()
  const context = await resolveGiftCardContext({ gan, prisma, giftCardsApi })

  if (!context) {
    notFound()
  }

  const { giftCardGan, balanceCents, customerName } = context
  const balanceLabel = `$${(balanceCents / 100).toFixed(2)}`
  const qrDataUri = await QRCode.toDataURL(`sqgc://${giftCardGan}`, {
    margin: 1,
    scale: 8,
    errorCorrectionLevel: 'M'
  })

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Zorina Wallet Card</title>
      </head>
      <body
        style={{
          margin: 0,
          background: '#F2EBDD',
          fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
          color: '#222',
          minHeight: '100vh',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '24px'
        }}
      >
        <main
          style={{
            width: '100%',
            maxWidth: '420px'
          }}
        >
          <div
            style={{
              background: '#F2E0C8',
              borderRadius: '26px',
              border: '1px solid rgba(0,0,0,0.08)',
              padding: '28px',
              boxShadow: '0 15px 40px rgba(0,0,0,0.15)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <img
                src="https://referral-system-salon.vercel.app/logo.png"
                alt="Zorina Nail Studio"
                style={{ height: '32px', objectFit: 'contain' }}
              />
              <span style={{ fontWeight: 600, fontSize: '18px' }}>Zorina Nail Studio</span>
            </div>
            <div style={{ fontSize: '48px', fontWeight: 600 }}>{balanceLabel}</div>
            <div style={{ fontSize: '16px', color: '#444', marginBottom: '24px' }}>Balance</div>
            <div style={{ display: 'flex', gap: '16px', fontSize: '14px', letterSpacing: '0.05em', color: '#4C5B47' }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>GIFT CARD NUMBER</div>
                <div style={{ color: '#222', fontSize: '16px', letterSpacing: '0.08em' }}>{giftCardGan}</div>
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>CUSTOMER</div>
                <div style={{ color: '#222', fontSize: '16px' }}>{customerName || 'Guest'}</div>
              </div>
            </div>
            <div style={{ marginTop: '24px', textAlign: 'center' }}>
              <img
                src={qrDataUri}
                alt="Gift card QR code"
                style={{ width: '220px', height: '220px', borderRadius: '16px', padding: '12px', background: '#fff', border: '1px solid #DDD' }}
              />
              <p style={{ fontSize: '12px', color: '#555' }}>Scan at checkout</p>
            </div>
          </div>
          <p style={{ textAlign: 'center', marginTop: '16px', color: '#4C5B47', fontSize: '14px' }}>
            Tip: Take a screenshot if you want to keep a copy without adding it to Apple Wallet.
          </p>
        </main>
      </body>
    </html>
  )
}

