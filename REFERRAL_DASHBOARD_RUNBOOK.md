# Referral Analytics Dashboard Runbook

_Last updated: 2025-11-26_

## 1. Prerequisites
- **Database**: Postgres/Neon already includes the analytics tables. Re-run `npx prisma migrate deploy` whenever the schema changes (especially before backfills).
- **Environment variables** (set in `.env.local` or Vercel):
  - `ANALYTICS_ADMIN_KEY`
  - `NEXTAUTH_SECRET`
  - `ENABLE_REFERRAL_ANALYTICS=true` (must be `true` for events to persist)
  - `REFERRAL_LOCATION_MAP` (comma-separated `friendly=SquareLocationId` pairs, e.g. `union=MLJSE2...A,pacific=MLJSE2...B`)
  - `DEFAULT_ANALYTICS_LOCATION_ID` (optional fallback friendly ID, e.g. `union`)
  - `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`
  - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `SMS_ENABLED=true`
  - `SQUARE_*` tokens already in use

## 2. Local verification
1. `npm install && npm run dev`.
2. Visit `http://localhost:3000/admin/referrals-dashboard`.
3. Enter `ANALYTICS_ADMIN_KEY` when prompted; dashboard should load KPI tiles + tables.
4. Trigger sample data (sandbox):
   - `node scripts/test-complete-referral-flow.js` to emit referral events.
   - Confirm `/api/admin/referrals/summary` reflects the new counts.
5. Run tests: `npm run test __tests__/admin-auth.test.js`.

### Gift card worker (new Vercel cron option)
- Set `GIFTCARD_WORKER_CRON_KEY` in Vercel (random secret string).  
- Create a Vercel Cron Job that hits `https://<project-domain>/api/cron/giftcard-jobs` every minute (or whatever cadence you need) with header `x-cron-key: <GIFTCARD_WORKER_CRON_KEY>`.  
- This replaces the long-running `scripts/giftcard-worker.js` PM2/Docker process and automatically inherits all Vercel env vars (including `ENABLE_REFERRAL_ANALYTICS`).  
- You can still run the legacy worker locally if needed, but ensure you set `ENABLE_REFERRAL_ANALYTICS=true` in that shell.

## 3. Production rollout
1. **Populate env vars** on Vercel (same list above). Never commit secrets.
2. Deploy latest build (`git push` → Vercel auto deploy).
3. Run migrations against production DB whenever analytics tables change:
   ```bash
   DATABASE_URL="postgresql://..." npx prisma migrate deploy
   ```
4. Open `/admin/referrals-dashboard`, log in with the admin key, and confirm data renders (counts will be zero until flag enabled).
5. Update env vars (Vercel → Environment Variables → redeploy):
   - `ENABLE_REFERRAL_ANALYTICS=true`
   - `REFERRAL_LOCATION_MAP` with the current Square location IDs
   - `DEFAULT_ANALYTICS_LOCATION_ID` (optional)
   This begins writing to `referral_events`, `notification_events`, etc., with per-location metadata.

## 4. Monitoring & troubleshooting
- **Logs**: Vercel request logs (see sample `referral_system-salon-..._logs.csv`) show heavy hitters like `/api/webhooks/square`. Watch for spikes in `/api/debug-logs`, `/404`, `/500`.
- **Dead-letter queue**: `analytics_dead_letter` captures failed inserts. Clear manually after rerunning the failed operation.
- **Notification failures**: `notification_events` rows with `status=failed/bounced` surface in the dashboard Issues tile; cross-check Twilio/SendGrid dashboards.
- **Process runs**: `/api/admin/referrals/process-runs` lists recent batches. A stuck `status=running` indicates background script issues.
- **Location coverage**: `SELECT DISTINCT metadata->>'locationId' FROM referral_events;` ensures both `union` and `pacific` appear. Update `REFERRAL_LOCATION_MAP` if Square changes IDs.

## 5. Rollback plan
1. Set `ENABLE_REFERRAL_ANALYTICS=false` to stop new writes.
2. If necessary, revert to previous deploy (`vercel rollback`).
3. Keep the schema—tables are additive and safe to leave in place.
4. Clear `zorina_admin_session` cookies if revoking access; rotate `ANALYTICS_ADMIN_KEY`.

## 6. Support commands
```bash
# Inspect referral events
npx prisma db pull
psql $DATABASE_URL -c "SELECT event_type, COUNT(*) FROM referral_events GROUP BY 1;"

# Dead-letter replay (manual)
psql $DATABASE_URL -c "SELECT id, event_type, created_at FROM analytics_dead_letter ORDER BY created_at DESC LIMIT 20;"

# Backfill 90 days of Square events (adjust begin/end as needed)
DOTENV_PATH=.env.production \
node scripts/replay-square-events.js \
  --begin 2025-08-26T00:00:00Z \
  --end 2025-11-26T23:59:59Z \
  --types customer.created,booking.created,payment.updated
```

Keep this runbook updated whenever rollout/test procedures change.

