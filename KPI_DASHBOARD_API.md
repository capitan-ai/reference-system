# KPI Dashboard API

## Overview

The KPI Dashboard endpoint provides the 4 main business metrics with automatic comparison to the previous period:

1. ✅ **Appointments** - ACCEPTED bookings only
2. ❌ **Cancelled** - CANCELLED_BY_CUSTOMER + CANCELLED_BY_SELLER combined
3. ⏸️ **No-Show** - NO_SHOW bookings
4. 💰 **Revenue** - Clean revenue without tips

Each metric includes:
- Current period value
- Previous period value
- Percentage change (%)
- Direction indicator (up/down)

## Endpoint

```
GET /api/admin/analytics/kpi?organizationId=xxx&startDate=2026-02-01&endDate=2026-02-28&locationId=yyy
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `organizationId` | UUID | Yes | Organization ID |
| `startDate` | YYYY-MM-DD | No | Start date (defaults to 1st of current month) |
| `endDate` | YYYY-MM-DD | No | End date (defaults to today) |
| `locationId` | UUID | No | Filter by specific location |

## Response Format

```json
{
  "periods": {
    "current": {
      "start": "2026-02-01",
      "end": "2026-02-28"
    },
    "previous": {
      "start": "2026-01-04",
      "end": "2026-01-31"
    }
  },
  "kpis": {
    "appointments": {
      "label": "Appointments",
      "current": 1026,
      "previous": 1839,
      "change_percent": -44.2,
      "change_direction": "down"
    },
    "cancelled": {
      "label": "Cancelled",
      "current": 282,
      "previous": 449,
      "change_percent": -37.2,
      "change_direction": "down"
    },
    "no_show": {
      "label": "No-Show",
      "current": 0,
      "previous": 0,
      "change_percent": 0,
      "change_direction": "down"
    },
    "revenue": {
      "label": "Revenue",
      "current": 100819.14,
      "current_formatted": "$100819.14",
      "previous": 163627.42,
      "previous_formatted": "$163627.42",
      "change_percent": -38.4,
      "change_direction": "down",
      "payments": 773,
      "average_transaction": "130.43"
    }
  },
  "summary": {
    "period_label": "2026-02-01 to 2026-02-28",
    "period_days": 28,
    "locations": "All"
  }
}
```

## Display Format

### KPI Card Layout (4 columns)

```
┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐
│  ✅ APPOINTMENTS│  ❌ CANCELLED   │  ⏸️  NO-SHOW   │  💰 REVENUE    │
├─────────────────┼─────────────────┼─────────────────┼─────────────────┤
│  1,026          │  282            │  0              │  $100,819.14    │
│  ↓ -44.2%       │  ↓ -37.2%       │  ↔ 0%           │  ↓ -38.4%       │
│  vs 1,839       │  vs 449         │  vs 0           │  vs $163,627.42 │
└─────────────────┴─────────────────┴─────────────────┴─────────────────┘
```

## Frontend Implementation

### React Component Example

```typescript
import { useState, useEffect } from 'react'

export function KPIDashboard({ organizationId, startDate, endDate }) {
  const [kpis, setKpis] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchKPIs = async () => {
      const params = new URLSearchParams({
        organizationId,
        ...(startDate && { startDate }),
        ...(endDate && { endDate })
      })
      
      const response = await fetch(`/api/admin/analytics/kpi?${params}`)
      const data = await response.json()
      setKpis(data)
      setLoading(false)
    }

    fetchKPIs()
  }, [organizationId, startDate, endDate])

  if (loading) return <div>Loading...</div>
  if (!kpis) return <div>Error loading KPIs</div>

  return (
    <div className="grid grid-cols-4 gap-4">
      <KPICard
        label="Appointments"
        icon="✅"
        current={kpis.kpis.appointments.current}
        previous={kpis.kpis.appointments.previous}
        change={kpis.kpis.appointments.change_percent}
        direction={kpis.kpis.appointments.change_direction}
      />
      
      <KPICard
        label="Cancelled"
        icon="❌"
        current={kpis.kpis.cancelled.current}
        previous={kpis.kpis.cancelled.previous}
        change={kpis.kpis.cancelled.change_percent}
        direction={kpis.kpis.cancelled.change_direction}
      />
      
      <KPICard
        label="No-Show"
        icon="⏸️"
        current={kpis.kpis.no_show.current}
        previous={kpis.kpis.no_show.previous}
        change={kpis.kpis.no_show.change_percent}
        direction={kpis.kpis.no_show.change_direction}
      />
      
      <KPICard
        label="Revenue"
        icon="💰"
        current={kpis.kpis.revenue.current_formatted}
        previous={kpis.kpis.revenue.previous_formatted}
        change={kpis.kpis.revenue.change_percent}
        direction={kpis.kpis.revenue.change_direction}
        additional={`Avg: $${kpis.kpis.revenue.average_transaction}`}
      />
    </div>
  )
}

function KPICard({ label, icon, current, previous, change, direction, additional }) {
  const isPositive = direction === 'up'
  const changeColor = isPositive ? 'text-green-600' : 'text-red-600'
  const changeArrow = isPositive ? '↑' : '↓'

  return (
    <div className="bg-white rounded-lg p-6 shadow">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-600">{label}</h3>
        <span className="text-2xl">{icon}</span>
      </div>
      
      <div className="mb-2">
        <div className="text-3xl font-bold text-gray-900">{current}</div>
        <div className={`text-sm ${changeColor} font-semibold`}>
          {changeArrow} {Math.abs(change)}%
        </div>
      </div>
      
      <div className="text-xs text-gray-500 space-y-1">
        <div>vs {previous}</div>
        {additional && <div className="font-semibold text-gray-700">{additional}</div>}
      </div>
    </div>
  )
}
```

## Period Comparison Logic

The endpoint automatically calculates the previous period with the same length:

```
Current:  Feb 1-28  (28 days)
Previous: Jan 4-31  (28 days)

So if you pass:
  startDate=2026-02-01, endDate=2026-02-28
  
The previous period is calculated as:
  28 days before Feb 1st = Jan 4 to Jan 31
```

This ensures fair comparison between periods of the same length.

## Data Sources

### Appointments & Cancellations
- **View**: `analytics_appointments_by_location_daily`
- **Metrics**: 
  - `appointments_count` = ACCEPTED bookings only
  - `cancelled_appointments` = CANCELLED_BY_CUSTOMER + CANCELLED_BY_SELLER
  - `no_show_appointments` = NO_SHOW bookings

### Revenue
- **View**: `analytics_revenue_by_location_daily`
- **Amount**: `revenue_dollars` (clean, without tips)
- **Payments**: `payment_count` (COMPLETED only)

## Example API Calls

### Today vs Yesterday
```bash
curl "http://localhost:3000/api/admin/analytics/kpi?organizationId=d0e24178-2f94-4033-bc91-41f22df58278"
```

### February vs January
```bash
curl "http://localhost:3000/api/admin/analytics/kpi?organizationId=d0e24178-2f94-4033-bc91-41f22df58278&startDate=2026-02-01&endDate=2026-02-28"
```

### Union St Location Only
```bash
curl "http://localhost:3000/api/admin/analytics/kpi?organizationId=d0e24178-2f94-4033-bc91-41f22df58278&startDate=2026-02-01&endDate=2026-02-28&locationId=2266-union-st-id"
```

## Notes

- All percentages are calculated as `(current - previous) / previous * 100`
- If previous period has 0 value and current is > 0, change shows as 100%
- If previous period has 0 value and current is 0, change shows as 0%
- Timezone: Pacific Time (America/Los_Angeles) for date grouping
- Revenue amounts are in dollars with 2 decimal places

