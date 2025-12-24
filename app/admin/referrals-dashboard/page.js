'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import dayjs from 'dayjs'
import { useTheme } from '../../../lib/theme-context'

const LOCATION_OPTIONS = [
  { id: 'all', label: 'All Locations' },
  { id: 'union', label: 'Union St' },
  { id: 'pacific', label: 'Pacific Ave' },
]

const LIGHT_PALETTE = {
  background: '#f4f6fb',
  card: '#ffffff',
  border: '#dfe3f8',
  text: '#0f172a',
  subtext: '#5f6b8c',
  accent: '#1f3aff',
  accentAlt: '#ffb347',
  success: '#16a34a',
  warning: '#f97316',
  danger: '#ef4444',
}

const DARK_PALETTE = {
  background: '#050914',
  card: '#0f172a',
  border: '#1f2540',
  text: '#f8fafc',
  subtext: '#c7d2fe',
  accent: '#7c8dff',
  accentAlt: '#ffb347',
  success: '#22c55e',
  warning: '#fb923c',
  danger: '#f87171',
}

function formatCurrency(cents = 0) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`
}

function formatPercent(value = 0) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`
}

function requestJson(url, options = {}) {
  return fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    ...options,
  }).then(async (res) => {
    if (res.status === 401) {
      const err = new Error('unauthorized')
      err.status = 401
      throw err
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      const err = new Error(data.error || 'Request failed')
      err.status = res.status
      throw err
    }
    return res.json()
  })
}

function Card({ title, subtitle, children, highlight, palette }) {
  return (
    <div
      style={{
        border: `1px solid ${highlight ? palette.accent : palette.border}`,
        borderRadius: 24,
        padding: 24,
        background: highlight ? 'linear-gradient(135deg,#1f3aff,#7c8dff)' : palette.card,
        color: highlight ? '#fff' : palette.text,
        boxShadow: '0 20px 45px rgba(31,58,255,0.08)',
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <p
          style={{
            fontSize: 12,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: highlight ? '#e0e7ff' : palette.subtext,
            margin: 0,
          }}
        >
          {title}
        </p>
        {subtitle ? (
          <p style={{ fontSize: 28, margin: '6px 0 0', fontWeight: 600 }}>{subtitle}</p>
        ) : null}
      </div>
      <div style={{ fontSize: 14, color: highlight ? '#e0e7ff' : palette.subtext }}>{children}</div>
    </div>
  )
}

function StatBar({ label, data, color, palette }) {
  const { sent = 0, delivered = 0, failed = 0 } = data || {}
  const total = sent || 1
  const deliveredPct = Math.round((delivered / total) * 100)
  const failedPct = Math.round((failed / total) * 100)
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: palette.subtext }}>
        <span>{label}</span>
        <span>{sent} sent</span>
      </div>
      <div style={{ position: 'relative', height: 9, borderRadius: 999, background: '#edf1ff', overflow: 'hidden', marginTop: 6 }}>
        <div style={{ width: `${deliveredPct}%`, background: color || palette.accent, height: '100%' }} />
        {failed ? (
          <div
            style={{
              width: `${failedPct}%`,
              background: palette.danger,
              height: '100%',
              position: 'absolute',
              right: 0,
            }}
          />
        ) : null}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9aa2c6', marginTop: 4 }}>
        <span>{delivered} delivered</span>
        <span>{failed} failed</span>
      </div>
    </div>
  )
}

export default function ReferralsDashboardPage() {
  const { theme, toggleTheme } = useTheme()
  const palette = theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE

  const [rangeDays, setRangeDays] = useState(30)
  const [location, setLocation] = useState('all')
  const [locationOptions, setLocationOptions] = useState(LOCATION_OPTIONS)
  const [summary, setSummary] = useState(null)
  const [leaderboard, setLeaderboard] = useState([])
  const [notifications, setNotifications] = useState([])
  const [processRuns, setProcessRuns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [loginKey, setLoginKey] = useState('')
  const [loginPending, setLoginPending] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatPending, setChatPending] = useState(false)
  const [chatResponse, setChatResponse] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ rangeDays: String(rangeDays) })
      if (location && location !== 'all') {
        params.set('location', location)
      }
      const [summaryData, referrersData, notificationsData, runsData] = await Promise.all([
        requestJson(`/api/admin/referrals/summary?${params.toString()}`),
        requestJson('/api/admin/referrals/referrers?limit=5&sort=revenue'),
        requestJson('/api/admin/referrals/notifications?limit=6'),
        requestJson('/api/admin/referrals/process-runs?limit=5'),
      ])
      setSummary(summaryData)
      if (summaryData.locations?.length) {
        setLocationOptions(summaryData.locations)
      }
      setLeaderboard(referrersData.data || [])
      setNotifications(notificationsData.data || [])
      setProcessRuns(runsData.data || [])
      setNeedsLogin(false)
    } catch (err) {
      if (err.status === 401) {
        setNeedsLogin(true)
      } else {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }, [rangeDays, location])

  useEffect(() => {
    load()
  }, [load])

  const handleLogin = async (event) => {
    event.preventDefault()
    if (!loginKey) return
    setLoginPending(true)
    try {
      await requestJson('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminKey: loginKey }),
      })
      setLoginKey('')
      setNeedsLogin(false)
      await load()
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setLoginPending(false)
    }
  }

  const handleLogout = async () => {
    await fetch('/api/admin/session', { method: 'DELETE', credentials: 'include' })
    setNeedsLogin(true)
  }

  const handleChat = async (event) => {
    event.preventDefault()
    if (!chatInput.trim()) return
    setChatPending(true)
    try {
      const res = await requestJson('/api/admin/referrals/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: chatInput, rangeDays, location }),
      })
      setChatResponse(res)
      setChatInput('')
    } catch (err) {
      if (err.status === 401) {
        setNeedsLogin(true)
      } else {
        setChatResponse({ answer: err.message })
      }
    } finally {
      setChatPending(false)
    }
  }

  const locationLabelMap = useMemo(
    () => Object.fromEntries(locationOptions.map((loc) => [loc.id, loc.label])),
    [locationOptions],
  )
  const currentLocationLabel = locationLabelMap[location] || 'All Locations'

  if (needsLogin) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: palette.background }}>
        <div style={{ width: 360, background: palette.card, borderRadius: 28, padding: 32, boxShadow: '0 30px 60px rgba(15,23,42,0.12)' }}>
          <h1 style={{ fontSize: 26, fontFamily: 'var(--font-display)', color: palette.text }}>Studio Zorina Admin</h1>
          <p style={{ fontSize: 14, color: palette.subtext, marginTop: 8 }}>Enter the admin key to unlock the dashboard.</p>
          <form style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }} onSubmit={handleLogin}>
            <input
              type="password"
              value={loginKey}
              onChange={(e) => setLoginKey(e.target.value)}
              placeholder="Admin key"
              style={{ padding: '12px 16px', borderRadius: 16, border: `1px solid ${palette.border}`, fontSize: 14 }}
            />
            <button
              type="submit"
              disabled={loginPending}
              style={{ padding: '12px 16px', borderRadius: 16, background: palette.accent, color: '#fff', fontWeight: 600, border: 'none' }}
            >
              {loginPending ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          {error ? <p style={{ color: palette.danger, marginTop: 12 }}>{error}</p> : null}
        </div>
      </main>
    )
  }

  const issues = summary?.issues || { failedNotifications: 0, deadLetters: 0, activeProcesses: 0 }
  const metrics = summary?.metrics || {}
  const giftCards =
    metrics.giftCards || {
      totals: { newRewardsCents: 0, newRewardsCount: 0, referrerRewardsCents: 0, referrerRewardsCount: 0 },
      byLocation: {},
    }
  const monthlyRevenue = metrics.monthlyRevenue || []
  const chatAnswerBg = theme === 'dark' ? '#111b33' : '#f1f5f9'

  return (
    <main style={{ minHeight: '100vh', background: palette.background, color: palette.text, padding: '48px 16px' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
          <div>
            <p style={{ fontSize: 12, letterSpacing: 4, textTransform: 'uppercase', color: palette.subtext }}>Automation Hub</p>
            <h1 style={{ fontSize: 38, margin: '4px 0', fontFamily: 'var(--font-display)', color: palette.text }}>Studio Zorina Dashboard</h1>
            <p style={{ fontSize: 15, color: palette.subtext }}>Track referral performance, communications, and payouts.</p>
            <p style={{ fontSize: 13, color: palette.subtext, marginTop: 6 }}>Showing: {currentLocationLabel}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={toggleTheme}
              style={{
                padding: '10px 16px',
                borderRadius: 999,
                border: `1px solid ${palette.border}`,
                background: theme === 'dark' ? palette.card : '#fff',
                color: palette.text,
              }}
            >
              {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
            </button>
            <select value={rangeDays} onChange={(e) => setRangeDays(Number(e.target.value))} style={{ padding: '10px 16px', borderRadius: 999, border: `1px solid ${palette.border}`, background: '#fff' }}>
              {[7, 14, 30, 60, 90].map((value) => (
                <option key={value} value={value}>{`Last ${value} days`}</option>
              ))}
            </select>
            <button
              onClick={load}
              style={{
                padding: '10px 20px',
                borderRadius: 999,
                border: 'none',
                background: palette.accent,
                color: '#fff',
                fontWeight: 600,
                boxShadow: '0 8px 20px rgba(31,58,255,0.25)',
              }}
            >
              Refresh
            </button>
            <button
              onClick={handleLogout}
              style={{
                padding: '10px 20px',
                borderRadius: 999,
                border: `1px solid ${palette.border}`,
                background: theme === 'dark' ? '#111b33' : '#fff',
                color: palette.text,
              }}
            >
              Logout
            </button>
          </div>
        </header>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {locationOptions.map((option) => {
            const active = option.id === location
            return (
              <button
                key={option.id}
                onClick={() => setLocation(option.id)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 999,
                  border: active ? 'none' : `1px solid ${palette.border}`,
                  background: active ? palette.accent : 'transparent',
                  color: active ? '#fff' : palette.subtext,
                  fontWeight: active ? 600 : 500,
                }}
              >
                {option.label}
              </button>
            )
          })}
        </div>

        {loading ? <Card palette={palette} title="Loading" subtitle=" "><p>Fetching latest data…</p></Card> : null}
        {error && !loading ? <Card palette={palette} title="Error" subtitle=" "><p style={{ color: palette.danger }}>{error}</p></Card> : null}

        {summary ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <Card palette={palette} title="New Customers" subtitle={metrics.newCustomers}>
              Since {dayjs(summary.range.since).format('MMM D')}
            </Card>
            <Card palette={palette} title="Codes Redeemed" subtitle={metrics.codesRedeemed}>
              Friends who used a referral
            </Card>
            <Card palette={palette} title="$10 Paid To New Customers" subtitle={formatCurrency(metrics.rewardsNewCents)}>
              Gift cards issued instantly
            </Card>
            <Card palette={palette} title="$10 Paid To Referrers" subtitle={formatCurrency(metrics.rewardsReferrerCents)}>
              Rewards triggered on payment
            </Card>
            <Card palette={palette} title="Referral Revenue" subtitle={formatCurrency(metrics.revenueCents)}>
              Payments attributed to referrals
            </Card>
            <Card palette={palette} title="Bookings" subtitle={metrics.bookings || 0}>
              Completed during range
            </Card>
            <Card palette={palette} title="Cancellations" subtitle={metrics.cancellations || 0}>
              Booking cancellations
            </Card>
            <Card palette={palette} title="Failed Notifications" subtitle={issues.failedNotifications}>
              SMS + email errors
            </Card>
            <Card palette={palette} title="Dead-letter Queue" subtitle={issues.deadLetters}>
              Events awaiting retry
            </Card>
            <Card palette={palette} title="Active Processes" subtitle={issues.activeProcesses}>
              Automations currently running
            </Card>
          </div>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <Card palette={palette} title="Communication Analytics" subtitle=" ">
            <StatBar label="SMS" data={metrics.sms} palette={palette} />
            <StatBar label="Emails" data={metrics.emails} color={palette.accentAlt} palette={palette} />
          </Card>
          <Card palette={palette} title="Issues Snapshot" subtitle=" ">
            <p>Failed notifications: {issues.failedNotifications}</p>
            <p>Dead-letter backlog: {issues.deadLetters}</p>
            <p>Running processes: {issues.activeProcesses}</p>
          </Card>
          <Card palette={palette} title="Monthly Revenue" subtitle="Last 6 months">
            {monthlyRevenue.length ? (
              monthlyRevenue.map((entry) => (
                <div key={entry.month} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8 }}>
                  <span>{dayjs(entry.month).format('MMM YYYY')}</span>
                  <strong>{formatCurrency(entry.totalCents)}</strong>
                </div>
              ))
            ) : (
              <p style={{ color: palette.subtext }}>No revenue trend yet.</p>
            )}
          </Card>
          <Card palette={palette} title="Gift Cards" subtitle="Issuance by role">
            <p style={{ marginBottom: 6 }}>New customers: {formatCurrency(giftCards.totals.newRewardsCents)} ({giftCards.totals.newRewardsCount})</p>
            <p style={{ marginBottom: 12 }}>Referrers: {formatCurrency(giftCards.totals.referrerRewardsCents)} ({giftCards.totals.referrerRewardsCount})</p>
            {Object.entries(giftCards.byLocation).map(([locId, stats]) => (
              <div key={locId} style={{ fontSize: 13, marginBottom: 6 }}>
                <strong>{locationLabelMap[locId] || locId}</strong>
                <div style={{ color: palette.subtext }}>
                  New: {formatCurrency(stats.newRewardsCents)} • Referrers: {formatCurrency(stats.referrerRewardsCents)}
                </div>
              </div>
            ))}
            {!Object.keys(giftCards.byLocation).length ? <p style={{ color: palette.subtext }}>No location breakdown yet.</p> : null}
          </Card>
        </div>

        <Card palette={palette} title="Top Referrers" subtitle={`Top ${leaderboard.length}`}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ color: palette.subtext, textAlign: 'left' }}>
                  <th>Referrer</th>
                  <th>New Customers</th>
                  <th>Codes Redeemed</th>
                  <th>$10 Rewards</th>
                  <th>Revenue</th>
                  <th>Conversion</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((entry) => (
                  <tr key={entry.id} style={{ borderTop: `1px solid ${palette.border}` }}>
                    <td style={{ padding: '12px 0' }}>
                      <div style={{ fontWeight: 600 }}>{entry.name || 'Unknown'}</div>
                      <div style={{ fontSize: 12, color: palette.subtext }}>{entry.email || entry.squareCustomerId}</div>
                    </td>
                    <td>{entry.stats.newCustomersTotal}</td>
                    <td>{entry.stats.codesRedeemedTotal}</td>
                    <td>{formatCurrency(entry.stats.rewardsPaidCents)}</td>
                    <td>{formatCurrency(entry.stats.revenueAttributedCents)}</td>
                    <td>{formatPercent(entry.stats.conversionRate)}</td>
                  </tr>
                ))}
                {!leaderboard.length ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 24, color: palette.subtext }}>
                      No referrer stats yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <Card palette={palette} title="Notifications" subtitle={`Latest ${notifications.length}`}>
            {notifications.map((event) => (
              <div key={event.id} style={{ border: `1px solid ${palette.border}`, borderRadius: 18, padding: 14, marginBottom: 12 }}>
                <strong>{event.channel} • {event.templateType || 'Template'}</strong>
                <div style={{ fontSize: 12, color: palette.subtext }}>{event.status} — {dayjs(event.createdAt).format('MMM D, HH:mm')}</div>
              </div>
            ))}
            {!notifications.length ? <p style={{ color: palette.subtext }}>No notifications recorded.</p> : null}
          </Card>
          <Card palette={palette} title="Process Timeline" subtitle={`Latest ${processRuns.length}`}>
            {processRuns.map((run) => (
              <div key={run.id} style={{ border: `1px solid ${palette.border}`, borderRadius: 18, padding: 14, marginBottom: 12 }}>
                <strong>{run.processType}</strong>
                <div style={{ fontSize: 12, color: palette.subtext }}>
                  {run.status.toUpperCase()} • {dayjs(run.createdAt).format('MMM D, HH:mm')}
                </div>
                <div style={{ fontSize: 12, color: palette.text }}>
                  {run.totalCount || 0} items ({run.successCount || 0} ok / {run.failureCount || 0} failed)
                </div>
              </div>
            ))}
            {!processRuns.length ? <p style={{ color: palette.subtext }}>No runs recorded.</p> : null}
          </Card>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <Card palette={palette} title="Ask Zorina Bot" subtitle=" ">
            <p style={{ fontSize: 14, color: palette.subtext }}>Try “How many new customers this month?” or “What’s our referral revenue?”.</p>
            <form onSubmit={handleChat} style={{ display: 'flex', gap: 12, marginTop: 12 }}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type your question…"
                style={{ flex: 1, padding: '12px 16px', borderRadius: 16, border: `1px solid ${palette.border}` }}
              />
              <button type="submit" disabled={chatPending} style={{ padding: '12px 20px', borderRadius: 16, border: 'none', background: palette.accent, color: '#fff' }}>
                {chatPending ? 'Thinking…' : 'Ask'}
              </button>
            </form>
            {chatResponse ? (
              <div style={{ marginTop: 12, background: chatAnswerBg, borderRadius: 16, padding: 16 }}>
                <p style={{ fontWeight: 600, color: palette.text }}>Answer</p>
                <p style={{ fontSize: 14, color: palette.subtext }}>{chatResponse.answer}</p>
              </div>
            ) : null}
          </Card>
          <Card palette={palette} title="Notification Breakdown" subtitle=" ">
            {summary?.notificationBreakdown?.length ? (
              summary.notificationBreakdown.map((item) => (
                <div key={`${item.channel}-${item.templateType || 'default'}`} style={{ marginBottom: 12 }}>
                  <strong>{item.channel} • {item.templateType || 'General'}</strong>
                  <div style={{ fontSize: 12, color: palette.subtext }}>
                    {Object.entries(item.statuses || {}).map(([status, count]) => `${status}: ${count}`).join(' • ')}
                  </div>
                </div>
              ))
            ) : (
              <p style={{ color: palette.subtext }}>No notification analytics yet.</p>
            )}
          </Card>
        </div>
      </div>
    </main>
  )
}