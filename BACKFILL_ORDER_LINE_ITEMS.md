# Backfill Order Line Items Missing Fields

## Problem

The `order_line_items` table has some records with NULL values for:
- `raw_json` - Full line item object from Square API
- `metadata` - Custom key-value pairs
- `custom_attributes` - Catalog-defined custom attributes
- `fulfillments` - Fulfillment details
- `applied_taxes` - Tax breakdown
- `applied_discounts` - Discount breakdown
- `applied_service_charges` - Service charge breakdown
- `note` - Special instructions
- `modifiers` - Add-ons/variations
- `discount_name` - Discount name(s) applied

## Why Fields Are NULL

1. **Old records**: Created before these fields were added to the schema
2. **Optional fields**: Square API doesn't always include these fields (they're optional)
3. **Migration timing**: Fields were added at different times, so older records don't have them

## Solution

The `orders` table has `raw_json` which contains the complete order object including all line items. We can extract this data to backfill missing fields in `order_line_items`.

## Backfill Script

Created: `scripts/backfill-order-line-items-missing-fields.js`

### What It Does

1. Finds orders that have `raw_json` but whose line items are missing fields
2. Extracts line item data from `orders.raw_json`
3. Updates `order_line_items` with:
   - `raw_json` - Full line item object
   - All optional JSON fields (metadata, custom_attributes, etc.)
   - `discount_name` - Extracted from order-level discounts array
   - All other missing fields

### Usage

```bash
# Process 50 orders at a time (default)
node scripts/backfill-order-line-items-missing-fields.js

# Process specific number of orders
node scripts/backfill-order-line-items-missing-fields.js 100

# Process with offset (for pagination)
node scripts/backfill-order-line-items-missing-fields.js 50 0
node scripts/backfill-order-line-items-missing-fields.js 50 50
node scripts/backfill-order-line-items-missing-fields.js 50 100
```

### How It Works

1. **Query**: Finds orders with `raw_json` that have line items missing fields
2. **Extract**: Parses `orders.raw_json` to get line items
3. **Match**: Matches line items by `uid` 
4. **Extract Discount Names**: 
   - Gets order-level `discounts` array
   - Maps `discount_uid` to `discount_name`
   - Matches `applied_discounts` in line items to get discount names
5. **Update**: Updates only missing fields (preserves existing data)

### Safety Features

- ✅ Only updates missing fields (won't overwrite existing data)
- ✅ Uses `COALESCE` to preserve existing values
- ✅ Handles both camelCase and snake_case field names
- ✅ Skips records that already have all fields
- ✅ Provides statistics after completion

## Statistics

After running, the script shows:
- How many line items were processed
- Current statistics:
  - Total line items
  - Percentage with `raw_json`
  - Percentage with `metadata`
  - Percentage with `discount_name`
  - Percentage with `applied_discounts`

## Example Output

```
🔍 Finding orders with line items missing raw_json or other fields...
   Limit: 50, Offset: 0
📦 Found 25 orders to process

✅ Updated line item ULkg0tQTRK2bkU9fNv3IJD in order CAISENgvlJ6jLWAzERDzjyHVybY with: raw_json, metadata, applied_discounts, discount_name
...

📊 Summary:
   Processed: 45 line items
   Skipped: 5 line items
   Errors: 0

📈 Current Statistics:
   Total line items: 1250
   With raw_json: 1200 (96.0%)
   With metadata: 800 (64.0%)
   With discount_name: 300 (24.0%)
   With applied_discounts: 450 (36.0%)
```

## Notes

- The script processes orders in batches to avoid memory issues
- Run multiple times with different offsets to process all orders
- The script is idempotent - safe to run multiple times
- Only updates fields that are currently NULL



