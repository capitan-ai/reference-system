# Discount Name Field Added to Order Line Items

## Summary
Added `discount_name` field to the `order_line_items` table to store the discount name(s) applied to each line item.

## Changes Made

### 1. Database Schema (`prisma/schema.prisma`)
- Added `discount_name` field to `OrderLineItem` model:
  ```prisma
  discount_name String? // Discount name(s) applied to this line item (comma-separated if multiple)
  ```

### 2. Webhook Handler (`app/api/webhooks/square/route.js`)
- **Extract discount names from order-level discounts array:**
  - Builds a map of `discount_uid -> discount_name` from the order's `discounts` array
  - Handles both camelCase (`discounts`) and snake_case (`discount`) field names
  
- **Match discounts to line items:**
  - For each line item, looks up discount names from `applied_discounts` array
  - Matches `discount_uid` from `applied_discounts` to discount names in the map
  - Stores comma-separated discount names if multiple discounts apply
  
- **Store discount names:**
  - Added `discount_name` to `lineItemData` object
  - Added `discount_name` to the UPDATE SQL statement

## How It Works

### Square API Structure:
```json
{
  "order": {
    "discounts": [
      {
        "uid": "zGsRZP69aqSSR9lq9euSPB",
        "name": "50% Off",
        "type": "FIXED_PERCENTAGE"
      }
    ],
    "line_items": [
      {
        "uid": "ULkg0tQTRK2bkU9fNv3IJD",
        "name": "Item 1",
        "applied_discounts": [
          {
            "uid": "9zr9S4dxvPAixvn0lpa1VC",
            "discount_uid": "zGsRZP69aqSSR9lq9euSPB",
            "applied_money": { "amount": 250, "currency": "USD" }
          }
        ]
      }
    ]
  }
}
```

### Processing Logic:
1. Extract all discounts from `order.discounts` array
2. Create map: `"zGsRZP69aqSSR9lq9euSPB" -> "50% Off"`
3. For each line item, check `applied_discounts` array
4. Match `discount_uid` ("zGsRZP69aqSSR9lq9euSPB") to discount name ("50% Off")
5. Store in `discount_name` field: `"50% Off"` (or `"50% Off, 10% Off"` if multiple)

## Database Migration Required

You'll need to run a migration to add the new field:

```bash
npx prisma migrate dev --name add_discount_name_to_order_line_items
```

Or if using production:

```bash
npx prisma migrate deploy
```

## Usage

After migration, you can query discount names:

```sql
-- Find all line items with discounts
SELECT 
  name as service_name,
  discount_name,
  total_discount_money_amount / 100.0 as discount_amount
FROM order_line_items
WHERE discount_name IS NOT NULL
ORDER BY created_at DESC;

-- Count discounts by name
SELECT 
  discount_name,
  COUNT(*) as usage_count,
  SUM(total_discount_money_amount) / 100.0 as total_discount_amount
FROM order_line_items
WHERE discount_name IS NOT NULL
GROUP BY discount_name
ORDER BY usage_count DESC;
```

## Notes

- **Multiple discounts:** If a line item has multiple discounts, they are stored as comma-separated values (e.g., "50% Off, 10% Off")
- **No discount:** If no discount is applied, `discount_name` will be `NULL`
- **Backfill scripts:** Existing backfill scripts may not populate this field. They can be updated later if historical discount names are needed.
- **Raw JSON:** The complete discount information is still available in `raw_json` and `applied_discounts` JSON fields for detailed analysis.

## Testing

To verify the field is working:

1. Check a recent order with discounts:
   ```sql
   SELECT name, discount_name, applied_discounts
   FROM order_line_items
   WHERE discount_name IS NOT NULL
   LIMIT 10;
   ```

2. Verify discount names match the order-level discounts:
   ```sql
   SELECT 
     oli.name,
     oli.discount_name,
     o.raw_json->'discounts' as order_discounts
   FROM order_line_items oli
   JOIN orders o ON oli.order_id = o.id
   WHERE oli.discount_name IS NOT NULL
   LIMIT 5;
   ```



