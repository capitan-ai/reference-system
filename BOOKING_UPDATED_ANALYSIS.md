# Booking.Updated Webhook Analysis

## Summary
The `booking.updated` webhook event is **NOT currently handled** in the system. Additionally, several fields from the webhook payload are missing from the `bookings` table.

## Webhook Payload Structure

From Square's `booking.updated` webhook:
```json
{
  "merchant_id": "GQQWA3J6A3AEZ",
  "location_id": "L9R0X9X5SGDBJ",
  "type": "booking.updated",
  "event_id": "d954ea4e-a393-52d4-bda6-bfd10cbd571f",
  "created_at": "2020-12-08T20:05:00Z",
  "data": {
    "type": "booking",
    "id": "i2id2g3enyspi7:1",
    "object": {
      "booking": {
        "id": "i2id2g3enyspi7",
        "status": "ACCEPTED",
        "customer_note": "I would like to sit near the window please",
        "seller_note": "",
        "start_at": "2020-12-17T16:00:00Z",
        "created_at": "2020-12-08T19:56:53Z",
        "updated_at": "2020-12-08T20:05:00Z",
        "version": 1,
        "appointment_segments": [
          {
            "service_variation_id": "T3WUWYFJOVW2EU6XGRU5YG4A",
            "duration_minutes": 30,
            "service_variation_version": 1605808735978,
            "team_member_id": "_4GsfYnqGHyurOwzWdKj"
          }
        ],
        "customer_id": "SSKBT02ECWZXK6W3VWYC78E52R",
        "location_id": "L9R0X9X5SGDBJ"
      }
    }
  }
}
```

## Missing Fields in Database

### ❌ **CRITICAL: Missing Columns**

| Field | Type | Status | Notes |
|-------|------|--------|-------|
| `customer_note` | `String?` | **MISSING** | Customer's note/request for the booking |
| `seller_note` | `String?` | **MISSING** | Staff/seller note for the booking |

### ✅ Fields That Exist

| Field | Database Column | Status |
|-------|----------------|--------|
| `id` | `booking_id` | ✅ EXISTS |
| `status` | `status` | ✅ EXISTS |
| `start_at` | `start_at` | ✅ EXISTS |
| `created_at` | `created_at` | ✅ EXISTS |
| `updated_at` | `updated_at` | ✅ EXISTS |
| `version` | `version` | ✅ EXISTS |
| `customer_id` | `customer_id` | ✅ EXISTS |
| `location_id` | `location_id` | ✅ EXISTS |
| `appointment_segments` | `raw_json` | ✅ EXISTS (in JSON) |

## Current Webhook Handling

### ❌ **NOT HANDLED: `booking.updated`**

**Location**: `app/api/webhooks/square/route.js`

**Current Status**:
- ✅ `booking.created` - Handled (line 108)
- ❌ `booking.updated` - **NOT HANDLED**
- ✅ `payment.created` / `payment.updated` - Handled
- ✅ `order.created` / `order.updated` - Handled

**Impact**: 
- When a booking is updated in Square (status change, notes added, etc.), the database is **NOT updated**
- Only `booking.created` events are processed
- Updates to existing bookings are ignored

## What Gets Stored in `raw_json`

Currently, `raw_json` contains:
- ✅ `appointmentSegments` (array)
- ❌ `customer_note` - **NOT stored** (missing from API response when booking is created)
- ❌ `seller_note` - **NOT stored** (missing from API response when booking is created)

**Note**: `customer_note` and `seller_note` may only appear in `booking.updated` webhooks, not in the initial `booking.created` event.

## Recommendations

### 1. **Add Missing Columns to Schema**

Add to `prisma/schema.prisma`:
```prisma
model Booking {
  // ... existing fields ...
  
  // ===== NOTES =====
  customer_note String? // Customer's note/request
  seller_note   String? // Staff/seller note
  
  // ... rest of fields ...
}
```

### 2. **Handle `booking.updated` Webhook**

Add handler in `app/api/webhooks/square/route.js`:
```javascript
} else if (eventData.type === 'booking.updated') {
  console.log('📅 Booking updated event received')
  const bookingData = eventData.data?.object?.booking
  if (bookingData) {
    await processBookingUpdated(bookingData, eventData.event_id, eventData.created_at)
  }
}
```

### 3. **Create `processBookingUpdated` Function**

This function should:
- Find existing booking by `booking_id` and `organization_id`
- Update fields: `status`, `customer_note`, `seller_note`, `version`, `updated_at`
- Update `raw_json` with latest booking data
- Handle `appointment_segments` updates (technician changes, etc.)

### 4. **Migration Required**

After schema changes:
```bash
npx prisma migrate dev --name add_booking_notes
```

## Fields That Are Empty (Actual Database Statistics)

Based on analysis of **40,568 bookings** in the database:

| Field | Filled | Empty | Empty % | Status |
|-------|--------|-------|---------|--------|
| `customer_id` | 40,413 | 155 | 0.4% | ✅ Mostly filled |
| `location_type` | 40,568 | 0 | 0.0% | ✅ Always filled |
| `source` | 40,568 | 0 | 0.0% | ✅ Always filled |
| `address_line_1` | 27,964 | 12,604 | 31.1% | ❌ Often empty (in-store bookings) |
| `creator_type` | 40,568 | 0 | 0.0% | ✅ Always filled |
| `creator_customer_id` | 27,735 | 12,833 | 31.6% | ❌ Often empty |
| `service_variation_id` | 15,087 | 25,481 | 62.8% | ❌ **MOSTLY EMPTY** |
| `technician_id` | 33,357 | 7,211 | 17.8% | ⚠️ Sometimes empty |
| `administrator_id` | 12,465 | 28,103 | 69.3% | ❌ **MOSTLY EMPTY** |
| `duration_minutes` | 2,047 | 38,521 | 95.0% | ❌ **ALMOST ALWAYS EMPTY** |
| `merchant_id` | 15,640 | 24,928 | 61.4% | ❌ **MOSTLY EMPTY** (deprecated) |
| `transition_time_minutes` | 40,568 | 0 | 0.0% | ✅ Always filled (defaults to 0) |

### Key Findings:

1. **Critical Missing Fields**:
   - `customer_note` - **NOT IN SCHEMA** (would be 0% if it existed)
   - `seller_note` - **NOT IN SCHEMA** (would be 0% if it existed)

2. **Fields That Are Mostly Empty**:
   - `duration_minutes` - 95% empty (likely stored in `appointment_segments` in `raw_json`)
   - `administrator_id` - 69.3% empty
   - `service_variation_id` - 62.8% empty
   - `merchant_id` - 61.4% empty (deprecated field)

3. **Fields That Are Sometimes Empty**:
   - `address_line_1` - 31.1% empty (in-store bookings don't need address)
   - `creator_customer_id` - 31.6% empty
   - `technician_id` - 17.8% empty (when `any_team_member = true`)

## Next Steps

1. ✅ **Analysis Complete** - Identified missing fields
2. ⏳ **Add schema fields** - `customer_note` and `seller_note`
3. ⏳ **Create migration** - Update database schema
4. ⏳ **Add webhook handler** - Handle `booking.updated` events
5. ⏳ **Implement update logic** - Process booking updates
6. ⏳ **Test** - Verify updates are saved correctly

