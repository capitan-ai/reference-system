# Square Bookings Historical Backfill

Production-ready system for backfilling all historical bookings from Square API into the database.

## Overview

This system implements a comprehensive backfill solution that:
- ✅ Uses Square's Search API (`POST /v2/bookings/search`)
- ✅ Handles full pagination with cursor-based traversal
- ✅ Implements UPSERT logic (booking_id + version)
- ✅ Stores raw JSON as immutable source of truth
- ✅ Provides multiple verification strategies
- ✅ Supports incremental sync mode
- ✅ Handles rate limits with exponential backoff
- ✅ Robust error handling

## Architecture

### Core Components

1. **`lib/square-bookings-backfill.js`** - Main backfill class
   - `fetchBookingsPage()` - Fetches a single page from Square API
   - `upsertBooking()` - UPSERTs booking with raw JSON
   - `backfillBookings()` - Main backfill orchestration
   - `verifyBackfill()` - Completeness verification

2. **`scripts/square-bookings-backfill.js`** - CLI script
   - Command-line interface
   - Location validation
   - Progress reporting

## Database Schema

The `Booking` model includes:
- All standard booking fields (customer_id, location_id, start_at, etc.)
- `version` field for tracking updates
- `raw_json` field (JSONB) storing the complete booking object from Square API

**Important**: The `raw_json` field serves as the immutable source of truth. All parsed fields are derived from this.

## Usage

### Full Historical Backfill

Backfill all historical bookings for a location:

```bash
node scripts/square-bookings-backfill.js --location LT4ZHFBQQYB2N
```

This will:
1. Fetch ALL bookings from Square (no date limit)
2. Process in pages of 100 (Square's max)
3. UPSERT each booking (insert or update based on booking_id)
4. Store raw JSON for each booking
5. Verify completeness after completion

### Incremental Sync

Only fetch bookings that have been updated since the last sync:

```bash
node scripts/square-bookings-backfill.js --location LT4ZHFBQQYB2N --incremental
```

This will:
1. Find the latest `updated_at` timestamp in the database for this location
2. Only fetch bookings with `updated_at > last_synced_at`
3. Update existing bookings or insert new ones

### Date-Filtered Backfill

Fetch bookings updated after a specific date:

```bash
node scripts/square-bookings-backfill.js --location LT4ZHFBQQYB2N --updated-after 2024-01-01T00:00:00Z
```

### Skip Verification

Skip verification after backfill (faster, but less safe):

```bash
node scripts/square-bookings-backfill.js --location LT4ZHFBQQYB2N --no-verify
```

## Verification Strategies

The system implements **4 independent verification strategies**:

### 1. Count Comparison
- Compares total bookings fetched from Square vs. stored in database
- Should match exactly

### 2. Temporal Coverage
- Verifies earliest and latest `start_at` dates match
- Ensures no data was truncated at the edges

### 3. Pagination Audit
- Logs cursor progression through all pages
- Confirms cursor reached `null` (end of data)
- Tracks bookings per page

### 4. Gap Detection (Sample)
- Samples bookings to detect large time gaps
- Identifies potential missing bookings

## Error Handling

### Retry Logic

The system automatically retries on:
- **429 Rate Limit**: Exponential backoff (1s → 2s → 4s → 8s → 16s → 60s max)
- **5xx Server Errors**: Same exponential backoff

### Fail Hard On

- **401/403 Authentication Errors**: Invalid token
- **400 with Invalid Location**: Location ID doesn't exist

### Log and Continue On

- **Malformed Booking Records**: Logs error, continues processing
- **Partial API Errors**: Logs warning, continues with available data

## Rate Limiting

Square API has rate limits. The system:
- Uses 100ms delay between pages
- Implements exponential backoff on 429 errors
- Tracks total retries in statistics

For large backfills, expect:
- ~10 requests/second (with delays)
- Automatic retry on rate limits
- Progress logging every 10 pages

## UPSERT Logic

Bookings are upserted based on:
- **Primary Key**: `booking_id` (Square booking ID)
- **Version Tracking**: `version` field updated on each change

When a booking is updated in Square:
1. New version number is assigned
2. Existing record is updated (not duplicated)
3. `raw_json` is updated with new data
4. All parsed fields are updated

This ensures:
- ✅ No duplicates
- ✅ Always latest version
- ✅ Historical data preserved in `raw_json`

## Incremental Sync Mode

Incremental sync is designed for ongoing synchronization:

1. **First Run**: Full historical backfill
2. **Subsequent Runs**: Only fetch `updated_at > last_synced_at`

To switch modes:
```javascript
// Full backfill
await backfill.backfillBookings({ incremental: false })

// Incremental sync
await backfill.backfillBookings({ incremental: true })
```

The system automatically determines `last_synced_at` from the database.

## Programmatic Usage

You can also use the backfill class directly in code:

```javascript
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const SquareBookingsBackfill = require('./lib/square-bookings-backfill')

const prisma = new PrismaClient()
const square = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Production
})

const backfill = new SquareBookingsBackfill(prisma, square, 'LT4ZHFBQQYB2N')

// Full backfill
const stats = await backfill.backfillBookings({
  incremental: false,
  onProgress: (progress) => {
    console.log(`Page ${progress.page}: ${progress.totalFetched} fetched`)
  }
})

// Verify
const verification = await backfill.verifyBackfill()
console.log('Verification passed:', verification.allPassed)
```

## Environment Variables

Required:
- `SQUARE_ACCESS_TOKEN` or `SQUARE_ACCESS_TOKEN_2` - Square API access token
- `DATABASE_URL` - PostgreSQL connection string

Optional:
- `SQUARE_ENV` - `production` or `sandbox` (default: `production`)

## Output

The script provides detailed output:

```
🚀 Starting Square bookings backfill
   Location ID: LT4ZHFBQQYB2N
   Mode: Full historical
   Limit per page: 100

📄 Page 1: Processing 100 booking(s)...
📄 Page 2: Processing 100 booking(s)...
   Progress: Page 10, Fetched: 1000, Upserted: 1000
...

✅ Backfill completed!
   Pages processed: 25
   Total fetched: 2500
   Total upserted: 2500
   Total errors: 0
   Total retries: 0
   Duration: 45.32s

🔍 Verifying backfill completeness...

1️⃣ Count Comparison:
   Square API: 2500 bookings
   Database: 2500 bookings
   ✅ Counts match!

2️⃣ Temporal Coverage:
   Square API earliest: 2022-01-15T10:00:00.000Z
   Database earliest: 2022-01-15T10:00:00.000Z
   ✅ Temporal coverage matches!

3️⃣ Pagination Audit:
   ✅ Pagination completed (cursor reached null)

4️⃣ Gap Detection (Sample):
   ✅ No obvious gaps in sample

✅ All verification checks passed!
```

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

### Count mismatch in verification
- May indicate pagination issue
- Check cursor traversal log
- Re-run backfill (idempotent, safe to retry)

### Large time gaps detected
- May be normal (e.g., location was closed)
- Review gap dates manually
- Check Square dashboard for those periods

## Safety Features

1. **Idempotent**: Safe to run multiple times
2. **UPSERT**: No duplicates, always latest version
3. **Raw JSON**: Immutable source of truth preserved
4. **Verification**: Multiple checks ensure completeness
5. **Error Recovery**: Continues on non-fatal errors
6. **Progress Tracking**: Can resume if interrupted

## Performance

For a typical backfill:
- **~100 bookings/second** (with API delays)
- **~10 pages/second** (100 bookings/page)
- **Automatic rate limit handling**

Example: 10,000 bookings ≈ 2-3 minutes

## Next Steps

After backfill:
1. ✅ Verify all checks passed
2. ✅ Review statistics
3. ✅ Set up incremental sync schedule (cron job)
4. ✅ Monitor for new bookings

## Migration Required

Before first use, add the `raw_json` field to the Booking model:

```prisma
model Booking {
  // ... existing fields ...
  raw_json Json? // Add this field
}
```

Then run:
```bash
npx prisma migrate dev --name add_raw_json_to_bookings
```

Or if using raw SQL:
```sql
ALTER TABLE bookings ADD COLUMN raw_json JSONB;
```

## Support

For issues:
1. Check verification output
2. Review error logs
3. Verify Square API access
4. Check database connectivity


