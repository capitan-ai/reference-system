const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Mapping from location_code enum to location name patterns
const locationCodeToNamePattern = {
  PACIFIC_AVE: "Pacific",
  UNION_ST: "Union",
  UNKNOWN_LOC: null, // Will remain NULL
};

async function fillLocationIds() {
  try {
    // Get all unique (organization_id, location_code) combinations in team_members
    const teamMembersWithoutLocation = await prisma.teamMember.findMany({
      where: {
        location_id: null,
        location_code: {
          not: "UNKNOWN_LOC",
        },
      },
      distinct: ["organization_id", "location_code"],
      select: {
        organization_id: true,
        location_code: true,
      },
    });

    console.log(
      "Team members without location_id:",
      teamMembersWithoutLocation
    );

    // For each combination, find matching location and update
    for (const { organization_id, location_code } of teamMembersWithoutLocation) {
      const namePattern = locationCodeToNamePattern[location_code];

      if (!namePattern) {
        console.log(`Skipping ${location_code} (no mapping)`);
        continue;
      }

      // Find location by name pattern in same organization
      const location = await prisma.location.findFirst({
        where: {
          organization_id,
          name: {
            contains: namePattern,
            mode: "insensitive",
          },
        },
      });

      if (!location) {
        console.log(
          `No location found for ${location_code} in organization ${organization_id}`
        );
        console.log(`Looking for locations with pattern: ${namePattern}`);

        // Show available locations for this org
        const availableLocations = await prisma.location.findMany({
          where: { organization_id },
          select: { id: true, name: true },
        });
        console.log("Available locations:", availableLocations);
        continue;
      }

      // Update all team members with this combination
      const updated = await prisma.teamMember.updateMany({
        where: {
          organization_id,
          location_code,
          location_id: null,
        },
        data: {
          location_id: location.id,
        },
      });

      console.log(
        `Updated ${updated.count} team members for ${location_code} -> ${location.name}`
      );
    }

    console.log("Done!");
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

fillLocationIds();
