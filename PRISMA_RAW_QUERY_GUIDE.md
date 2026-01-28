# Prisma $executeRaw and $queryRaw Common Issues

## Why We Always Have UUID and BigInt Problems

### 1. **UUID Issues**
**Problem**: Prisma's `$executeRaw` doesn't automatically cast types. PostgreSQL is strict about type matching.

**Common Errors**:
- `operator does not exist: text = uuid`
- `column "x" is of type uuid but expression is of type text`

**Solutions**:
```javascript
// ❌ WRONG - No type casting
WHERE id = ${someId}

// ✅ CORRECT - Explicit UUID cast
WHERE id = ${someId}::uuid

// ✅ CORRECT - Using Prisma's tagged template (auto-casts)
await prisma.$queryRaw`
  SELECT * FROM table WHERE id = ${someId}::uuid
`
```

### 2. **BigInt Issues**
**Problem**: JavaScript's `JSON.stringify()` doesn't handle BigInt values (throws "Do not know how to serialize a BigInt").

**Common Errors**:
- `Do not know how to serialize a BigInt`
- Happens when storing JSON with BigInt values

**Solutions**:
```javascript
// ❌ WRONG - Will throw error
JSON.stringify(dataWithBigInt)

// ✅ CORRECT - Custom replacer function
JSON.stringify(dataWithBigInt, (key, value) => 
  typeof value === 'bigint' ? value.toString() : value
)

// ✅ CORRECT - For Prisma JSONB columns
await prisma.$executeRaw`
  INSERT INTO table (json_column) 
  VALUES (${JSON.stringify(data, (k, v) => typeof v === 'bigint' ? v.toString() : v)}::jsonb)
`
```

### 3. **Best Practices**

1. **Always cast UUIDs explicitly**:
   ```javascript
   ${variable}::uuid
   ```

2. **Always handle BigInt in JSON.stringify**:
   ```javascript
   const safeStringify = (obj) => JSON.stringify(obj, (k, v) => 
     typeof v === 'bigint' ? v.toString() : v
   )
   ```

3. **Use Prisma's tagged templates** (they help with SQL injection):
   ```javascript
   await prisma.$queryRaw`SELECT * FROM table WHERE id = ${id}::uuid`
   ```

4. **For complex queries, use $executeRawUnsafe with proper casting**:
   ```javascript
   await prisma.$executeRawUnsafe(
     `UPDATE table SET uuid_col = $1::uuid WHERE id = $2::uuid`,
     uuidValue,
     idValue
   )
   ```

## Common Patterns

### Pattern 1: Resolving UUIDs from Square IDs
```javascript
// Always cast the result
const result = await prisma.$queryRaw`
  SELECT id FROM table
  WHERE square_id = ${squareId}
  LIMIT 1
`
const uuid = result && result.length > 0 ? result[0].id : null

// Then use it with explicit cast
await prisma.$executeRaw`
  UPDATE other_table SET foreign_key = ${uuid}::uuid WHERE ...
`
```

### Pattern 2: Storing JSON with BigInt
```javascript
const safeJson = JSON.stringify(data, (k, v) => 
  typeof v === 'bigint' ? v.toString() : v
)

await prisma.$executeRaw`
  INSERT INTO table (json_column) VALUES (${safeJson}::jsonb)
`
```

### Pattern 3: Conditional UUID Updates
```javascript
const updateFields = []
const updateValues = []

if (someUuid) {
  updateFields.push(`column_name = $${updateValues.length + 1}::uuid`)
  updateValues.push(someUuid)
}

if (updateFields.length > 0) {
  await prisma.$executeRawUnsafe(
    `UPDATE table SET ${updateFields.join(', ')} WHERE id = $${updateValues.length + 1}::uuid`,
    ...updateValues,
    recordId
  )
}
```



