# Diagnosing Database Connectivity Issues

## Problem: Can't connect to Supabase database

When you get `P1001` errors (Can't reach database server), you need to determine:
1. **Is the database actually down?** OR
2. **Is external access just blocked?**

## Test 1: Database from Inside Supabase (Best Signal)

### Steps:
1. Go to **Supabase Dashboard** → **SQL Editor**
2. Run these queries:

```sql
SELECT now();
SELECT 1;
```

### Results:

**✅ If queries work:**
- Database is **ALIVE** and healthy
- Issue is **external connectivity** (IP ban, firewall, network, IPv6, etc.)
- Your code/network is the problem, not Supabase

**❌ If queries fail:**
- Database is **truly down/unhealthy**
- This is a Supabase infrastructure issue
- Wait for Supabase services to recover

## Test 2: REST API with Key (Hits Database)

This test actually queries the database through PostgREST, so it's a good indicator.

### Command:
```bash
curl -i 'https://fqkrigvliyphjwpokwbl.supabase.co/rest/v1/' \
  -H "apikey: <ANON_OR_SERVICE_KEY>" \
  -H "Authorization: Bearer <ANON_OR_SERVICE_KEY>"
```

### Or use the script:
```bash
node scripts/test-db-via-rest-api.js
```

### Results:

**✅ If you get 200 / 404 / JSON error:**
- Database path is **responding**
- Database is **accessible** via REST API
- Issue is likely **external direct connection** (port 5432/6543)
- Check: IP restrictions, firewall, network settings

**❌ If you get 5xx / timeout / 522:**
- Database path is **broken**
- PostgREST cannot connect to database
- Database may be **truly down**
- Check Supabase dashboard for service status

## Test 3: Direct Database Connection

### Test connection:
```bash
node scripts/check-db-connection.js
```

### Results:

**✅ If connection works:**
- External access is **not blocked**
- Database is **accessible**
- Everything is working

**❌ If connection fails:**
- Could be:
  1. Database is down (if SQL Editor also fails)
  2. External access is blocked (if SQL Editor works)
  3. Network/firewall issue
  4. IP restrictions

## Diagnosis Flowchart

```
Can't connect to database
│
├─ Test 1: SQL Editor in Supabase Dashboard
│  │
│  ├─ ✅ Works → Database is ALIVE
│  │  │
│  │  └─ Test 2: REST API with key
│  │     │
│  │     ├─ ✅ Works → Issue is external direct connection
│  │     │  └─ Check: IP restrictions, firewall, network
│  │     │
│  │     └─ ❌ Fails → PostgREST issue (but DB is alive)
│  │
│  └─ ❌ Fails → Database is truly DOWN
│     └─ Wait for Supabase services to recover
```

## Common Issues

### Issue: SQL Editor works, but direct connection fails

**Cause:** External access is blocked

**Solutions:**
1. Check Supabase Dashboard → Settings → Database → Connection Pooling
2. Verify IP restrictions/allowlist
3. Check firewall rules
4. Try connection pooling URL (port 6543) instead of direct (port 5432)
5. Check if IPv6 is required (some networks)

### Issue: Both SQL Editor and REST API fail

**Cause:** Database is truly down

**Solutions:**
1. Check Supabase Dashboard for service status
2. Wait for services to recover (can take 5-15 minutes after restore)
3. Contact Supabase support if issue persists

### Issue: REST API works, but direct connection fails

**Cause:** External direct connection is blocked, but REST API path works

**Solutions:**
1. Use REST API for queries (if possible)
2. Check IP restrictions on direct database access
3. Use connection pooling (port 6543) instead of direct (port 5432)
4. Verify firewall/network settings

## Quick Test Script

Run the comprehensive test:

```bash
node scripts/test-db-via-rest-api.js
```

This will:
- Test REST API endpoint (hits database)
- Try to query tables
- Provide diagnosis

## Summary

| SQL Editor | REST API | Direct Connection | Diagnosis |
|------------|----------|-------------------|-----------|
| ✅ Works | ✅ Works | ✅ Works | All good! |
| ✅ Works | ✅ Works | ❌ Fails | External access blocked |
| ✅ Works | ❌ Fails | ❌ Fails | PostgREST issue |
| ❌ Fails | ❌ Fails | ❌ Fails | Database is down |

