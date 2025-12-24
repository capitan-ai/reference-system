'use client'

import { useState } from 'react'

export default function LookupReferralPage() {
  const [phoneNumber, setPhoneNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)
    setCopied(false)

    try {
      const response = await fetch('/api/lookup-referral', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phoneNumber }),
      })

      const data = await response.json()

      if (!data.found) {
        setError(data.error || 'Customer not found')
        return
      }

      if (!data.hasReferralLink) {
        setError(data.error || 'No referral URL found for this customer')
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
      // Fallback for older browsers
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

  return (
    <div style={{
      minHeight: '100vh',
      background: '#F2EBDD',
      padding: '2rem 1rem',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <div style={{
        maxWidth: '600px',
        margin: '0 auto',
        background: 'white',
        borderRadius: '16px',
        padding: '2rem',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
      }}>
        <h1 style={{
          fontSize: '1.75rem',
          fontWeight: '600',
          color: '#333',
          marginBottom: '0.5rem',
          textAlign: 'center'
        }}>
          Lookup Referral Code
        </h1>
        <p style={{
          fontSize: '0.95rem',
          color: '#666',
          textAlign: 'center',
          marginBottom: '2rem'
        }}>
          Enter customer phone number to find their referral URL
        </p>

        <form onSubmit={handleSubmit} style={{ marginBottom: '2rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{
              display: 'block',
              fontSize: '0.9rem',
              fontWeight: '500',
              color: '#333',
              marginBottom: '0.5rem'
            }}>
              Phone Number
            </label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="(415) 555-1234 or +14155551234"
              required
              style={{
                width: '100%',
                padding: '0.75rem',
                fontSize: '1rem',
                border: '2px solid #5C6B50',
                borderRadius: '8px',
                boxSizing: 'border-box',
                fontFamily: 'inherit'
              }}
            />
            <p style={{
              fontSize: '0.8rem',
              color: '#666',
              marginTop: '0.25rem'
            }}>
              Enter phone number in any format
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '0.875rem',
              fontSize: '1rem',
              fontWeight: '600',
              background: loading ? '#ccc' : '#5C6B50',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: loading ? 'not-allowed' : 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              transition: 'background 0.2s'
            }}
          >
            {loading ? 'Looking up...' : 'Lookup Referral URL'}
          </button>
        </form>

        {error && (
          <div style={{
            padding: '1rem',
            background: '#fee',
            border: '2px solid #fcc',
            borderRadius: '8px',
            marginBottom: '1rem',
            color: '#c33'
          }}>
            {error}
          </div>
        )}

        {result && (
          <div style={{
            padding: '1.5rem',
            background: '#f0f9f0',
            border: '2px solid #5C6B50',
            borderRadius: '12px'
          }}>
            <h2 style={{
              fontSize: '1.2rem',
              fontWeight: '600',
              color: '#333',
              marginBottom: '1rem'
            }}>
              Customer Found
            </h2>

            <div style={{ marginBottom: '1rem' }}>
              <p style={{
                fontSize: '0.9rem',
                color: '#666',
                marginBottom: '0.25rem'
              }}>
                Customer Name:
              </p>
              <p style={{
                fontSize: '1rem',
                fontWeight: '500',
                color: '#333'
              }}>
                {result.customerName || 'N/A'}
              </p>
            </div>

            {result.referralCode && (
              <div style={{ marginBottom: '1rem' }}>
                <p style={{
                  fontSize: '0.9rem',
                  color: '#666',
                  marginBottom: '0.25rem'
                }}>
                  Referral Code:
                </p>
                <p style={{
                  fontSize: '1.25rem',
                  fontWeight: '600',
                  color: '#5C6B50',
                  letterSpacing: '2px',
                  fontFamily: 'monospace'
                }}>
                  {result.referralCode}
                </p>
              </div>
            )}

            <div style={{ marginBottom: '1.5rem' }}>
              <p style={{
                fontSize: '0.9rem',
                color: '#666',
                marginBottom: '0.5rem'
              }}>
                Referral URL:
              </p>
              <div style={{
                padding: '0.75rem',
                background: 'white',
                border: '2px solid #5C6B50',
                borderRadius: '8px',
                wordBreak: 'break-all',
                fontSize: '0.9rem',
                color: '#333'
              }}>
                {result.referralUrl}
              </div>
            </div>

            <button
              onClick={handleCopyUrl}
              style={{
                width: '100%',
                padding: '0.875rem',
                fontSize: '1rem',
                fontWeight: '600',
                background: copied ? '#4CAF50' : '#5C6B50',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                transition: 'background 0.2s'
              }}
            >
              {copied ? '✓ Copied!' : 'Copy URL'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

