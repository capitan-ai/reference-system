const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Verifying synced catalog data...');

  const itemsCount = await prisma.catalogItem.count();
  const variationsCount = await prisma.catalogVariation.count();

  console.log(`📊 Total Catalog Items: ${itemsCount}`);
  console.log(`📊 Total Catalog Variations: ${variationsCount}`);

  const items = await prisma.catalogItem.findMany({
    include: {
      variations: true,
    },
    take: 5,
  });

  console.log('\n🔍 Sample Data:');
  items.forEach((item) => {
    console.log(`\n📦 Item: ${item.name} (${item.square_item_id})`);
    item.variations.forEach((v) => {
      console.log(`  🔹 Var: ${v.name} - $${(v.price_amount / 100).toFixed(2)} (${v.square_variation_id})`);
    });
  });

  console.log('\n✅ Verification completed!');
}

main()
  .catch((e) => {
    console.error('❌ Error verifying catalog:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


