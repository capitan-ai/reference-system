# Using Payments as Bridge to Link Orders to Bookings

## Key Insight

**Payments table has both `order_id` AND `booking_id` fields!**

This means we can use payments as a bridge to link orders to bookings:

```
Order → Payment (via order_id) → Booking (via booking_id)
```

## Current Status

From the database:
- ✅ **All payments (27,910) have `order_id`** - 100%
- ❌ **No payments (0) have `booking_id`** - 0%
- ❌ **No payments have both `order_id` AND `booking_id`** - 0%

## The Problem

Payments have the `booking_id` field in the schema, but it's not being populated when payments are created/updated.

## Solution: Two Approaches

### Approach 1: Populate booking_id in Payments (Recommended)

When processing `payment.created` or `payment.updated` webhooks:

1. **Check if Square Payment API provides booking_id**
   - Need to inspect what Square sends in payment webhooks
   - If Square doesn't provide it, use matching logic

2. **If Square doesn't provide booking_id, match payment to booking:**
   - Use: Customer ID + Location ID + Time window
   - Payment has `customer_id` and `location_id`
   - Match to booking's `start_at` time

3. **Once payment has booking_id, use it to populate orders:**
   ```sql
   UPDATE orders o
   SET booking_id = p.booking_id
   FROM payments p
   WHERE o.id = p.order_id
     AND p.booking_id IS NOT NULL
     AND o.booking_id IS NULL
   ```

### Approach 2: Use Payments to Find Booking (Current)

Even if payments don't have booking_id, we can:

1. Find payment for order (via `order_id`)
2. Use payment's `customer_id` and `location_id` to match booking
3. Update both payment and order with booking_id

## Implementation Strategy

**Best approach:** Populate `booking_id` in payments when they're created, then use payments to populate orders.

**Steps:**
1. When `payment.created` webhook arrives:
   - Extract customer_id, location_id, created_at
   - Match to booking using customer + location + time
   - Update `payments.booking_id`

2. When `order.created/updated` webhook arrives:
   - Find payment(s) for this order (via `order_id`)
   - If payment has `booking_id`, use it to update `orders.booking_id`
   - Also update `order_line_items.booking_id`

This is more reliable than matching orders directly because:
- Payments are created closer in time to bookings
- Payments have direct customer and location context
- One payment can link one order to one booking

## Example Query

```sql
-- Get booking_id from payments for an order
SELECT DISTINCT p.booking_id
FROM payments p
WHERE p.order_id = 'order-uuid-here'
  AND p.booking_id IS NOT NULL
LIMIT 1
```

## Next Steps

1. Check what Square Payment API provides in webhooks
2. Implement booking matching in payment webhook handler
3. Use payments to populate orders.booking_id automatically



