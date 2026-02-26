const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Creating catalog tables manually...');

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS public.catalog_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          square_item_id TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          product_type TEXT,
          abbreviation TEXT,
          label_color TEXT,
          is_deleted BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ(6) DEFAULT NOW(),
          updated_at TIMESTAMPTZ(6) DEFAULT NOW(),
          organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
          present_at_all_locations BOOLEAN DEFAULT TRUE,
          present_at_location_ids TEXT[] DEFAULT '{}'
      );
    `);
    console.log('✅ Created catalog_items table');

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS public.catalog_variations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          square_variation_id TEXT UNIQUE NOT NULL,
          item_id UUID NOT NULL REFERENCES public.catalog_items(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          pricing_type TEXT,
          price_amount INTEGER,
          price_currency TEXT DEFAULT 'USD',
          service_duration BIGINT,
          available_for_booking BOOLEAN DEFAULT TRUE,
          team_member_ids TEXT[] DEFAULT '{}',
          is_deleted BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ(6) DEFAULT NOW(),
          updated_at TIMESTAMPTZ(6) DEFAULT NOW(),
          organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE
      );
    `);
    console.log('✅ Created catalog_variations table');

    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_catalog_items_organization_id ON public.catalog_items(organization_id);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_catalog_variations_organization_id ON public.catalog_variations(organization_id);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_catalog_variations_item_id ON public.catalog_variations(item_id);`);
    console.log('✅ Created indexes');

    console.log('🎉 All tables created successfully!');
  } catch (error) {
    console.error('❌ Error creating tables:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

