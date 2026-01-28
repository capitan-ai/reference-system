# Union St 2022 Bookings Backfill

## Overview
This document describes how to upsert all historical bookings for the Union St location from 2022 into the database.

## Scripts Created

### 1. `scripts/test-union-st-bookings.js`
**Purpose:** Test script to verify the booking upsert process works correctly with a small date range (1 week in January 2022).

**Usage:**
```bash
node scripts/test-union-st-bookings.js
```

**What it does:**
- Ensures Union St location exists in the database
- Fetches a small sample of bookings (first week of January 2022)
- Tests upserting those bookings
- Verifies the bookings were saved correctly

**Use this first** to verify everything works before running the full backfill.

### 2. `scripts/backfill-bookings.js` (Modified)
**Purpose:** Main script to backfill all Union St bookings from 2022.

**Usage:**
```bash
node scripts/backfill-bookings.js
```

**What it does:**
- Processes only Union St location (LT4ZHFBQQYB2N)
- Fetches bookings from January 1, 2022 to December 31, 2022
- Uses 30-day windows (Square API limit is 31 days)
- Upserts bookings and their appointment segments into the database
- Ensures location exists in database before processing

## Configuration

### Location Details
- **Square Location ID:** `LT4ZHFBQQYB2N`
- **Name:** Union St
- **Address:** 3089 Union St, San Francisco, CA 94123

### Date Range
- **Start:** 2022-01-01T00:00:00Z
- **End:** 2022-12-31T23:59:59Z

### Environment Variables Required
- `SQUARE_ACCESS_TOKEN` or `SQUARE_ACCESS_TOKEN_2` - Square API access token
- `SQUARE_ENV` (optional) - `production` or `sandbox`, defaults to `production`
- `DATABASE_URL` - PostgreSQL connection string (from .env)

## How It Works

1. **Location Setup:** Ensures Union St location exists in the `locations` table
2. **Time Windows:** Processes bookings in 30-day windows, moving backward from end of 2022 to start
3. **API Calls:** Uses Square's `listBookings` API with location and date filters
4. **Upsert Logic:**
   - Upserts booking records (inserts new or updates existing)
   - Deletes existing appointment segments and recreates them
   - Handles all booking fields including address, creator details, etc.

## Testing Steps

1. **Run the test script first:**
   ```bash
   node scripts/test-union-st-bookings.js
   ```

2. **Verify the output:**
   - Should show successful fetch of bookings
   - Should show successful upsert
   - Should verify bookings in database

3. **If test succeeds, run full backfill:**
   ```bash
   node scripts/backfill-bookings.js
   ```

## Expected Output

The script will show:
- Location being processed
- Each 30-day window being processed
- Number of bookings found per window
- Total bookings upserted per location
- Progress as it moves backward through 2022

## Notes

- The script is **idempotent** - you can run it multiple times safely
- Existing bookings will be updated if they've changed
- The script processes bookings in reverse chronological order (newest to oldest)
- Square API has rate limits, so the script may take some time for a full year of data

## Troubleshooting

### Error: "Missing SQUARE_ACCESS_TOKEN"
- Ensure `.env` file has `SQUARE_ACCESS_TOKEN` or `SQUARE_ACCESS_TOKEN_2` set

### Error: "Location not found"
- The script should auto-create the location, but you can manually run:
  ```bash
  node scripts/upsert-locations.js
  ```

### Error: Foreign key constraint
- Ensure the location exists in the `locations` table
- The script should handle this automatically, but verify if issues occur

### No bookings found
- Verify the date range has bookings in Square
- Check that the location ID is correct
- Verify Square API access token has proper permissions

## Database Schema

Bookings are stored in:
- `bookings` table - Main booking records
- `booking_appointment_segments` table - Service segments for each booking

Both tables are linked via `booking_id` foreign key.




