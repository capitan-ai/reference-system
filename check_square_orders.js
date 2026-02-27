const { Client, Environment } = require('square');
require('dotenv').config();

const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN.replace(/\\n/g, '').trim(),
  environment: Environment.Production,
});

async function main() {
  const orderIds = [
    'bLgRLve2wZyQjamPdcR5PP3yT4EZY',
    'BA5HaYJT3ue4odYhpVTMY1deFpbZY',
    'bzIRQM4z8wsmI0wItkXZ9ZnrkROZY'
  ];

  for (const id of orderIds) {
    try {
      console.log(`Checking order: ${id}`);
      const response = await client.ordersApi.retrieveOrder(id);
      console.log(JSON.stringify(response.result, null, 2));
    } catch (error) {
      console.error(`Error for ${id}:`, error.message);
    }
  }
}

main();
