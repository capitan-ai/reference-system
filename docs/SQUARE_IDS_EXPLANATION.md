# Square IDs vs Internal UUIDs

## Overview

Your database uses **two different ID systems**:

1. **Square IDs** - External identifiers from Square API (strings like `ZEAKNB35I37RMXNUBGWDZQIM`)
2. **Internal UUIDs** - Your database primary keys (UUIDs like `1ddde7c9-775a-4c89-b4bf-737a5cfaa0a3`)

## Examples

### Service Variation

**Square ID** (from Square API):
```
ZEAKNB35I37RMXNUBGWDZQIM
```
- This is what Square sends in webhooks
- Stored in `service_variation.square_variation_id` column
- Format: Uppercase alphanumeric string (22 characters)

**Internal UUID** (your database):
```
1ddde7c9-775a-4c89-b4bf-737a5cfaa0a3
```
- This is your database primary key
- Stored in `service_variation.uuid` column
- Format: Standard UUID (36 characters with hyphens)

**The Problem:**
- `bookings.service_variation_id` should store the **UUID** (`1ddde7c9-775a-4c89-b4bf-737a5cfaa0a3`)
- But sometimes it was storing the **Square ID** (`ZEAKNB35I37RMXNUBGWDZQIM`) directly
- This breaks foreign key relationships!

### Team Member (Technician)

**Square ID** (from Square API):
```
TMILsQUVwLkLzbVo
```
- Stored in `team_members.square_team_member_id` column
- Format: Starts with "TM" followed by alphanumeric

**Internal UUID** (your database):
```
86defb94-6f0f-4984-9595-8ac526ddcfe6
```
- Stored in `team_members.id` column
- Format: Standard UUID

**The Problem:**
- `bookings.technician_id` should store the **UUID** (`86defb94-6f0f-4984-9595-8ac526ddcfe6`)
- But sometimes it was storing the **Square ID** (`TMILsQUVwLkLzbVo`) directly

### Booking

**Square ID** (from Square API):
```
d0ane0kkznbroo
```
- Stored in `bookings.booking_id` column
- Format: Lowercase alphanumeric string (14 characters)

**Internal UUID** (your database):
```
71b4bcbe-6304-4850-8217-ed7a1f63d40b
```
- Stored in `bookings.id` column
- Format: Standard UUID

**Note:** `bookings.booking_id` correctly stores the Square ID (this is intentional - it's the external identifier)

### Customer

**Square ID** (from Square API):
```
WNM6TSH2CGVSK92P570PM9373W
```
- Stored in `square_existing_clients.square_customer_id` column
- Format: Uppercase alphanumeric string

**Internal ID** (your database):
```
12345  (integer auto-increment)
```
- Stored in `square_existing_clients.id` column
- Format: Integer

## How They Should Work

### Correct Flow:

1. **Webhook arrives** with Square IDs:
   ```json
   {
     "appointmentSegments": [{
       "serviceVariationId": "ZEAKNB35I37RMXNUBGWDZQIM",  // Square ID
       "teamMemberId": "TMILsQUVwLkLzbVo"                 // Square ID
     }]
   }
   ```

2. **Code should resolve** Square IDs to UUIDs:
   ```javascript
   // Look up service variation
   SELECT uuid FROM service_variation 
   WHERE square_variation_id = 'ZEAKNB35I37RMXNUBGWDZQIM'
   // Returns: 1ddde7c9-775a-4c89-b4bf-737a5cfaa0a3
   
   // Look up team member
   SELECT id FROM team_members 
   WHERE square_team_member_id = 'TMILsQUVwLkLzbVo'
   // Returns: 86defb94-6f0f-4984-9595-8ac526ddcfe6
   ```

3. **Store UUIDs** in bookings table:
   ```sql
   INSERT INTO bookings (
     service_variation_id,  -- Should be: 1ddde7c9-775a-4c89-b4bf-737a5cfaa0a3 (UUID)
     technician_id          -- Should be: 86defb94-6f0f-4984-9595-8ac526ddcfe6 (UUID)
   ) VALUES (...)
   ```

## The Bug

The code was doing this **WRONG**:
```javascript
// Line 3339 - WRONG!
${segment?.service_variation_id || segment?.serviceVariationId || null}
// This stores the Square ID directly: "ZEAKNB35I37RMXNUBGWDZQIM"
// But it should be a UUID: "1ddde7c9-775a-4c89-b4bf-737a5cfaa0a3"
```

It should do this **CORRECTLY**:
```javascript
// First resolve Square ID to UUID
const squareServiceVariationId = segment?.service_variation_id || segment?.serviceVariationId
const svRecord = await prisma.$queryRaw`
  SELECT uuid FROM service_variation 
  WHERE square_variation_id = ${squareServiceVariationId}
`
const serviceVariationUuid = svRecord[0]?.uuid

// Then store the UUID
${serviceVariationUuid || null}  // Stores: 1ddde7c9-775a-4c89-b4bf-737a5cfaa0a3
```

## Summary

| Field | Should Store | Sometimes Stored (BUG) |
|-------|-------------|------------------------|
| `bookings.service_variation_id` | UUID (`1ddde7c9-...`) | Square ID (`ZEAKNB35...`) ❌ |
| `bookings.technician_id` | UUID (`86defb94-...`) | Square ID (`TMILsQU...`) ❌ |
| `bookings.booking_id` | Square ID (`d0ane0kkznbroo`) | ✅ Correct |
| `bookings.customer_id` | Square ID (`WNM6TSH2...`) | ✅ Correct (this one is intentionally Square ID) |

## Why This Matters

1. **Foreign Key Constraints**: UUIDs are required for foreign key relationships
2. **Data Integrity**: Mixing Square IDs and UUIDs breaks queries and joins
3. **Performance**: UUID lookups are faster than string comparisons
4. **Consistency**: All foreign keys should use the same ID type (UUIDs)



