async function resolveLocationUuidForSquareLocationId(prisma, squareLocationId, organizationId) {
  if (!squareLocationId || !organizationId) return null

  // Step 1: lookup with org
  let record = await prisma.$queryRaw`
    SELECT id::text as id
    FROM locations
    WHERE square_location_id = ${squareLocationId}
      AND organization_id = ${organizationId}::text
    LIMIT 1
  `
  if (record?.[0]?.id) return record[0].id

  // Step 2: lookup without org, then update
  record = await prisma.$queryRaw`
    SELECT id::text as id
    FROM locations
    WHERE square_location_id = ${squareLocationId}
    LIMIT 1
  `
  if (record?.[0]?.id) {
    const locationUuid = record[0].id
    await prisma.$executeRaw`
      UPDATE locations
      SET organization_id = ${organizationId}::uuid,
          updated_at = NOW()
      WHERE id = ${locationUuid}::uuid
    `
    return locationUuid
  }

  // Step 3: create new
  const created = await prisma.location.create({
    data: {
      organization_id: organizationId,
      square_location_id: squareLocationId,
      name: `Location ${squareLocationId.substring(0, 8)}...`,
    },
  })

  // HARD ASSERT
  if (!created?.id) {
    throw new Error(`Failed to create location for square_location_id=${squareLocationId}`)
  }

  return created.id
}

module.exports = { resolveLocationUuidForSquareLocationId }
module.exports.default = { resolveLocationUuidForSquareLocationId }


