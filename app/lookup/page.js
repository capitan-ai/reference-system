'use client'

import { useState } from 'react'

export default function LookupReferralPage() {
  const [phoneNumber, setPhoneNumber] = useState('')
  const [givenName, setGivenName] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!phoneNumber.trim() && !givenName.trim() && !familyName.trim()) {
      setError('Please enter at least a phone number or name')
      return
    }
    
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/lookup-referral', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber: phoneNumber.trim() || null,
          givenName: givenName.trim() || null,
          familyName: familyName.trim() || null,
        }),
      })

      const data = await response.json()

      if (!data.found) {
        setError(data.error || 'Customer not found')
        return
      }

      if (!data.hasReferralLink) {
        setError(data.error || 'No referral link found for this customer')
        return
      }

      setResult(data)
    } catch (err) {
      setError('Failed to lookup referral. Please try again.')
      console.error('Lookup error:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCopyUrl = async () => {
    if (!result?.referralUrl) return

    try {
      await navigator.clipboard.writeText(result.referralUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
      const textArea = document.createElement('textarea')
      textArea.value = result.referralUrl
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleReset = () => {
    setPhoneNumber('')
    setGivenName('')
    setFamilyName('')
    setResult(null)
    setError(null)
  }

  return (
    <>
      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        
        * {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        }
        
        @media (max-width: 768px) {
          .mobile-logo {
            height: 100px !important;
            width: 85% !important;
          }
          .mobile-padding {
            padding: 1rem !important;
          }
          .mobile-title {
            font-size: 1.5rem !important;
          }
        }
      `}</style>
      <div style={{
        minHeight: '100vh',
        background: '#F2EBDD',
        padding: '2rem 1rem',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
      }}>
        <div style={{
          maxWidth: '600px',
          margin: '0 auto',
          background: 'white',
          borderRadius: '16px',
          padding: '2.5rem',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
        }}>
          {/* Logo Section */}
          <div style={{ 
            marginBottom: '2rem', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center' 
          }}>
            <img 
              className="mobile-logo"
              src="/logo.png" 
              alt="Zorina Nail Studio Logo" 
              style={{ 
                height: '140px',
                width: '70%',
                maxWidth: '400px',
                objectFit: 'cover',
                objectPosition: 'center'
              }}
            />
          </div>

          <h1 className="mobile-title" style={{
            fontSize: '1.75rem',
            fontWeight: '500',
            color: '#333',
            marginBottom: '0.75rem',
            textAlign: 'center',
            letterSpacing: '-0.02em'
          }}>
            Lookup Referral Code
          </h1>
          <p style={{
            fontSize: '0.95rem',
            color: '#666',
            textAlign: 'center',
            marginBottom: '2rem',
            fontWeight: '400',
            lineHeight: '1.5'
          }}>
            Enter your phone number or name to find your referral code
          </p>

        {!result && (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{
                display: 'block',
                fontSize: '0.875rem',
                fontWeight: '500',
                color: '#333',
                marginBottom: '0.5rem',
                letterSpacing: '0.01em'
              }}>
                Phone Number (optional)
              </label>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="(415) 555-1234 or +14155551234"
                style={{
                  width: '100%',
                  padding: '0.875rem',
                  fontSize: '1rem',
                  border: '2px solid #5C6B50',
                  borderRadius: '10px',
                  boxSizing: 'border-box',
                  fontFamily: 'inherit',
                  fontWeight: '400',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                  outline: 'none'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#4A5A45'
                  e.target.style.boxShadow = '0 0 0 3px rgba(92, 107, 80, 0.1)'
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#5C6B50'
                  e.target.style.boxShadow = 'none'
                }}
              />
            </div>

            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: '1fr 1fr', 
              gap: '1rem',
              marginBottom: '1rem'
            }}>
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  color: '#333',
                  marginBottom: '0.5rem',
                  letterSpacing: '0.01em'
                }}>
                  First Name (optional)
                </label>
                <input
                  type="text"
                  value={givenName}
                  onChange={(e) => setGivenName(e.target.value)}
                  placeholder="First name"
                  style={{
                    width: '100%',
                    padding: '0.875rem',
                    fontSize: '1rem',
                    border: '2px solid #ddd',
                    borderRadius: '10px',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                    fontWeight: '400',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                    outline: 'none'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#5C6B50'
                    e.target.style.boxShadow = '0 0 0 3px rgba(92, 107, 80, 0.1)'
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#ddd'
                    e.target.style.boxShadow = 'none'
                  }}
                />
              </div>
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  color: '#333',
                  marginBottom: '0.5rem',
                  letterSpacing: '0.01em'
                }}>
                  Last Name (optional)
                </label>
                <input
                  type="text"
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  placeholder="Last name"
                  style={{
                    width: '100%',
                    padding: '0.875rem',
                    fontSize: '1rem',
                    border: '2px solid #ddd',
                    borderRadius: '10px',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                    fontWeight: '400',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                    outline: 'none'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#5C6B50'
                    e.target.style.boxShadow = '0 0 0 3px rgba(92, 107, 80, 0.1)'
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#ddd'
                    e.target.style.boxShadow = 'none'
                  }}
                />
              </div>
            </div>

            <p style={{
              fontSize: '0.8125rem',
              color: '#666',
              marginBottom: '1.5rem',
              fontStyle: 'italic',
              fontWeight: '400',
              textAlign: 'center',
              lineHeight: '1.5'
            }}>
              Enter phone number OR name (first and/or last name)
            </p>

            {error && (
              <div style={{
                padding: '1rem',
                background: '#fee',
                border: '2px solid #fcc',
                borderRadius: '10px',
                marginBottom: '1.25rem',
                color: '#c33',
                fontSize: '0.875rem',
                fontWeight: '400',
                lineHeight: '1.5'
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '1rem',
                fontSize: '1rem',
                fontWeight: '600',
                background: loading ? '#ccc' : '#5C6B50',
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                cursor: loading ? 'not-allowed' : 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                transition: 'background 0.2s, transform 0.1s, box-shadow 0.2s',
                boxShadow: loading ? 'none' : '0 2px 4px rgba(92, 107, 80, 0.2)'
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.target.style.background = '#4A5A45'
                  e.target.style.transform = 'translateY(-1px)'
                  e.target.style.boxShadow = '0 4px 8px rgba(92, 107, 80, 0.3)'
                }
              }}
              onMouseLeave={(e) => {
                if (!loading) {
                  e.target.style.background = '#5C6B50'
                  e.target.style.transform = 'translateY(0)'
                  e.target.style.boxShadow = '0 2px 4px rgba(92, 107, 80, 0.2)'
                }
              }}
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </form>
        )}

        {result && (
          <div>
            <div style={{
              padding: '1.5rem',
              background: '#f0f9f0',
              border: '2px solid #5C6B50',
              borderRadius: '12px',
              marginBottom: '1rem'
            }}>
              <h2 style={{
                fontSize: '1.25rem',
                fontWeight: '500',
                color: '#333',
                marginBottom: '1.25rem',
                letterSpacing: '-0.01em'
              }}>
                Your Referral Information
              </h2>

              <div style={{ marginBottom: '1.25rem' }}>
                <p style={{
                  fontSize: '0.875rem',
                  color: '#666',
                  marginBottom: '0.375rem',
                  fontWeight: '500',
                  letterSpacing: '0.01em'
                }}>
                  Customer Name:
                </p>
                <p style={{
                  fontSize: '1rem',
                  fontWeight: '500',
                  color: '#333',
                  letterSpacing: '-0.01em'
                }}>
                  {result.customerName || 'N/A'}
                </p>
              </div>

              {result.referralCode && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <p style={{
                    fontSize: '0.875rem',
                    color: '#666',
                    marginBottom: '0.375rem',
                    fontWeight: '500',
                    letterSpacing: '0.01em'
                  }}>
                    Referral Code:
                  </p>
                  <p style={{
                    fontSize: '1.375rem',
                    fontWeight: '600',
                    color: '#5C6B50',
                    letterSpacing: '0.1em',
                    fontFamily: "'Inter', monospace"
                  }}>
                    {result.referralCode}
                  </p>
                </div>
              )}

              <div style={{ marginBottom: '1.75rem' }}>
                <p style={{
                  fontSize: '0.875rem',
                  color: '#666',
                  marginBottom: '0.5rem',
                  fontWeight: '500',
                  letterSpacing: '0.01em'
                }}>
                  Referral URL:
                </p>
                <div style={{
                  padding: '0.875rem',
                  background: 'white',
                  border: '2px solid #5C6B50',
                  borderRadius: '10px',
                  wordBreak: 'break-all',
                  fontSize: '0.875rem',
                  color: '#333',
                  fontWeight: '400',
                  lineHeight: '1.5'
                }}>
                  {result.referralUrl}
                </div>
              </div>

              <button
                onClick={handleCopyUrl}
                style={{
                  width: '100%',
                  padding: '1rem',
                  fontSize: '1rem',
                  fontWeight: '600',
                  background: copied ? '#4CAF50' : '#5C6B50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  transition: 'background 0.2s, transform 0.1s, box-shadow 0.2s',
                  boxShadow: copied ? 'none' : '0 2px 4px rgba(92, 107, 80, 0.2)',
                  marginBottom: '0.75rem'
                }}
                onMouseEnter={(e) => {
                  if (!copied) {
                    e.target.style.background = '#4A5A45'
                    e.target.style.transform = 'translateY(-1px)'
                    e.target.style.boxShadow = '0 4px 8px rgba(92, 107, 80, 0.3)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!copied) {
                    e.target.style.background = '#5C6B50'
                    e.target.style.transform = 'translateY(0)'
                    e.target.style.boxShadow = '0 2px 4px rgba(92, 107, 80, 0.2)'
                  }
                }}
              >
                {copied ? '✓ Copied!' : 'Copy URL'}
              </button>

              <button
                onClick={handleReset}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  fontSize: '0.875rem',
                  background: 'transparent',
                  color: '#5C6B50',
                  border: '1.5px solid #5C6B50',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontWeight: '500',
                  transition: 'background 0.2s, color 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = '#f5f5f5'
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'transparent'
                }}
              >
                Lookup Another
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  )
}
