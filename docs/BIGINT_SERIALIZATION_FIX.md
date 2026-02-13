# BigInt Serialization Fix

## Problem

BigInt serialization errors were occurring again:
```
TypeError: Do not know how to serialize a BigInt
at JSON.stringify (<anonymous>)
```

## Root Cause

When Prisma throws errors, the error objects can contain BigInt values in their properties. When these errors are thrown and Next.js tries to serialize them in the HTTP response, JSON.stringify fails because BigInt cannot be serialized directly.

**Why it happened again:**
- We had `safeStringify` helper functions, but they weren't being used when throwing errors
- Prisma error objects can contain BigInt values in nested properties
- Next.js tries to serialize thrown errors before our catch blocks can clean them

## Solution Applied

### Fixed Error Throwing Locations

1. **Order Save Error** (line 2511-2549)
   - Changed: `throw orderError` → `throw cleanOrderError`
   - Creates clean error object without BigInt values before throwing

2. **Payment Save Error** (line 1516-1524)
   - Changed: `throw paymentError` → `throw cleanPaymentError`
   - Creates clean error object without BigInt values

3. **Square API Error** (line 2182-2189)
   - Changed: `throw apiError` → `throw cleanApiError`
   - Creates clean error object without BigInt values

4. **Order Retry Error** (line 2623-2632)
   - Changed: `throw retryError` → Uses `cleanRetryError`
   - Creates clean error object without BigInt values

### Pattern Used

```javascript
// Before (WRONG - can contain BigInt values)
catch (error) {
  throw error
}

// After (CORRECT - clean error without BigInt)
catch (error) {
  const cleanError = new Error(error?.message || 'Error message')
  cleanError.name = error?.name || 'ErrorName'
  cleanError.code = error?.code
  throw cleanError
}
```

## Why This Pattern Works

1. **New Error Object**: Creates a fresh Error object with only primitive values
2. **No Nested Objects**: Doesn't copy nested objects that might contain BigInt
3. **Preserves Important Info**: Keeps message, name, and code for debugging
4. **Serializable**: Can be safely serialized by JSON.stringify

## Prevention

All error throwing locations now follow this pattern:
- Extract only primitive values (message, name, code)
- Create new Error object
- Don't copy nested objects or properties that might contain BigInt

## Related Files

- `app/api/webhooks/square/route.js` - Fixed 4 error throwing locations
- `app/api/webhooks/square/referrals/route.js` - Already has safeStringify helpers
- `lib/workflows/webhook-job-queue.js` - Already handles BigInt correctly

## Status

✅ **FIXED** - All error throwing locations now create clean error objects without BigInt values.

