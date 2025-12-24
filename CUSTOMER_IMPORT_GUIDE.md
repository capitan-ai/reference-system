# Customer Import System

This system imports all existing Square customers into your Supabase database with the required schema.

## Database Schema

Your Supabase `customers` table now has these columns:

- `square_customer_id` → TEXT (unique)
- `given_name` → TEXT
- `family_name` → TEXT  
- `email_address` → TEXT
- `phone_number` → TEXT
- `got_signup_bonus` → BOOLEAN (true if customer has completed orders)
- `activated_as_referrer` → BOOLEAN (true when customer makes first payment)
- `personal_code` → TEXT (unique code for each customer)
- `first_paid_seen` → BOOLEAN (true if customer has completed orders)

## How to Import Existing Customers

### 1. Set up Environment Variables

Make sure your `.env` file has:

```env
DATABASE_URL="your_supabase_connection_string"
SQUARE_ACCESS_TOKEN="your_square_access_token"
SQUARE_LOCATION_ID="your_square_location_id"
SQUARE_ENV="sandbox" # or "production"
```

### 2. Run Database Migration

```bash
npx prisma migrate dev --name update_customer_schema_for_supabase
```

### 3. Import All Customers

```bash
# Option 1: Run the simple script
node scripts/run-import.js

# Option 2: Run the full import script directly
node scripts/import-existing-customers.js
```

## What the Import Does

1. **Fetches all customers** from Square API (handles pagination automatically)
2. **Checks order history** for each customer to determine if they're first-time customers
3. **Creates database records** with proper flags:
   - `got_signup_bonus`: true if customer has completed orders
   - `first_paid_seen`: true if customer has completed orders
   - `activated_as_referrer`: false (will be set to true on first payment)
   - `personal_code`: unique code for each customer

## First-Time Customer Logic

The system now checks first-time status from the database instead of making API calls:

- **First-time customer**: `first_paid_seen = false` AND no completed orders
- **Returning customer**: `first_paid_seen = true` OR has completed orders

## Key Functions

### `isFirstTimeCandidate(squareCustomerId)`
- Checks database for customer's first-time status
- Automatically syncs customer from Square if not in database
- Returns `true` if customer is first-time, `false` otherwise

### `syncCustomerFromSquare(squareCustomerId)`
- Syncs a single customer from Square to database
- Updates existing customers or creates new ones
- Checks order history to set proper flags

### `markCustomerAsPaid(squareCustomerId)`
- Marks customer as having made their first payment
- Sets `first_paid_seen = true` and `activated_as_referrer = true`

## Webhook Integration

The webhook handler now:

1. **Checks first-time status** from database (fast)
2. **Awards gift cards** only to first-time customers
3. **Creates referral links** for customers on their first payment
4. **Updates customer flags** when payments are processed

## Benefits

✅ **Fast first-time checking** - no more API calls to Square  
✅ **Complete customer history** - all customers in your database  
✅ **Proper attribution** - tracks who got signup bonuses  
✅ **Referral tracking** - knows who can refer others  
✅ **Scalable** - works with thousands of customers  

## Troubleshooting

If you get database connection errors:
1. Check your `DATABASE_URL` in `.env`
2. Make sure Supabase is running
3. Run `npx prisma generate` to update the client

If you get Square API errors:
1. Check your `SQUARE_ACCESS_TOKEN`
2. Verify your `SQUARE_LOCATION_ID`
3. Make sure you're using the correct environment (sandbox/production)
