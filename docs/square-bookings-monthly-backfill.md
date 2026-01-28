# Square Bookings Monthly Historical Backfill

## Overview

This script fetches historical bookings from Square in **monthly chunks**, starting from January 2022 (or 2023) up to the present, and stores them in the database with full verification.

**CRITICAL**: Square does NOT return historical bookings unless a `start_at_range` filter is explicitly provided. This script processes month by month to ensure all historical data is captured.

## Features

- ✅ **Monthly chunking**: Processes bookings month by month to comply with Square's requirements
- ✅ **Customer filtering**: Can filter bookings for a specific customer ID
- ✅ **Date range control**: Start from 2022, 2023, or any custom date range
- ✅ **Full verification**: Verifies completeness after backfill
- ✅ **Rate limit handling**: Automatic retry with exponential backoff
- ✅ **Progress tracking**: Shows progress for each month

## Usage

### Basic Usage

Backfill all bookings for a location from 2022 to present:

```bash
node scripts/square-bookings-monthly-backfill.js --location LT4ZHFBQQYB2N
```

### Filter by Customer

Backfill bookings for a specific customer:

```bash
node scripts/square-bookings-monthly-backfill.js --location LT4ZHFBQQYB2N --customer E4WWWKMSZM3KY4RSNNBV5398GG
```

### Start from 2023

If you want to start from 2023 instead of 2022:

```bash
node scripts/square-bookings-monthly-backfill.js --location LT4ZHFBQQYB2N --start-year 2023
```

### Custom Date Range

Backfill a specific date range:

```bash
node scripts/square-bookings-monthly-backfill.js --location LT4ZHFBQQYB2N --start-date 2022-06-01 --end-date 2022-12-31
```

### Skip Verification

Skip verification after backfill (faster, but less safe):

```bash
node scripts/square-bookings-monthly-backfill.js --location LT4ZHFBQQYB2N --no-verify
```

## Command Line Options

| Option | Short | Description | Required |
|--------|-------|-------------|----------|
| `--location` | `-l` | Square location ID | ✅ Yes |
| `--customer` | `-c` | Square customer ID to filter by | No |
| `--start-year` | | Start year (default: 2022) | No |
| `--start-date` | | Start date in ISO format (YYYY-MM-DD) | No |
| `--end-date` | | End date in ISO format (default: now) | No |
| `--no-verify` | | Skip verification after backfill | No |
| `--help` | `-h` | Show help message | No |

## How It Works

1. **Monthly Chunking**: The script generates monthly date ranges from the start date to the end date
2. **Square API Calls**: For each month, it calls Square's `/v2/bookings/search` API with:
   - `start_at_range` filter (REQUIRED by Square)
   - `locationIds` filter
   - `customerIds` filter (if customer ID is provided)
3. **Pagination**: Handles pagination within each month using cursor-based traversal
4. **Database Storage**: UPSERTs each booking into the database (no duplicates)
5. **Verification**: After all months are processed, verifies completeness

## Example Output

```
🔑 Using Square Production environment
📍 Location ID: LT4ZHFBQQYB2N
👤 Customer ID: E4WWWKMSZM3KY4RSNNBV5398GG

✅ Location found: Union St

📅 Processing 24 month(s) from 2022-01-01 to 2024-01-01

============================================================
📆 Month 1/24: 2022-01
   From: 2022-01-01T00:00:00.000Z
   To:   2022-02-01T00:00:00.000Z
============================================================
📄 Page 1: Processing 15 booking(s)...
   Progress: Page 1, Fetched: 15, Upserted: 15

✅ Month 2022-01 completed:
   Fetched: 15
   Upserted: 15
   Errors: 0
   Retries: 0

[... continues for each month ...]

============================================================
📊 OVERALL SUMMARY
============================================================
   Months processed: 24/24
   Total fetched: 342
   Total upserted: 342
   Total errors: 0
   Total retries: 0
   Duration: 45.32s
============================================================

📊 Customer E4WWWKMSZM3KY4RSNNBV5398GG bookings in database: 342

✅ Monthly backfill completed successfully!
```

## Technical Details

### Square API Requirements

- **MUST** include `start_at_range` in every `/v2/bookings/search` request
- Without `start_at_range`, Square may return:
  - Only future bookings
  - Or an empty list with no error
- Square indexes bookings by `start_at`, not `created_at`

### Request Format

For each month, the script sends:

```json
{
  "limit": 100,
  "query": {
    "filter": {
      "locationIds": ["LOCATION_ID"],
      "customerIds": ["CUSTOMER_ID"],  // Optional
      "startAtRange": {
        "startAt": "2022-01-01T00:00:00Z",
        "endAt": "2022-02-01T00:00:00Z"
      }
    }
  }
}
```

### Database Schema

Bookings are stored in the `bookings` table with:
- `id`: Square booking ID (primary key)
- `customer_id`: Square customer ID (nullable)
- `location_id`: Square location ID
- `start_at`: Booking start time
- `raw_json`: Complete booking object from Square API (JSONB)
- All other booking fields

## Environment Variables

Required:
- `SQUARE_ACCESS_TOKEN` or `SQUARE_ACCESS_TOKEN_2` - Square API access token
- `DATABASE_URL` - PostgreSQL connection string

Optional:
- `SQUARE_ENV` - `production` or `sandbox` (default: `production`)

## Troubleshooting

### "Authentication failed"
- Check `SQUARE_ACCESS_TOKEN` is valid
- Verify token has `BOOKINGS_READ` permission

### "Invalid location_id"
- Verify location ID exists in Square
- Check location ID format (should be like `LT4ZHFBQQYB2N`)

### "Rate limited" (429 errors)
- Normal for large backfills
- System will automatically retry with backoff
- Consider running during off-peak hours

### No bookings found for customer
- Verify customer ID is correct
- Check if customer has bookings in the specified date range
- Try without customer filter to see all bookings

## Safety Features

1. **Idempotent**: Safe to run multiple times
2. **UPSERT**: No duplicates, always latest version
3. **Raw JSON**: Immutable source of truth preserved
4. **Error Recovery**: Continues on non-fatal errors
5. **Progress Tracking**: Can see progress for each month

## Performance

For a typical backfill:
- **~100 bookings/second** (with API delays)
- **~10 pages/second** (100 bookings/page)
- **Automatic rate limit handling**

Example: 10,000 bookings across 24 months ≈ 5-10 minutes

## Related Scripts

- `scripts/square-bookings-backfill.js` - Original backfill script (single date range)
- `lib/square-bookings-backfill.js` - Core backfill class




