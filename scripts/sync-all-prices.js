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
          "variations": [{ "id": "VVA7G2UN7N2HUFMCW5LQOVHB", "item_variation_data": { "price_money": { "amount": 7000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "A2CSBPWXVD73JGSOPTZINVJZ",
        "item_data": {
          "name": "Smart E-file Pedicure( no color)",
          "variations": [{ "id": "SBE5XUATXRM76CBTT25HL2NZ", "item_variation_data": { "price_money": { "amount": 10000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "UVNR734QW76TSKA7LGTYHXFS",
        "item_data": {
          "name": "Smart E-file Pedicure with gel",
          "variations": [{ "id": "ZEAKNB35I37RMXNUBGWDZQIM", "item_variation_data": { "price_money": { "amount": 13000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "CXNUJDF7TR5TB7IY4OFWLNSR",
        "item_data": {
          "name": "Designs",
          "variations": [
            { "id": "6F6F3OAFJSOEN3X7HSXYIVQC", "item_variation_data": { "price_money": { "amount": 1000 } } },
            { "id": "HAJX45W3U2WUCCXM5MI24UEE", "item_variation_data": { "price_money": { "amount": 2000 } } },
            { "id": "LFLFEZO7L46URIM2OVZOJADI", "item_variation_data": { "price_money": { "amount": 4000 } } },
            { "id": "XVYD33PWUOIDOBJYERR7FNXT", "item_variation_data": { "price_money": { "amount": 6000 } } },
            { "id": "Q5Q5KMENAUYAPOIIGF5KQ7UE", "item_variation_data": { "price_money": { "amount": 1000 } } }
          ]
        }
      },
      {
        "type": "ITEM",
        "id": "XIQE2PTOTVSTB6LI7PWMTSQO",
        "item_data": {
          "name": "Nail Extension",
          "variations": [
            { "id": "4QI3JWGEYQANKCGC36J3MYNB", "item_variation_data": { "price_money": { "amount": 19000 } } },
            { "id": "FKVQUFGSG7BFA55SUPGKTCWF", "item_variation_data": { "price_money": { "amount": 21000 } } },
            { "id": "QSVIF7ZTUIVIDPQWUMOPYETM", "item_variation_data": { "price_money": { "amount": 23000 } } }
          ]
        }
      },
      {
        "type": "ITEM",
        "id": "EY5UH5FR2IOCWHQEEDVATVZA",
        "item_data": {
          "name": "Smart E-file pedicure with regular polish",
          "variations": [{ "id": "63PG6RLS2NHWRD5JRXEC74HN", "item_variation_data": { "price_money": { "amount": 12000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "BZ4B25GGMGNC4F4WEK6TSHXE",
        "item_data": {
          "name": "Extension for 1 nail",
          "variations": [{ "id": "KBHPHVKLJNAF223GMYIRUUH3", "item_variation_data": { "price_money": { "amount": 1500 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "QIHBUGSESE7TX4JX2T7NWTPX",
        "item_data": {
          "name": "Acrylic/dip powder nail removal",
          "variations": [{ "id": "WDGZ6T4JLCDPLM5GYCWCSUDY", "item_variation_data": { "price_money": { "amount": 4000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "I7JOKREPSVKNHKEKNLDY4VCB",
        "item_data": {
          "name": "FREE Fix (7 days after the appointment)",
          "variations": [{ "id": "SGSLS3INMK5YV637KUITCILL", "item_variation_data": { "price_money": { "amount": 0 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "AHBJ3HM7SYLTTLCXMTDYL7Q2",
        "item_data": {
          "name": "Manicure/Pedicure the same time",
          "variations": [{ "id": "E4VPBODMBZHPRXJLU32PXTAO", "item_variation_data": { "price_money": { "amount": 25500 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "DDHPHITMOUN57QXJBW2OADXE",
        "item_data": {
          "name": "Only gel removal",
          "variations": [{ "id": "JNRUKPGA2ZZUFCEB6YPNDC2Y", "item_variation_data": { "price_money": { "amount": 4000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "MD4W2ZSXKKRM2OLOJXJCOTPR",
        "item_data": {
          "name": "Nail Extension Refill",
          "variations": [{ "id": "HXLBKQC3DRE57DB7IK5RBYOB", "item_variation_data": { "price_money": { "amount": 15000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "KRZ4C2O4XKGYZYPXGAZ7TYRA",
        "item_data": {
          "name": "Russian Manicure with MASTER",
          "variations": [{ "id": "5KMEQ27BJSRQ4HEIXM3BEVCU", "item_variation_data": { "price_money": { "amount": 12000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "72H6T6IVZ4VXIWX2WHMANFQF",
        "item_data": {
          "name": "Same time",
          "variations": [{ "id": "DBRXEHQPCF7V4APTHDQTZW62", "item_variation_data": { "price_money": { "amount": 1500 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "HMN4MCFVBX4MDHYKHTYIDHM5",
        "item_data": {
          "name": "Russian Manicure with JUNIOR MASTER",
          "variations": [{ "id": "CJI5WHOAKSFTASYPJ4MSYZLS", "item_variation_data": { "price_money": { "amount": 10000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "F64VHQN2IMHAEYHEMXBJOCQ2",
        "item_data": {
          "name": "Change color after 7 days!",
          "variations": [{ "id": "Y555I3UQZHD4TQTISQDIWPZG", "item_variation_data": { "price_money": { "amount": 6000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "22ZVM7OZKQMBP6NYMSRR77PL",
        "item_data": {
          "name": "GIFT CARD $150",
          "variations": [{ "id": "EL7SWIBOQGDHIB43ZG56FM7V", "item_variation_data": { "price_money": { "amount": 15000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "N5PVQLYWVEBCBNEZTIZSN7KN",
        "item_data": {
          "name": "GIFT CARD $200",
          "variations": [{ "id": "TKYMW43ODOJ2ZPLAYODE5W44", "item_variation_data": { "price_money": { "amount": 20000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "HL3NJA2UG5NOVMWPJ4OIWE6F",
        "item_data": {
          "name": "GIFT CARD $300",
          "variations": [{ "id": "6RLAISQBT3WQOCWNIF7S4GRA", "item_variation_data": { "price_money": { "amount": 30000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "YRE6UNYWN5HLKDGZAYY5ONVL",
        "item_data": {
          "name": "GIFT CARD",
          "variations": [{ "id": "F4SYMX64YUY4RRNKNH3DM7BB", "item_variation_data": { "price_money": { "amount": 0 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "OKGZXTAWZR4FT6XVQALPITLV",
        "item_data": {
          "name": "Model",
          "variations": [{ "id": "P7ZIY6C3IGQPBSIGSQUFDCIF", "item_variation_data": { "price_money": { "amount": 4000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "PGQQSQP433ZFRXVCXFIEGAPR",
        "item_data": {
          "name": "1 DAY  LEVEL UP $790",
          "variations": [{ "id": "S4LCSSQWC4VOHIYQ6VTXHZYE", "item_variation_data": { "price_money": { "amount": 79000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "RG5O4HT5IZRY2RAUL6K6FGP7",
        "item_data": {
          "name": "2 DAYS RUSSIAN GEL MANICURE $1290",
          "variations": [{ "id": "JHEDUAS7PFWIQGVYMIRBNVE4", "item_variation_data": { "price_money": { "amount": 129000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "RJI4WPZ44E7X6ZHW3PHAFQHP",
        "item_data": {
          "name": "3 DAYS RUSSIAN MANICURE $1790",
          "variations": [{ "id": "OOZ32S5D66Q6Q7DSY57CQJHR", "item_variation_data": { "price_money": { "amount": 179000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "KZKZNYXHPSBFYKRB7L7O4AZ7",
        "item_data": {
          "name": "1 DAY EXTENSION $790",
          "variations": [{ "id": "K2AGN5STKD7T6S76FOC4PDQ3", "item_variation_data": { "price_money": { "amount": 79000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "Z67SII5MCGK765FLOJSXMET4",
        "item_data": {
          "name": "$1090 training with Julia",
          "variations": [{ "id": "TQDVA4FYESFNSNBP4KU5TRCZ", "item_variation_data": { "price_money": { "amount": 109000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "NG6ZDFABMJAXYGKV2LYP6TEG",
        "item_data": {
          "name": "$275 training with Julia",
          "variations": [{ "id": "RDHKJGHZXK5RR4JVCQCVLK2B", "item_variation_data": { "price_money": { "amount": 27500 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "T6EUNLDP5PEARCENF6BQNEBZ",
        "item_data": {
          "name": "$590 training with Julia",
          "variations": [{ "id": "HFCJGSOXM236AE4623YWTZLZ", "item_variation_data": { "price_money": { "amount": 59000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "SACODJE6Z3NZ6VZ6X6HO4A4Z",
        "item_data": {
          "name": "$ 1840 training with Julia",
          "variations": [{ "id": "SQAWC4CVAKYYYEOZE2CIGCWA", "item_variation_data": { "price_money": { "amount": 184000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "UEUPWPQ2CIE7K7X5OVJQB26X",
        "item_data": {
          "name": "$2090 training with Julia",
          "variations": [{ "id": "X77Y74YJ3YZBIJVVNXG3SVG2", "item_variation_data": { "price_money": { "amount": 209000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "APXOW52TNHOY7S5A455BCIFP",
        "item_data": {
          "name": "$200 deposit Julia",
          "variations": [{ "id": "AQUW4XV65PZ72TMJB6G3YATS", "item_variation_data": { "price_money": { "amount": 20000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "6Y6PKEFSTJL6QOYHVAEMFXUU",
        "item_data": {
          "name": "$790 training with Julia",
          "variations": [{ "id": "OG5MODY3VCLQHIAU3GV7OUQK", "item_variation_data": { "price_money": { "amount": 79000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "UB44QIZGPBOPYPSWZIEAM3XH",
        "item_data": {
          "name": "$500 course",
          "variations": [{ "id": "OLYG4MVDBPIM7YVU65QR52Z5", "item_variation_data": { "price_money": { "amount": 50000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "TCZXSMX3J7AZB2UN2UIBFLU5",
        "item_data": {
          "name": "DEPOSIT $220",
          "variations": [{ "id": "2H3YMHDD6CFSAEM2ISFSNLUJ", "item_variation_data": { "price_money": { "amount": 22000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "T3YWBCOUWAPKYRYXUWN4HRXD",
        "item_data": {
          "name": "deposit 10.04 $60",
          "variations": [{ "id": "SHVWZ4JFYNGNYE3AZV5G2ZSC", "item_variation_data": { "price_money": { "amount": 6000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "HRQUSNHCNJ326DA4SG2REKDG",
        "item_data": {
          "name": "deposit 50%",
          "variations": [{ "id": "JWDU2OHRXLDFI2CWIIHB25CD", "item_variation_data": { "price_money": { "amount": 5000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "X3N7HES4JEUDTK5GW5EUWRXX",
        "item_data": {
          "name": "Package 5 TOP MASTER",
          "variations": [{ "id": "3KKPBKIFNNT4T4ALHTGGFEYP", "item_variation_data": { "price_money": { "amount": 63000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "EBZ5BJUAHB7BEDH2BX66KHCS",
        "item_data": {
          "name": "Package 5 MASTER",
          "variations": [{ "id": "DQ4PLKEMLOB5O5ONVHSDGV6A", "item_variation_data": { "price_money": { "amount": 54000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "F2HMIU6UKA7UAXTZDRFXLS7I",
        "item_data": {
          "name": "Package 5 JUNIOR",
          "variations": [{ "id": "EW6PISTHZRQVXLTQ7DNU5M7I", "item_variation_data": { "price_money": { "amount": 45000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "WVOFRQJVQ3C4LS4PIPXQW32H",
        "item_data": {
          "name": "Package 3 TOP MASTER",
          "variations": [{ "id": "Q2ACQFIUUAUFX7SL2DRAMOUE", "item_variation_data": { "price_money": { "amount": 39200 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "T5AAUMFQQMX6RX3BALCQHTCR",
        "item_data": {
          "name": "Package 3 JUNIOR",
          "variations": [{ "id": "OJOX73LLNJPVU5XIM3VZYDQ6", "item_variation_data": { "price_money": { "amount": 28000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "P6GHNYXUAAEAEXQPRUZABD4J",
        "item_data": {
          "name": "Package 3 MASTER",
          "variations": [{ "id": "K2LK5242YLYSFNVUPC2MIFH3", "item_variation_data": { "price_money": { "amount": 33600 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "TASPWSCJ3A7WSXSUKUTUTCVI",
        "item_data": {
          "name": "Training with Julia",
          "variations": [{ "id": "ZBYQODDDPUWNJ5LBCWERZITW", "item_variation_data": { "price_money": { "amount": 49000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "DZUQG5DX7VDLSTYRBXNNVMV5",
        "item_data": {
          "name": "$600 training with Julia",
          "variations": [{ "id": "TSAP7SAADYC7WWXONQ4DSCEW", "item_variation_data": { "price_money": { "amount": 60000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "YOVLPNE5ARO6YQFNSKSRMWHS",
        "item_data": {
          "name": "$1290 2 days training",
          "variations": [{ "id": "HZULKX4H67NBYBMZ4FM35NP6", "item_variation_data": { "price_money": { "amount": 129000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "GPGZYWWP2EFOO6VR5FE667AT",
        "item_data": {
          "name": "$450 Gift Card",
          "variations": [{ "id": "ZFG4NNLCJA4W3PB7FGBZAQRU", "item_variation_data": { "price_money": { "amount": 45000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "5VPQIEYNKZTGNDTDUZY6CB4I",
        "item_data": {
          "name": "$260 Deposit",
          "variations": [{ "id": "K7FPZHL3NSZOYC55TYEG3UWY", "item_variation_data": { "price_money": { "amount": 26000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "65CVTOOQVBPYNXTS4UA2CTCN",
        "item_data": {
          "name": "MANICURE WORKSHOP",
          "variations": [{ "id": "ERLHDFC7WVW3VFL5KRSA7RQI", "item_variation_data": { "price_money": { "amount": 25000 } } }]
        }
      },
      {
        "type": "ITEM",
        "id": "T7BKLZGAAFIB4K3O6KKUX74Y",
        "item_data": {
          "name": "$840 Julia class",
          "variations": [{ "id": "Z7N5JR3XGYI7V46R6W644BAM", "item_variation_data": { "price_money": { "amount": 84000 } } }]
        }
      }
    ]
  }
];

async function main() {
  console.log('🚀 Syncing ALL remaining NULL prices...');
  for (const batch of catalogData) {
    for (const obj of batch.objects) {
      for (const variation of obj.item_data.variations) {
        const amount = variation.item_variation_data.price_money?.amount;
        if (amount !== undefined) {
          console.log(`  🔹 Updating: ${obj.item_data.name} (${variation.id}) -> ${amount}`);
          await prisma.serviceVariation.updateMany({
            where: { square_variation_id: variation.id },
            data: { price_amount: amount }
          });
        }
      }
    }
  }
  console.log('✅ Done!');
}

main().finally(() => prisma.$disconnect());


