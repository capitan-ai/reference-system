# Square Order Line Item - All Available Fields from API

## Complete Field List

Based on actual data from Square API webhooks, here are **all fields** available in an Order Line Item:

### Basic Identification
- `uid` (string) - Unique identifier for this line item
  - Example: `"E491B8C4-7BDE-486B-8DB1-BE7834A0BAD3"`

### Item Information
- `name` (string) - Item name
  - Example: `"Designs"`, `"Smart E-file Pedicure with gel"`
- `itemType` / `item_type` (string) - Type of item
  - Values: `"ITEM"`, `"CUSTOM_AMOUNT"`, etc.
- `quantity` (string) - Quantity as string
  - Example: `"1"`, `"2"`
- `variationName` / `variation_name` (string) - Variation name
  - Example: `"Medium Level Design (french tip, chrome, ombre)"`
  - Example: `"Top Master Irina"`

### Catalog References
- `catalogObjectId` / `catalog_object_id` (string) - Square catalog object ID
  - This is the **service_variation_id** for service items
  - Example: `"HAJX45W3U2WUCCXM5MI24UEE"`
- `catalogVersion` / `catalog_version` (string/BigInt) - Catalog version
  - Example: `"1767994687100"`

### Pricing Fields (Money Objects)
All money fields have structure: `{ "amount": "2000", "currency": "USD" }`

- `basePriceMoney` / `base_price_money` - Base price before discounts/taxes
- `grossSalesMoney` / `gross_sales_money` - Gross sales amount
- `totalMoney` / `total_money` - Total amount for this line item
- `totalTaxMoney` / `total_tax_money` - Total tax amount
- `totalDiscountMoney` / `total_discount_money` - Total discount amount
- `totalServiceChargeMoney` / `total_service_charge_money` - Total service charge
- `variationTotalPriceMoney` / `variation_total_price_money` - Variation total price
- `totalCardSurchargeMoney` / `total_card_surcharge_money` - Card surcharge (if applicable)

### Potentially Available (Optional Fields)
These fields are optional and only appear when they're actually set on the order:

#### Found in Some Orders:
- **`appliedDiscounts`** / `applied_discounts` (array) - Discounts applied to this specific line item
  - Structure: `[{ uid, discountUid, appliedMoney: {amount, currency} }]`
  - Example: Discount of $10.00 applied to a line item
  - **Status**: ✅ Found in 4 out of 20 orders checked

#### Not Found in Our Orders (But Available in Square API):
- **`metadata`** (object) - Custom key-value pairs you can attach to line items
  - Use case: Store custom data like booking_id, internal references, etc.
  - **Status**: ❌ Not found (would need to be set when creating orders)
  
- **`customAttributes`** / `custom_attributes` (array) - Additional attributes defined in your catalog
  - Use case: Catalog-defined custom fields for items
  - **Status**: ❌ Not found
  
- **`fulfillments`** / `fulfillment` (array) - Information about how/when the item will be fulfilled
  - Use case: Pickup details, delivery info, appointment times
  - **Status**: ❌ Not found (could potentially contain booking/appointment info if set)
  
- **`appliedTaxes`** / `applied_taxes` (array) - Tax details applied specifically to this line item
  - Use case: Breakdown of taxes per line item
  - **Status**: ❌ Not found (taxes are in totalTaxMoney instead)
  
- **`appliedServiceCharges`** / `applied_service_charges` (array) - Service charges applied to this line item
  - Use case: Breakdown of service charges per line item
  - **Status**: ❌ Not found (service charges are in totalServiceChargeMoney instead)
  
- **`note`** (string) - Special instructions or notes for this line item
  - Use case: Customer notes, special requests
  - **Status**: ❌ Not found
  
- **`modifiers`** (array) - Add-ons or variations selected for this item
  - Use case: Item modifiers like "extra sauce", "large size", etc.
  - **Status**: ❌ Not found

## What We're Currently Storing

From `app/api/webhooks/square/route.js`, we extract and store:

✅ **Stored Fields:**
- `uid`
- `service_variation_id` (from `catalogObjectId`)
- `catalog_version`
- `quantity`
- `name`
- `variation_name`
- `item_type`
- All money fields (amount + currency for each)
- `raw_json` (complete line item object)

## What's Missing / Not Available

❌ **NOT Available from Square API:**
- `booking_id` - **Does not exist in Square Order API**
- `technician_id` - Must be matched from bookings table
- `administrator_id` - Must be matched from payments table
- Direct booking reference - No link between Orders and Bookings APIs

## Key Finding

**The `catalogObjectId` field is the service_variation_id** that can be used to match line items to bookings:

1. Line item has `catalogObjectId` = `"CJI5WHOAKSFTASYPJ4MSYZLS"`
2. Booking has `service_variation_id` = `"CJI5WHOAKSFTASYPJ4MSYZLS"`
3. Match by: Customer + Location + Service Variation ID + Time Window

This is the most reliable way to link orders to bookings since Square doesn't provide a direct booking_id field.

