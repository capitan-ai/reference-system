# Order Line Items - Field Analysis & Missing Fields

## Overview
This document compares the database schema, Square API response, and current code to identify missing fields in the `order_line_items` table.

## Database Schema Fields (from schema.prisma)

### Core Fields
- ✅ `id` (UUID) - Primary key
- ✅ `organization_id` (UUID) - Multi-tenant isolation
- ✅ `order_id` (UUID FK) - Links to orders table
- ✅ `location_id` (String) - Square location ID
- ✅ `customer_id` (String) - Square customer ID
- ✅ `booking_id` (UUID FK) - Links to bookings table

### Team Members
- ✅ `technician_id` (UUID FK) - Links to team_members
- ✅ `administrator_id` (UUID FK) - Links to team_members

### Line Item Identification
- ✅ `uid` (String, unique) - Square line item UID
- ✅ `service_variation_id` (String) - Square service variation ID
- ✅ `catalog_version` (BigInt) - Catalog version
- ✅ `quantity` (String) - Quantity
- ✅ `name` (String) - Item name
- ✅ `variation_name` (String) - Variation name
- ✅ `item_type` (String) - ITEM, CUSTOM_AMOUNT, etc.

### Optional JSON Fields
- ✅ `metadata` (Json) - Custom key-value pairs
- ✅ `custom_attributes` (Json) - Catalog-defined custom attributes
- ✅ `fulfillments` (Json) - Fulfillment details
- ✅ `applied_taxes` (Json) - Tax breakdown
- ✅ `applied_discounts` (Json) - Discount breakdown
- ✅ `applied_service_charges` (Json) - Service charge breakdown
- ✅ `note` (String) - Special instructions
- ✅ `modifiers` (Json) - Add-ons/variations

### Money Fields (Amount + Currency)
- ✅ `base_price_money_amount` (Int) + `base_price_money_currency` (String)
- ✅ `gross_sales_money_amount` (Int) + `gross_sales_money_currency` (String)
- ✅ `total_tax_money_amount` (Int) + `total_tax_money_currency` (String)
- ✅ `total_discount_money_amount` (Int) + `total_discount_money_currency` (String)
- ✅ `total_money_amount` (Int) + `total_money_currency` (String)
- ✅ `variation_total_price_money_amount` (Int) + `variation_total_price_money_currency` (String)
- ✅ `total_service_charge_money_amount` (Int) + `total_service_charge_money_currency` (String)
- ✅ `total_card_surcharge_money_amount` (Int) + `total_card_surcharge_money_currency` (String)

### Order-Level Context Fields
- ✅ `order_state` (String) - OPEN, COMPLETED, CANCELED
- ✅ `order_version` (Int) - Order version
- ✅ `order_created_at` (DateTime)
- ✅ `order_updated_at` (DateTime)
- ✅ `order_closed_at` (DateTime)

### Order Totals (for context)
- ✅ `order_total_tax_money_amount` (Int) + `order_total_tax_money_currency` (String)
- ✅ `order_total_discount_money_amount` (Int) + `order_total_discount_money_currency` (String)
- ✅ `order_total_tip_money_amount` (Int) + `order_total_tip_money_currency` (String)
- ✅ `order_total_money_amount` (Int) + `order_total_money_currency` (String)
- ✅ `order_total_service_charge_money_amount` (Int) + `order_total_service_charge_money_currency` (String)
- ✅ `order_total_card_surcharge_money_amount` (Int) + `order_total_card_surcharge_money_currency` (String)

### Timestamps
- ✅ `created_at` (DateTime)
- ✅ `updated_at` (DateTime)

### Raw Data
- ✅ `raw_json` (Json) - Complete line item object from Square

---

## Square API Response Fields (from your example)

### Line Item Fields Available:
```json
{
  "uid": "ULkg0tQTRK2bkU9fNv3IJD",
  "quantity": "1",
  "name": "Item 1",
  "base_price_money": { "amount": 500, "currency": "USD" },
  "gross_sales_money": { "amount": 500, "currency": "USD" },
  "total_tax_money": { "amount": 0, "currency": "USD" },
  "total_service_charge_money": { "amount": 0, "currency": "USD" },
  "total_discount_money": { "amount": 250, "currency": "USD" },
  "total_money": { "amount": 250, "currency": "USD" },
  "variation_total_price_money": { "amount": 500, "currency": "USD" },
  "applied_discounts": [
    {
      "uid": "9zr9S4dxvPAixvn0lpa1VC",
      "discount_uid": "zGsRZP69aqSSR9lq9euSPB",
      "applied_money": { "amount": 250, "currency": "USD" }
    }
  ]
}
```

### Order-Level Fields Available:
```json
{
  "id": "CAISENgvlJ6jLWAzERDzjyHVybY",
  "location_id": "D7AVYMEAPJ3A3",
  "created_at": "2020-05-18T16:30:49.614Z",
  "updated_at": "2020-05-18T16:30:49.614Z",
  "state": "OPEN",
  "version": 1,
  "total_tax_money": { "amount": 0, "currency": "USD" },
  "total_discount_money": { "amount": 550, "currency": "USD" },
  "total_tip_money": { "amount": 0, "currency": "USD" },
  "total_money": { "amount": 550, "currency": "USD" },
  "total_service_charge_money": { "amount": 0, "currency": "USD" },
  "net_amounts": {
    "total_money": { "amount": 550, "currency": "USD" },
    "tax_money": { "amount": 0, "currency": "USD" },
    "discount_money": { "amount": 550, "currency": "USD" },
    "tip_money": { "amount": 0, "currency": "USD" },
    "service_charge_money": { "amount": 0, "currency": "USD" }
  },
  "discounts": [
    {
      "uid": "zGsRZP69aqSSR9lq9euSPB",
      "name": "50% Off",
      "percentage": "50",
      "applied_money": { "amount": 550, "currency": "USD" },
      "type": "FIXED_PERCENTAGE",
      "scope": "ORDER"
    }
  ]
}
```

---

## Current Code Implementation (from route.js)

### Fields Currently Being Populated:

✅ **Core Fields:**
- `organization_id` ✅
- `order_id` ✅
- `location_id` ✅
- `customer_id` ✅
- `technician_id` ✅ (matched from bookings)
- `administrator_id` ✅ (matched from payments)
- `uid` ✅
- `service_variation_id` ✅ (from `catalog_object_id`)
- `catalog_version` ✅
- `quantity` ✅
- `name` ✅
- `variation_name` ✅
- `item_type` ✅

✅ **Optional JSON Fields:**
- `metadata` ✅
- `custom_attributes` ✅
- `fulfillments` ✅
- `applied_taxes` ✅
- `applied_discounts` ✅
- `applied_service_charges` ✅
- `note` ✅
- `modifiers` ✅

✅ **Money Fields:**
- All money fields (amount + currency) ✅

✅ **Order-Level Fields:**
- `order_state` ✅
- `order_version` ✅
- `order_created_at` ✅
- `order_updated_at` ✅
- `order_closed_at` ✅
- All order total fields ✅

✅ **Raw Data:**
- `raw_json` ✅

---

## Missing Fields Analysis

### ❌ NOT Available from Square API (Cannot be filled):
1. **`booking_id`** - Square doesn't provide this in order webhooks. Must be matched via reconciliation logic.
2. **`technician_id`** - Not in Square order response. Currently matched from bookings table.
3. **`administrator_id`** - Not in Square order response. Currently matched from payments table.

### ⚠️ Potentially Missing from Square Response (May or may not be present):
These fields exist in the database schema and code, but may not always be present in Square API responses:

1. **`catalog_object_id`** / `service_variation_id`
   - **Status**: ✅ Currently extracted as `service_variation_id`
   - **Note**: May be null for custom amount items

2. **`variation_name`**
   - **Status**: ✅ Currently extracted
   - **Note**: May be null for some items

3. **`item_type`**
   - **Status**: ✅ Currently extracted
   - **Note**: Should always be present

4. **`metadata`**
   - **Status**: ✅ Currently extracted
   - **Note**: Only present if set when creating order

5. **`custom_attributes`**
   - **Status**: ✅ Currently extracted
   - **Note**: Only present if catalog item has custom attributes

6. **`fulfillments`**
   - **Status**: ✅ Currently extracted
   - **Note**: Only present for items with fulfillment info (pickup, delivery, appointments)

7. **`applied_taxes`**
   - **Status**: ✅ Currently extracted
   - **Note**: May not be present if no taxes applied

8. **`applied_discounts`**
   - **Status**: ✅ Currently extracted
   - **Note**: Present in your example! ✅

9. **`applied_service_charges`**
   - **Status**: ✅ Currently extracted
   - **Note**: May not be present if no service charges

10. **`note`**
    - **Status**: ✅ Currently extracted
    - **Note**: Only present if note was added to line item

11. **`modifiers`**
    - **Status**: ✅ Currently extracted
    - **Note**: Only present if item has modifiers

12. **`total_card_surcharge_money`**
    - **Status**: ✅ Currently extracted
    - **Note**: Only present if card surcharge applied

---

## Summary

### ✅ All Fields Are Being Populated Correctly!

**Good News:** The current implementation in `app/api/webhooks/square/route.js` is already extracting and storing **all available fields** from the Square API response.

### What's Working:
1. ✅ All money fields are extracted (using `??` to preserve 0 values)
2. ✅ All optional JSON fields are extracted
3. ✅ Order-level context fields are extracted
4. ✅ Applied discounts are extracted (present in your example)
5. ✅ Raw JSON is stored for complete data preservation

### What Cannot Be Filled (Not in Square API):
1. ❌ `booking_id` - Must be matched via reconciliation logic (already implemented)
2. ❌ `technician_id` - Must be matched from bookings (already implemented)
3. ❌ `administrator_id` - Must be matched from payments (already implemented)

### Recommendations:

1. **No changes needed** - The code is already comprehensive and extracts all available fields.

2. **Optional Enhancement:** If you want to ensure fields are always populated even when null, you could add explicit null handling, but the current code already does this with `|| null` and `?? null`.

3. **Verification:** You can verify data completeness by checking:
   ```sql
   SELECT 
     COUNT(*) as total,
     COUNT(uid) as has_uid,
     COUNT(service_variation_id) as has_service_id,
     COUNT(applied_discounts) as has_discounts,
     COUNT(metadata) as has_metadata,
     COUNT(raw_json) as has_raw_json
   FROM order_line_items
   WHERE created_at >= NOW() - INTERVAL '7 days'
   ```

---

## Conclusion

**All fields that can be filled from the Square API are already being filled.** The implementation is complete and comprehensive. The only fields that cannot be filled directly from Square are:
- `booking_id` (requires reconciliation)
- `technician_id` (requires matching from bookings)
- `administrator_id` (requires matching from payments)

These are already handled by the existing reconciliation logic in the codebase.



