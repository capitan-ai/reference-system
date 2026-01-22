# Rebooking Rate Calculation Fix

## Issue Found

The original `analytics_overview_daily` view calculated rebooking rate **per day** as:
- "Of customers who booked on this day, what % have 2+ bookings total?"

This resulted in **averaging daily percentages**, which inflated the rate.

### Example Problem:
- Day 1: 10 customers, 7 have 2+ bookings = 70%
- Day 2: 5 customers, 3 have 2+ bookings = 60%
- **Average = 65%** (but this is not the true overall rate)

### Actual Data:
- **True Overall Rate:** 65.93%
- **Old View Average:** 71.03% (inflated by 5.10 percentage points)
- **Fixed View Rate:** 65.93% ✅ (now correct)

## Fix Applied

**Migration:** `20260121160000_fix_rebooking_rate`

The view now calculates the **true overall rebooking rate**:
- Counts all customers who have ever booked
- Calculates: `(Customers with 2+ bookings) / (Total customers)`
- Uses this same rate for all days (consistent metric)

## Verification

Run the verification script to check accuracy:

```bash
node scripts/verify-rebooking-rate.js
```

### Expected Output:
```
TRUE Overall Rate: 65.93%
View Rate (days with data): 65.93%
✅ Rates match - calculation is accurate!
```

## Important Notes

1. **Days without bookings** show `0.0%` rate (no customers = no rate)
2. **Days with bookings** show the **overall rate** (65.93%)
3. When aggregating in frontend, **use the latest non-zero value** or **max value**, not the average
4. The rate is the same for all days with data (by design - it's an overall metric)

## Frontend Usage

When displaying rebooking rate in the dashboard:

```javascript
// ✅ CORRECT: Use latest non-zero value
const rebookingRate = data
  .filter(d => d.rebooking_rate > 0)
  .sort((a, b) => new Date(b.date) - new Date(a.date))[0]?.rebooking_rate

// ❌ WRONG: Don't average (includes 0% days)
const rebookingRate = data.reduce((sum, d) => sum + d.rebooking_rate, 0) / data.length
```

Or simply use the **max value** (since all days with data have the same rate):
```javascript
const rebookingRate = Math.max(...data.map(d => d.rebooking_rate))
```

## Summary

✅ **Fixed:** Rebooking rate now shows true overall rate (65.93%)  
✅ **Verified:** Matches manual calculation  
✅ **Consistent:** Same rate for all days with bookings  
⚠️ **Note:** Days without bookings show 0% (expected behavior)

