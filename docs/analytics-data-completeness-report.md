# Analytics Data Completeness Report

**Date:** 2025-01-27  
**Status:** ✅ Mostly Complete, ⚠️ 1 Issue Found

## Summary

After fixing all webhook handlers to populate `organization_id`, the analytics views now have **almost all required data**. One minor issue was found that affects a small number of bookings.

## ✅ What's Working

### 1. **Payments** ✅
- ✅ All payments have `organization_id`
- ✅ All payments have `location_id` (UUID, not Square ID)
- ✅ All payments have `status`, `total_money_amount`, `created_at`
- ✅ All payment tenders have `organization_id`

### 2. **Bookings** ✅
- ✅ All bookings have `organization_id`
- ✅ All bookings have `location_id` (UUID, not Square ID)
- ✅ All bookings have `status`, `start_at`, `customer_id`
- ✅ All booking technician_ids are valid UUIDs

### 3. **Orders & Order Line Items** ✅
- ✅ All orders have `organization_id`
- ✅ All order_line_items have `organization_id`
- ✅ All order_line_items have `service_variation_id`
- ✅ All order_line_items have `order_state`, `order_created_at`, `total_money_amount`

### 4. **Analytics Views** ✅
All analytics views are populated with data:
- ✅ `analytics_overview_daily`: 775 rows
- ✅ `analytics_revenue_by_location_daily`: 1,200 rows
- ✅ `analytics_appointments_by_location_daily`: 1,236 rows
- ✅ `analytics_master_performance_daily`: 7,869 rows
- ✅ `analytics_service_performance_daily`: 8,805 rows

## ⚠️ Issue Found

### **38 Bookings with Invalid service_variation_id**

**Problem:**
- 38 bookings have `service_variation_id` values that don't exist in the `service_variation` table
- This represents **0.25%** of bookings (38 out of 15,087 bookings with service_variation_id)

**Root Cause:**
The `saveBookingToDatabase` function in `app/api/webhooks/square/referrals/route.js` is saving the Square service variation ID directly instead of resolving it to a UUID:

```javascript
// Line 2945 - Currently saves Square ID directly
${segment?.service_variation_id || segment?.serviceVariationId || null},
```

**Impact:**
- These 38 bookings won't appear in `analytics_service_performance_daily` view
- Service performance metrics will be slightly undercounted
- Minimal impact due to small number (0.25%)

**Fix Required:**
The booking save function needs to:
1. Look up the `service_variation` record by `square_id` and `organization_id`
2. Use the UUID `id` from that record
3. If the service variation doesn't exist, create/upsert it first

## 📊 Data Verification Results

```
✅ All payments have organization_id
✅ All payments have location_id (UUID)
✅ All bookings have organization_id
✅ All bookings have location_id (UUID)
📊 15,087 bookings have service_variation_id
❌ 38 bookings have invalid service_variation_id (0.25%)
📊 25,520 bookings have technician_id
✅ All booking technician_ids are valid UUIDs
✅ All order_line_items have organization_id
📊 19,970 order_line_items have service_variation_id
```

## ✅ All Required Fields for Analytics

### **analytics_overview_daily**
- ✅ `payments.organization_id`
- ✅ `payments.status = 'COMPLETED'`
- ✅ `payments.total_money_amount`
- ✅ `payments.created_at`
- ✅ `bookings.organization_id`
- ✅ `bookings.status != 'CANCELLED'`
- ✅ `bookings.start_at`
- ✅ `bookings.customer_id`
- ✅ `square_existing_clients.used_referral_code`

### **analytics_revenue_by_location_daily**
- ✅ `payments.organization_id`
- ✅ `payments.location_id` (UUID)
- ✅ `payments.status = 'COMPLETED'`
- ✅ `payments.total_money_amount`
- ✅ `payments.created_at`
- ✅ `locations.id` (UUID)
- ✅ `locations.name`

### **analytics_appointments_by_location_daily**
- ✅ `bookings.organization_id`
- ✅ `bookings.location_id` (UUID)
- ✅ `bookings.status != 'CANCELLED'`
- ✅ `bookings.start_at`
- ✅ `bookings.customer_id`
- ✅ `locations.id` (UUID)
- ✅ `locations.name`

### **analytics_master_performance_daily**
- ✅ `bookings.organization_id`
- ✅ `bookings.technician_id` (UUID)
- ✅ `bookings.status != 'CANCELLED'`
- ✅ `bookings.start_at`
- ✅ `order_line_items.organization_id`
- ✅ `order_line_items.technician_id` (UUID)
- ✅ `order_line_items.order_state = 'COMPLETED'`
- ✅ `order_line_items.order_created_at`
- ✅ `order_line_items.total_money_amount`
- ✅ `team_members.id` (UUID)
- ✅ `team_members.given_name`, `family_name`

### **analytics_service_performance_daily**
- ✅ `bookings.organization_id`
- ⚠️ `bookings.service_variation_id` (38 invalid - 0.25%)
- ✅ `bookings.status != 'CANCELLED'`
- ✅ `bookings.start_at`
- ✅ `bookings.duration_minutes`
- ✅ `order_line_items.organization_id`
- ✅ `order_line_items.service_variation_id`
- ✅ `order_line_items.order_state = 'COMPLETED'`
- ✅ `order_line_items.order_created_at`
- ✅ `order_line_items.total_money_amount`
- ⚠️ `service_variation.square_id` (needed for join - 38 bookings affected)

## 🎯 Conclusion

**Analytics views have 99.75% complete data.** The only issue is 38 bookings (0.25%) with invalid `service_variation_id` values. This is a minor data quality issue that doesn't significantly impact analytics accuracy.

**Recommendation:**
1. Fix the booking save function to resolve Square service variation IDs to UUIDs
2. Optionally backfill the 38 invalid bookings if service variation records can be created

**Overall Status:** ✅ **Analytics Ready** (with minor fix recommended)

