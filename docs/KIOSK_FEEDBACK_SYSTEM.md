# Kiosk Feedback System Documentation

## System Overview

The Kiosk Feedback System is a post-service feedback collection platform designed for salon/service businesses. Customers complete feedback forms on tablets after service, with automatic linking to their booking and service technician data.

**Current Status**: Single-organization implementation  
**Future Goal**: Multi-organization SaaS platform

---

## Architecture

### High-Level Flow

```
Customer finishes service
        ↓
Staff hands tablet with feedback form
        ↓
[INTAKE PAGE] Staff enters their name + customer phone/email
        ↓
System looks up customer + today's bookings
        ↓
Auto-populated: customer name, technician(s), service date
        ↓
[FEEDBACK PAGE] Customer rates experience and provides feedback
        ↓
Submit → Feedback + booking link saved to database
        ↓
Success screen with referral code
```

### Component Architecture

```
/public/feedback/index.html (SPA)
├── Admin Intake Form (Page 1)
│   ├── Admin/staff selector pills (from /api/kiosk/admins)
│   ├── Customer lookup (phone or email → /api/kiosk/lookup)
│   └── Booking selection UI (multi-service handling)
└── Customer Feedback Form (Page 2)
    ├── Source (how heard about us)
    ├── Rating (1-5 emoji scale)
    ├── Improvement suggestions
    ├── Issues (quality, cleanliness, atmosphere, etc.)
    └── Referral program awareness

API Routes
├── /api/kiosk/admins (GET)
│   └── Returns: active front-desk staff (role IN [ADMIN, TOP_MASTER, MASTER])
├── /api/kiosk/lookup (GET)
│   ├── ?phone=6505551234 OR ?email=customer@example.com
│   └── Returns: customer + today's bookings with technician info
└── /api/feedback (POST)
    ├── Accepts: customer data, feedback, booking_id
    └── Stores: customer_feedback row with booking linkage

Database
├── squareExistingClient (read-only from Square sync)
├── teamMember (staff, roles)
├── bookings (appointments with status, technician)
├── booking_segments (multi-technician segments of one booking)
└── customer_feedback (feedback responses + booking link)
```

---

## Current Implementation

### Environment Variables (Single-Org)

```bash
ZORINA_ORG_ID=<uuid>  # Organization ID from organization table
NEXT_PUBLIC_FEEDBACK_URL=https://zorinastudio-referral.com/feedback
```

The organization ID is baked into environment variables and used to filter all queries.

### Database Schema

#### customer_feedback table

```sql
CREATE TABLE customer_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  email_address TEXT,
  square_customer_id UUID,
  master_name TEXT,
  master_id UUID REFERENCES team_members(id),
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  service_date DATE,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  source TEXT,
  improve_text TEXT,
  issues TEXT[], -- ARRAY of ['quality', 'cleanliness', 'atmosphere', 'comfort', 'nothing']
  awareness TEXT, -- 'yes' or 'no'
  raw_payload JSONB,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX customer_feedback_org_idx ON customer_feedback(organization_id);
CREATE INDEX customer_feedback_booking_idx ON customer_feedback(booking_id);
CREATE INDEX customer_feedback_customer_idx ON customer_feedback(square_customer_id);
```

### API Endpoints

#### 1. GET /api/kiosk/admins

Returns active front-desk staff for the admin selector pills.

**Query Parameters**: None (uses ZORINA_ORG_ID env var)

**Response**:
```json
{
  "admins": [
    {
      "id": "uuid",
      "given_name": "Yana",
      "family_name": "S."
    }
  ]
}
```

**Implementation**: `app/api/kiosk/admins/route.js`
- Filters: role IN ['ADMIN', 'TOP_MASTER', 'MASTER'], status = 'ACTIVE', is_system = false
- Ordered by: given_name ASC

#### 2. GET /api/kiosk/lookup

Searches for customer by phone or email and returns their bookings for today.

**Query Parameters**:
- `phone=6505551234` (10 digits, normalized)
- OR `email=customer@example.com` (must provide exactly one)

**Response on found**:
```json
{
  "found": true,
  "customer": {
    "square_customer_id": "uuid",
    "given_name": "Jane",
    "family_name": "D."
  },
  "bookings": [
    {
      "booking_id": "uuid",
      "start_at": "2026-05-01T14:00:00Z",
      "status": "ACCEPTED",
      "technician_id": "uuid",
      "technician_name": "Yana S.",
      "segments": [
        {
          "segment_id": "uuid",
          "segment_index": 0,
          "technician_id": "uuid",
          "technician_name": "Yana S.",
          "duration_minutes": 60
        }
      ]
    }
  ]
}
```

**Response on not found**:
```json
{
  "found": false
}
```

**Implementation**: `app/api/kiosk/lookup/route.js`

**Logic**:
1. Validate: phone (10 digits) OR email (valid format), not both
2. Fetch all squareExistingClient rows for org (not just filtered)
3. Normalize locally (phone: remove non-digits, last 10; email: lowercase, trim)
4. Match against normalized values
5. If customer found: raw SQL query for today's bookings with timezone-aware date
6. Collapse rows by booking_id, nest segments by segment_index

**Timezone Note**: All `start_at` timestamps use `AT TIME ZONE 'America/Los_Angeles'` for date comparison and display.

#### 3. POST /api/feedback

Stores customer feedback with booking linkage.

**Request Body**:
```json
{
  "customer": {
    "customerName": "Jane D.",
    "customerPhone": "(650) 555-1234",
    "masterName": "Yana S.",
    "serviceDate": "2026-05-01"
  },
  "booking_id": "uuid (optional)",
  "source": "google|instagram|influencer|friend|walkin|yelp|tiktok",
  "rating": 1-5,
  "improve": "Text or empty",
  "issues": ["quality", "cleanliness"],
  "awareness": "yes|no"
}
```

**Response**:
```json
{
  "success": true,
  "id": "feedback_uuid"
}
```

**Error Handling**: 
- Rate limiting: 30 submissions per IP per 5 minutes
- Validation: customerName, customerPhone (10 digits), masterName, serviceDate required
- Source, rating, issues enums validated against allowed values

**Implementation**: `app/api/feedback/route.js`

**Logic**:
1. Rate limit by IP (x-forwarded-for or x-real-ip header)
2. Validate required fields
3. Search for customer by phone (endsWith match)
4. Search for master by given_name or family_name (case-insensitive contains)
5. Create feedback row with:
   - organization_id from env
   - square_customer_id (if matched) or null
   - master_id (if matched) or null
   - booking_id (if provided)
   - All feedback fields normalized

---

## Frontend Implementation

### public/feedback/index.html

Single-page application with two views: admin intake and customer feedback.

**Session State**:
```javascript
const session = {
  customerName: '',
  customerPhone: '',
  masterId: null,
  masterName: '',
  adminId: null,
  bookingId: null,
  serviceDate: ''
};
```

### Admin Page (Page 1)

**Elements**:
1. **Admin Pills** - dynamically loaded from `/api/kiosk/admins`
   - Click to select staff member
   - Highlights matching pill when booking auto-resolves

2. **Customer Lookup** - phone or email input
   - Phone: formats as (XXX) XXX-XXXX, triggers at 10 digits
   - Email: triggers on valid email pattern
   - Debounce: 400ms
   - Mutual exclusion: typing phone clears email and vice versa

3. **Lookup Results** - conditional UI based on results:
   - **Not in system**: "Phone not in system — enter master name manually"
   - **No booking today**: "No booking today — enter master name manually"
   - **Single booking, single/same tech**: Auto-selects, shows booking card
   - **Single booking, multiple techs**: Segment selector ("Which service?")
   - **Multiple bookings**: Booking list selector ("Which booking?")

4. **Form Fields** (shown after lookup):
   - Customer name (auto-filled or manual)
   - Master name (auto-filled or manual)
   - Service date (auto-filled from booking.start_at)

### Customer Page (Page 2)

**Questions**:
1. How did you hear about us? (source)
   - Options: Google/Search, Instagram, Influencer post, Friend/Family Recommendation, Walk-in/Passing by, Yelp, TikTok
   
2. How would you rate your experience? (rating 1-5)
   - Emoji buttons: 😭 Poor, 😞 Fair, 😊 Okay, 😊 Great, 🥰 Excellent

3. Is there anything we could improve? (improve_text)
   - Textarea, optional

4. Did anything bother you today? (issues multi-select)
   - Checkboxes: Quality of work, Cleanliness, Atmosphere, Comfort, Nothing (mutually exclusive)

5. Do you already know about our referral program? (awareness)
   - Radio: Yes / No

6. Referral Program Callout
   - QR code (hardcoded SVG, decorative)
   - Text: "$10 off + friend gets $10 off"

### CSS Architecture

**Design System**:
- `--bg`: #F2EBDD (beige background)
- `--bg-card`: #ffffff (card backgrounds)
- `--ink`: #333 (primary text)
- `--ink-soft`: #666 (secondary text)
- `--muted`: #999 (tertiary text)
- `--line`: #ddd (borders, dividers)
- `--accent`: #5C6B50 (sage green)
- `--accent-deep`: #4A5A45 (darker sage)

**Notable Styling**:
- No border-radius (border-radius: 0)
- Logo: 360px max-width, centered, negative margin (-32px top) to overlap card
- Admin pill radius: 20px (rounded)
- Minimal padding/spacing, compact form
- Emoji rating buttons: 5-column grid, aspect-ratio 1:1

---

## Deployment

### Prerequisites

- Next.js 14+ application
- Supabase PostgreSQL database
- Prisma ORM configured
- Environment variables set

### Environment Setup

1. **Set org ID** (single-org, hardcoded):
```bash
export ZORINA_ORG_ID="<your-org-uuid>"
export DATABASE_URL="postgresql://..."
```

2. **Deploy to Vercel** (or similar):
```bash
vercel deploy
```

3. **Custom Domain** (example: zorinastudio-referral.com):
```
https://yourdomain.com/feedback → /public/feedback/index.html
```

### Database Migration

Apply the booking_id column migration (if not already done):

```sql
ALTER TABLE customer_feedback
  ADD COLUMN booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL;
CREATE INDEX customer_feedback_booking_idx ON customer_feedback(booking_id);
```

Then update Prisma schema:
```prisma
model CustomerFeedback {
  // ... existing fields
  booking_id  String?   @db.Uuid
  booking     Booking?  @relation(fields: [booking_id], references: [id], onDelete: SetNull)
}

model Booking {
  // ... existing fields
  customer_feedback CustomerFeedback[]
}
```

---

## Future: Multi-Organization Expansion

### Design Principles

The system is architected to support SaaS multi-org expansion with minimal core changes. Here's the roadmap:

### Phase 1: Org Discovery (From Single-Org)

**Instead of hardcoded ZORINA_ORG_ID, discover org from request context**:

```javascript
// Old (single-org):
const orgId = process.env.ZORINA_ORG_ID

// New (multi-org):
const orgId = await getOrgIdFromRequest(request)
// Strategies:
// 1. Subdomain: feedback.zorina.com → org lookup by domain
// 2. Query param: ?org=zorina-uuid (simple but manual)
// 3. Custom domain DNS: redirect zorinastudio-referral.com → detect from Host header
// 4. Tenant header: X-Tenant-ID (for programmatic clients)
```

### Phase 2: Dynamic URL Routing

**Current**: Single hardcoded path `/feedback`  
**Future**: Multi-tenant paths

Options:

**Option A: Subdomain** (recommended for SaaS)
```
https://feedback.zorina.io/form
https://feedback.acme.io/form
```
Router detects Host header → lookup org from domain table → inject into context

**Option B: Path-based**
```
https://feedback.io/zorina/form
https://feedback.io/acme/form
```
Extract `:orgSlug` from URL → lookup org → pass to handlers

**Option C: Custom domain** (white-label)
```
https://zorinastudio-referral.com/feedback
https://acme-feedback.com/feedback
```
Maintain domain → org mapping table, lookup on every request

### Phase 3: Organization Service Layer

Create an org service abstraction:

```javascript
// services/organization.ts
export async function getOrgIdFromRequest(request) {
  const host = request.headers.get('host')
  const domain = extractDomain(host)
  
  const org = await db.organization.findFirst({
    where: {
      OR: [
        { subdomain: domain },
        { custom_domain: domain }
      ]
    }
  })
  
  return org?.id || null
}

// Middleware: inject into context for all routes
export async function withOrgContext(request, handler) {
  const orgId = await getOrgIdFromRequest(request)
  if (!orgId) return Response.json({ error: 'Org not found' }, { status: 400 })
  
  return handler(request, { orgId })
}
```

**Update all route handlers** to accept context instead of env var:

```javascript
// Old:
const orgId = process.env.ZORINA_ORG_ID

// New:
export async function GET(request, { orgId }) {
  // Use orgId directly
}
```

### Phase 4: Data Isolation & Multi-Tenancy

**Database strategy**: Shared-schema multi-tenancy (not separate databases)

**Enforce org boundaries** on every query:

```javascript
// Insecure (old):
const clients = await db.squareExistingClient.findMany()

// Secure (new):
const clients = await db.squareExistingClient.findMany({
  where: { organization_id: orgId }
})
```

**Create helper methods** to prevent accidental data leaks:

```javascript
// lib/db-helpers.ts
export async function findClientSafe(phone10, orgId) {
  const all = await db.squareExistingClient.findMany({
    where: { organization_id: orgId }
  })
  return all.find(c => normalizePhone(c.phone_number) === phone10)
}

// Force org_id on all inserts:
export async function createFeedbackSafe(data, orgId) {
  return await db.customerFeedback.create({
    data: {
      ...data,
      organization_id: orgId  // Always set from context, never from input
    }
  })
}
```

### Phase 5: Authentication & Admin Dashboard

**Add org admin auth**:
- Each org has admin users (team_member.is_org_admin = true)
- Login to /admin to manage org settings, view feedback analytics
- Admin-only access to analytics endpoints

**Update frontend**:
- Add authentication check in intake form
- Optional: add org branding/customization (logo, colors, form questions)

### Phase 6: Org Settings & Customization

Allow orgs to customize form elements:

```prisma
model OrganizationSettings {
  id String @id @default(cuid())
  organization_id String @unique
  
  # Branding
  logo_url String?
  primary_color String?
  
  # Form customization
  source_options String[]  // ['google', 'instagram', ...]
  issue_options String[]
  custom_questions CustomQuestion[]
  
  # Referral settings
  referral_discount_amount Int?
  referral_enabled Boolean @default(true)
}
```

Update form generation:
```javascript
const settings = await getOrgSettings(orgId)
const formQuestions = [
  ...DEFAULT_QUESTIONS,
  ...settings.custom_questions
]
```

---

## Implementation Checklist for Multi-Org

When expanding to multi-org, follow this order:

- [ ] 1. Add organization lookup middleware
- [ ] 2. Update all API routes to accept orgId from context
- [ ] 3. Update all database queries to filter by org
- [ ] 4. Add org discovery strategy (subdomain, domain mapping, etc.)
- [ ] 5. Create org admin authentication
- [ ] 6. Build org settings/customization UI
- [ ] 7. Add org-specific branding to kiosk form
- [ ] 8. Implement analytics per org (separate dashboards)
- [ ] 9. Add org management endpoints (create, update, delete)
- [ ] 10. Test data isolation (ensure no cross-org leaks)

---

## Key Learnings & Gotchas

### Phone Number Normalization

**Issue**: Phones stored in database with formatting `(650) 387-9053`, but lookup searches for unformatted `6503879053`.

**Solution**: Normalize both database values and search input before comparison.
```javascript
const normalized = String(value || '').replace(/\D/g, '').slice(-10)
```

**Never** use `.endsWith()` on formatted numbers.

### Timezone Handling

**Issue**: `bookings.start_at` is stored as `timestamptz`, but "today" is ambiguous across timezones.

**Solution**: All "today's bookings" queries use:
```sql
AND (b.start_at AT TIME ZONE 'America/Los_Angeles')::date 
    = (NOW() AT TIME ZONE 'America/Los_Angeles')::date
```

If expanding to multiple regions, store org timezone in settings and use dynamically:
```sql
AND (b.start_at AT TIME ZONE settings.timezone)::date
    = (NOW() AT TIME ZONE settings.timezone)::date
```

### Multi-Technician Bookings

**Issue**: One booking can have multiple segments (different techs, different services).

**Solution**: 
- Store segments separately in booking_segments table
- Lookup query joins and nests them by booking_id
- Frontend shows segment selector if multiple different techs in one booking
- feedback.master_id links to one technician; if needed, could add master_ids ARRAY

### Rate Limiting

**Issue**: In-memory rate limit map grows unbounded and resets on server restart.

**Solution** (current): Acceptable for single-server, kiosk-only use.

**Solution** (future): Use Redis or database for distributed rate limiting:
```javascript
export async function checkRateLimit(ip, orgId) {
  const window = Date.now() - 5 * 60 * 1000
  const hits = await db.rateLimitLog.count({
    where: { ip, organization_id: orgId, timestamp: { gt: window } }
  })
  if (hits >= 30) return false
  await db.rateLimitLog.create({ data: { ip, organization_id: orgId } })
  return true
}
```

---

## Support for Future Developers

### Questions to Ask When Onboarding

1. **Single-org or multi-org?** Are we deploying for one organization or many?
2. **Domain strategy?** Subdomain, path-based, or custom domain?
3. **Customization scope?** Do orgs need to customize form questions, colors, etc.?
4. **Admin features?** Do orgs need to view their own analytics/feedback history?
5. **Integration?** How does feedback data flow downstream (to CRM, analytics, etc.)?

### Recommended Reading

- `KIOSK_FEEDBACK_SYSTEM.md` (this file) — architecture & current state
- `public/feedback/index.html` — frontend logic & form structure
- `app/api/kiosk/lookup/route.js` — booking lookup & multi-service logic
- `app/api/feedback/route.js` — feedback storage & validation
- Prisma schema: `prisma/schema.prisma` — data model

### Common Modifications

| Need | File | Change |
|------|------|--------|
| Add form question | `public/feedback/index.html` | Add `<div class="q">` section + JS handler |
| Change source options | `app/api/feedback/route.js` | Update `SOURCE_VALUES` set |
| Add issue options | `app/api/feedback/route.js` | Update `ISSUE_VALUES` set |
| Change timezone | `app/api/kiosk/lookup/route.js` | Update `AT TIME ZONE` clause |
| Modify admin filter | `app/api/kiosk/admins/route.js` | Update `role` and `status` filters |
| Add new lookup field | `app/api/kiosk/lookup/route.js` | Add new param, normalization, search logic |

---

## Monitoring & Analytics

### Key Metrics to Track

- **Submission rate**: Feedback submissions per day / bookings completed
- **Lookup success**: % of customer lookups that find a match
- **Completion rate**: Customers who start form / customers who submit
- **Avg rating**: Mean score across all ratings
- **Top issues**: Most commonly selected problem areas
- **Source attribution**: Which discovery channels drive most customers

### Useful Queries

**Feedback submitted today**:
```sql
SELECT COUNT(*), DATE(submitted_at) 
FROM customer_feedback 
WHERE organization_id = '<org-id>'
  AND submitted_at > NOW() - INTERVAL '24h'
GROUP BY DATE(submitted_at)
```

**Avg rating by master**:
```sql
SELECT master_id, master_name, AVG(rating)
FROM customer_feedback
WHERE organization_id = '<org-id>' AND rating IS NOT NULL
GROUP BY master_id, master_name
ORDER BY AVG(rating) DESC
```

**Bookings with feedback**:
```sql
SELECT b.id, b.status, cf.rating, cf.submitted_at
FROM bookings b
LEFT JOIN customer_feedback cf ON cf.booking_id = b.id
WHERE b.organization_id = '<org-id>'
  AND DATE(b.start_at AT TIME ZONE 'America/Los_Angeles') = CURRENT_DATE
ORDER BY b.start_at DESC
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-05-01 | Initial single-org implementation with phone/email lookup, multi-service handling, booking linkage |

---

## Questions & Contact

For questions on:
- **Architecture decisions**: See "Design Principles" section
- **Current implementation**: Check relevant route/component
- **Multi-org expansion**: See "Future: Multi-Organization Expansion"
- **Database schema**: See Prisma schema + migration files
