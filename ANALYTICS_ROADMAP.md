# Analytics Roadmap & Implementation Notes (Archived)

> Last updated: 2025-11-11  
> Analytics tracking is currently **disabled**. Keep this document in sync if the feature is revived.

---

## 1. Current State (⏸️ paused)

- **Status**
  - Analytics logging has been removed (Nov 11, 2025) to resolve database schema errors.
  - `AnalyticsEvent` model **no longer exists** in `prisma/schema.prisma`.
  - Migration folder `20251110_add_analytics_events/` removed; Neon instance does not have the analytics table.
  - `/api/admin/analytics` API route and `/admin/dashboard` UI have been deleted.

- **Runtime behaviour**
  - Webhook handlers run without any analytics side-effects.
  - No environment variables related to analytics are read at runtime.

---

## 2. How To Reintroduce Analytics (if needed)

1. **Recreate schema + migration**
   - Re-add the `AnalyticsEvent` model to `prisma/schema.prisma`.
   - Generate a new migration (e.g., `npx prisma migrate dev --name add_analytics_events`) and deploy it to Neon.

2. **Restore instrumentation**
   - Re-add the `trackAnalyticsEvent()` helper in `app/api/webhooks/square/referrals/route.js`.
   - Gate writes behind a feature flag (e.g., `ENABLE_ANALYTICS === 'true'`).
   - Ensure all webhook paths call the helper where metrics are needed.

3. **Rebuild the API**
   - Restore `app/api/admin/analytics/route.ts` or equivalent aggregation endpoint.
   - Validate authentication (`ANALYTICS_ADMIN_KEY`) before exposing data.

4. **Bring back the dashboard**
   - Recreate `/admin/dashboard` page (see git history prior to Nov 11, 2025 for reference).
   - Expose the admin key in the browser (e.g., `NEXT_PUBLIC_ANALYTICS_ADMIN_KEY`).

5. **Regression checklist**
   - Run `npx prisma generate`.
   - Confirm events appear via `npx prisma studio` or SQL query.
   - Verify webhook flow still succeeds even if analytics insert fails.

---

## 3. Parking Lot Ideas (🚧 future)

| Priority | Task | Notes |
| --- | --- | --- |
| High | Re-introduce analytics logging with robust schema | Only after schema + migration reviewed |
| Medium | Cached summaries / materialized views | Helps if analytics returns |
| Medium | Email open tracking | Requires analytics pipeline |
| Low | Alerts/notifications | Depends on analytics events being available |

---

## 4. Design Guidelines (for future reinstatement)

- **Keep it optional:** Analytics failures must never block referral or payment logic.
- **Sanitize payloads:** Use a safe stringify helper to strip unsupported values before insert.
- **Minimise coupling:** Instrumentation should live in a dedicated helper.
- **Protect data:** Require auth for any admin analytics endpoints.

---

## 5. Update Checklist For Future Changes

Whenever analytics functionality changes:

1. Document the change here (approximate date, summary).
2. Note new event types / schema updates / migrations.
3. Record any new environment variables or feature flags.
4. Update the milestone table if priorities shift.
5. Link to PR or commit hash for easy reference.

---

## 6. Appendix

- **Git history references**
  - Prior analytics implementation: see commits before Nov 11, 2025 on `main`.
- **Helpful commands**
  ```bash
  # regenerate client after schema change
  npx prisma generate

  # run pending migrations
  npx prisma migrate deploy

  # explore DB locally (needs DATABASE_URL)
  npx prisma studio
  ```

Keep this doc updated if analytics makes a comeback.***

