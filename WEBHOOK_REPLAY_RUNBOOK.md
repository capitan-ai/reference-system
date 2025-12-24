# Square Webhook Replay Runbook

Use this guide any time Square kept sending events while our `referrals` webhook endpoint was unavailable (e.g., a Vercel outage or maintenance window). The replay script re‑signs historical events and replays them through the live handler so `square_existing_clients`, `giftcard_runs`, and downstream logic stay consistent.

## Prerequisites

1. Production env vars available (pull them if needed):
   ```bash
   vercel env pull .env.local
   ```
2. `.env.local` (or your shell) must contain:
   - `SQUARE_ACCESS_TOKEN`
   - `SQUARE_WEBHOOK_SIGNATURE_KEY`
   - `SQUARE_WEBHOOK_NOTIFICATION_URL=https://www.zorinastudio-referral.com/api/webhooks/square/referrals`

## Replay command

Replace the time window with the actual outage range you want to reprocess:

```bash
cd /Users/umitrakhimbekova/Documents/Zorina/10$GiftCard_story

SQUARE_ACCESS_TOKEN=$(grep SQUARE_ACCESS_TOKEN .env.local | cut -d= -f2-) \
SQUARE_WEBHOOK_SIGNATURE_KEY=$(grep SQUARE_WEBHOOK_SIGNATURE_KEY .env | cut -d= -f2-) \
SQUARE_WEBHOOK_NOTIFICATION_URL=https://www.zorinastudio-referral.com/api/webhooks/square/referrals \
node scripts/replay-square-events.js \
  --begin 2025-11-24T18:00:00Z \
  --end   2025-11-24T21:00:00Z \
  --types customer.created
```

Notes:
- `--types` accepts a comma‑separated list (e.g., `customer.created,booking.created,payment.updated`) if you need more than customers.
- Omit `--begin`/`--end` to replay everything Square returns, but prefer tight windows to avoid duplicate noise.

## Verification steps

1. Watch the script output for `✅ Replay succeeded ...`.
2. Check `giftcard_runs` to confirm new rows were created for the replayed correlation IDs:
   ```bash
   node -e "require('dotenv').config({path:'.env.local'});const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{console.log(await p.$queryRaw\`SELECT COUNT(*) AS c, max(created_at) AS last FROM giftcard_runs\`);await p.$disconnect()})()"
   ```
3. Spot check one of the replayed customer IDs in `square_existing_clients` to ensure `personal_code`/`referral_url` populated.

## When to run

- Any time the webhook endpoint was down or returning 5xx/401 responses.
- After manually rotating the webhook secret or notification URL.
- After deploying schema migrations or worker changes that paused the job queue.

Replaying is idempotent for `customer.created` (handler uses `ON CONFLICT`), so running it twice for the same window is safe—the existing records will just be re-verified.


