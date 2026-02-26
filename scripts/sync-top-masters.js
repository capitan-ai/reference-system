const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const catalogData = [
  {
    "objects": [
      {
        "type": "ITEM",
        "id": "444AMU4XKRSI7ELI3OHTSFU2",
        "item_data": {
          "name": "Russian manicure with TOP MASTER",
          "description": "Our Russian Manicure with TOP MASTER offers the highest level of expertise...",
          "variations": [
            { "id": "BRSIGZFOWC6F4ERPKX3CODLU", "item_variation_data": { "name": "TOP Angelina", "price_money": { "amount": 14000 } } },
            { "id": "BM556FTNFOTEHYVG4GPXAXFM", "item_variation_data": { "name": "TOP Esther", "price_money": { "amount": 14000 } } },
            { "id": "JMTK5M2CY2W7WEXSTAJKAJ35", "item_variation_data": { "name": "TOP Ksenia", "price_money": { "amount": 14000 } } },
            { "id": "6TYOE67IDYTKHW2ZG6HKVZER", "item_variation_data": { "name": "TOP Marichka", "price_money": { "amount": 14000 } } },
            { "id": "GJ5SRTYFV6ZCDI62TMSZP2OP", "item_variation_data": { "name": "TOP Anya", "price_money": { "amount": 14000 } } },
            { "id": "XBUDIMNKOPC2XVG5YLIQ4RYS", "item_variation_data": { "name": "TOP Bika", "price_money": { "amount": 14000 } } },
            { "id": "GSZZR45VJXB44NF4P4WXI5NB", "item_variation_data": { "name": "TOP Anna P", "price_money": { "amount": 14000 } } },
            { "id": "LI7DPMZ73P77O27QKKOX5JAK", "item_variation_data": { "name": "TOP Betina", "price_money": { "amount": 14000 } } },
            { "id": "TUQVRAANPVBDAMK5PXBQSNZ5", "item_variation_data": { "name": "TOP Julia", "price_money": { "amount": 14000 } } },
            { "id": "TRWNNSSRAWCTWJGDNSEI3PVH", "item_variation_data": { "name": "TOP Alexandra", "price_money": { "amount": 14000 } } }
          ]
        }
      }
    ]
  }
];

const organizationId = 'd0e24178-2f94-4033-bc91-41f22df58278';

async function main() {
  console.log('🚀 Syncing ALL variations for TOP MASTER...');
  const item = catalogData[0].objects[0];
  
  for (const variation of item.item_data.variations) {
    console.log(`  🔹 Syncing: ${variation.item_variation_data.name} (${variation.id})`);
    await prisma.serviceVariation.upsert({
      where: { square_variation_id: variation.id },
      update: {
        price_amount: variation.item_variation_data.price_money.amount,
        service_name: item.item_data.name,
        name: variation.item_variation_data.name,
        updated_at: new Date()
      },
      create: {
        uuid: crypto.randomUUID(),
        square_variation_id: variation.id,
        organization_id: organizationId,
        service_name: item.item_data.name,
        name: variation.item_variation_data.name,
        price_amount: variation.item_variation_data.price_money.amount,
        created_at: new Date(),
        updated_at: new Date()
      }
    });
  }
  console.log('✅ Done!');
}

main().finally(() => prisma.$disconnect());

