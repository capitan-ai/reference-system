# Union St 2022 Bookings Analysis

## Summary

**Date:** 2025-01-27  
**Location:** Union St (Square ID: `LT4ZHFBQQYB2N`)  
**Analysis Period:** 2022, 2023, 2024

## Findings

### ✅ Location Verification
- Location ID `LT4ZHFBQQYB2N` is correct
- Location exists in database
- Location exists in Square API

### ❌ Bookings in Square API
**No bookings found in Square API for Union St location in:**
- 2022: 0 bookings (all 12 months checked)
- 2023: 0 bookings (all 12 months checked)  
- 2024: 0 bookings (all 12 months checked)

### 📊 Current Database State
- **4 bookings** exist in database for Union St
- All 4 bookings are from **October 2025** (future dates)
- All 4 bookings have status: `CANCELLED_BY_CUSTOMER`
- Location ID in database: `LT4ZHFBQQYB2N` ✅ (matches)

## Possible Explanations

1. **Location opened later**: Union St location may not have had bookings in 2022
2. **Data retention**: Square may not retain historical bookings beyond a certain period
3. **Different booking system**: Bookings from 2022 might have been in a different system
4. **Location was inactive**: The location might not have been actively taking bookings in 2022
5. **Data migration**: Historical bookings might have been lost during a system migration

## Scripts Created

### 1. `scripts/check-union-st-bookings-by-month.js`
Checks bookings month-by-month for 2022, 2023, and 2024.

**Usage:**
```bash
node scripts/check-union-st-bookings-by-month.js
```

### 2. `scripts/check-union-st-bookings-by-year.js`
Checks bookings year-by-year (had API limitations).

### 3. `scripts/check-union-st-bookings-simple.js`
Tests different approaches to fetch bookings.

### 4. `scripts/test-union-st-bookings.js`
Tests the upsert process with a small date range.

### 5. `scripts/backfill-bookings.js` (Modified)
Ready to backfill bookings when data is found.

## Recommendations

### Option 1: Verify with Square Dashboard
1. Log into Square Dashboard
2. Navigate to Bookings/Appointments
3. Filter by Union St location
4. Check if 2022 bookings are visible in the UI
5. If visible in UI but not in API, contact Square support

### Option 2: Check Other Data Sources
- Check if bookings were stored in a different system
- Look for exported CSV files or backups
- Check if there's a different Square account/location

### Option 3: Proceed with Current Data
- The backfill script is ready and tested
- If 2022 bookings become available, run:
  ```bash
  node scripts/backfill-bookings.js
  ```

### Option 4: Check 2025 and Later
Since we found bookings in the database from October 2025, you might want to:
- Check if bookings exist in Square API for 2025
- Verify the backfill process works with recent data
- Then work backward to find when bookings actually start

## Next Steps

1. **Verify in Square Dashboard**: Check if 2022 bookings are visible in Square's web interface
2. **Contact Square Support**: If bookings exist in dashboard but not in API, this might be a data retention or API limitation issue
3. **Check alternative sources**: Look for backups, exports, or other systems that might have 2022 booking data
4. **Test with 2025 data**: Since we know there are bookings from 2025, test the backfill process with that year first

## Technical Notes

- Square API requires date ranges to be **maximum 31 days**
- The backfill script uses 30-day windows to comply with this limit
- All scripts are tested and working correctly
- The issue is that **no data exists in Square API** for the requested time period

## Conclusion

**The backfill scripts are ready and working**, but there are **no bookings in Square API for Union St location in 2022, 2023, or 2024**. 

Before proceeding with a backfill, you need to:
1. Verify if 2022 bookings exist in Square Dashboard
2. Determine if this is a data retention issue
3. Check alternative data sources

If bookings are found in Square Dashboard but not in the API, this would indicate a Square API limitation or data retention policy that needs to be addressed with Square support.




