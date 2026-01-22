'use client'

import { useState } from 'react'

export default function LookupReferralPage() {
  const [phoneNumber, setPhoneNumber] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [step, setStep] = useState('phone') // 'phone' | 'verify' | 'result'
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [checkingSession, setCheckingSession] = useState(false)
  
  // Admin mode state
  const [adminMode, setAdminMode] = useState(false)
  const [teamMemberPhone, setTeamMemberPhone] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerGivenName, setCustomerGivenName] = useState('')
  const [customerFamilyName, setCustomerFamilyName] = useState('')

  // Check session when phone number is entered
  const handlePhoneSubmit = async (e) => {
    e.preventDefault()
    
    if (!phoneNumber.trim()) {
      setError('Please enter your phone number')
      return
    }
    
    setLoading(true)
    setError(null)
    setCheckingSession(true)

    try {
      // First, check if there's a valid session
      const sessionResponse = await fetch('/api/lookup-referral/check-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phoneNumber: phoneNumber.trim() }),
      })

      const sessionData = await sessionResponse.json()

      if (sessionData.sessionValid && sessionData.skipVerification) {
        // Valid session exists! Skip SMS and show results directly
        setResult(sessionData)
        setStep('result')
        setLoading(false)
        setCheckingSession(false)
        return
      }

      // No valid session - proceed to send SMS
      setCheckingSession(false)
      await handleSendCode(e)

    } catch (err) {
      setError('Failed to check session. Please try again.')
      console.error('Session check error:', err)
      setLoading(false)
      setCheckingSession(false)
    }
  }

  const handleSendCode = async (e) => {
    if (e) e.preventDefault()
    
    setLoading(true)
    setError(null)
    setCodeSent(false)

    try {
      const response = await fetch('/api/lookup-referral/send-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phoneNumber: phoneNumber.trim() }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to send verification code')
        return
      }

      setCodeSent(true)
      setStep('verify')
    } catch (err) {
      setError('Failed to send verification code. Please try again.')
      console.error('Send code error:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyCode = async (e) => {
    e.preventDefault()
    
    if (!verificationCode.trim() || verificationCode.length !== 6) {
      setError('Please enter the 6-digit verification code')
      return
    }
    
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/lookup-referral/verify-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          phoneNumber: phoneNumber.trim(),
          code: verificationCode.trim()
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Verification failed')
        return
      }

      if (!data.found) {
        setError(data.error || 'Customer not found')
        return
      }

      if (!data.hasReferralLink) {
        setError(data.error || 'No referral URL found for this customer')
        return
      }

      setResult(data)
      setStep('result')
    } catch (err) {
      setError('Failed to verify code. Please try again.')
      console.error('Verify error:', err)
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
    setStep('phone')
    setPhoneNumber('')
    setVerificationCode('')
    setResult(null)
    setError(null)
    setCodeSent(false)
    setCheckingSession(false)
  }

  // Admin lookup handler
  const handleAdminLookup = async (e) => {
    e.preventDefault()
    
    if (!teamMemberPhone.trim()) {
      setError('Please enter your team member phone number')
      return
    }

    if (!customerPhone.trim() && !customerGivenName.trim() && !customerFamilyName.trim()) {
      setError('Please enter customer phone number or name to search')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/lookup-referral/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          teamMemberPhone: teamMemberPhone.trim(),
          customerPhone: customerPhone.trim() || null,
          customerGivenName: customerGivenName.trim() || null,
          customerFamilyName: customerFamilyName.trim() || null,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Lookup failed')
        return
      }

      if (!data.found) {
        setError(data.error || 'Customer not found')
        return
      }

      if (!data.hasReferralLink) {
        setError(data.error || 'No referral link found for this customer')
        return
      }

      setResult(data)
      setStep('result')
    } catch (err) {
      setError('Failed to lookup customer. Please try again.')
      console.error('Admin lookup error:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleAdminReset = () => {
    setTeamMemberPhone('')
    setCustomerPhone('')
    setCustomerGivenName('')
    setCustomerFamilyName('')
    setResult(null)
    setError(null)
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
        
        {/* Admin Mode Toggle */}
        <div style={{
          marginBottom: '1.5rem',
          padding: '1rem',
          background: '#f5f5f5',
          borderRadius: '8px',
          border: '1px solid #ddd'
        }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            fontSize: '0.9rem',
            color: '#666'
          }}>
            <input
              type="checkbox"
              checked={adminMode}
              onChange={(e) => {
                setAdminMode(e.target.checked)
                handleReset()
                handleAdminReset()
              }}
              style={{
                marginRight: '0.5rem',
                width: '18px',
                height: '18px',
                cursor: 'pointer'
              }}
            />
            <span style={{ fontWeight: '500' }}>Team Member / Admin Mode</span>
          </label>
          {adminMode && (
            <p style={{
              fontSize: '0.8rem',
              color: '#666',
              marginTop: '0.5rem',
              marginLeft: '1.75rem'
            }}>
              Search for customer referral data without SMS verification
            </p>
          )}
        </div>

        {!adminMode && (
          <p style={{
            fontSize: '0.95rem',
            color: '#666',
            textAlign: 'center',
            marginBottom: '2rem'
          }}>
            Enter your phone number to receive a verification code
          </p>
        )}

        {/* Admin Mode Form */}
        {adminMode && step === 'phone' && (
          <form onSubmit={handleAdminLookup}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{
                display: 'block',
                fontSize: '0.9rem',
                fontWeight: '500',
                color: '#333',
                marginBottom: '0.5rem'
              }}>
                Your Team Member Phone Number
              </label>
              <input
                type="tel"
                value={teamMemberPhone}
                onChange={(e) => setTeamMemberPhone(e.target.value)}
                placeholder="(415) 555-1234 or +14155551234"
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
                Enter your phone number to verify you're a team member
              </p>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{
                display: 'block',
                fontSize: '0.9rem',
                fontWeight: '500',
                color: '#333',
                marginBottom: '0.5rem'
              }}>
                Customer Phone Number (optional)
              </label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="(415) 555-1234 or +14155551234"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  fontSize: '1rem',
                  border: '2px solid #ddd',
                  borderRadius: '8px',
                  boxSizing: 'border-box',
                  fontFamily: 'inherit'
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
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  color: '#333',
                  marginBottom: '0.5rem'
                }}>
                  Customer First Name (optional)
                </label>
                <input
                  type="text"
                  value={customerGivenName}
                  onChange={(e) => setCustomerGivenName(e.target.value)}
                  placeholder="First name"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    fontSize: '1rem',
                    border: '2px solid #ddd',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit'
                  }}
                />
              </div>
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  color: '#333',
                  marginBottom: '0.5rem'
                }}>
                  Customer Last Name (optional)
                </label>
                <input
                  type="text"
                  value={customerFamilyName}
                  onChange={(e) => setCustomerFamilyName(e.target.value)}
                  placeholder="Last name"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    fontSize: '1rem',
                    border: '2px solid #ddd',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit'
                  }}
                />
              </div>
            </div>

            <p style={{
              fontSize: '0.8rem',
              color: '#666',
              marginBottom: '1rem',
              fontStyle: 'italic'
            }}>
              Enter customer phone number OR name (first and/or last name)
            </p>

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
              {loading ? 'Searching...' : 'Search Customer'}
            </button>
          </form>
        )}

        {/* Step 1: Phone Number (Customer Mode) */}
        {!adminMode && step === 'phone' && (
          <form onSubmit={handlePhoneSubmit}>
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
              {loading 
                ? (checkingSession ? 'Checking...' : 'Sending...') 
                : 'Continue'}
            </button>
          </form>
        )}

        {/* Step 2: Verification Code */}
        {step === 'verify' && (
          <form onSubmit={handleVerifyCode}>
            <div style={{ marginBottom: '1rem' }}>
              <p style={{
                fontSize: '0.9rem',
                color: '#666',
                marginBottom: '1rem',
                textAlign: 'center'
              }}>
                We sent a 6-digit code to {phoneNumber}
              </p>
              <label style={{
                display: 'block',
                fontSize: '0.9rem',
                fontWeight: '500',
                color: '#333',
                marginBottom: '0.5rem'
              }}>
                Verification Code
              </label>
              <input
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  fontSize: '1.5rem',
                  textAlign: 'center',
                  letterSpacing: '0.5rem',
                  border: '2px solid #5C6B50',
                  borderRadius: '8px',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                  fontWeight: '600'
                }}
              />
            </div>

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

            <button
              type="submit"
              disabled={loading || verificationCode.length !== 6}
              style={{
                width: '100%',
                padding: '0.875rem',
                fontSize: '1rem',
                fontWeight: '600',
                background: (loading || verificationCode.length !== 6) ? '#ccc' : '#5C6B50',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: (loading || verificationCode.length !== 6) ? 'not-allowed' : 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                transition: 'background 0.2s',
                marginBottom: '0.5rem'
              }}
            >
              {loading ? 'Verifying...' : 'Verify Code'}
            </button>

            <button
              type="button"
              onClick={handleReset}
              style={{
                width: '100%',
                padding: '0.5rem',
                fontSize: '0.9rem',
                background: 'transparent',
                color: '#5C6B50',
                border: '1px solid #5C6B50',
                borderRadius: '8px',
                cursor: 'pointer'
              }}
            >
              Use Different Phone Number
            </button>
          </form>
        )}

        {/* Step 3: Results */}
        {step === 'result' && result && (
          <div>
            <div style={{
              padding: '1.5rem',
              background: '#f0f9f0',
              border: '2px solid #5C6B50',
              borderRadius: '12px',
              marginBottom: '1rem'
            }}>
              <h2 style={{
                fontSize: '1.2rem',
                fontWeight: '600',
                color: '#333',
                marginBottom: '1rem'
              }}>
                {result.adminAccess ? 'Customer Referral Information' : 'Your Referral Information'}
              </h2>
              
              {result.adminAccess && (
                <div style={{
                  padding: '0.5rem',
                  background: '#fff3cd',
                  border: '1px solid #ffc107',
                  borderRadius: '6px',
                  marginBottom: '1rem',
                  fontSize: '0.85rem',
                  color: '#856404'
                }}>
                  ℹ️ Admin Access - This lookup was performed by a team member
                </div>
              )}

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
                  transition: 'background 0.2s',
                  marginBottom: '0.5rem'
                }}
              >
                {copied ? '✓ Copied!' : 'Copy URL'}
              </button>

              <button
                onClick={() => {
                  if (adminMode) {
                    handleAdminReset()
                  } else {
                    handleReset()
                  }
                }}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  fontSize: '0.9rem',
                  background: 'transparent',
                  color: '#5C6B50',
                  border: '1px solid #5C6B50',
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              >
                {adminMode ? 'Search Another Customer' : 'Lookup Another Number'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
