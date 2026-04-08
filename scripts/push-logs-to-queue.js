const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting to push application_logs to webhook_jobs queue...');
  
  try {
    // 1. Get all logs in 'received' status that are webhooks
    const logs = await prisma.$queryRaw`
      SELECT 
        id, 
        log_id, 
        log_type, 
        payload, 
        organization_id, 
        log_created_at
      FROM application_logs 
      WHERE status::text = 'received' 
      AND log_type = 'webhook'
      ORDER BY created_at ASC
    `;

    console.log(`Found ${logs.length} logs to process.`);

    if (logs.length === 0) {
      console.log('No logs found in "received" status. Exiting.');
      return;
    }

    let pushedCount = 0;
    let skippedCount = 0;

    // 2. Push each log to webhook_jobs
    for (const log of logs) {
      try {
        const payload = log.payload;
        const eventType = payload.type || 'unknown';
        const eventId = log.log_id;
        let organizationId = log.organization_id;

        // CRITICAL: If organization_id is missing, try to resolve it from payload
        if (!organizationId) {
          const merchantId = payload.merchant_id || 
                            payload.data?.object?.merchant_id || 
                            payload.data?.object?.order?.merchant_id;
          
          if (merchantId) {
            const org = await prisma.$queryRaw`
              SELECT id FROM organizations WHERE square_merchant_id = ${merchantId} LIMIT 1
            `;
            if (org && org.length > 0) {
              organizationId = org[0].id;
            }
          }
        }

        // If still no organizationId, we can't push this to webhook_jobs as it's a required field
        if (!organizationId) {
          console.warn(`Skipping log ${log.id}: Could not resolve organization_id`);
          skippedCount++;
          continue;
        }

        // Check if job already exists to avoid duplicates
        const existingJob = await prisma.$queryRaw`
          SELECT id FROM webhook_jobs 
          WHERE event_id = ${eventId} 
          AND organization_id = ${organizationId}::uuid
          LIMIT 1
        `;

        if (existingJob && existingJob.length > 0) {
          skippedCount++;
          // Update log status to processing so we don't keep finding it
          await prisma.$executeRaw`
            UPDATE application_logs SET status = 'processing' WHERE id = ${log.id}
          `;
          continue;
        }

        // Insert into webhook_jobs
        await prisma.$executeRaw`
          INSERT INTO webhook_jobs (
            id,
            event_type,
            event_id,
            event_created_at,
            payload,
            organization_id,
            status,
            attempts,
            max_attempts,
            scheduled_at,
            created_at,
            updated_at
          ) VALUES (
            gen_random_uuid(),
            ${eventType},
            ${eventId},
            ${log.log_created_at},
            ${payload}::jsonb,
            ${organizationId}::uuid,
            'queued',
            0,
            5,
            NOW(),
            NOW(),
            NOW()
          )
        `;

        // Update log status
        await prisma.$executeRaw`
          UPDATE application_logs SET status = 'processing' WHERE id = ${log.id}
        `;

        pushedCount++;
        if (pushedCount % 100 === 0) {
          console.log(`Pushed ${pushedCount} jobs...`);
        }
      } catch (err) {
        console.error(`Error pushing log ${log.id}:`, err.message);
      }
    }

    console.log(`\n✅ Finished!`);
    console.log(`Pushed: ${pushedCount}`);
    console.log(`Skipped (already exists): ${skippedCount}`);

  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();

