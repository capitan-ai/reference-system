# Migration Problems Explained

## Problems Found

### 1. **Broken Migration Names** 
Some migrations have literal shell command syntax instead of timestamps:
- `$(date +%Y%m%d%H%M%S)_add_booking_id_to_orders_and_line_items`
- `$(date +%Y%m%d%H%M%S)_add_booking_notes`
- etc.

**What happened**: Someone ran a command like:
```bash
npx prisma migrate dev --name $(date +%Y%m%d%H%M%S)_add_booking_id
```
But the shell didn't execute `$(date...)`, so the literal string was used as the migration name.

### 2. **Migration History Mismatch**
- **Local migrations not in database**: 
  - `$(date +%Y%m%d%H%M%S)_add_booking_notes`
  - `20260127130110_add_booking_notes`
  - `20260127130113_add_booking_notes`

- **Database migrations not in local files**:
  - `$(date +%Y%m%d%H%M%S)_add_device_pass_registrations`
  - `$(date +%Y%m%d%H%M%S)_add_gift_card_info_to_device_registrations`

### 3. **Shadow Database Issue**
When Prisma tries to create a new migration, it:
1. Creates a temporary "shadow database"
2. Applies all existing migrations to it
3. Compares the result with your schema

**Problem**: The shadow database fails because:
- Migration names are broken
- Migration history is inconsistent
- Can't apply migrations in the right order

### 4. **Cross-Schema Issue** (with `db push`)
Your database has cross-schema references:
- `public.profiles` references `auth.users`
- Prisma needs `auth` schema in datasource config to introspect properly

## Solutions

### Solution 1: Quick Fix - Run SQL Directly (Recommended for Now)

Since we only need to add one column, just run the SQL directly:

```bash
# Option A: Using psql
psql $DATABASE_URL -f prisma/migrations/add_merchant_id_to_locations.sql

# Option B: Using Supabase CLI or dashboard
# Copy the SQL from prisma/migrations/add_merchant_id_to_locations.sql
# and run it in your Supabase SQL editor
```

**Pros**: Fast, bypasses all migration issues
**Cons**: Not tracked in Prisma migration history

### Solution 2: Fix Migration History (Proper Fix)

This requires cleaning up the migration history:

1. **Mark migrations as applied** (if they're already in database):
```bash
npx prisma migrate resolve --applied "$(date +%Y%m%d%H%M%S)_add_device_pass_registrations"
npx prisma migrate resolve --applied "$(date +%Y%m%d%H%M%S)_add_gift_card_info_to_device_registrations"
```

2. **Rename broken migrations** (if needed):
   - Rename folders from `$(date...)` to proper timestamps
   - Update migration history in database

3. **Then create new migration**:
```bash
npx prisma migrate dev --name add_merchant_id_to_locations
```

**Pros**: Proper migration tracking
**Cons**: Time-consuming, requires careful cleanup

### Solution 3: Use Prisma DB Push (After Fixing Schema Config)

1. **Fix datasource config** in `prisma/schema.prisma`:
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["public", "auth"]  // Add this
}
```

2. **Then push schema**:
```bash
npx prisma db push
```

**Pros**: Syncs schema directly
**Cons**: Doesn't create migration files, loses migration history

## Recommendation

**For now**: Use **Solution 1** (run SQL directly) because:
- ✅ Fast and simple
- ✅ Only one column to add
- ✅ No risk of breaking existing migrations
- ✅ Can fix migration history later when needed

The SQL is safe to run multiple times (uses `IF NOT EXISTS`).



