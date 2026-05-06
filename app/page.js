'use client'

export default function HomePage() {
  const referralCode = 'ZORINA2024'
  
  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(referralCode)
      alert('Code copied to clipboard!')
    } catch (err) {
      console.error('Failed to copy code:', err)
      alert('Failed to copy code. Please copy it manually.')
    }
  }
  
  const handleBookVisit = () => {
    window.open(`https://studio-zorina.square.site/?ref=${referralCode}`, '_blank')
  }
  
  return (
    <>
    <style jsx>{`
      @media (max-width: 768px) {
        .mobile-padding {
          padding: 0.5rem 1rem !important;
        }
        .mobile-title {
          font-size: 1.4rem !important;
        }
        .mobile-text {
          font-size: 0.9rem !important;
        }
        .mobile-logo {
          height: 100px !important;
          width: 85% !important;
        }
        .mobile-box-padding {
          padding: 1.25rem !important;
        }
        .mobile-code-text {
          font-size: 0.95rem !important;
        }
        .mobile-button {
          padding: 0.875rem 2rem !important;
          font-size: 0.85rem !important;
        }
        .mobile-step-padding {
          padding: 1rem !important;
        }
        .mobile-step-text {
          font-size: 0.9rem !important;
        }
        .mobile-gap {
          gap: 0.75rem !important;
        }
      }
    `}</style>
    <div className="mobile-padding" style={{ 
      minHeight: '100vh',
      background: '#F2EBDD',
      padding: '1rem 2rem',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <div style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
        {/* Logo Section */}
        <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img 
            className="mobile-logo"
            src="/logo.png" 
            alt="Zorina Nail Studio Logo" 
            style={{ 
              height: '140px',
              width: '70%',
              maxWidth: 'none',
              objectFit: 'cover',
              objectPosition: 'center'
            }}
          />
        </div>

        {/* Welcome Message */}
        <div style={{ marginBottom: '2.5rem' }}>
          <h1 className="mobile-title" style={{ 
            fontSize: '1.75rem', 
            color: '#333',
            fontWeight: '500',
            marginBottom: '1rem',
            textAlign: 'center'
          }}>
            Welcome! Your friend invited you to ZORINA!
          </h1>
          <p className="mobile-text" style={{ fontSize: '1rem', color: '#333', lineHeight: '1.6', fontWeight: '400', textAlign: 'center' }}>
            You&apos;ll get $10 off your first visit, and your friend will get $10 off their next one too — it&apos;s our way of saying thank you for spreading the love 🤍
          </p>
        </div>

        {/* Referral Code Box */}
        <div className="mobile-box-padding" style={{ 
          background: 'white',
          border: '2px solid #5C6B50',
          borderRadius: '12px',
          padding: '2rem',
          marginBottom: '2.5rem'
        }}>
          <div className="mobile-code-text" style={{ fontSize: '1.1rem', color: '#333', marginBottom: '1.5rem', fontWeight: '500' }}>
            Your Friend&apos;s Code
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="mobile-code-text" style={{ 
              background: '#5C6B50',
              color: 'white',
              padding: '1rem',
              borderRadius: '8px',
              fontSize: '1.1rem',
              fontWeight: '600',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              letterSpacing: '2px'
            }}>
              {referralCode}
            </div>
            <button 
              onClick={handleCopyCode}
              className="mobile-button"
              style={{ 
                background: '#5C6B50',
                color: 'white',
                padding: '1rem',
                borderRadius: '8px',
                fontSize: '0.9rem',
                fontWeight: '600',
                border: 'none',
                cursor: 'pointer',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                textTransform: 'uppercase',
                letterSpacing: '1.5px'
              }}
            >
              Use This Code
            </button>
          </div>
        </div>

        {/* How to Use Section */}
        <div style={{ marginBottom: '2.5rem' }}>
          <h2 className="mobile-code-text" style={{ fontSize: '1.1rem', color: '#333', marginBottom: '1.5rem', fontWeight: '500' }}>
            How to use your discount:
          </h2>
          <div className="mobile-gap" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="mobile-step-padding" style={{ 
              background: 'white',
              border: '2px solid #5C6B50',
              borderRadius: '12px',
              padding: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem'
            }}>
              <div style={{ 
                background: '#5C6B50',
                color: 'white',
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.1rem',
                fontWeight: '600',
                flexShrink: 0
              }}>
                1
              </div>
              <p className="mobile-step-text" style={{ color: '#333', fontSize: '1rem', margin: 0, fontWeight: '400' }}>
                Use the code above when booking your first visit.
              </p>
            </div>

            <div className="mobile-step-padding" style={{ 
              background: 'white',
              border: '2px solid #5C6B50',
              borderRadius: '12px',
              padding: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem'
            }}>
              <div style={{ 
                background: '#5C6B50',
                color: 'white',
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.1rem',
                fontWeight: '600',
                flexShrink: 0
              }}>
                2
              </div>
              <p className="mobile-step-text" style={{ color: '#333', fontSize: '1rem', margin: 0, fontWeight: '400' }}>
                Get $10 off when you come in for your appointment.
              </p>
            </div>

            <div className="mobile-step-padding" style={{ 
              background: 'white',
              border: '2px solid #5C6B50',
              borderRadius: '12px',
              padding: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem'
            }}>
              <div style={{ 
                background: '#5C6B50',
                color: 'white',
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.1rem',
                fontWeight: '600',
                flexShrink: 0
              }}>
                3
              </div>
              <p className="mobile-step-text" style={{ color: '#333', fontSize: '1rem', margin: 0, fontWeight: '400' }}>
                Your friend gets $10 off their next visit too.
              </p>
            </div>
          </div>
        </div>

        {/* Call to Action Button */}
        <button 
          onClick={handleBookVisit}
          className="mobile-button"
          style={{ 
            background: '#5C6B50',
            color: 'white',
            padding: '1.25rem 3rem',
            borderRadius: '8px',
            fontSize: '0.9rem',
            fontWeight: '600',
            border: 'none',
            cursor: 'pointer',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            textTransform: 'uppercase',
            letterSpacing: '2px'
          }}
        >
          BOOK YOUR VISIT
        </button>
      </div>
    </div>
    </>
  )
}