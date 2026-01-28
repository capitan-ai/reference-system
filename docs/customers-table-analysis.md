# Customers Table Analysis

## Why We Need the Customers Table

The `customers` table serves as a **foreign key reference table** for Prisma-managed relationships in the referral system. It bridges Square customer IDs to internal relational structure.

## Current State

### Table Structure
```prisma
model Customer {
  id               String      @id @default(uuid())
  squareCustomerId String?     @unique
  phoneE164        String?     @db.VarChar(32)
  email            String?     @db.VarChar(255)
  createdAt        DateTime    @default(now())
  firstPaidSeen    Boolean     @default(false)
  firstName        String?     @db.VarChar(100)
  lastName         String?     @db.VarChar(100)
  fullName         String?     @db.VarChar(200)
  
  // Relations
  RefClicks        RefClick[]
  RefLinks         RefLink?
  RefMatches       RefMatch[]
  FriendRewards    RefReward[] @relation("FriendRewards")
  RefRewards       RefReward[] @relation("ReferrerRewards")
  Bookings         Booking[]
  Payments         Payment[]
}
```

### Data Volume
- **Modern `customers` table:** ~23 records (sparsely populated)
- **Legacy `square_existing_clients` table:** ~7,486 records (actively used)

## Where Customers Table is Used

### 1. **Foreign Key Relationships** ✅ PRIMARY USE

The `customers` table is required by Prisma schema to support foreign key constraints:

#### Booking Model
```prisma
model Booking {
  customer_id   String? // Square customer ID
  customer      Customer? @relation(fields: [customer_id], references: [squareCustomerId])
}
```
**File:** `prisma/schema.prisma:363`

#### Payment Model
```prisma
model Payment {
  customer_id String?
  customer    Customer? @relation(fields: [customer_id], references: [squareCustomerId])
}
```
**File:** `prisma/schema.prisma:533`

#### RefLink Model (Referral Links)
```prisma
model RefLink {
  customerId String  @unique
  customer   Customer @relation(fields: [customerId], references: [id])
}
```
**File:** `prisma/schema.prisma:40`
- **Usage:** Links referral codes to customers
- **Critical:** Without this, cannot create referral links

#### RefMatch Model (Referral Matches)
```prisma
model RefMatch {
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])
}
```
**File:** `prisma/schema.prisma:74`
- **Usage:** Tracks which bookings were matched to referral codes

#### RefReward Model (Rewards System)
```prisma
model RefReward {
  referrerCustomerId String?
  friendCustomerId   String?
  referrer           Customer? @relation("ReferrerRewards", fields: [referrerCustomerId], references: [id])
  friend             Customer? @relation("FriendRewards", fields: [friendCustomerId], references: [id])
}
```
**File:** `prisma/schema.prisma:93-94`
- **Usage:** Tracks rewards for referrers and referred friends

#### RefClick Model (Click Tracking)
```prisma
model RefClick {
  customerId  String?
  customer    Customer? @relation(fields: [customerId], references: [id])
}
```
**File:** `prisma/schema.prisma:59`
- **Usage:** Tracks referral link clicks (optional customer association)

### 2. **Booking Backfill Process** ✅ ACTIVE USE

**File:** `lib/square-bookings-backfill.js:352-369`

When backfilling bookings from Square API, the system ensures customers exist in `customers` table to satisfy FK constraints:

```javascript
// Ensure customer exists in customers table (for FK constraint)
if (customerId) {
  const existingCustomer = await this.prisma.customer.findUnique({
    where: { squareCustomerId: customerId }
  })
  
  if (!existingCustomer) {
    await this.prisma.customer.upsert({
      where: { squareCustomerId: customerId },
      create: {
        squareCustomerId: customerId,
        firstPaidSeen: false
      }
    })
  }
}
```

**Why needed:** Without this, inserting bookings would fail FK constraint violations.

### 3. **Referral Link Generation** ✅ ACTIVE USE

**File:** `scripts/generate-referral-links-for-all-customers.js:37-55`

The script queries `customers` table to find customers without referral links:

```javascript
const customersWithoutRefLinks = await prisma.customer.findMany({
  where: {
    RefLinks: {
      none: {}
    }
  },
  select: {
    id: true,
    squareCustomerId: true,
    phoneE164: true,
    firstName: true,
    lastName: true,
    fullName: true,
    email: true
  }
})
```

**Usage:** Creates `RefLink` records which require a `customer.id` reference.

### 4. **Referral Link Management Scripts** ✅ ACTIVE USE

Multiple scripts query `customers` table for referral system management:

- **`scripts/check-all-customers-referral-urls.js`** - Verifies all customers have referral links
- **`scripts/send-referral-emails-to-customers.js`** - Sends referral emails to customers
- **`scripts/backfill-bookings-by-customer.js`** - Backfills bookings by customer
- **`scripts/verify-email-readiness.js`** - Verifies customer email readiness

### 5. **Database Analysis Scripts** 📊 REPORTING

**File:** `scripts/analyze-all-database-data.js:51-77`

Reports customer statistics from `customers` table:

```javascript
const customersCount = await prisma.customer.count()
const customersWithSquare = await prisma.customer.count({
  where: { squareCustomerId: { not: null } }
})
```

## Where Customers Table is NOT Used

### ❌ Gift Card Flow
**Files:**
- `lib/webhooks/giftcard-processors.js`
- `app/api/webhooks/square/referrals/route.js`

Uses `square_existing_clients` table directly with raw SQL:
```javascript
await prisma.$executeRaw`
  INSERT INTO square_existing_clients (...)
```

### ❌ Payment Processing
Uses `square_existing_clients` table for first payment tracking:
```javascript
const customerData = await prisma.$queryRaw`
  SELECT ... FROM square_existing_clients 
  WHERE square_customer_id = ${customerId}
`
```

### ❌ Booking Webhooks
Uses `square_existing_clients` table for customer lookup and referral code matching.

### ❌ Lookup API
**File:** `app/api/lookup-referral/route.js`

Queries `square_existing_clients` directly:
```javascript
const customer = await prisma.$queryRaw`
  SELECT ... FROM square_existing_clients
  WHERE phone_number = ${normalized}
`
```

## Critical Issues & Recommendations

### 🔴 Problem: Two Customer Tables

The system maintains **two separate customer tables**:

1. **`customers`** (Prisma-managed, ~23 records)
   - Used for FK relationships
   - Sparsely populated
   - Managed through Prisma ORM

2. **`square_existing_clients`** (Legacy, ~7,486 records)
   - Used for business logic
   - Fully populated with customer data
   - Managed via raw SQL queries

### ⚠️ Consequences

1. **Data Duplication Risk:** Customer data exists in two places
2. **Sync Issues:** `customers` table may not reflect all customers
3. **Confusion:** Developers must know which table to query
4. **FK Constraint Workarounds:** Some code bypasses FK constraints with raw SQL

### 💡 Recommendation: Keep Customers Table

**Why keep it:**

1. **Prisma Relationships:** Required for FK constraints on:
   - `RefLink` (referral links)
   - `RefMatch` (referral matches)
   - `RefReward` (reward tracking)
   - `Booking` (bookings)
   - `Payment` (payments)
   - `RefClick` (click tracking)

2. **Referral System Core:** The referral system depends on Prisma relationships that require this table.

3. **Type Safety:** Prisma provides type-safe queries that would be lost without this model.

**But:** Consider syncing strategy to keep `customers` table populated from `square_existing_clients`.

## Summary

| Aspect | Status |
|--------|--------|
| **Required for FK constraints** | ✅ Yes |
| **Used in booking backfill** | ✅ Yes |
| **Used in referral link generation** | ✅ Yes |
| **Used in gift card flow** | ❌ No (uses `square_existing_clients`) |
| **Used in payment processing** | ❌ No (uses `square_existing_clients`) |
| **Used in booking webhooks** | ❌ No (uses `square_existing_clients`) |
| **Data population** | ⚠️ Partial (~23 vs 7,486) |

**Conclusion:** The `customers` table is **essential** for the referral system's relational structure but is **under-utilized** due to parallel use of `square_existing_clients` table for business logic.




