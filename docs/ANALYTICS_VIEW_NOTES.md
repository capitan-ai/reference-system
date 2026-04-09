# Analytics View Documentation

## analytics_appointments_by_location_daily

### Key Differences from Raw Bookings Count

**Database bookings table:** Counts unique booking records (one per booking_id)

**Analytics view:** Counts **staff_slots** (sum of team members assigned per appointment)

#### Example:
- **Booking 1:** ACCEPTED, assigned to 2 technicians → counts as **2 appointments**
- **Booking 2:** ACCEPTED, assigned to 1 technician → counts as **1 appointment**
- **Raw bookings count:** 2
- **Analytics appointments_count:** 3

### Why staff_slots?

For business analytics, what matters is **appointments served by staff**, not the number of bookings. A single booking might be handled by multiple technicians, so the analytics view counts staff slot allocations instead of raw bookings.

### Timezone Handling

The view uses: `DATE(start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')`

This correctly converts from UTC storage to LA business hours:
- April 8 LA time (00:00-23:59 LA) = April 8 07:00 UTC - April 9 07:00 UTC
- Bookings starting at 2026-04-08T07:00:00Z through 2026-04-09T06:59:59Z are counted as April 8

### Counting Logic

```sql
appointments_count = SUM(staff_slots WHERE status = 'ACCEPTED')
accepted_appointments = SUM(staff_slots WHERE status = 'ACCEPTED')
cancelled_by_customer = SUM(staff_slots WHERE status = 'CANCELLED_BY_CUSTOMER')
cancelled_by_seller = SUM(staff_slots WHERE status = 'CANCELLED_BY_SELLER')
```

Each appointment's slot count comes from the number of distinct team_member_ids in appointment_segments.

### Deduplication

View deduplicates bookings by base_id (Square booking ID prefix) using `DISTINCT ON`. When multiple booking records exist with the same Square ID, only the latest version is kept.

### Example April 8 Comparison

| Location | Raw Bookings | Staff Slots | Reason |
|---|---|---|---|
| Union St | 28 | 25 | Some bookings have fewer team members assigned |
| Pacific Ave | 28 | 28 | Each booking has ~1 technician average |

This difference is **expected and correct** for staff utilization analytics.
