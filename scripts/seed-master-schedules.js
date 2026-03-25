/**
 * Seed master weekly schedules from Square Dashboard bookable hours.
 * Source: Square team member booking profiles (screenshots 2026-03-24).
 *
 * Day mapping: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
 * Times: { sh: startHour, sm: startMinute, eh: endHour, em: endMinute }
 *
 * Usage: node scripts/seed-master-schedules.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Pacific Ave (550 Pacific Ave) ──────────────────────────────────────────
const PACIFIC_AVE_SCHEDULES = {
  'Anastasia L': {
    // Sun 10-6, Mon 10-6, Tue -, Wed 10-6, Thu -, Fri -, Sat 10-6
    0: { sh: 10, sm: 0, eh: 18, em: 0 },
    1: { sh: 10, sm: 0, eh: 18, em: 0 },
    3: { sh: 10, sm: 0, eh: 18, em: 0 },
    6: { sh: 10, sm: 0, eh: 18, em: 0 },
  },
  'Angelina G': {
    // Sun-Sat 10-8
    0: { sh: 10, sm: 0, eh: 20, em: 0 },
    1: { sh: 10, sm: 0, eh: 20, em: 0 },
    2: { sh: 10, sm: 0, eh: 20, em: 0 },
    3: { sh: 10, sm: 0, eh: 20, em: 0 },
    4: { sh: 10, sm: 0, eh: 20, em: 0 },
    5: { sh: 10, sm: 0, eh: 20, em: 0 },
    6: { sh: 10, sm: 0, eh: 20, em: 0 },
  },
  'Anna Moniuk': {
    // Sun -, Mon 10-8, Tue 10-8, Wed 10-5, Thu 12-5, Fri 12-5, Sat 10-4:30
    1: { sh: 10, sm: 0, eh: 20, em: 0 },
    2: { sh: 10, sm: 0, eh: 20, em: 0 },
    3: { sh: 10, sm: 0, eh: 17, em: 0 },
    4: { sh: 12, sm: 0, eh: 17, em: 0 },
    5: { sh: 12, sm: 0, eh: 17, em: 0 },
    6: { sh: 10, sm: 0, eh: 16, em: 30 },
  },
  'Arina Gariaeva': {
    // Sun 10-8, Mon 10-4:30, Tue 10-4:30, Wed 10-4:30, Thu -, Fri 10-8, Sat -
    0: { sh: 10, sm: 0, eh: 20, em: 0 },
    1: { sh: 10, sm: 0, eh: 16, em: 30 },
    2: { sh: 10, sm: 0, eh: 16, em: 30 },
    3: { sh: 10, sm: 0, eh: 16, em: 30 },
    5: { sh: 10, sm: 0, eh: 20, em: 0 },
  },
  'Aruzhan T': {
    // Sun-Sat 10-8
    0: { sh: 10, sm: 0, eh: 20, em: 0 },
    1: { sh: 10, sm: 0, eh: 20, em: 0 },
    2: { sh: 10, sm: 0, eh: 20, em: 0 },
    3: { sh: 10, sm: 0, eh: 20, em: 0 },
    4: { sh: 10, sm: 0, eh: 20, em: 0 },
    5: { sh: 10, sm: 0, eh: 20, em: 0 },
    6: { sh: 10, sm: 0, eh: 20, em: 0 },
  },
  'Bika S': {
    // Sun-Sat 10-8
    0: { sh: 10, sm: 0, eh: 20, em: 0 },
    1: { sh: 10, sm: 0, eh: 20, em: 0 },
    2: { sh: 10, sm: 0, eh: 20, em: 0 },
    3: { sh: 10, sm: 0, eh: 20, em: 0 },
    4: { sh: 10, sm: 0, eh: 20, em: 0 },
    5: { sh: 10, sm: 0, eh: 20, em: 0 },
    6: { sh: 10, sm: 0, eh: 20, em: 0 },
  },
  'Carla Gedeon': {
    // Sun-Wed -, Thu 10-8, Fri 10-8, Sat -
    4: { sh: 10, sm: 0, eh: 20, em: 0 },
    5: { sh: 10, sm: 0, eh: 20, em: 0 },
  },
  'Carol Ramirez': {
    // Sun 10-7, Mon 10-7, Tue 10-7, Wed -, Thu -, Fri 10-7, Sat 10-7
    0: { sh: 10, sm: 0, eh: 19, em: 0 },
    1: { sh: 10, sm: 0, eh: 19, em: 0 },
    2: { sh: 10, sm: 0, eh: 19, em: 0 },
    5: { sh: 10, sm: 0, eh: 19, em: 0 },
    6: { sh: 10, sm: 0, eh: 19, em: 0 },
  },
  'Elizabeth Marie': {
    // Sun 10-8, Mon -, Tue -, Wed 10-4:30, Thu 10-4:30, Fri 10-8, Sat -
    0: { sh: 10, sm: 0, eh: 20, em: 0 },
    3: { sh: 10, sm: 0, eh: 16, em: 30 },
    4: { sh: 10, sm: 0, eh: 16, em: 30 },
    5: { sh: 10, sm: 0, eh: 20, em: 0 },
  },
  'Ruth M': {
    // Sun -, Mon 10-8, Tue 10-8, Wed 10-8, Thu -, Fri 10-8, Sat 10-8
    1: { sh: 10, sm: 0, eh: 20, em: 0 },
    2: { sh: 10, sm: 0, eh: 20, em: 0 },
    3: { sh: 10, sm: 0, eh: 20, em: 0 },
    5: { sh: 10, sm: 0, eh: 20, em: 0 },
    6: { sh: 10, sm: 0, eh: 20, em: 0 },
  },
  'Vinu V': {
    // Sun 10-7, Mon 10-6, Tue -, Wed -, Thu 10-6, Fri 10-6, Sat -
    0: { sh: 10, sm: 0, eh: 19, em: 0 },
    1: { sh: 10, sm: 0, eh: 18, em: 0 },
    4: { sh: 10, sm: 0, eh: 18, em: 0 },
    5: { sh: 10, sm: 0, eh: 18, em: 0 },
  },
};

// ── Union St (2266 Union St) ───────────────────────────────────────────────
const UNION_ST_SCHEDULES = {
  'Elvira A': {
    // Sun-Fri 9-7, Sat -
    0: { sh: 9, sm: 0, eh: 19, em: 0 },
    1: { sh: 9, sm: 0, eh: 19, em: 0 },
    2: { sh: 9, sm: 0, eh: 19, em: 0 },
    3: { sh: 9, sm: 0, eh: 19, em: 0 },
    4: { sh: 9, sm: 0, eh: 19, em: 0 },
    5: { sh: 9, sm: 0, eh: 19, em: 0 },
  },
  'Esther R': {
    // Sun-Sat 9-7
    0: { sh: 9, sm: 0, eh: 19, em: 0 },
    1: { sh: 9, sm: 0, eh: 19, em: 0 },
    2: { sh: 9, sm: 0, eh: 19, em: 0 },
    3: { sh: 9, sm: 0, eh: 19, em: 0 },
    4: { sh: 9, sm: 0, eh: 19, em: 0 },
    5: { sh: 9, sm: 0, eh: 19, em: 0 },
    6: { sh: 9, sm: 0, eh: 19, em: 0 },
  },
  'Irina M': {
    // Sun-Thu -, Fri 9-7, Sat 9-7
    5: { sh: 9, sm: 0, eh: 19, em: 0 },
    6: { sh: 9, sm: 0, eh: 19, em: 0 },
  },
  'Julia Vasko': {
    // Sun-Sat 9-7
    0: { sh: 9, sm: 0, eh: 19, em: 0 },
    1: { sh: 9, sm: 0, eh: 19, em: 0 },
    2: { sh: 9, sm: 0, eh: 19, em: 0 },
    3: { sh: 9, sm: 0, eh: 19, em: 0 },
    4: { sh: 9, sm: 0, eh: 19, em: 0 },
    5: { sh: 9, sm: 0, eh: 19, em: 0 },
    6: { sh: 9, sm: 0, eh: 19, em: 0 },
  },
  'Kasia R': {
    // Sun 9-7, Mon -, Tue -, Wed 9-7, Thu -, Fri -, Sat -
    0: { sh: 9, sm: 0, eh: 19, em: 0 },
    3: { sh: 9, sm: 0, eh: 19, em: 0 },
  },
  'Ksenia T': {
    // Sun -, Mon-Fri 9-6, Sat -
    1: { sh: 9, sm: 0, eh: 18, em: 0 },
    2: { sh: 9, sm: 0, eh: 18, em: 0 },
    3: { sh: 9, sm: 0, eh: 18, em: 0 },
    4: { sh: 9, sm: 0, eh: 18, em: 0 },
    5: { sh: 9, sm: 0, eh: 18, em: 0 },
  },
  'Marichka Savchuk': {
    // Sun-Sat 9-7
    0: { sh: 9, sm: 0, eh: 19, em: 0 },
    1: { sh: 9, sm: 0, eh: 19, em: 0 },
    2: { sh: 9, sm: 0, eh: 19, em: 0 },
    3: { sh: 9, sm: 0, eh: 19, em: 0 },
    4: { sh: 9, sm: 0, eh: 19, em: 0 },
    5: { sh: 9, sm: 0, eh: 19, em: 0 },
    6: { sh: 9, sm: 0, eh: 19, em: 0 },
  },
  'Martha Y': {
    // Sun-Sat 9-7
    0: { sh: 9, sm: 0, eh: 19, em: 0 },
    1: { sh: 9, sm: 0, eh: 19, em: 0 },
    2: { sh: 9, sm: 0, eh: 19, em: 0 },
    3: { sh: 9, sm: 0, eh: 19, em: 0 },
    4: { sh: 9, sm: 0, eh: 19, em: 0 },
    5: { sh: 9, sm: 0, eh: 19, em: 0 },
    6: { sh: 9, sm: 0, eh: 19, em: 0 },
  },
  'Milana S': {
    // Sun-Tue -, Wed-Fri 9-7, Sat 10-7
    3: { sh: 9, sm: 0, eh: 19, em: 0 },
    4: { sh: 9, sm: 0, eh: 19, em: 0 },
    5: { sh: 9, sm: 0, eh: 19, em: 0 },
    6: { sh: 10, sm: 0, eh: 19, em: 0 },
  },
  'Nadia Rodriguez': {
    // Sun-Sat 9-7
    0: { sh: 9, sm: 0, eh: 19, em: 0 },
    1: { sh: 9, sm: 0, eh: 19, em: 0 },
    2: { sh: 9, sm: 0, eh: 19, em: 0 },
    3: { sh: 9, sm: 0, eh: 19, em: 0 },
    4: { sh: 9, sm: 0, eh: 19, em: 0 },
    5: { sh: 9, sm: 0, eh: 19, em: 0 },
    6: { sh: 9, sm: 0, eh: 19, em: 0 },
  },
  'Olga Benitez': {
    // Sun -, Mon 9-7, Tue 9-7, Wed -, Thu 9-7, Fri -, Sat 10-7
    1: { sh: 9, sm: 0, eh: 19, em: 0 },
    2: { sh: 9, sm: 0, eh: 19, em: 0 },
    4: { sh: 9, sm: 0, eh: 19, em: 0 },
    6: { sh: 10, sm: 0, eh: 19, em: 0 },
  },
  'Polina Olegova': {
    // Sun-Sat 9-7
    0: { sh: 9, sm: 0, eh: 19, em: 0 },
    1: { sh: 9, sm: 0, eh: 19, em: 0 },
    2: { sh: 9, sm: 0, eh: 19, em: 0 },
    3: { sh: 9, sm: 0, eh: 19, em: 0 },
    4: { sh: 9, sm: 0, eh: 19, em: 0 },
    5: { sh: 9, sm: 0, eh: 19, em: 0 },
    6: { sh: 9, sm: 0, eh: 19, em: 0 },
  },
};

function calcMinutes({ sh, sm, eh, em }) {
  return (eh * 60 + em) - (sh * 60 + sm);
}

async function seedSchedules() {
  const org = await prisma.organization.findFirst({
    where: { is_active: true, name: { contains: 'ZORINA' } }
  }) || await prisma.organization.findFirst({ where: { is_active: true } });
  if (!org) throw new Error('No active organization');
  console.log(`Using org: ${org.name} (${org.id})`);

  // Get locations
  const locations = await prisma.location.findMany({ where: { organization_id: org.id } });
  const pacificLoc = locations.find(l => l.name?.includes('Pacific') || l.square_location_id?.includes('Pacific'));
  const unionLoc = locations.find(l => l.name?.includes('Union') || l.square_location_id?.includes('Union'));

  if (!pacificLoc && !unionLoc) {
    console.log('Locations found:', locations.map(l => ({ id: l.id, name: l.name })));
    throw new Error('Could not identify Pacific Ave or Union St locations');
  }

  // Get all team members
  const teamMembers = await prisma.teamMember.findMany({
    where: { organization_id: org.id, status: 'ACTIVE' },
  });

  console.log(`Found ${teamMembers.length} active team members`);
  console.log(`Pacific Ave: ${pacificLoc?.id || 'NOT FOUND'} (${pacificLoc?.name})`);
  console.log(`Union St: ${unionLoc?.id || 'NOT FOUND'} (${unionLoc?.name})`);

  let upserted = 0;
  let skipped = 0;

  async function processScheduleMap(scheduleMap, location) {
    if (!location) {
      console.log('  Skipping — location not found');
      return;
    }

    for (const [displayName, days] of Object.entries(scheduleMap)) {
      // Match by given_name + family_name first letter
      const parts = displayName.split(' ');
      const firstName = parts[0];
      const lastInitialOrName = parts.slice(1).join(' ');

      const tm = teamMembers.find(t => {
        const gn = (t.given_name || '').trim();
        const fn = (t.family_name || '').trim();
        // Try exact match first
        if (`${gn} ${fn}` === displayName) return true;
        // Try first name + last initial
        if (gn === firstName && fn.startsWith(lastInitialOrName)) return true;
        // Try first name + last initial (single letter)
        if (lastInitialOrName.length === 1 && gn === firstName && fn.startsWith(lastInitialOrName)) return true;
        // Fallback: first name match only (if unique)
        return false;
      });

      if (!tm) {
        console.log(`  ⚠️  No team member match for "${displayName}" — skipped`);
        skipped++;
        continue;
      }

      for (const [dayStr, times] of Object.entries(days)) {
        const dayOfWeek = parseInt(dayStr);
        const minutes = calcMinutes(times);

        await prisma.$executeRawUnsafe(`
          INSERT INTO master_weekly_schedule (
            id, team_member_id, organization_id, location_id,
            day_of_week, start_hour, start_minute, end_hour, end_minute,
            scheduled_minutes, source, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid,
            $4, $5, $6, $7, $8,
            $9, 'SQUARE_SEED', NOW(), NOW()
          )
          ON CONFLICT (team_member_id, location_id, day_of_week)
          DO UPDATE SET
            start_hour = EXCLUDED.start_hour,
            start_minute = EXCLUDED.start_minute,
            end_hour = EXCLUDED.end_hour,
            end_minute = EXCLUDED.end_minute,
            scheduled_minutes = EXCLUDED.scheduled_minutes,
            source = EXCLUDED.source,
            updated_at = NOW()
        `, tm.id, org.id, location.id,
          dayOfWeek, times.sh, times.sm, times.eh, times.em, minutes
        );
        upserted++;
      }
      console.log(`  ✅ ${displayName} → ${tm.given_name} ${tm.family_name} (${Object.keys(days).length} days)`);
    }
  }

  console.log('\n── Pacific Ave ──');
  await processScheduleMap(PACIFIC_AVE_SCHEDULES, pacificLoc);

  console.log('\n── Union St ──');
  await processScheduleMap(UNION_ST_SCHEDULES, unionLoc);

  console.log(`\nDone: ${upserted} schedule rows upserted, ${skipped} masters skipped`);
}

seedSchedules()
  .catch(e => console.error('Error:', e))
  .finally(() => prisma.$disconnect());
