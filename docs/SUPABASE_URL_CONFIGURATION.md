# Supabase URL Configuration Guide

## ⚠️ Important: Two Different URLs for Different Purposes

Supabase uses **two different URLs** depending on what you're connecting to:

### 1. HTTP API Base URL (for Auth, Storage, Realtime)
**Format:** `https://<ref>.supabase.co`  
**NO `db.` prefix!**

**Environment Variable:** `NEXT_PUBLIC_SUPABASE_URL`

**Used for:**
- Supabase Auth API calls (`auth.admin.createUser()`, `auth.getUser()`, etc.)
- Storage API
- Realtime subscriptions
- REST API calls

**Example:**
```bash
NEXT_PUBLIC_SUPABASE_URL=https://fqkrigvliyphjwpokwbl.supabase.co
```

**In code:**
```javascript
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,  // https://fqkrigvliyphjwpokwbl.supabase.co
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)
```

### 2. Database Connection URL (for PostgreSQL)
**Format:** `postgresql://user:pass@db.<ref>.supabase.co:5432/dbname`  
**WITH `db.` prefix!**

**Environment Variable:** `DATABASE_URL`

**Used for:**
- Direct PostgreSQL connections
- Prisma queries
- Database migrations
- Raw SQL queries

**Example:**
```bash
DATABASE_URL=postgresql://postgres:password@db.fqkrigvliyphjwpokwbl.supabase.co:5432/postgres
```

**Connection Pooling (Alternative):**
```bash
DATABASE_URL=postgresql://postgres:password@fqkrigvliyphjwpokwbl.supabase.co:6543/postgres?pgbouncer=true
```

## Common Mistakes

### ❌ Wrong: Using `db.` prefix for HTTP API
```javascript
// WRONG - This will cause 522 errors!
const supabase = createClient(
  'https://db.fqkrigvliyphjwpokwbl.supabase.co',  // ❌ Wrong!
  anonKey
)
```

### ✅ Correct: No `db.` prefix for HTTP API
```javascript
// CORRECT
const supabase = createClient(
  'https://fqkrigvliyphjwpokwbl.supabase.co',  // ✅ Correct!
  anonKey
)
```

### ❌ Wrong: Missing `db.` prefix for database
```javascript
// WRONG - This won't connect to the database!
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://...@fqkrigvliyphjwpokwbl.supabase.co:5432/...'  // ❌ Wrong!
    }
  }
})
```

### ✅ Correct: `db.` prefix for database
```javascript
// CORRECT
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://...@db.fqkrigvliyphjwpokwbl.supabase.co:5432/...'  // ✅ Correct!
    }
  }
})
```

## Verification

Run the verification script to check your configuration:

```bash
node scripts/verify-supabase-urls.js
```

## Finding Your URLs

1. **HTTP API URL:**
   - Go to Supabase Dashboard → Settings → API
   - Look for "Project URL" or "API URL"
   - Should be: `https://<project-ref>.supabase.co`

2. **Database URL:**
   - Go to Supabase Dashboard → Settings → Database
   - Look for "Connection string" → "URI"
   - Should be: `postgresql://postgres:[YOUR-PASSWORD]@db.<project-ref>.supabase.co:5432/postgres`

## Troubleshooting 522 Errors

If you're getting 522 errors (Connection Timeout):

1. **Check if you're using the correct URL format:**
   - HTTP API calls → `https://<ref>.supabase.co` (no `db.`)
   - Database connections → `db.<ref>.supabase.co` (with `db.`)

2. **Verify the URL is set correctly:**
   ```bash
   echo $NEXT_PUBLIC_SUPABASE_URL  # Should be https://<ref>.supabase.co
   echo $DATABASE_URL              # Should include db.<ref>.supabase.co
   ```

3. **Check Supabase Dashboard:**
   - Verify services are healthy (Database, PostgREST, Auth)
   - If services show "Unhealthy", wait for them to recover

4. **Test the connection:**
   ```bash
   # Test database connection
   node scripts/check-db-connection.js
   
   # Verify URL configuration
   node scripts/verify-supabase-urls.js
   ```

## Summary

| Purpose | URL Format | Environment Variable | Example |
|---------|-----------|---------------------|---------|
| HTTP API (Auth, Storage) | `https://<ref>.supabase.co` | `NEXT_PUBLIC_SUPABASE_URL` | `https://fqkrigvliyphjwpokwbl.supabase.co` |
| Database (Direct) | `db.<ref>.supabase.co:5432` | `DATABASE_URL` | `postgresql://...@db.fqkrigvliyphjwpokwbl.supabase.co:5432/...` |
| Database (Pooled) | `<ref>.supabase.co:6543` | `DATABASE_URL` | `postgresql://...@fqkrigvliyphjwpokwbl.supabase.co:6543/...` |

