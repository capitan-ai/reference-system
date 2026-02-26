const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const catalogData = [
  {
    "objects": [
      {
        "type": "ITEM",
        "id": "DY2FGRXACZQXTINQDX76BZYE",
        "item_data": {
          "name": "Russian E-file Manicure (cuticle work only)",
          "label_color": "911C12",
          "is_taxable": false,
          "variations": [
            {
              "type": "ITEM_VARIATION",
              "id": "VVA7G2UN7N2HUFMCW5LQOVHB",
              "item_variation_data": {
                "item_id": "DY2FGRXACZQXTINQDX76BZYE",
                "name": "Regular",
                "price_money": { "amount": 7000, "currency": "USD" },
                "service_duration": 2700000,
                "available_for_booking": true,
                "team_member_ids": ["TMQ7SBwevl5z1-JE", "TMXiw38Bbb7XQUWI", "TMY8nA5MR1nKKS3Q", "TMSHCoHWoyf5290X", "TMTcqc1bm3sBHmBV", "TMEvfivX1FlbVblT", "TMNW4SIF7tjp4oM_", "TM7_r-KmvY9xjnEU", "TMILsQUVwLkLzbVo", "TMyUMvTJIj2HrHSg", "TMWAtQTYmZpwwxii", "TMgsjtuk5cfKnstq", "TMVwAQUdLz6no-cB", "TMEWAZHdtaiRR_Zs", "TM-zXe9fXe4axYWn", "TMUG3s1qVnk-DCtG", "TMMHlgFBIFbMTRap", "TM9jDlRr_Hl4rdBB", "TMdagA6g0F03A7_w", "TMe-bT5XxKxmk0nw", "TMOscywuGXO2VURY", "TMkdrQsxG5tlf-c_"]
              }
            }
          ]
        }
      },
      {
        "type": "ITEM",
        "id": "A2CSBPWXVD73JGSOPTZINVJZ",
        "item_data": {
          "name": "Smart E-file Pedicure( no color)",
          "description": "Signature E-file pedicure done by the nail technicians in a dry or E-file technique.\n\nAn E-file pedicure service is a professional foot treatment using an electronic file for precise nail shaping, cuticle care, and callus removal.",
          "label_color": "E76132",
          "is_taxable": false,
          "variations": [
            {
              "type": "ITEM_VARIATION",
              "id": "SBE5XUATXRM76CBTT25HL2NZ",
              "item_variation_data": {
                "item_id": "A2CSBPWXVD73JGSOPTZINVJZ",
                "name": "Regular",
                "price_money": { "amount": 10000, "currency": "USD" },
                "service_duration": 3600000,
                "available_for_booking": true,
                "team_member_ids": ["TMSHCoHWoyf5290X", "TMEvfivX1FlbVblT", "TMY8nA5MR1nKKS3Q", "TMQ7SBwevl5z1-JE", "TMTcqc1bm3sBHmBV", "TMOscywuGXO2VURY", "TMILsQUVwLkLzbVo", "TMNW4SIF7tjp4oM_", "TM7_r-KmvY9xjnEU", "TMyUMvTJIj2HrHSg", "TMgsjtuk5cfKnstq", "TMVwAQUdLz6no-cB", "TMXiw38Bbb7XQUWI", "TM9jDlRr_Hl4rdBB", "TMEWAZHdtaiRR_Zs", "TMgretPQwvqtzmrC"]
              }
            }
          ]
        }
      },
      {
        "type": "ITEM",
        "id": "UVNR734QW76TSKA7LGTYHXFS",
        "item_data": {
          "name": "Smart E-file Pedicure with gel",
          "description": "Signature gel pedicure done by the nail technicians in a dry or E-file technique.\n\nAn E-file pedicure service is a professional foot treatment using an electronic file for precise nail shaping, cuticle care, and callus removal.",
          "is_taxable": false,
          "variations": [
            {
              "type": "ITEM_VARIATION",
              "id": "ZEAKNB35I37RMXNUBGWDZQIM",
              "item_variation_data": {
                "item_id": "UVNR734QW76TSKA7LGTYHXFS",
                "name": "Top Master Irina",
                "price_money": { "amount": 13000, "currency": "USD" },
                "service_duration": 5400000,
                "available_for_booking": true,
                "team_member_ids": ["TMSHCoHWoyf5290X", "TMEvfivX1FlbVblT", "TMY8nA5MR1nKKS3Q", "TMQ7SBwevl5z1-JE", "TMTcqc1bm3sBHmBV", "TMOscywuGXO2VURY", "TMILsQUVwLkLzbVo", "TMNW4SIF7tjp4oM_", "TM7_r-KmvY9xjnEU", "TMyUMvTJIj2HrHSg", "TMgsjtuk5cfKnstq", "TMVwAQUdLz6no-cB", "TMXiw38Bbb7XQUWI", "TM9jDlRr_Hl4rdBB", "TMEWAZHdtaiRR_Zs", "TMgretPQwvqtzmrC"]
              }
            }
          ]
        }
      },
      {
        "type": "ITEM",
        "id": "CXNUJDF7TR5TB7IY4OFWLNSR",
        "item_data": {
          "name": "Designs",
          "description": "PLEASE NOTE: All design services MUST be booked with a full manicure or pedicure...",
          "is_taxable": false,
          "variations": [
            {
              "type": "ITEM_VARIATION",
              "id": "6F6F3OAFJSOEN3X7HSXYIVQC",
              "item_variation_data": {
                "item_id": "CXNUJDF7TR5TB7IY4OFWLNSR",
                "name": "Simple Level Design(cat eye, minimal design on one )",
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
                "price_money": { "amount": 4000, "currency": "USD" },
                "service_duration": 1800000,
                "available_for_booking": true,
                "team_member_ids": ["TMNW4SIF7tjp4oM_", "TM7_r-KmvY9xjnEU", "TMILsQUVwLkLzbVo", "TMyUMvTJIj2HrHSg", "TMWAtQTYmZpwwxii", "TMVwAQUdLz6no-cB", "TMEvfivX1FlbVblT", "TMTcqc1bm3sBHmBV", "TMSHCoHWoyf5290X", "TMY8nA5MR1nKKS3Q"]
              }
            },
            {
              "type": "ITEM_VARIATION",
              "id": "XVYD33PWUOIDOBJYERR7FNXT",
              "item_variation_data": {
                "item_id": "CXNUJDF7TR5TB7IY4OFWLNSR",
                "name": "Extra Hard Design (includes 3+ colors, intricate art, or multiple detailed accents)",
                "price_money": { "amount": 6000, "currency": "USD" },
                "service_duration": 2700000,
                "available_for_booking": true,
                "team_member_ids": ["TMNW4SIF7tjp4oM_", "TM7_r-KmvY9xjnEU", "TMILsQUVwLkLzbVo", "TMyUMvTJIj2HrHSg", "TMWAtQTYmZpwwxii", "TMVwAQUdLz6no-cB", "TMEvfivX1FlbVblT", "TMTcqc1bm3sBHmBV", "TMSHCoHWoyf5290X"]
              }
            },
            {
              "type": "ITEM_VARIATION",
              "id": "Q5Q5KMENAUYAPOIIGF5KQ7UE",
              "item_variation_data": {
                "item_id": "CXNUJDF7TR5TB7IY4OFWLNSR",
                "name": "Extra (per nail charms, crystals, 3D details)",
                "price_money": { "amount": 1000, "currency": "USD" },
                "service_duration": 900000,
                "available_for_booking": true,
                "team_member_ids": ["TMILsQUVwLkLzbVo", "TMNW4SIF7tjp4oM_", "TMVwAQUdLz6no-cB", "TMEvfivX1FlbVblT", "TMSHCoHWoyf5290X"]
              }
            }
          ]
        }
      },
      {
        "type": "ITEM",
        "id": "XIQE2PTOTVSTB6LI7PWMTSQO",
        "item_data": {
          "name": "Nail Extension",
          "description": "Signature gel manicure with nail extensions...",
          "is_taxable": false,
          "variations": [
            {
              "type": "ITEM_VARIATION",
              "id": "4QI3JWGEYQANKCGC36J3MYNB",
              "item_variation_data": {
                "item_id": "XIQE2PTOTVSTB6LI7PWMTSQO",
                "name": "Short Length Extension",
                "price_money": { "amount": 19000, "currency": "USD" },
                "service_duration": 9000000,
                "available_for_booking": true,
                "team_member_ids": ["TMILsQUVwLkLzbVo", "TMWAtQTYmZpwwxii", "TMgsjtuk5cfKnstq", "TM7_r-KmvY9xjnEU", "TMVwAQUdLz6no-cB", "TMNW4SIF7tjp4oM_", "TMMHlgFBIFbMTRap", "TM9jDlRr_Hl4rdBB", "TMEvfivX1FlbVblT", "TMdagA6g0F03A7_w", "TMTcqc1bm3sBHmBV", "TMSHCoHWoyf5290X", "TMY8nA5MR1nKKS3Q"]
              }
            },
            {
              "type": "ITEM_VARIATION",
              "id": "FKVQUFGSG7BFA55SUPGKTCWF",
              "item_variation_data": {
                "item_id": "XIQE2PTOTVSTB6LI7PWMTSQO",
                "name": "Medium Length Extension",
                "price_money": { "amount": 21000, "currency": "USD" },
                "service_duration": 9000000,
                "available_for_booking": true,
                "team_member_ids": ["TMILsQUVwLkLzbVo", "TMWAtQTYmZpwwxii", "TMgsjtuk5cfKnstq", "TM7_r-KmvY9xjnEU", "TMVwAQUdLz6no-cB", "TMNW4SIF7tjp4oM_", "TMMHlgFBIFbMTRap", "TM9jDlRr_Hl4rdBB", "TMEvfivX1FlbVblT", "TMdagA6g0F03A7_w", "TMTcqc1bm3sBHmBV", "TMSHCoHWoyf5290X", "TMY8nA5MR1nKKS3Q"]
              }
            },
            {
              "type": "ITEM_VARIATION",
              "id": "QSVIF7ZTUIVIDPQWUMOPYETM",
              "item_variation_data": {
                "item_id": "XIQE2PTOTVSTB6LI7PWMTSQO",
                "name": "Long Length Extension",
                "price_money": { "amount": 23000, "currency": "USD" },
                "service_duration": 9000000,
                "available_for_booking": true,
                "team_member_ids": ["TMILsQUVwLkLzbVo", "TMWAtQTYmZpwwxii", "TMgsjtuk5cfKnstq", "TM7_r-KmvY9xjnEU", "TMVwAQUdLz6no-cB", "TMNW4SIF7tjp4oM_", "TMMHlgFBIFbMTRap", "TM9jDlRr_Hl4rdBB", "TMEvfivX1FlbVblT", "TMdagA6g0F03A7_w", "TMTcqc1bm3sBHmBV", "TMSHCoHWoyf5290X", "TMY8nA5MR1nKKS3Q"]
              }
            }
          ]
        }
      },
      {
        "type": "ITEM",
        "id": "KRZ4C2O4XKGYZYPXGAZ7TYRA",
        "item_data": {
          "name": "Russian Manicure with MASTER",
          "description": "Our Russian Manicure with MASTER offers three levels of expertise...",
          "is_taxable": false,
          "variations": [
            {
              "type": "ITEM_VARIATION",
              "id": "5KMEQ27BJSRQ4HEIXM3BEVCU",
              "item_variation_data": {
                "item_id": "KRZ4C2O4XKGYZYPXGAZ7TYRA",
                "name": "Regular",
                "price_money": { "amount": 12000, "currency": "USD" },
                "service_duration": 7200000,
                "available_for_booking": true,
                "team_member_ids": ["TMXiw38Bbb7XQUWI", "TMMHlgFBIFbMTRap", "TMEWAZHdtaiRR_Zs", "TMgretPQwvqtzmrC", "TMdagA6g0F03A7_w", "TMUG3s1qVnk-DCtG", "TMOscywuGXO2VURY", "TMTcqc1bm3sBHmBV", "TMSHCoHWoyf5290X", "TM-zXe9fXe4axYWn", "TMY8nA5MR1nKKS3Q"]
              }
            }
          ]
        }
      },
      {
        "type": "ITEM",
        "id": "HMN4MCFVBX4MDHYKHTYIDHM5",
        "item_data": {
          "name": "Russian Manicure with JUNIOR MASTER",
          "description": "The Junior Master delivers precise cuticle work...",
          "is_taxable": false,
          "variations": [
            {
              "type": "ITEM_VARIATION",
              "id": "CJI5WHOAKSFTASYPJ4MSYZLS",
              "item_variation_data": {
                "item_id": "HMN4MCFVBX4MDHYKHTYIDHM5",
                "name": "Regular",
                "price_money": { "amount": 10000, "currency": "USD" },
                "service_duration": 8400000,
                "available_for_booking": true,
                "team_member_ids": ["TMe-bT5XxKxmk0nw", "TMkdrQsxG5tlf-c_", "TMQ7SBwevl5z1-JE"]
              }
            }
          ]
        }
      },
      {
        "type": "ITEM",
        "id": "444AMU4XKRSI7ELI3OHTSFU2",
        "item_data": {
          "name": "Russian manicure with TOP MASTER",
          "description": "Our Russian Manicure with TOP MASTER offers the highest level of expertise...",
          "is_taxable": false,
          "variations": [
            {
              "type": "ITEM_VARIATION",
              "id": "BRSIGZFOWC6F4ERPKX3CODLU",
              "item_variation_data": {
                "item_id": "444AMU4XKRSI7ELI3OHTSFU2",
                "name": "TOP Angelina",
                "price_money": { "amount": 14000, "currency": "USD" },
                "service_duration": 5400000,
                "available_for_booking": true,
                "team_member_ids": ["TMNW4SIF7tjp4oM_"]
              }
            }
          ]
        }
      }
    ]
  }
];

const organizationId = 'd0e24178-2f94-4033-bc91-41f22df58278';

async function main() {
  console.log('🚀 Starting service_variation sync...');

  for (const batch of catalogData) {
    for (const obj of batch.objects) {
      if (obj.type === 'ITEM') {
        const itemData = obj.item_data;
        console.log(`📦 Processing item: ${itemData.name}`);

        for (const variation of itemData.variations) {
          const varData = variation.item_variation_data;
          const durationMs = varData.service_duration || 0;
          const durationMinutes = Math.round(durationMs / 60000);

          console.log(`  🔹 Syncing variation: ${varData.name} (${variation.id})`);

          await prisma.serviceVariation.upsert({
            where: { square_variation_id: variation.id },
            update: {
              name: varData.name,
              service_name: itemData.name,
              item_id: itemData.id || obj.id,
              duration_minutes: durationMinutes,
              service_duration: durationMs,
              team_member_ids: varData.team_member_ids || [],
              price_amount: varData.price_money?.amount || 0,
              price_currency: varData.price_money?.currency || 'USD',
              available_for_booking: varData.available_for_booking ?? true,
              description: itemData.description || null,
              label_color: itemData.label_color || null,
              is_taxable: itemData.is_taxable ?? false,
              updated_at: new Date(),
            },
            create: {
              uuid: crypto.randomUUID(),
              square_variation_id: variation.id,
              name: varData.name,
              service_name: itemData.name,
              item_id: itemData.id || obj.id,
              duration_minutes: durationMinutes,
              service_duration: durationMs,
              team_member_ids: varData.team_member_ids || [],
              price_amount: varData.price_money?.amount || 0,
              price_currency: varData.price_money?.currency || 'USD',
              available_for_booking: varData.available_for_booking ?? true,
              description: itemData.description || null,
              label_color: itemData.label_color || null,
              is_taxable: itemData.is_taxable ?? false,
              organization_id: organizationId,
              created_at: new Date(),
              updated_at: new Date(),
            },
          });
        }
      }
    }
  }

  console.log('✅ ServiceVariation sync completed!');
}

main()
  .catch((e) => {
    console.error('❌ Error syncing service variations:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
