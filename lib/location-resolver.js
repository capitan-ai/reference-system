async function resolveLocationUuidForSquareLocationId(prisma, squareLocationId, organizationId) {
  console.log(`[LOCATION-RESOLVER] Resolving ${squareLocationId} for org ${organizationId}`);
  if (!squareLocationId || !organizationId) {
    console.warn(`[LOCATION-RESOLVER] Missing params: squareLocationId=${squareLocationId}, organizationId=${organizationId}`);
    return null;
  }

  // Step 1: lookup with org
  let record = await prisma.$queryRaw`
    SELECT id::text as id
    FROM locations
    WHERE square_location_id = ${squareLocationId}
      AND organization_id = ${organizationId}::uuid
    LIMIT 1
  `
  if (record?.[0]?.id) {
    console.log(`[LOCATION-RESOLVER] Found existing record: ${record[0].id}`);
    return record[0].id;
  }

  // Step 2: lookup without org, then update
  console.log(`[LOCATION-RESOLVER] No record for org ${organizationId}, checking globally...`);
  record = await prisma.$queryRaw`
    SELECT id::text as id
    FROM locations
    WHERE square_location_id = ${squareLocationId}
    LIMIT 1
  `
  if (record?.[0]?.id) {
    const locationUuid = record[0].id
    console.log(`[LOCATION-RESOLVER] Found global record ${locationUuid}, updating to org ${organizationId}`);
    await prisma.$executeRaw`
      UPDATE locations
      SET organization_id = ${organizationId}::uuid,
          updated_at = NOW()
      WHERE id = ${locationUuid}::uuid
    `
    return locationUuid
  }

  // Step 3: create new
  console.log(`[LOCATION-RESOLVER] Creating new location for ${squareLocationId}`);
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

export { resolveLocationUuidForSquareLocationId };
export default { resolveLocationUuidForSquareLocationId };



