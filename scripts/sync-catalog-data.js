const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const catalogData = [
  {
    "objects": [
      {
        "type": "ITEM",
        "id": "DY2FGRXACZQXTINQDX76BZYE",
        "updated_at": "2026-02-24T23:36:24.78Z",
        "created_at": "2023-12-13T17:51:00.028Z",
        "is_deleted": false,
        "present_at_all_locations": false,
        "present_at_location_ids": [
          "LNQKVBTQZN3EZ",
          "LT4ZHFBQQYB2N"
        ],
        "item_data": {
          "name": "Russian E-file Manicure (cuticle work only)",
          "label_color": "911C12",
          "variations": [
            {
              "type": "ITEM_VARIATION",
              "id": "VVA7G2UN7N2HUFMCW5LQOVHB",
              "item_variation_data": {
                "item_id": "DY2FGRXACZQXTINQDX76BZYE",
                "name": "Regular",
                "pricing_type": "FIXED_PRICING",
                "price_money": {
                  "amount": 7000,
                  "currency": "USD"
                },
                "service_duration": 2700000,
                "available_for_booking": true,
                "team_member_ids": [
                  "TMQ7SBwevl5z1-JE", "TMXiw38Bbb7XQUWI", "TMY8nA5MR1nKKS3Q", "TMSHCoHWoyf5290X", "TMTcqc1bm3sBHmBV", "TMEvfivX1FlbVblT", "TMNW4SIF7tjp4oM_", "TM7_r-KmvY9xjnEU", "TMILsQUVwLkLzbVo", "TMyUMvTJIj2HrHSg", "TMWAtQTYmZpwwxii", "TMgsjtuk5cfKnstq", "TMVwAQUdLz6no-cB", "TMEWAZHdtaiRR_Zs", "TM-zXe9fXe4axYWn", "TMUG3s1qVnk-DCtG", "TMMHlgFBIFbMTRap", "TM9jDlRr_Hl4rdBB", "TMdagA6g0F03A7_w", "TMe-bT5XxKxmk0nw", "TMOscywuGXO2VURY", "TMkdrQsxG5tlf-c_"
                ]
              }
            }
          ],
          "product_type": "APPOINTMENTS_SERVICE"
        }
      },
      {
        "type": "ITEM",
        "id": "A2CSBPWXVD73JGSOPTZINVJZ",
        "updated_at": "2026-02-25T00:32:35.001Z",
        "created_at": "2023-12-13T18:01:32.121Z",
        "is_deleted": false,
        "present_at_all_locations": true,
        "item_data": {
          "name": "Smart E-file Pedicure( no color)",
          "description": "Signature E-file pedicure done by the nail technicians in a dry or E-file technique.\n\nAn E-file pedicure service is a professional foot treatment using an electronic file for precise nail shaping, cuticle care, and callus removal.",
          "label_color": "E76132",
          "variations": [
            {
              "type": "ITEM_VARIATION",
              "id": "SBE5XUATXRM76CBTT25HL2NZ",
              "item_variation_data": {
                "item_id": "A2CSBPWXVD73JGSOPTZINVJZ",
                "name": "Regular",
                "pricing_type": "FIXED_PRICING",
                "price_money": {
                  "amount": 10000,
                  "currency": "USD"
                },
                "service_duration": 3600000,
                "available_for_booking": true,
                "team_member_ids": [
                  "TMSHCoHWoyf5290X", "TMEvfivX1FlbVblT", "TMY8nA5MR1nKKS3Q", "TMQ7SBwevl5z1-JE", "TMTcqc1bm3sBHmBV", "TMOscywuGXO2VURY", "TMILsQUVwLkLzbVo", "TMNW4SIF7tjp4oM_", "TM7_r-KmvY9xjnEU", "TMyUMvTJIj2HrHSg", "TMgsjtuk5cfKnstq", "TMVwAQUdLz6no-cB", "TMXiw38Bbb7XQUWI", "TM9jDlRr_Hl4rdBB", "TMEWAZHdtaiRR_Zs", "TMgretPQwvqtzmrC"
                ]
              }
            }
          ],
          "product_type": "APPOINTMENTS_SERVICE"
        }
      },
      {
        "type": "ITEM",
        "id": "UVNR734QW76TSKA7LGTYHXFS",
        "updated_at": "2026-02-25T00:32:35.001Z",
        "created_at": "2023-12-13T18:03:05.931Z",
        "is_deleted": false,
        "present_at_all_locations": true,
        "item_data": {
          "name": "Smart E-file Pedicure with gel",
          "description": "Signature gel pedicure done by the nail technicians in a dry or E-file technique.\n\nAn E-file pedicure service is a professional foot treatment using an electronic file for precise nail shaping, cuticle care, and callus removal.",
          "variations": [
            {
              "type": "ITEM_VARIATION",
              "id": "ZEAKNB35I37RMXNUBGWDZQIM",
              "item_variation_data": {
                "item_id": "UVNR734QW76TSKA7LGTYHXFS",
                "name": "Top Master Irina",
                "pricing_type": "FIXED_PRICING",
                "price_money": {
                  "amount": 13000,
                  "currency": "USD"
                },
                "service_duration": 5400000,
                "available_for_booking": true,
                "team_member_ids": [
                  "TMSHCoHWoyf5290X", "TMEvfivX1FlbVblT", "TMY8nA5MR1nKKS3Q", "TMQ7SBwevl5z1-JE", "TMTcqc1bm3sBHmBV", "TMOscywuGXO2VURY", "TMILsQUVwLkLzbVo", "TMNW4SIF7tjp4oM_", "TM7_r-KmvY9xjnEU", "TMyUMvTJIj2HrHSg", "TMgsjtuk5cfKnstq", "TMVwAQUdLz6no-cB", "TMXiw38Bbb7XQUWI", "TM9jDlRr_Hl4rdBB", "TMEWAZHdtaiRR_Zs", "TMgretPQwvqtzmrC"
                ]
              }
            }
          ],
          "product_type": "APPOINTMENTS_SERVICE"
        }
      },
      {
        "type": "ITEM",
        "id": "CXNUJDF7TR5TB7IY4OFWLNSR",
        "updated_at": "2026-02-21T17:39:18.178Z",
        "created_at": "2023-12-24T05:57:53.483Z",
        "is_deleted": false,
        "present_at_all_locations": true,
        "item_data": {
          "name": "Designs",
          "description": "PLEASE NOTE: All design services MUST be booked with a full manicure or pedicure...",
          "variations": [
            {
              "type": "ITEM_VARIATION",
              "id": "6F6F3OAFJSOEN3X7HSXYIVQC",
              "item_variation_data": {
                "item_id": "CXNUJDF7TR5TB7IY4OFWLNSR",
                "name": "Simple Level Design(cat eye, minimal design on one )",
                "pricing_type": "FIXED_PRICING",
                "price_money": { "amount": 1000, "currency": "USD" },
                "service_duration": 600000,
                "available_for_booking": true,
                "team_member_ids": ["TMNW4SIF7tjp4oM_", "TMILsQUVwLkLzbVo", "TMyUMvTJIj2HrHSg", "TM7_r-KmvY9xjnEU", "TMgsjtuk5cfKnstq", "TMVwAQUdLz6no-cB", "TM-zXe9fXe4axYWn", "TMMHlgFBIFbMTRap", "TMdagA6g0F03A7_w", "TMXiw38Bbb7XQUWI", "TMEWAZHdtaiRR_Zs", "TM9jDlRr_Hl4rdBB", "TMOscywuGXO2VURY", "TMkdrQsxG5tlf-c_", "TMEvfivX1FlbVblT", "TMTcqc1bm3sBHmBV", "TMSHCoHWoyf5290X", "TMY8nA5MR1nKKS3Q"]
              }
            },
            {
              "type": "ITEM_VARIATION",
              "id": "HAJX45W3U2WUCCXM5MI24UEE",
              "item_variation_data": {
                "item_id": "CXNUJDF7TR5TB7IY4OFWLNSR",
                "name": "Medium Level Design (french tip, chrome, ombre)",
                "pricing_type": "FIXED_PRICING",
                "price_money": { "amount": 2000, "currency": "USD" },
                "service_duration": 1200000,
                "available_for_booking": true,
                "team_member_ids": ["TMNW4SIF7tjp4oM_", "TM7_r-KmvY9xjnEU", "TMILsQUVwLkLzbVo", "TMyUMvTJIj2HrHSg", "TMWAtQTYmZpwwxii", "TMgsjtuk5cfKnstq", "TMVwAQUdLz6no-cB", "TM-zXe9fXe4axYWn", "TMXiw38Bbb7XQUWI", "TM9jDlRr_Hl4rdBB", "TMMHlgFBIFbMTRap", "TMEWAZHdtaiRR_Zs", "TMEvfivX1FlbVblT", "TMTcqc1bm3sBHmBV", "TMSHCoHWoyf5290X", "TMY8nA5MR1nKKS3Q"]
              }
            },
            {
              "type": "ITEM_VARIATION",
              "id": "LFLFEZO7L46URIM2OVZOJADI",
              "item_variation_data": {
                "item_id": "CXNUJDF7TR5TB7IY4OFWLNSR",
                "name": "Hard Level Design (includes at least two colors on all nails plus added elements like lines, dots, or art)",
                "pricing_type": "FIXED_PRICING",
                "price_money": { "amount": 4000, "currency": "USD" },
                "service_duration": 1800000,
                "available_for_booking": true,
                "team_member_ids": ["TMNW4SIF7tjp4oM_", "TM7_r-KmvY9xjnEU", "TMILsQUVwLkLzbVo", "TMyUMvTJIj2HrHSg", "TMWAtQTYmZpwwxii", "TMVwAQUdLz6no-cB", "TMEvfivX1FlbVblT", "TMTcqc1bm3sBHmBV", "TMSHCoHWoyf5290X", "TMY8nA5MR1nKKS3Q"]
              }
            }
          ],
          "product_type": "APPOINTMENTS_SERVICE"
        }
      },
      {
        "type": "ITEM",
        "id": "XIQE2PTOTVSTB6LI7PWMTSQO",
        "updated_at": "2026-02-21T17:40:39.128Z",
        "created_at": "2024-01-04T14:31:34.226Z",
        "is_deleted": false,
        "present_at_all_locations": true,
        "item_data": {
          "name": "Nail Extension",
          "description": "Signature gel manicure with nail extensions...",
          "variations": [
            {
              "type": "ITEM_VARIATION",
              "id": "4QI3JWGEYQANKCGC36J3MYNB",
              "item_variation_data": {
                "item_id": "XIQE2PTOTVSTB6LI7PWMTSQO",
                "name": "Short Length Extension",
                "pricing_type": "FIXED_PRICING",
                "price_money": { "amount": 19000, "currency": "USD" },
                "service_duration": 9000000,
                "available_for_booking": true,
                "team_member_ids": ["TMILsQUVwLkLzbVo", "TMWAtQTYmZpwwxii", "TMgsjtuk5cfKnstq", "TM7_r-KmvY9xjnEU", "TMVwAQUdLz6no-cB", "TMNW4SIF7tjp4oM_", "TMMHlgFBIFbMTRap", "TM9jDlRr_Hl4rdBB", "TMEvfivX1FlbVblT", "TMdagA6g0F03A7_w", "TMTcqc1bm3sBHmBV", "TMSHCoHWoyf5290X", "TMY8nA5MR1nKKS3Q"]
              }
            }
          ],
          "product_type": "APPOINTMENTS_SERVICE"
        }
      },
      {
        "type": "ITEM",
        "id": "KRZ4C2O4XKGYZYPXGAZ7TYRA",
        "updated_at": "2026-02-21T17:39:18.178Z",
        "created_at": "2024-09-17T21:07:27.006Z",
        "is_deleted": false,
        "present_at_all_locations": true,
        "item_data": {
          "name": "Russian Manicure with MASTER",
          "description": "Our Russian Manicure with MASTER offers three levels of expertise...",
          "variations": [
            {
              "type": "ITEM_VARIATION",
              "id": "5KMEQ27BJSRQ4HEIXM3BEVCU",
              "item_variation_data": {
                "item_id": "KRZ4C2O4XKGYZYPXGAZ7TYRA",
                "name": "Regular",
                "pricing_type": "FIXED_PRICING",
                "price_money": { "amount": 12000, "currency": "USD" },
                "service_duration": 7200000,
                "available_for_booking": true,
                "team_member_ids": ["TMXiw38Bbb7XQUWI", "TMMHlgFBIFbMTRap", "TMEWAZHdtaiRR_Zs", "TMgretPQwvqtzmrC", "TMdagA6g0F03A7_w", "TMUG3s1qVnk-DCtG", "TMOscywuGXO2VURY", "TMTcqc1bm3sBHmBV", "TMSHCoHWoyf5290X", "TM-zXe9fXe4axYWn", "TMY8nA5MR1nKKS3Q"]
              }
            }
          ],
          "product_type": "APPOINTMENTS_SERVICE"
        }
      },
      {
        "type": "ITEM",
        "id": "HMN4MCFVBX4MDHYKHTYIDHM5",
        "updated_at": "2026-02-25T00:32:35.001Z",
        "created_at": "2024-10-04T20:43:50.907Z",
        "is_deleted": false,
        "present_at_all_locations": true,
        "item_data": {
          "name": "Russian Manicure with JUNIOR MASTER",
          "description": "The Junior Master delivers precise cuticle work...",
          "variations": [
            {
              "type": "ITEM_VARIATION",
              "id": "CJI5WHOAKSFTASYPJ4MSYZLS",
              "item_variation_data": {
                "item_id": "HMN4MCFVBX4MDHYKHTYIDHM5",
                "name": "Regular",
                "pricing_type": "FIXED_PRICING",
                "price_money": { "amount": 10000, "currency": "USD" },
                "service_duration": 8400000,
                "available_for_booking": true,
                "team_member_ids": ["TMe-bT5XxKxmk0nw", "TMkdrQsxG5tlf-c_", "TMQ7SBwevl5z1-JE"]
              }
            }
          ],
          "product_type": "APPOINTMENTS_SERVICE"
        }
      },
      {
        "type": "ITEM",
        "id": "444AMU4XKRSI7ELI3OHTSFU2",
        "updated_at": "2026-02-18T00:41:27.623Z",
        "created_at": "2025-04-08T18:19:27.866Z",
        "is_deleted": false,
        "present_at_all_locations": true,
        "item_data": {
          "name": "Russian manicure with TOP MASTER",
          "description": "Our Russian Manicure with TOP MASTER offers the highest level of expertise...",
          "variations": [
            {
              "type": "ITEM_VARIATION",
              "id": "BRSIGZFOWC6F4ERPKX3CODLU",
              "item_variation_data": {
                "item_id": "444AMU4XKRSI7ELI3OHTSFU2",
                "name": "TOP Angelina",
                "pricing_type": "FIXED_PRICING",
                "price_money": { "amount": 14000, "currency": "USD" },
                "service_duration": 5400000,
                "available_for_booking": true,
                "team_member_ids": ["TMNW4SIF7tjp4oM_"]
              }
            }
          ],
          "product_type": "APPOINTMENTS_SERVICE"
        }
      }
    ]
  }
];

const organizationId = 'd0e24178-2f94-4033-bc91-41f22df58278';

async function main() {
  console.log('🚀 Starting catalog sync...');

  for (const batch of catalogData) {
    for (const obj of batch.objects) {
      if (obj.type === 'ITEM') {
        console.log(`📦 Syncing item: ${obj.item_data.name} (${obj.id})`);
        
        const catalogItem = await prisma.catalogItem.upsert({
          where: { square_item_id: obj.id },
          update: {
            name: obj.item_data.name,
            description: obj.item_data.description || null,
            product_type: obj.item_data.product_type || null,
            abbreviation: obj.item_data.abbreviation || null,
            label_color: obj.item_data.label_color || null,
            is_deleted: obj.is_deleted || false,
            present_at_all_locations: obj.present_at_all_locations ?? true,
            present_at_location_ids: obj.present_at_location_ids || [],
            updated_at: new Date(obj.updated_at),
          },
          create: {
            square_item_id: obj.id,
            name: obj.item_data.name,
            description: obj.item_data.description || null,
            product_type: obj.item_data.product_type || null,
            abbreviation: obj.item_data.abbreviation || null,
            label_color: obj.item_data.label_color || null,
            is_deleted: obj.is_deleted || false,
            present_at_all_locations: obj.present_at_all_locations ?? true,
            present_at_location_ids: obj.present_at_location_ids || [],
            organization_id: organizationId,
            created_at: new Date(obj.created_at),
            updated_at: new Date(obj.updated_at),
          },
        });

        for (const variation of obj.item_data.variations) {
          console.log(`  🔹 Syncing variation: ${variation.item_variation_data.name} (${variation.id})`);
          
          await prisma.catalogVariation.upsert({
            where: { square_variation_id: variation.id },
            update: {
              name: variation.item_variation_data.name || 'Regular',
              pricing_type: variation.item_variation_data.pricing_type || null,
              price_amount: variation.item_variation_data.price_money?.amount || null,
              price_currency: variation.item_variation_data.price_money?.currency || 'USD',
              service_duration: variation.item_variation_data.service_duration ? BigInt(variation.item_variation_data.service_duration) : null,
              available_for_booking: variation.item_variation_data.available_for_booking ?? true,
              team_member_ids: variation.item_variation_data.team_member_ids || [],
              is_deleted: variation.is_deleted || false,
              updated_at: new Date(variation.updated_at || obj.updated_at),
            },
            create: {
              square_variation_id: variation.id,
              item_id: catalogItem.id,
              name: variation.item_variation_data.name || 'Regular',
              pricing_type: variation.item_variation_data.pricing_type || null,
              price_amount: variation.item_variation_data.price_money?.amount || null,
              price_currency: variation.item_variation_data.price_money?.currency || 'USD',
              service_duration: variation.item_variation_data.service_duration ? BigInt(variation.item_variation_data.service_duration) : null,
              available_for_booking: variation.item_variation_data.available_for_booking ?? true,
              team_member_ids: variation.item_variation_data.team_member_ids || [],
              is_deleted: variation.is_deleted || false,
              organization_id: organizationId,
              created_at: new Date(variation.created_at || obj.created_at),
              updated_at: new Date(variation.updated_at || obj.updated_at),
            },
          });
        }
      }
    }
  }

  console.log('✅ Catalog sync completed!');
}

main()
  .catch((e) => {
    console.error('❌ Error syncing catalog:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


