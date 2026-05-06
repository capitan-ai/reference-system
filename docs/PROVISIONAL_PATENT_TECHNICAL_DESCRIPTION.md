# PROVISIONAL PATENT APPLICATION — TECHNICAL DESCRIPTION

## CONFIDENTIAL — ATTORNEY-CLIENT WORK PRODUCT DRAFT

**Filing Date Target:** On or before _______________

**Applicant(s):** _______________

**Correspondence Address:** _______________

---

## TITLE OF THE INVENTION

**Cloud-Based Software-as-a-Service (SaaS) Platform for Multi-Tenant Service Business Management with Snapshot-Based Commission Economics, Dual-Attribution Referral Analytics, Asynchronous Event Processing Pipeline, Precomputed Customer Intelligence Engine, and Serverless Digital Wallet Credential Generation**

---

## CROSS-REFERENCE TO RELATED APPLICATIONS

This is a provisional patent application filed under 35 U.S.C. §111(b). The applicant(s) reserve the right to file one or more non-provisional applications, continuation applications, continuation-in-part applications, or divisional applications claiming priority to this provisional application under 35 U.S.C. §119(e).

---

## FIELD OF THE INVENTION

The present invention relates generally to cloud-based Software-as-a-Service (SaaS) platforms for managing service-based businesses, wherein the system is delivered as a hosted, subscription-accessible service over the Internet, and more specifically to:

1. A method and system for immutable point-in-time economic snapshot capture with dual-stage ledger-based commission computation;
2. A method and system for dual-attribution referral program analytics with cascading self-referral abuse prevention;
3. A method and system for asynchronous webhook event processing with multi-strategy entity reconciliation;
4. A method and system for precomputed multi-metric customer intelligence with temporal segmentation;
5. A method and system for dynamic digital wallet credential generation with serverless certificate management;
6. A method and system for AI-powered autonomous business intelligence analysis with actionable recommendation generation for service business operations;
7. A method and system for multi-channel communication tracking and administrator performance analytics; and
8. A method and system for integrated point-of-sale, booking, and payment processing within a unified SaaS platform that replaces third-party POS dependencies.

The system is delivered as a SaaS product, meaning that: (a) the software is centrally hosted on cloud infrastructure and accessed by multiple independent business tenants via web browsers and API endpoints over the Internet; (b) tenants do not install, maintain, or operate the software on their own infrastructure; (c) the platform provider manages all deployment, scaling, updates, and security patches; (d) each tenant's data is logically isolated within a shared infrastructure using organization-level partitioning; and (e) the system provides continuous availability with automatic scaling to accommodate varying tenant loads.

---

## BACKGROUND OF THE INVENTION

### Technical Problem 1: Commission Disputes in Service Businesses

In service-based businesses such as salons, spas, and medical practices, technicians (service providers) are compensated via commission — a percentage of the service price. A persistent technical problem arises when service prices, commission rates, or discount structures change between the time a service is booked and the time payment is processed. Existing point-of-sale systems (including Square, Clover, Toast, and similar platforms) compute commissions based on current values at the time of settlement, not at the time of booking. This creates data integrity failures where:

- A technician books a $100 service at a 50% commission rate, but the service price is updated to $80 before payment, resulting in a $40 commission instead of $50.
- Discount rules change retroactively, altering the allocation of discount costs between the business and technician.
- Multiple processing stages (base commission, tip distribution, discount adjustment) execute at different times with potentially inconsistent data.

No existing system provides an immutable economic snapshot captured at booking time with independent dual-stage processing that guarantees deterministic commission computation regardless of subsequent data changes.

### Technical Problem 2: Referral Program Abuse Through Self-Referral

Referral programs that incentivize customer acquisition (e.g., "Refer a friend, both get $10") are vulnerable to self-referral abuse, where a single individual creates multiple identities to claim both the referrer and referred-friend rewards. Existing solutions rely on simple email or phone deduplication, which fails when customers have multiple accounts across different communication channels. The technical challenge is implementing cascading multi-attribute deduplication in a single database operation that:

- Prevents self-referral across phone, email, and account identity boundaries
- Deduplicates reward records when a single referral generates multiple payment events
- Aggregates analytics with timezone-aware date bucketing in a single atomic query
- Preserves detailed attribution data in structured JSON for audit purposes

### Technical Problem 3: Webhook Processing Reliability at Scale

Third-party service platforms (Square, Stripe, Shopify) deliver business events via webhooks that must be acknowledged within strict timeout windows (typically 3-10 seconds). Complex business logic — such as booking-to-payment reconciliation, technician assignment resolution, and multi-entity foreign key establishment — cannot reliably complete within these windows. Existing solutions either:

- Process synchronously and risk timeout failures, or
- Queue events but lack sophisticated entity reconciliation strategies

The specific technical challenge involves reconciling payments to bookings when the connecting data (booking ID on the payment record) is absent, requiring multi-strategy matching across service type, time window, customer identity, and location.

### Technical Problem 4: Real-Time Analytics on High-Cardinality Data

Service businesses with multiple locations, hundreds of technicians, and thousands of customers require real-time dashboard analytics across 65+ metrics. Computing these metrics on-demand from normalized transactional tables requires joining 5-8 tables with complex aggregation, resulting in query times of 10-30 seconds — unacceptable for interactive dashboards. Existing solutions use either:

- Simple caching (which serves stale data), or
- Stream processing infrastructure (Kafka, Flink) that is prohibitively complex for small-to-medium businesses

### Technical Problem 5: Absence of Actionable AI-Driven Business Intelligence for Service Businesses

Service business owners (salon owners, spa operators, medical practice managers) face an overwhelming volume of operational data — bookings, payments, commissions, customer behavior, team performance, referral metrics — spread across multiple systems and reports. Existing analytics dashboards present raw numbers and charts but do not interpret the data, identify patterns, detect blind spots, or generate actionable recommendations. Business owners must act as their own analysts, a role for which most lack training or time.

Existing AI-powered business intelligence tools (Tableau AI, Power BI Copilot, Looker) are: (a) designed for enterprise data analysts, not service business owners; (b) prohibitively expensive ($70-150/user/month); (c) unable to understand domain-specific service business concepts (commission fairness, technician utilization, client retention patterns, referral program effectiveness); and (d) unable to correlate across the full operational stack (bookings + payments + commissions + referrals + customer lifecycle + team performance).

No existing system provides an AI agent that autonomously analyzes all dimensions of a service business and delivers contextual, domain-specific recommendations in natural language — functioning as a virtual business analyst that identifies what the owner is missing.

### Technical Problem 6: Inability to Track Administrator-Client Communication Quality

Service businesses depend heavily on administrators (receptionists, front desk staff) to manage client relationships — confirming bookings, handling rebooking after cancellations, upselling services, and resolving complaints. The quality of these interactions directly impacts customer retention and revenue, yet no existing salon/spa management system tracks or analyzes administrator-client communications.

Business owners currently have no visibility into: (a) whether administrators respond to client messages promptly; (b) the quality and tone of administrator responses; (c) whether missed calls lead to lost bookings; (d) which administrators are most effective at converting inquiries to bookings; or (e) whether follow-up communications are happening after cancellations or no-shows.

### Technical Problem 7: Digital Wallet Credentials in Serverless Environments

Apple Wallet (.pkpass) generation requires cryptographic certificate handling (reading .p12 or PEM certificate files, signing pass bundles). Serverless deployment environments (Vercel, AWS Lambda, Cloudflare Workers) provide no persistent filesystem and impose strict execution time limits. Existing PassKit libraries assume persistent filesystem access for certificate storage and template management, making them incompatible with serverless architectures without significant adaptation.

---

## SUMMARY OF THE INVENTION

The present invention is a cloud-based Software-as-a-Service (SaaS) platform — centrally hosted on serverless infrastructure, accessed by multiple independent business tenants over the Internet, and requiring no per-tenant software installation or server provisioning. The platform comprises five interdependent novel subsystems that collectively solve the technical problems described above:

**Subsystem 1 — Snapshot-Based Commission Economics Engine** captures an immutable economic record at booking time, including the service price, technician commission rate, and technician category. A dual-stage processing pipeline independently computes base commission (Stage 1) and discount allocation (Stage 2) using processing flags that prevent duplicate execution while allowing independent completion. All computations are recorded in an append-only ledger with entry-type classification.

**Subsystem 2 — Dual-Attribution Referral Analytics Engine** implements a single-query analytics refresh using cascading Common Table Expressions (CTEs) that: (a) identify new customers who used referral codes while preventing self-referral through multi-attribute identity resolution; (b) deduplicate reward records using SQL `DISTINCT ON` clauses keyed on (organization, referrer, referred, date) tuples; (c) aggregate metrics across 9 independent dimensions; and (d) merge results using a full outer join key-union pattern with atomic UPSERT persistence.

**Subsystem 3 — Asynchronous Event Processing Pipeline with Multi-Strategy Entity Reconciliation** separates webhook receipt (synchronous, <1 second) from business logic execution (asynchronous, queued). The reconciliation engine implements a two-phase matching strategy: (a) API-based derivation using service-type overlap and time-window scoring; and (b) database-based fallback using customer identity, location proximity, and temporal distance minimization.

**Subsystem 4 — Precomputed Customer Intelligence Engine** maintains a denormalized analytics table with 65+ precomputed metrics per customer, refreshed periodically via a 7-stage CTE pipeline that: (a) deduplicates customers across phone and email identities using window functions; (b) classifies line items by service category using pattern matching; (c) computes temporal segmentation (NEW, ACTIVE, AT_RISK, LOST) and behavioral classification (SALON_CLIENT, STUDENT, RETAIL); and (d) persists via atomic UPSERT with COALESCE-based field preservation.

**Subsystem 5 — Serverless Digital Wallet Credential Generator** generates Apple Wallet passes in serverless environments by: (a) decoding base64-encoded certificates from environment variables to ephemeral temporary files at runtime; (b) supporting multiple certificate formats (PEM and P12) with automatic detection; (c) programmatically constructing pass manifests without filesystem-based templates; and (d) injecting web service URLs for real-time balance update push notifications with multi-stage verification.

---

## DETAILED DESCRIPTION OF THE INVENTION

### System Architecture Overview — SaaS Delivery Model

The system is implemented and delivered as a **cloud-based Software-as-a-Service (SaaS) platform** where multiple independent business tenants ("Organizations") access the system through a shared, centrally-hosted infrastructure over the Internet. Each tenant operates one or more physical service locations and accesses the platform via web browsers (admin dashboard) and programmatic API endpoints (integrations). Tenants do not install, configure, or maintain any software on their own servers or devices.

#### SaaS Infrastructure Architecture

The platform is deployed on **serverless cloud infrastructure** (Vercel) with the following SaaS-specific architectural characteristics:

| SaaS Component | Implementation |
|---|---|
| **Compute Layer** | Serverless functions (Vercel Edge/Node.js) — auto-scaling, zero-provisioning per tenant |
| **Database Layer** | Managed PostgreSQL (Neon/Supabase) with connection pooling — shared cluster, logical tenant isolation |
| **API Gateway** | Next.js API routes — RESTful endpoints serving multiple tenants from single deployment |
| **Background Processing** | Cron-triggered serverless workers — shared job queue with per-tenant event isolation |
| **CDN / Static Assets** | Vercel Edge Network — globally distributed, tenant-agnostic |
| **Certificate Storage** | Environment variables (base64-encoded) — no per-tenant filesystem, serverless-compatible |
| **External Integrations** | Per-tenant API credentials stored in database — each Organization connects to its own Square account |

#### SaaS Tenant Onboarding Flow

```
NEW TENANT ONBOARDING

1. CREATE Organization record with:
   - Unique organization_id (UUID)
   - Square merchant_id (connects to tenant's Square account)
   - Square API credentials (access_token, encrypted at rest)

2. CONFIGURE webhook endpoints:
   - Register system's shared webhook URL with tenant's Square account
   - System uses merchant_id/location_id to route events to correct tenant

3. SYNC initial data:
   - Backfill existing bookings, customers, payments from Square APIs
   - Populate service catalog (ServiceVariation records)
   - Import team members and commission settings

4. ACTIVATE tenant features:
   - Referral program (generate referral codes for existing customers)
   - Analytics (trigger initial customer analytics refresh)
   - Wallet passes (configure Apple Pass certificates if applicable)

All tenants share the same codebase, database cluster, and
serverless infrastructure. No per-tenant deployment or server
provisioning is required.
```

#### Multi-Tenant Data Isolation in SaaS Context

The SaaS platform serves multiple independent businesses from a single deployment. Data isolation is critical and is enforced at the database schema level — not the application layer — providing defense-in-depth against cross-tenant data leakage:

- Every data table includes an `organization_id` foreign key referencing the tenant
- Composite unique indexes on `(organization_id, entity_id)` tuples prevent cross-tenant data collisions
- All API queries include `organization_id` in WHERE clauses, derived from authenticated session context
- Webhook events are routed to the correct tenant using the multi-strategy organization resolution module (see Subsystem 3, Section 3.6)
- Background workers process jobs in tenant-isolated batches

This architecture enables the platform to onboard new service businesses (salons, spas, medical practices) without any infrastructure changes — each new Organization is a database row, not a new deployment.

The system integrates with a third-party point-of-sale platform (Square) for booking management, payment processing, and customer records, while implementing proprietary SaaS-layer business logic for commission economics, referral programs, customer analytics, and digital wallet management that extends beyond the capabilities of the underlying POS platform.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SaaS PLATFORM ARCHITECTURE                           │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    INTERNET / CLOUD LAYER                         │  │
│  │                                                                   │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────┐  │  │
│  │  │ Tenant A    │  │ Tenant B    │  │ Tenant N               │  │  │
│  │  │ (Salon 1)   │  │ (Salon 2)   │  │ (Any service business) │  │  │
│  │  │ Web Browser │  │ Web Browser │  │ Web Browser            │  │  │
│  │  └──────┬──────┘  └──────┬──────┘  └────────────┬─────────────┘  │  │
│  │         │                │                       │                │  │
│  │         └────────────────┼───────────────────────┘                │  │
│  │                          │ HTTPS (API + Dashboard)                │  │
│  │                          ▼                                        │  │
│  │  ┌───────────────────────────────────────────────────────┐       │  │
│  │  │            SHARED SaaS APPLICATION LAYER              │       │  │
│  │  │     (Single Deployment Serving All Tenants)           │       │  │
│  │  │                                                       │       │  │
│  │  │  ┌──────────────────────────────────────────────┐    │       │  │
│  │  │  │ API Gateway (Next.js Routes)                 │    │       │  │
│  │  │  │ • /api/admin/analytics/* (Dashboard APIs)    │    │       │  │
│  │  │  │ • /api/webhooks/square   (Event Ingestion)   │    │       │  │
│  │  │  │ • /api/wallet/*          (Pass Generation)   │    │       │  │
│  │  │  │ • /api/cron/*            (Scheduled Jobs)    │    │       │  │
│  │  │  └──────────────────────────────────────────────┘    │       │  │
│  │  └───────────────────────────────────────────────────────┘       │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    SERVERLESS COMPUTE LAYER                       │  │
│  │                    (Vercel Edge + Node.js)                        │  │
│  │                                                                   │  │
│  │  ┌──────────┐    ┌──────────────┐    ┌─────────────────────────┐ │  │
│  │  │ Square   │───▶│ Webhook      │───▶│ Event Queue             │ │  │
│  │  │ Platform │    │ Receiver     │    │ (WebhookJob table)      │ │  │
│  │  │(per-tenant    │ (Signature   │    └────────┬────────────────┘ │  │
│  │  │ API keys)│    │  Verify +    │             │                  │  │
│  │  └──────────┘    │  Tenant      │    ┌────────▼────────────────┐ │  │
│  │                  │  Routing)    │    │ Async Worker            │ │  │
│  │                  └──────┬───────┘    │ (Cron-triggered,        │ │  │
│  │                         │            │  tenant-isolated)       │ │  │
│  │                         │            └────────┬────────────────┘ │  │
│  │                         │                     │                  │  │
│  │            ┌────────────▼─────────────────────▼──────────────┐  │  │
│  │            │              TRANSACTIONAL LAYER                 │  │  │
│  │            │  ┌──────────┐ ┌────────┐ ┌──────────┐          │  │  │
│  │            │  │ Bookings │ │ Orders │ │ Payments │          │  │  │
│  │            │  └─────┬────┘ └───┬────┘ └────┬─────┘          │  │  │
│  │            │        │          │            │                 │  │  │
│  │            │        ▼          ▼            ▼                 │  │  │
│  │            │  ┌─────────────────────────────────────┐        │  │  │
│  │            │  │    RECONCILIATION ENGINE             │        │  │  │
│  │            │  │  (Multi-Strategy Entity Matching)    │        │  │  │
│  │            │  └─────────────────────────────────────┘        │  │  │
│  │            └─────────────────────┬────────────────────────────┘  │  │
│  │                                  │                               │  │
│  │         ┌────────────────────────┼─────────────────────────┐    │  │
│  │         │                        │                          │    │  │
│  │         ▼                        ▼                          ▼    │  │
│  │  ┌──────────────┐  ┌───────────────────────┐  ┌──────────────┐ │  │
│  │  │ SUBSYSTEM 1  │  │    SUBSYSTEM 4        │  │ SUBSYSTEM 2  │ │  │
│  │  │ Commission   │  │ Customer Intelligence │  │ Referral     │ │  │
│  │  │ Economics    │  │ Engine (65+ metrics)  │  │ Analytics    │ │  │
│  │  │ Engine       │  │                       │  │ Engine       │ │  │
│  │  │              │  │ ┌───────────────────┐ │  │              │ │  │
│  │  │ ┌──────────┐ │  │ │ Deduplication    │ │  │ ┌──────────┐ │ │  │
│  │  │ │ Booking  │ │  │ │ Classification  │ │  │ │ Self-    │ │ │  │
│  │  │ │ Snapshot │ │  │ │ Segmentation    │ │  │ │ Referral │ │ │  │
│  │  │ │ (Immut.) │ │  │ └───────────────────┘ │  │ │ Prevent. │ │ │  │
│  │  │ └────┬─────┘ │  └───────────────────────┘  │ └──────────┘ │ │  │
│  │  │      │       │                              │              │ │  │
│  │  │      ▼       │                              │              │ │  │
│  │  │ ┌──────────┐ │                              │ ┌──────────┐ │ │  │
│  │  │ │ Stage 1: │ │                              │ │ Reward   │ │ │  │
│  │  │ │ Base     │ │                              │ │ Dedup +  │ │ │  │
│  │  │ │ Earnings │ │                              │ │ JSON Agg │ │ │  │
│  │  │ └────┬─────┘ │                              │ └──────────┘ │ │  │
│  │  │      │       │                              │              │ │  │
│  │  │      ▼       │                              └──────────────┘ │  │
│  │  │ ┌──────────┐ │                                               │  │
│  │  │ │ Stage 2: │ │        ┌─────────────────────────────────┐   │  │
│  │  │ │ Discount │ │        │        SUBSYSTEM 5              │   │  │
│  │  │ │ Alloc.   │ │        │  Digital Wallet Generator       │   │  │
│  │  │ └────┬─────┘ │        │  (Serverless Certificate Mgmt)  │   │  │
│  │  │      │       │        └─────────────────────────────────┘   │  │
│  │  │      ▼       │                                               │  │
│  │  │ ┌──────────┐ │                                               │  │
│  │  │ │ Earnings │ │                                               │  │
│  │  │ │ Ledger   │ │                                               │  │
│  │  │ │ (Append) │ │                                               │  │
│  │  │ └──────────┘ │                                               │  │
│  │  └──────────────┘                                               │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    MANAGED DATABASE LAYER                         │  │
│  │            (Shared PostgreSQL Cluster — Neon/Supabase)            │  │
│  │                                                                   │  │
│  │  All tables partitioned by organization_id (tenant isolation)     │  │
│  │  Composite unique indexes: (organization_id, entity_id)           │  │
│  │  Connection pooling for serverless function compatibility         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### SUBSYSTEM 1: Snapshot-Based Commission Economics Engine

#### 1.1 Problem Addressed

This subsystem solves the technical problem of deterministic commission computation in an environment where service prices, commission rates, and discount structures change independently and asynchronously relative to booking, service delivery, and payment events.

#### 1.2 Booking Snapshot Data Structure

When a booking event is received, the system creates an immutable **BookingSnapshot** record that captures the economic state at the moment of booking:

| Field | Description | Immutability |
|-------|-------------|-------------|
| `price_snapshot_amount` | Service price in cents at booking time | Immutable after creation |
| `commission_rate_snapshot` | Technician's commission percentage at booking time | Immutable after creation |
| `technician_category` | Technician classification (TOP_MASTER, MASTER, JUNIOR, APPRENTICE) at booking time | Immutable after creation |
| `duration_minutes` | Service duration at booking time | Immutable after creation |
| `base_processed` | Stage 1 completion flag | Mutable (false → true, one-way) |
| `discount_processed` | Stage 2 completion flag | Mutable (false → true, one-way) |
| `original_booking_id` | Link to source booking for update/cancellation tracking | Immutable after creation |

The snapshot is created by querying the current `MasterSettings` record for the assigned technician to obtain their commission rate, and the `ServiceVariation` record to obtain the current price — both values are then frozen into the snapshot. Subsequent changes to MasterSettings or ServiceVariation do not affect existing snapshots.

#### 1.3 Stage 1: Base Commission and Tip Computation

Stage 1 executes when a booking's associated order reaches COMPLETED status and a payment with status COMPLETED exists. The processing algorithm:

```
STAGE 1 ALGORITHM — Base Commission Processing

INPUT: Set of BookingSnapshots where:
  - Associated Order.status = 'COMPLETED'
  - Associated Payment.status = 'COMPLETED'
  - Technician is assigned (from snapshot or booking)
  - Booking.status = 'ACCEPTED'
  - base_processed = FALSE

FOR EACH qualifying snapshot IN batch (default batch_size = 50):

  1. COMPUTE commission:
     commission_amount = price_snapshot_amount × (commission_rate_snapshot / 100)

     NOTE: Uses snapshot price, NOT current price or payment amount.
     This means if a $100 service is discounted to $80 at checkout,
     the technician still earns commission on $100.

  2. AGGREGATE tips:
     tips = SUM(tip_money_amount) FROM all Payments
            WHERE order_id = snapshot.order_id

     NOTE: A single order may have multiple payments (split tender),
     each with its own tip. All tips are summed.

  3. DETECT package usage:
     IF any OrderLineItem has:
       - total_money_amount = 0, OR
       - discount_name CONTAINS 'package' (case-insensitive)
     THEN:
       a. Create PackageUsage record linking snapshot to package
       b. Decrement units_remaining on customer's active package
       c. Flag line item as package-derived

  4. WRITE ledger entries (atomic transaction):
     INSERT MasterEarningsLedger(
       entry_type = 'SERVICE_COMMISSION',
       amount_cents = commission_amount,
       metadata = {
         price_snapshot: price_snapshot_amount,
         commission_rate: commission_rate_snapshot,
         calculation: "price × rate"
       }
     )

     IF tips > 0:
       INSERT MasterEarningsLedger(
         entry_type = 'TIP',
         amount_cents = tips,
         metadata = { source_payments: [payment_ids], original_values: [...] }
       )

  5. SET base_processed = TRUE (one-way flag)

CONCURRENCY: Multiple snapshots processed in parallel
             (configurable via EARNINGS_CONCURRENCY)
```

#### 1.4 Stage 2: Discount Allocation Processing

Stage 2 executes independently of Stage 1, but only after Stage 1 completes (`base_processed = TRUE`). This independence allows the discount allocation rules to be defined, modified, or corrected without requiring reprocessing of base commissions.

```
STAGE 2 ALGORITHM — Discount Allocation Processing

PREREQUISITE: base_processed = TRUE AND discount_processed = FALSE

1. LOAD allocation rules:
   rules = Map<discount_name_lowercase, {master_share_percent, ...}>
   FROM DiscountAllocationRule WHERE active = TRUE

   Example rules:
     "birthday discount" → master_share_percent: 50
     "loyalty 10% off"   → master_share_percent: 0
     "new client promo"   → master_share_percent: 25

2. FOR EACH qualifying snapshot IN batch (default batch_size = 400):

   a. FETCH discounted line items:
      items = OrderLineItem WHERE order_id = snapshot.order_id
              AND total_discount_money_amount > 0

   b. FOR EACH discounted item:
      - NORMALIZE discount_name to lowercase/trimmed
      - LOOKUP rule = rules[normalized_discount_name]
      - IF rule found:
          master_share = discount_amount × (master_share_percent / 100)

          INSERT MasterEarningsLedger(
            entry_type = 'DISCOUNT_ADJUSTMENT',
            amount_cents = -master_share,  // NEGATIVE (reduces earnings)
            metadata = {
              discount_name,
              discount_cents,
              master_share_percent,
              order_line_item_id
            }
          )

   c. SET discount_processed = TRUE
      (even if no discounts found, to prevent reprocessing)

CONCURRENCY: Configurable via DISCOUNT_CONCURRENCY (default: 10)
```

#### 1.5 Ledger Architecture

The `MasterEarningsLedger` is an append-only audit trail where each entry has:

- **entry_type**: SERVICE_COMMISSION | TIP | DISCOUNT_ADJUSTMENT
- **amount_cents**: Positive for earnings, negative for adjustments
- **technician_id**: The technician who performed the service
- **booking_snapshot_id**: Link to the immutable economic snapshot
- **metadata**: JSONB field containing the calculation basis and source data

A technician's total earnings for any period is computed as:
```
Total Earnings = SUM(amount_cents)
                 WHERE technician_id = X
                 AND created_at BETWEEN start AND end
```

This ledger design provides:
- **Auditability**: Every entry traces back to a snapshot and calculation basis
- **Determinism**: Replaying the same snapshots with the same rules produces identical results
- **Independence**: Base and discount stages can be reprocessed independently
- **Immutability**: No entry is ever modified or deleted; corrections are additive entries

---

### SUBSYSTEM 2: Dual-Attribution Referral Analytics Engine

#### 2.1 Problem Addressed

This subsystem solves the technical problem of computing accurate referral program metrics in the presence of: (a) self-referral abuse attempts; (b) duplicate reward events from multi-payment scenarios; and (c) the need for timezone-aware daily aggregation across multiple independent dimensions.

#### 2.2 Dual-Code Architecture

Each customer in the referral program receives two distinct codes:

| Code | Purpose | Example |
|------|---------|---------|
| `personal_code` | Identifies the customer themselves | "JANE2847" |
| `referral_code` | Used by the customer to invite friends | "JANE2847" |

When a new customer (Friend) uses a referral code at their first visit:
- The **Friend** receives a $10 gift card (`friend_signup_bonus`)
- The **Referrer** (owner of the code) receives a $10 gift card (`referrer_reward`)

#### 2.3 Self-Referral Prevention Algorithm

The system prevents self-referral through cascading identity checks implemented in SQL:

```
SELF-REFERRAL PREVENTION ALGORITHM

A referral is classified as SELF-REFERRAL (and excluded) if ANY of:

CHECK 1 — Direct Code Match:
  customer.referral_code_used == customer.personal_code
  (Customer used their own code)

CHECK 2 — Cross-Code Match:
  customer.referral_code_used == customer.referral_code
  (Customer's assigned referral code matches the code they used)

CHECK 3 — Customer ID Match:
  referrer.square_customer_id == referred.square_customer_id
  (Same customer ID on both sides of the referral)

CHECK 4 — Known Abuse Exclusion:
  Configurable exclusion list of (customer_id, code) pairs
  identified through operational monitoring

These checks cascade: if any single check identifies self-referral,
the record is excluded from analytics without requiring all checks
to pass. This defense-in-depth approach prevents abuse even if
one identity attribute is manipulated.
```

#### 2.4 Single-Query Analytics Refresh

The referral analytics are computed via a single SQL query using 10+ Common Table Expressions (CTEs) that execute atomically:

```
ANALYTICS REFRESH — CTE PIPELINE

CTE 1: date_range
  Establishes parameterized time window for filtering

CTE 2: new_customers_agg
  - JOIN customer_analytics WITH square_existing_clients
  - APPLY self-referral prevention checks (all 4)
  - GROUP BY (organization_id, date_pacific)
  - AGGREGATE into JSON array: [{customer_id, name, referral_code, first_visit}]

CTE 3: rewards_deduped
  - SELECT DISTINCT ON (organization_id, referrer_id, referred_id, date)
  - FROM referral_rewards WHERE type = 'referrer_reward'
  - Keeps FIRST occurrence per unique (referrer, referred, date) tuple
  - Prevents double-counting when one referral generates multiple payments

CTE 4: rewards_agg
  - AGGREGATE deduplicated rewards
  - SUM amounts WHERE status = 'PAID'
  - BUILD JSON: [{referrer_name, referred_name, amount, status}]

CTE 5: friend_signup_deduped
  - Same DISTINCT ON pattern for friend_signup_bonus rewards
  - Independent deduplication from referrer rewards

CTE 6: friend_signup_agg
  - AGGREGATE friend signup bonuses with JSON detail

CTE 7: emails_agg
  - COUNT notification_events BY template type
  - Templates: REFERRAL_INVITE, FRIEND_ACTIVATION, REFERRER_ACTIVATION

CTE 8: wallet_agg
  - COUNT wallet activations (gift_cards JOIN device_pass_registrations)
  - Filter by reward types: FRIEND_SIGNUP_BONUS, REFERRER_REWARD

CTE 9: redemptions_agg
  - COUNT gift card redemptions (type = 'REDEEM')
  - SUM absolute transaction amounts

CTE 10: all_keys + keys
  - UNION ALL possible (organization_id, date_pacific) combinations
  - From ALL preceding CTEs
  - Ensures days with data in any dimension are represented

CTE 11: details_merged
  - COALESCE all JSON arrays from dimension CTEs
  - Build composite details_json object

FINAL: INSERT INTO referral_analytics_daily
  ON CONFLICT (organization_id, date_pacific) DO UPDATE
  - Atomic UPSERT prevents duplicate rows
  - SET updated_at = NOW()
```

#### 2.5 Timezone-Aware Date Bucketing

All date conversions in the analytics pipeline use explicit timezone conversion:

```sql
DATE(timestamp AT TIME ZONE 'America/Los_Angeles')
```

This ensures that a booking at 11:30 PM Pacific on March 5th is attributed to March 5th (not March 6th UTC). The timezone is configurable per organization but defaults to the business's operating timezone.

---

### SUBSYSTEM 3: Asynchronous Event Processing Pipeline with Multi-Strategy Entity Reconciliation

#### 3.1 Problem Addressed

This subsystem solves two interdependent technical problems:
1. Acknowledging webhook events within strict timeout windows while executing complex business logic asynchronously
2. Reconciling payments to bookings when the linking data (booking ID) is absent from the payment record

#### 3.2 Event Receipt and Queuing

```
WEBHOOK RECEIPT ALGORITHM

1. RECEIVE HTTP POST from Square platform
2. VERIFY signature using HMAC-SHA256:
   - Extract x-square-hmacsha256-signature header
   - Compute HMAC-SHA256(raw_body, webhook_signature_key)
   - Compare using crypto.timingSafeEqual() (prevents timing attacks)
   - REJECT if signature invalid (HTTP 403)

3. PARSE event type from payload

4. ROUTE by event type:
   SYNCHRONOUS processing (< 1 second):
     - booking.created → processBookingCreated() + enqueue referral check
     - booking.updated → processBookingUpdated() + enqueue referral check
     - payment.created/updated → savePaymentToDatabase() + reconciliation
     - order.created/updated → processOrderWebhook()

   ASYNCHRONOUS processing (queued):
     - customer.created → enqueue to WebhookJob
     - gift_card.* → enqueue to WebhookJob
     - refund.* → enqueue to WebhookJob
     - team_member.created → enqueue to WebhookJob

5. RESPOND HTTP 200 within timeout window
```

#### 3.3 Job Queue Architecture

The `WebhookJob` table serves as a persistent, database-backed job queue:

| Field | Purpose |
|-------|---------|
| `event_type` | Routing key for handler dispatch |
| `event_id` | Square event ID (idempotency key) |
| `payload` | Complete webhook body (JSONB) |
| `status` | PENDING → PROCESSING → COMPLETED / FAILED |
| `worker_id` | Assigned worker identifier (prevents concurrent processing) |
| `locked_at` | Timestamp of lock acquisition |
| `attempts` | Retry counter |

#### 3.4 Worker Execution

```
JOB RUNNER ALGORITHM

1. LOCK next available job:
   UPDATE webhook_jobs
   SET status = 'PROCESSING',
       worker_id = generated_id,
       locked_at = NOW()
   WHERE status = 'PENDING'
   AND id = (SELECT id FROM webhook_jobs
             WHERE status = 'PENDING'
             ORDER BY created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED)
   RETURNING *

2. DISPATCH to handler based on event_type:
   handler_map = {
     'booking.created'            → processBookingCreated,
     'booking.updated'            → processBookingCreated,
     'customer.created'           → processCustomerCreated,
     'payment.updated'            → processPaymentUpdated,
     'order.updated'              → processOrderUpdated,
     'gift_card.activity.created' → processGiftCardActivity,
     'team_member.created'        → processTeamMemberCreated,
     ...
   }

3. EXECUTE handler(payload, eventId, eventCreatedAt)

4. ON SUCCESS:
   SET status = 'COMPLETED', completed_at = NOW()

5. ON FAILURE:
   SET status = 'FAILED', error = error_message
   (Available for retry by subsequent job runner invocations)
```

#### 3.5 Multi-Strategy Entity Reconciliation

The most technically novel aspect of this subsystem is the **booking-to-payment reconciliation engine**, which links payments to bookings when no direct booking ID exists on the payment record.

```
RECONCILIATION ENGINE — TWO-PHASE MATCHING

PHASE 1: API-Based Derivation (Primary Strategy)

  1. FETCH full order from Square Orders API using order_id from payment

  2. EXTRACT service_variation_ids from order line items:
     svc_ids = order.lineItems
       .map(item → item.catalogObjectId)
       .filter(id → id != null)

  3. QUERY Square Bookings API for customer's bookings:
     bookings = SearchBookings(
       customer_id = payment.customer_id,
       start_at_min = startOfDay(order.created_at),
       start_at_max = endOfDay(order.created_at)
     )

  4. SCORE each candidate booking:
     FOR EACH booking IN bookings:
       a. Extract booking_svc_ids from booking.appointmentSegments
       b. Compute overlap = INTERSECTION(svc_ids, booking_svc_ids)
       c. IF overlap IS EMPTY → skip (no service match)
       d. VALIDATE time constraint:
          booking.startAt <= order.createdAt  (service before payment)
          order.createdAt - booking.endAt <= 4 hours  (payment delay tolerance)
       e. Compute time_diff = |order.createdAt - booking.startAt|
       f. Add to candidates with score = 1/time_diff  (closer = better)

  5. SELECT best_match = candidate with minimum time_diff

  6. ASSIGN confidence:
     - HIGH if exactly 1 candidate
     - MEDIUM if multiple candidates (best selected by time proximity)
     - LOW if no candidates found

PHASE 2: Database Fallback (When Phase 1 fails)

  1. QUERY local bookings table:
     SELECT * FROM bookings
     WHERE customer_id = payment.customer_id
     AND (location_id = payment.location_id
          OR square_location_id = payment.square_location_id)
     AND start_at BETWEEN (order.created_at - 7 days)
                      AND (order.created_at + 1 day)
     ORDER BY ABS(EXTRACT(EPOCH FROM (start_at - order.created_at)))
     LIMIT 1

  2. SELECT closest temporal match

PHASE 3: Entity Update Chain (After match found)

  1. UPDATE orders SET booking_id, technician_id, administrator_id
  2. UPDATE order_line_items SET technician_id per service variation:
     a. Query booking_segments for service_variation → technician mapping
     b. Use DISTINCT ON service_variation_id (prioritize by duration)
     c. Fallback to primary booking technician for unmatched items
  3. UPDATE payments SET booking_id
```

#### 3.6 Organization ID Resolution (Multi-Strategy)

The system resolves the tenant (organization) for each webhook event using a cascading strategy:

```
ORGANIZATION RESOLUTION ALGORITHM

STRATEGY 1 (Fast Path): Location Lookup
  - Query locations table by square_location_id
  - If found with organization_id → return immediately
  - If found with merchant_id only → resolve via merchant → update location

STRATEGY 2 (API Fallback): Square API
  - Call Square Locations API: retrieveLocation(location_id)
  - Extract merchant_id from response
  - Resolve organization_id from merchant_id
  - Create or update location record (UPSERT)

STRATEGY 3 (Nested Object Extraction):
  - For events without direct location_id
  - Extract from nested objects: order.locationId, booking.locationId
  - Apply Strategy 1 or 2 with extracted value
```

---

### SUBSYSTEM 4: Precomputed Customer Intelligence Engine

#### 4.1 Problem Addressed

This subsystem solves the technical problem of computing 65+ customer metrics in real-time for interactive dashboards without requiring expensive multi-table joins at query time.

#### 4.2 Customer Deduplication Pipeline

Customers may have multiple records across different communication channels. The deduplication uses window functions to establish canonical identity:

```
DEDUPLICATION ALGORITHM — 3-Stage Identity Resolution

STAGE 1: Phone Normalization
  - Strip non-numeric characters from phone numbers
  - Compute canonical_id = FIRST_VALUE(customer_id)
    OVER (PARTITION BY normalized_phone, organization_id
          ORDER BY created_at ASC)
  - Oldest record per phone number becomes canonical

STAGE 2: Email Normalization
  - Compute canonical_id = FIRST_VALUE(customer_id)
    OVER (PARTITION BY email_address, organization_id
          ORDER BY created_at ASC)
  - Oldest record per email becomes canonical

STAGE 3: Identity Merge
  - FOR EACH customer:
    canonical_id = COALESCE(
      phone_canonical_id,   // Phone match takes priority
      email_canonical_id,   // Email match is fallback
      self_id               // No match → use own ID
    )
  - All metrics are aggregated under the canonical_id
```

#### 4.3 Line Item Classification

Order line items are classified into service categories using pattern matching:

```
CLASSIFICATION ALGORITHM

FOR EACH OrderLineItem:
  IF item_name MATCHES /training|class|course|workshop/i
    → CLASSIFY as 'training_item'
  ELSE IF item_name MATCHES /retail|product|shampoo|conditioner/i
    → CLASSIFY as 'retail_item'
  ELSE
    → CLASSIFY as 'salon_item' (default)
```

#### 4.4 Temporal Segmentation

Customers are segmented based on visit recency:

```
SEGMENTATION ALGORITHM

first_visit = LEAST(first_booking_at, first_order_at)
last_visit  = GREATEST(last_booking_at, last_order_at)

customer_segment =
  CASE
    WHEN first_visit IS NULL           → 'NEVER_BOOKED'
    WHEN first_visit >= NOW() - 30d    → 'NEW'
    WHEN last_visit >= NOW() - 30d     → 'ACTIVE'
    WHEN last_visit >= NOW() - 90d     → 'AT_RISK'
    WHEN last_visit < NOW() - 90d      → 'LOST'
  END

customer_type =
  CASE
    WHEN has_bookings OR has_salon_items → 'SALON_CLIENT'
    WHEN has_training_items_only         → 'STUDENT'
    WHEN has_retail_items OR (has_revenue AND NOT has_salon AND NOT has_training)
                                         → 'RETAIL'
    WHEN has_cancellations_only          → 'CANCELLED_ONLY'
    ELSE                                 → 'POTENTIAL'
  END
```

#### 4.5 Metrics Computed (65+ fields)

The `CustomerAnalytics` table stores precomputed metrics in these categories:

**Visit Metrics:**
- `first_visit_at`, `last_visit_at`
- `booking_visits`, `service_order_visits`, `training_visits`, `retail_visits`
- `total_visits` (computed sum)

**Booking Status Metrics:**
- `accepted_bookings`, `completed_bookings`
- `no_show_count`, `cancelled_by_customer`, `cancelled_by_seller`

**Revenue Metrics:**
- `total_revenue_cents`, `total_tips_cents`
- `payment_count`, `average_ticket_cents`
- `last_payment_at`

**Referral Metrics:**
- `is_referrer`, `referral_code`, `personal_code`
- `referral_rewards_earned`, `referral_rewards_amount`

**Classification:**
- `customer_type` (SALON_CLIENT, STUDENT, RETAIL, CANCELLED_ONLY, POTENTIAL)
- `customer_segment` (NEW, ACTIVE, AT_RISK, LOST, NEVER_BOOKED)

**Audit:**
- `booking_notes` (JSONB — searchable via GIN index)
- `snapshot_calculated_at`, `updated_at`

#### 4.6 Refresh Mechanism

The analytics table is refreshed via a cron job (configurable interval, default hourly) that executes the full 7-stage CTE pipeline as a single atomic UPSERT:

```sql
INSERT INTO customer_analytics (organization_id, square_customer_id, ...)
SELECT ... FROM final_data
ON CONFLICT (organization_id, square_customer_id)
DO UPDATE SET
  -- Preserve existing names if new data is null
  given_name = COALESCE(EXCLUDED.given_name, customer_analytics.given_name),
  -- Update all metric fields
  total_visits = EXCLUDED.total_visits,
  customer_segment = EXCLUDED.customer_segment,
  ...
  updated_at = NOW()
```

#### 4.7 Booking Fact Classification System

A companion subsystem classifies bookings as NEW_CLIENT or REBOOKING using a correction-window approach:

```
BOOKING CLASSIFICATION ALGORITHM

1. For each admin-created or online booking:
   a. Resolve administrator (creator) with fallback logic:
      - Direct creator_type field
      - Raw JSON extraction
      - Team member matching

   b. Check for prior paid bookings:
      EXISTS(SELECT 1 FROM bookings b2
             JOIN payments p ON p.booking_id = b2.id
             WHERE b2.customer_id = current.customer_id
             AND (b2.start_at, b2.created_at, b2.id) <
                 (current.start_at, current.created_at, current.id)
             AND p.status = 'COMPLETED')

   c. Classify:
      IF prior_paid_exists → 'REBOOKING' (reason: 'HAS_PRIOR_PAID')
      ELSE → 'NEW_CLIENT' (reason: 'NO_PRIOR_PAID')

2. CORRECTION WINDOW (35 days):
   - Immutable snapshot fields (booking_id, administrator, dates)
     are set ONLY on INSERT
   - Mutable classification fields CAN be updated within 35 days
   - After 35 days, classification is frozen permanently

   This prevents retroactive reclassification while allowing
   corrections during a reasonable window (e.g., if a payment
   arrives late for a prior booking, changing the classification)
```

---

### SUBSYSTEM 5: Serverless Digital Wallet Credential Generator

#### 5.1 Problem Addressed

This subsystem solves the technical problem of generating Apple Wallet (.pkpass) files in serverless deployment environments that lack persistent filesystem access and impose strict execution time limits.

#### 5.2 Certificate Management in Serverless Environments

```
CERTIFICATE RESOLUTION ALGORITHM

1. CHECK environment for certificate format:
   IF APPLE_PASS_CERT_PEM AND APPLE_PASS_KEY_PEM exist:
     → PEM format (modern)
   ELSE IF APPLE_PASS_P12_BASE64 exists:
     → P12 format (legacy)
   ELSE:
     → ERROR: No certificates configured

2. FOR PEM format:
   a. DECODE base64 certificate:
      cert_buffer = Buffer.from(APPLE_PASS_CERT_PEM, 'base64')
   b. DECODE base64 private key:
      key_buffer = Buffer.from(APPLE_PASS_KEY_PEM, 'base64')
   c. VALIDATE PEM format:
      - Check for '-----BEGIN CERTIFICATE-----' marker
      - Check for '-----BEGIN PRIVATE KEY-----' marker
   d. NORMALIZE line endings: Replace CRLF/CR with LF
   e. WRITE to ephemeral temp files:
      cert_path = '/tmp/pass-cert-{timestamp}.pem'
      key_path = '/tmp/pass-key-{timestamp}.pem'
   f. These files exist only for the duration of the function invocation
      and are automatically cleaned up by the serverless runtime

3. FOR P12 format:
   a. DECODE base64 P12 bundle:
      p12_buffer = Buffer.from(APPLE_PASS_P12_BASE64, 'base64')
   b. WRITE to ephemeral temp file:
      p12_path = '/tmp/pass-cert-{timestamp}.p12'
   c. Extract passphrase from APPLE_PASS_P12_PASSWORD
```

#### 5.3 Pass Generation Without Filesystem Templates

Traditional PassKit libraries require a template directory on the persistent filesystem containing `pass.json`, icon files, and other assets. This subsystem eliminates that requirement:

```
TEMPLATELESS PASS GENERATION ALGORITHM

1. CONSTRUCT pass.json programmatically:
   pass = {
     formatVersion: 1,
     passTypeIdentifier: configured_identifier,
     teamIdentifier: configured_team_id,
     organizationName: "Zorina Nail Studio",
     serialNumber: computed_serial,
     description: "Gift Card",

     storeCard: {
       primaryFields: [{
         key: "balance",
         label: "BALANCE",
         value: formatCurrency(balance_cents)  // e.g., "$10.00"
       }],
       secondaryFields: [
         { key: "gan", label: "GIFT CARD", value: gift_card_number },
         { key: "name", label: "CUSTOMER", value: customer_name },
         { key: "location", label: "VALID AT", value: location_name }
       ]
     },

     barcode: {
       message: gift_card_number,
       format: "PKBarcodeFormatQR",
       messageEncoding: "iso-8859-1"
     },

     webServiceURL: production_url,
     authenticationToken: hmac_sha256(serial_number, secret)
   }

2. ATTACH image assets dynamically:
   - Search multiple directories for icon.png, logo.png
   - Required assets: icon.png, icon@2x.png (throw if missing)
   - Optional assets: logo.png, logo@2x.png (warn if missing)
   - Add each asset via addBuffer() instead of filesystem reference

3. INJECT web service URL with multi-stage verification:
   ATTEMPT 1: Direct PKPass API methods
     pass.setWebServiceURL(url)
     pass.setAuthenticationToken(token)

   ATTEMPT 2: Internal object modification
     pass._pass.webServiceURL = url  // or pass.pass.webServiceURL

   ATTEMPT 3: Buffer re-injection
     Serialize pass.json, inject URL, re-add via addBuffer('pass.json')

   VERIFY: Search final .pkpass binary for webServiceURL string
           Log verification result at each stage

4. GENERATE authentication token:
   token = HMAC-SHA256(
     key: webhook_signature_key || default_secret,
     data: serial_number
   )

   This token is verified by the Apple Wallet web service when
   requesting pass updates, ensuring only legitimate requests
   receive updated balance information.
```

#### 5.4 Gift Card Context Resolution

```
CONTEXT RESOLUTION ALGORITHM

1. NORMALIZE gift card account number (GAN):
   - Strip whitespace and formatting
   - Handle multiple lookup formats (exact match vs. contains)
   - Prioritize exact matches using SQL CASE ordering

2. RESOLVE customer identity:
   - Query by organization_id + GAN (exact match priority)
   - Fallback to gift_card_id lookup
   - Extract customer name: full_name → first_name → "Guest"

3. RESOLVE balance:
   - IF gift_card_id found → Query Square Gift Cards API for live balance
   - Use normalizeCents() for safe numeric conversion:
     - Handle BigInt, String, Decimal (Prisma), Number types
     - Return null with optional fallback for undefined/null
   - DEFAULT balance: $10.00 (1000 cents) if API unavailable

4. CONSTRUCT web service URL:
   - Hardcode production domain (ignore preview/staging deployments)
   - Path: /api/wallet (Apple appends /v1/devices/... automatically)
```

#### 5.5 Push Notification Integration

The system registers with Apple's Push Notification service to deliver real-time balance updates when a gift card is used:

1. When a customer adds the pass to Apple Wallet, Apple sends a registration request to the web service URL
2. The system stores the device token and push token
3. When a gift card transaction occurs (via webhook), the system:
   a. Looks up registered devices for that gift card's serial number
   b. Sends a push notification via APNs (Apple Push Notification service)
   c. The device requests an updated pass with the new balance
   d. The system generates a fresh .pkpass with the current balance

---

### SUBSYSTEM 6: AI-Powered Autonomous Business Intelligence Agent

#### 6.1 Problem Addressed

This subsystem solves the technical problem of transforming raw multi-dimensional operational data into actionable, domain-specific business recommendations without requiring the business owner to have data analysis expertise. Unlike generic BI tools that present charts and require interpretation, this system functions as an autonomous AI business analyst.

#### 6.2 Architecture Overview

The AI Business Intelligence Agent operates as an autonomous analytical layer that consumes data from all other subsystems:

```
DATA SOURCES (All Subsystems Feed Into AI Agent)

┌─────────────────────────────────────────────────────────────────┐
│                     AI BUSINESS ANALYST AGENT                    │
│                                                                  │
│  INPUTS:                                                         │
│  ├── Subsystem 1: Commission Economics                           │
│  │   • Per-technician earnings, tip patterns, discount impact   │
│  │   • Commission fairness analysis (snapshot vs. actual)       │
│  │                                                               │
│  ├── Subsystem 2: Referral Analytics                             │
│  │   • Referral program ROI, top referrers, conversion rates    │
│  │   • Reward redemption patterns                               │
│  │                                                               │
│  ├── Subsystem 4: Customer Intelligence (65+ metrics)            │
│  │   • Lifecycle segments (NEW→ACTIVE→AT_RISK→LOST)             │
│  │   • Churn risk signals, visit frequency trends               │
│  │   • Revenue per customer trends                              │
│  │                                                               │
│  ├── Subsystem 7: Communication Tracking                         │
│  │   • Admin response times, missed calls, follow-up rates      │
│  │                                                               │
│  ├── Booking Data                                                │
│  │   • Capacity utilization, peak/off-peak patterns             │
│  │   • No-show rates, cancellation patterns                     │
│  │                                                               │
│  └── Team Performance                                            │
│      • Per-technician KPIs, per-admin conversion rates          │
│      • Scheduling efficiency                                    │
│                                                                  │
│  PROCESSING:                                                     │
│  ├── Pattern Detection Engine                                    │
│  │   • Cross-dimensional correlation analysis                   │
│  │   • Anomaly detection (sudden drops, unusual patterns)       │
│  │   • Trend forecasting (revenue, customer count, utilization) │
│  │                                                               │
│  ├── Domain Knowledge Model                                      │
│  │   • Service business best practices                          │
│  │   • Industry benchmarks (retention rates, avg ticket, etc.)  │
│  │   • Seasonal patterns for beauty/wellness industry           │
│  │                                                               │
│  └── Recommendation Engine                                       │
│      • Priority-ranked actionable recommendations               │
│      • Impact estimation (projected revenue/retention change)   │
│      • Root cause analysis for negative trends                  │
│                                                                  │
│  OUTPUTS:                                                        │
│  ├── Daily/Weekly Business Brief (natural language summary)      │
│  ├── Alert Notifications (urgent issues requiring attention)     │
│  ├── Opportunity Identification (revenue/growth opportunities)   │
│  ├── Team Coaching Insights (per-technician/admin feedback)      │
│  └── Strategic Recommendations (long-term business decisions)    │
└─────────────────────────────────────────────────────────────────┘
```

#### 6.3 AI Agent Analysis Domains

The AI agent performs autonomous analysis across the following domains:

```
AI AGENT ANALYSIS PIPELINE

DOMAIN 1: Customer Health Analysis
  INPUT: CustomerAnalytics (65+ metrics per customer)
  ANALYSIS:
    - Identify customers moving from ACTIVE → AT_RISK
    - Calculate churn probability based on visit frequency decay
    - Detect high-value customers with declining visit patterns
    - Identify customers who stopped using specific services
  OUTPUT:
    "⚠️ 12 high-value customers (avg ticket >$200) haven't visited
     in 45+ days. Historically, 73% of customers who pass 60 days
     without a visit never return. Recommended: personal outreach
     to these 12 clients this week. Estimated recovery revenue: $4,800."

DOMAIN 2: Team Performance Analysis
  INPUT: MasterEarningsLedger, AdminAnalyticsDaily, BookingFacts
  ANALYSIS:
    - Compare technician utilization rates (booked hours / available hours)
    - Identify technicians with declining rebooking rates
    - Detect technicians whose clients have higher churn rates
    - Compare new client conversion rates across administrators
    - Identify administrators with low follow-up rates after cancellations
  OUTPUT:
    "📊 Master Anna's rebooking rate dropped from 78% to 61% over
     the last 30 days. Her average ticket is stable, but 14 of her
     regular clients haven't rebooked. This correlates with the
     period when she moved from Location A to Location B.
     Recommended: check if her existing clients know about the
     location change."

DOMAIN 3: Revenue Optimization
  INPUT: Payments, Orders, BookingSnapshots, DiscountAllocationRules
  ANALYSIS:
    - Identify services with declining demand
    - Detect over-discounting (discounts exceeding customer acquisition value)
    - Calculate discount ROI (new clients acquired per discount dollar)
    - Identify upsell opportunities based on service co-occurrence patterns
    - Detect pricing anomalies (services priced below market benchmarks)
  OUTPUT:
    "💰 The 'New Client 20% Off' discount has been used 47 times
     this month but only 12 of those clients rebooked. Cost: $1,880
     in discounts. Revenue from rebookings: $960. The discount is
     losing $920/month. Consider: reducing to 15%, or requiring
     minimum service value, or switching to a rebooking incentive."

DOMAIN 4: Referral Program Effectiveness
  INPUT: ReferralAnalyticsDaily, ReferralRewards, GiftCardTransactions
  ANALYSIS:
    - Calculate referral program ROI (reward cost vs. new client LTV)
    - Identify top referrers and their social graph patterns
    - Detect referral code abuse patterns beyond self-referral
    - Measure referral-to-booking conversion funnel
  OUTPUT:
    "🎯 Your referral program generated 23 new clients this month
     at a cost of $460 ($230 referrer rewards + $230 friend bonuses).
     Average LTV of referral clients: $680. ROI: 14.8x.
     Top referrer: Maria K. (5 referrals, all became regular clients).
     Recommended: send Maria a thank-you gift and ask if she'd
     share her code on social media."

DOMAIN 5: Operational Blind Spot Detection
  INPUT: All subsystems cross-correlated
  ANALYSIS:
    - Identify patterns the owner hasn't queried or viewed
    - Detect correlations between seemingly unrelated metrics
    - Flag potential compliance or financial risks
    - Identify capacity constraints before they impact revenue
  OUTPUT:
    "🔍 You may not have noticed: Saturday 2-4 PM is consistently
     overbooked (3 rejected booking attempts per week), while
     Thursday 2-4 PM has 40% unused capacity with the same
     technicians available. Estimated lost revenue from Saturday
     rejections: $1,200/month. Recommended: offer Thursday
     incentive pricing to redirect demand."
```

#### 6.4 Technical Architecture of AI Agent

```
AI AGENT TECHNICAL ARCHITECTURE

1. DATA AGGREGATION LAYER
   - Scheduled data collection from all subsystem tables
   - Time-series construction for trend analysis
   - Cross-table correlation matrix computation
   - Anomaly baseline establishment (rolling 90-day averages)

2. CONTEXT CONSTRUCTION
   - For each analysis domain, construct a structured context payload:
     {
       tenant_profile: { locations, team_size, service_catalog, ... },
       current_metrics: { KPIs for current period },
       historical_trends: { same KPIs for trailing 30/60/90 days },
       benchmarks: { industry averages for comparable businesses },
       previous_recommendations: { what was recommended before and outcome }
     }

3. AI MODEL INVOCATION
   - Submit structured context to large language model (LLM)
   - System prompt includes domain expertise:
     • Service business operations knowledge
     • Financial analysis frameworks
     • Customer psychology for beauty/wellness industry
     • Team management best practices
   - Temperature: low (0.2) for analytical consistency
   - Constrained output format: structured recommendations with
     priority, impact estimate, and specific action steps

4. RECOMMENDATION VALIDATION
   - Verify all cited numbers against actual database values
   - Check recommendations against business constraints
     (e.g., don't recommend hiring when owner said budget is frozen)
   - Filter out recommendations that duplicate recent advice
   - Rank by estimated impact × feasibility

5. DELIVERY
   - Dashboard widget: top 3-5 recommendations refreshed daily
   - Push notifications: urgent alerts (e.g., sudden revenue drop)
   - Weekly email digest: comprehensive business analysis
   - In-app chat: owner can ask follow-up questions about any recommendation
```

#### 6.5 Key Differentiator: Domain-Specific vs. Generic AI

The critical technical innovation is that the AI agent is **domain-specialized for service businesses**, not a generic data analysis tool:

| Generic BI AI (Tableau/PowerBI) | This System's AI Agent |
|---|---|
| "Revenue declined 12% MoM" | "Revenue declined 12% because 3 top technicians had 15% fewer bookings. Root cause: they were reassigned to training shifts. Training ends next week — expect recovery." |
| "Customer churn is 8%" | "8 of your AT_RISK customers are regulars of Master Elena. She had a scheduling conflict last month that forced 8 rebookings to other technicians. 5 of those clients haven't returned. Contact them personally — they're likely not churning from the salon, they're waiting for Elena." |
| Shows a chart | Tells you what to DO about the chart |

---

### SUBSYSTEM 7: Multi-Channel Communication Tracking and Administrator Performance Analytics

#### 7.1 Problem Addressed

This subsystem solves the technical problem of measuring administrator (receptionist/front desk) effectiveness in managing client relationships across communication channels (SMS, phone calls, in-app messages, email) by tracking, classifying, and analyzing all administrator-client interactions.

#### 7.2 Communication Event Capture

```
COMMUNICATION TRACKING ARCHITECTURE

CHANNEL 1: SMS / Text Messages (via Twilio integration)
  CAPTURE:
    - Outbound messages: content, timestamp, recipient, sender (admin)
    - Inbound messages: content, timestamp, sender (client), recipient
    - Delivery status: sent, delivered, read, failed
  CLASSIFY:
    - Booking confirmation
    - Rebooking attempt (after cancellation/no-show)
    - Follow-up (post-visit)
    - Promotional (upsell/cross-sell)
    - Administrative (schedule change, location info)

CHANNEL 2: Phone Calls (via telephony integration)
  CAPTURE:
    - Call direction: inbound/outbound
    - Duration, timestamp, admin_id, customer_id
    - Outcome: answered, missed, voicemail, callback completed
    - Call-to-booking conversion: did a booking follow within 24 hours?
  CLASSIFY:
    - New client inquiry
    - Rebooking call
    - Complaint/issue resolution
    - Follow-up call

CHANNEL 3: Email (via SendGrid integration)
  CAPTURE:
    - Template type, send timestamp, open timestamp, click timestamp
    - Admin who triggered the send (if manual)
    - Response received (yes/no)

CHANNEL 4: In-App / Platform Messages
  CAPTURE:
    - Messages sent through booking platform
    - Read receipts, response times
```

#### 7.3 Administrator Performance Metrics

```
ADMIN PERFORMANCE ANALYTICS

PER-ADMINISTRATOR METRICS (computed daily):

  Response Metrics:
    - avg_response_time_minutes: Average time to respond to client messages
    - missed_call_rate: % of inbound calls not answered
    - callback_completion_rate: % of missed calls returned within 2 hours
    - message_response_rate: % of client messages answered within 1 hour

  Conversion Metrics:
    - inquiry_to_booking_rate: % of new inquiries that result in a booking
    - cancellation_recovery_rate: % of cancelled bookings that are rebooked
    - no_show_follow_up_rate: % of no-shows contacted within 24 hours
    - upsell_success_rate: % of upsell attempts that result in added services

  Quality Metrics:
    - client_satisfaction_proxy: rebooking rate for clients this admin handled
    - escalation_rate: % of interactions escalated to manager/owner
    - communication_volume: total interactions per day (workload indicator)

  Business Impact:
    - revenue_influenced: sum of bookings where admin was the last contact
    - clients_retained: AT_RISK clients who rebooked after admin outreach
    - new_clients_onboarded: new bookings from admin-handled inquiries
```

#### 7.4 Communication-to-Business Outcome Correlation

```
CORRELATION ENGINE

The system links communication events to business outcomes:

1. Message → Booking Chain:
   Admin sends rebooking SMS to client at 10:00 AM
   → Client books appointment at 10:45 AM (same day)
   → System attributes this booking to admin's outreach
   → Counts toward admin's cancellation_recovery_rate

2. Missed Call → Lost Revenue Detection:
   Client calls at 2:15 PM, call missed
   → No callback within 2 hours
   → Client does not book within 7 days
   → System flags as potential_lost_booking
   → Estimated lost revenue: client's average_ticket_cents

3. Follow-Up → Retention Impact:
   Client classified as AT_RISK (no visit in 45 days)
   → Admin sends follow-up message
   → Client rebooks within 72 hours
   → System credits admin with client_retention_save
   → Updates customer segment: AT_RISK → ACTIVE
```

---

### SUBSYSTEM 8: Integrated Standalone POS and Booking Platform

#### 8.1 Problem Addressed

This subsystem addresses the fundamental architectural limitation of depending on third-party POS platforms (Square, Clover, Toast) for core business operations. Third-party dependencies create: (a) data latency (webhook delays of 1-60 seconds between event and receipt); (b) reconciliation complexity (see Subsystem 3); (c) feature limitations imposed by the third party's product roadmap; (d) per-transaction fees that reduce margins; and (e) platform risk if the third party changes API terms or pricing.

#### 8.2 Platform Independence Architecture

The system is designed for progressive independence from third-party POS platforms:

```
PLATFORM EVOLUTION ROADMAP

PHASE 1 (Current — Deployed):
  Square handles: Bookings, Payments, Catalog, Customers
  Our platform handles: Analytics, Commissions, Referrals, Wallet
  Integration: Webhooks + API sync

PHASE 2 (In Development):
  Square handles: Payment processing only (card terminal)
  Our platform handles: Bookings, Customers, Analytics, Commissions,
                        Referrals, Wallet, Communication Tracking,
                        AI Business Analyst
  Integration: Payment-only API

PHASE 3 (Target Architecture):
  Our platform handles: EVERYTHING
  ├── Native booking engine (online + in-salon)
  ├── Native payment processing (via payment processor integration)
  ├── Native customer management (with deduplication engine)
  ├── Native catalog/service management
  ├── Native team scheduling and management
  ├── All existing subsystems (1-7)
  └── AI Business Analyst as central intelligence layer

  Square dependency: ZERO
```

#### 8.3 Technical Advantages of Integrated Platform

```
INTEGRATED vs. THIRD-PARTY DEPENDENCY

DATA LATENCY:
  Third-party: Event → Webhook → Receipt → Processing (1-60 sec)
  Integrated:  Event → Immediate Processing (0 sec)
  Impact: Real-time dashboard updates, instant commission calculation

RECONCILIATION:
  Third-party: Complex multi-strategy matching (Subsystem 3)
  Integrated:  Direct foreign keys — booking_id on payment at creation
  Impact: 100% reconciliation accuracy, zero orphaned records

FEATURE VELOCITY:
  Third-party: Limited by Square's product roadmap
  Integrated:  Full control over all features
  Impact: Can build per-service commission rates, advanced scheduling,
          AI-powered features without third-party constraints

DATA RICHNESS:
  Third-party: Only data Square chooses to expose via API
  Integrated:  Full access to every data point
  Impact: AI Agent has complete operational picture

COST:
  Third-party: Square fees (2.6% + $0.10 per transaction)
  Integrated:  Direct processor fees (~2.2% + $0.05)
  Impact: ~0.4% + $0.05 savings per transaction
```

---

## DATA MODEL SUMMARY

### Core Entity Relationships

```
Organization (tenant root)
  ├── Location (1:N) — physical service locations
  ├── TeamMember (1:N) — technicians with commission settings
  │     └── MasterSettings (1:1) — commission rate, category
  │     └── MasterEarningsLedger (1:N) — earnings entries
  ├── Booking (1:N) — customer appointments
  │     ├── BookingSnapshot (1:1) — immutable economic capture
  │     ├── BookingSegment (1:N) — individual service segments
  │     └── AdminCreatedBookingFact (1:1) — NEW/REBOOK classification
  ├── Order (1:N) — financial orders
  │     └── OrderLineItem (1:N) — service/product line items
  ├── Payment (1:N) — completed transactions
  │     └── PaymentTender (1:N) — payment method details
  ├── GiftCard (1:N) — gift card accounts
  │     └── GiftCardTransaction (1:N) — usage history
  ├── ReferralProfile (1:N) — customer referral enrollment
  │     └── ReferralReward (1:N) — earned rewards
  ├── CustomerAnalytics (1:N) — precomputed metrics per customer
  ├── ReferralAnalyticsDaily (1:N) — daily referral aggregates
  ├── AdminAnalyticsDaily (1:N) — daily team performance
  └── WebhookJob (1:N) — event processing queue
```

### Key Composite Indexes

```
UNIQUE(organization_id, square_customer_id)     — CustomerAnalytics
UNIQUE(organization_id, date_pacific)            — ReferralAnalyticsDaily
UNIQUE(booking_id, segment_index, booking_version) — BookingSegment
UNIQUE(organization_id, square_booking_id)       — Booking
UNIQUE(organization_id, payment_id)              — Payment
```

---

## CLAIMS OUTLINE

The following claim outlines are provided for attorney reference and are not formal patent claims:

### Independent Claim 1 — Cloud-Based SaaS Platform
A cloud-based Software-as-a-Service (SaaS) platform for managing service-based business operations, the platform being centrally hosted on serverless cloud infrastructure and accessible by a plurality of independent business tenants over the Internet via web browsers and API endpoints, the platform comprising:
- a shared application layer deployed as a single codebase serving all tenants without per-tenant installation or infrastructure provisioning;
- a multi-tenant database with organization-level data isolation enforced at the schema level through composite unique indexes and foreign key constraints, wherein each tenant's data is logically partitioned within a shared database cluster;
- an immutable booking snapshot module that captures economic parameters at booking time;
- a dual-stage ledger-based commission computation engine;
- a referral analytics module with self-referral prevention;
- an asynchronous event processing pipeline with multi-strategy entity reconciliation and automatic tenant routing for webhook events from third-party platforms;
- a precomputed customer intelligence module with temporal segmentation;
- a serverless digital wallet credential generator compatible with the platform's ephemeral compute environment;
- an AI-powered autonomous business intelligence agent that consumes data from all preceding modules and generates domain-specific, actionable business recommendations in natural language; and
- a multi-channel communication tracking module that captures, classifies, and correlates administrator-client interactions across SMS, phone, email, and in-app channels with business outcomes.

### Dependent Claims 2-6 — Snapshot Economics
2. The system of claim 1, wherein the booking snapshot captures service price and commission rate values that remain immutable regardless of subsequent changes to service pricing or commission rate configurations.
3. The system of claim 2, wherein commission computation uses the snapshot price rather than the actual payment amount, ensuring technician compensation is based on the service value at booking time.
4. The system of claim 2, further comprising dual processing flags (base_processed, discount_processed) that enable independent completion of base commission and discount allocation stages.
5. The system of claim 4, wherein the discount allocation stage applies configurable rules that map discount names to master share percentages, generating negative ledger entries.
6. The system of claim 2, wherein all commission, tip, and discount computations are recorded as append-only ledger entries with entry-type classification and JSONB metadata containing the calculation basis.

### Dependent Claims 7-11 — Referral Analytics
7. The system of claim 1, wherein self-referral prevention comprises cascading multi-attribute identity checks including direct code match, cross-code match, customer ID match, and configurable exclusion lists.
8. The system of claim 7, wherein referral reward deduplication uses SQL DISTINCT ON clauses keyed on (organization, referrer, referred, date) tuples to prevent double-counting from multi-payment scenarios.
9. The system of claim 7, wherein analytics aggregation across 9+ independent dimensions executes as a single atomic SQL query using Common Table Expressions with a full outer join key-union merge pattern.
10. The system of claim 9, wherein each analytics dimension produces structured JSON arrays containing attribution details, preserving audit-level granularity within aggregated daily records.
11. The system of claim 7, wherein all date bucketing uses explicit timezone conversion to the business's operating timezone.

### Dependent Claims 12-16 — Event Processing & Reconciliation
12. The system of claim 1, wherein webhook events are received synchronously with cryptographic signature verification and selectively routed to either synchronous processing or asynchronous queue-based processing based on event type.
13. The system of claim 12, wherein the job queue uses database-level row locking (SELECT FOR UPDATE SKIP LOCKED) to prevent concurrent processing of the same event.
14. The system of claim 12, further comprising a two-phase booking-to-payment reconciliation engine that: (a) in a primary phase, derives booking matches using service-type overlap scoring and time-window validation via external API queries; and (b) in a fallback phase, performs database-based matching using customer identity, location proximity, and temporal distance minimization.
15. The system of claim 14, wherein the primary phase assigns confidence scores (HIGH, MEDIUM, LOW) based on the number of candidate matches.
16. The system of claim 12, further comprising a multi-strategy organization resolution module that cascades through database lookup, API query, and nested object extraction to determine the tenant for each event.

### Dependent Claims 17-21 — Customer Intelligence
17. The system of claim 1, wherein customer deduplication uses window functions (FIRST_VALUE) to establish canonical identity across phone and email attributes with phone-match priority.
18. The system of claim 17, wherein 65+ customer metrics are precomputed via a 7-stage CTE pipeline and persisted in a denormalized table with atomic UPSERT and COALESCE-based field preservation.
19. The system of claim 18, wherein customers are classified along two independent axes: temporal segmentation (NEW, ACTIVE, AT_RISK, LOST, NEVER_BOOKED) based on visit recency, and behavioral classification (SALON_CLIENT, STUDENT, RETAIL, CANCELLED_ONLY, POTENTIAL) based on service consumption patterns.
20. The system of claim 18, further comprising a booking fact classification subsystem that classifies bookings as NEW_CLIENT or REBOOKING based on prior paid booking history, with a configurable correction window (default 35 days) after which classifications become immutable.
21. The system of claim 18, wherein booking notes are stored in JSONB format with GIN indexing for full-text pattern search across customer history.

### Dependent Claims 22-25 — Digital Wallet
22. The platform of claim 1, wherein digital wallet credentials are generated in the platform's serverless compute environment by decoding base64-encoded certificates from environment variables to ephemeral temporary files at runtime, without requiring persistent filesystem access.
23. The platform of claim 22, wherein pass manifests are constructed programmatically without filesystem-based templates, with image assets attached via buffer injection.
24. The platform of claim 22, further comprising multi-stage web service URL injection with binary verification of the final pass bundle.
25. The platform of claim 22, wherein authentication tokens are generated using HMAC-SHA256 keyed on the pass serial number, enabling secure push notification delivery for real-time balance updates.

### Dependent Claims 26-30 — SaaS Delivery Architecture
26. The platform of claim 1, wherein the platform is deployed as a single shared codebase on serverless cloud infrastructure, and new tenants are onboarded by creating an Organization record in the shared database without requiring any per-tenant software deployment, server provisioning, or infrastructure configuration.
27. The platform of claim 26, wherein each tenant connects to its own third-party point-of-sale account (Square) through per-tenant API credentials stored in the shared database, and the platform's shared webhook endpoint automatically routes incoming events to the correct tenant using a multi-strategy organization resolution module that cascades through location-based database lookup, external API query, and nested object extraction.
28. The platform of claim 26, wherein background processing jobs from all tenants are stored in a shared job queue table with tenant isolation enforced by organization_id partitioning, and serverless cron-triggered workers process jobs across tenants using database-level row locking (SELECT FOR UPDATE SKIP LOCKED) to prevent concurrent processing.
29. The platform of claim 26, wherein the platform's serverless compute layer auto-scales to accommodate varying tenant loads without manual capacity planning, and connection pooling is used to manage database connections across concurrent serverless function invocations.
30. The platform of claim 1, wherein each tenant accesses an isolated administrative dashboard via web browser showing only that tenant's data, with all dashboard API queries including the tenant's organization_id derived from authenticated session context, preventing cross-tenant data access at the query level.

### Dependent Claims 31-36 — AI Business Intelligence Agent
31. The platform of claim 1, further comprising an AI-powered autonomous business intelligence agent that consumes precomputed metrics from all platform subsystems — including commission ledger data, referral analytics, customer intelligence metrics, communication tracking data, and booking/payment records — and generates prioritized, actionable business recommendations in natural language.
32. The platform of claim 31, wherein the AI agent constructs structured context payloads for each analysis domain comprising: current-period metrics, trailing 30/60/90-day historical trends, industry benchmarks for comparable service businesses, and outcomes of previously delivered recommendations, and submits these payloads to a large language model (LLM) with domain-specialized system prompts encoding service business operational expertise.
33. The platform of claim 31, wherein the AI agent performs cross-dimensional correlation analysis to detect blind spots — business patterns or anomalies that the owner has not queried or viewed — including correlations between technician reassignment and customer churn, scheduling conflicts and revenue decline, discount overuse and negative acquisition ROI, and capacity underutilization at specific time slots.
34. The platform of claim 31, wherein the AI agent validates all generated recommendations by verifying cited numerical values against actual database records, checking recommendations against known business constraints, filtering out recommendations that duplicate recently delivered advice, and ranking remaining recommendations by estimated revenue impact multiplied by feasibility score.
35. The platform of claim 31, wherein the AI agent delivers analysis through multiple channels: a dashboard widget showing top daily recommendations, push notifications for urgent alerts (sudden metric drops, threshold breaches), weekly email digests with comprehensive business analysis, and an interactive chat interface where the business owner can ask follow-up questions about any recommendation.
36. The platform of claim 31, wherein the AI agent is domain-specialized for service businesses (salons, spas, medical practices) and generates contextual recommendations that reference specific technicians, customers, services, and time periods by name — as opposed to generic BI tools that present aggregated charts requiring manual interpretation.

### Dependent Claims 37-40 — Communication Tracking & Admin Performance
37. The platform of claim 1, further comprising a multi-channel communication tracking module that captures administrator-client interactions across SMS (via Twilio integration), phone calls (via telephony integration), email (via SendGrid integration), and in-app messaging channels, recording for each interaction: the communication channel, direction (inbound/outbound), timestamp, administrator identity, customer identity, content or duration, and delivery/response status.
38. The platform of claim 37, wherein the communication tracking module classifies each interaction by type — booking confirmation, rebooking attempt, post-visit follow-up, promotional/upsell, administrative, new inquiry, or complaint — and computes per-administrator performance metrics including: average response time, missed call rate, callback completion rate, inquiry-to-booking conversion rate, cancellation recovery rate, no-show follow-up rate, and upsell success rate.
39. The platform of claim 37, further comprising a communication-to-business-outcome correlation engine that links communication events to subsequent business actions — including attributing bookings to preceding administrator outreach, detecting lost revenue from unanswered calls that did not result in bookings within a configurable time window, and crediting administrators for client retention when AT_RISK-segmented customers rebook after administrator-initiated contact.
40. The platform of claim 37, wherein the communication tracking data feeds into the AI business intelligence agent (claim 31) to generate administrator coaching recommendations — identifying administrators with low conversion rates, high missed-call rates, or insufficient follow-up patterns, and suggesting specific behavioral changes with projected impact on bookings and revenue.

---

## ABSTRACT

A cloud-based Software-as-a-Service (SaaS) platform and method for managing multi-tenant service business operations, wherein the platform is centrally hosted on serverless cloud infrastructure and accessed by a plurality of independent business tenants over the Internet without requiring per-tenant software installation or infrastructure provisioning. The platform comprises eight integrated subsystems: (1) a snapshot-based commission economics engine that captures immutable economic parameters at booking time and computes earnings through a dual-stage ledger pipeline; (2) a dual-attribution referral analytics engine with cascading self-referral prevention and single-query multi-dimensional aggregation; (3) an asynchronous event processing pipeline that separates webhook receipt from business logic execution, featuring a two-phase booking-to-payment reconciliation engine with service-type overlap scoring and automatic tenant routing; (4) a precomputed customer intelligence engine that maintains 65+ metrics per customer through a 7-stage deduplication and classification pipeline with temporal segmentation; (5) a serverless digital wallet credential generator that produces Apple Wallet passes using ephemeral certificate management and templateless pass construction; (6) an AI-powered autonomous business intelligence agent that consumes data from all other subsystems and generates domain-specific, actionable business recommendations in natural language, functioning as a virtual business analyst that detects blind spots, identifies revenue opportunities, and provides team coaching insights; (7) a multi-channel communication tracking module that captures administrator-client interactions across SMS, phone, email, and in-app channels, correlates communications with business outcomes (bookings, retention, revenue), and computes per-administrator performance analytics; and (8) an integrated standalone booking and payment platform designed to progressively replace third-party POS dependencies, eliminating data latency, reconciliation complexity, and feature constraints. The platform enforces multi-tenant data isolation at the database schema level and provides deterministic, auditable computation across all subsystems while enabling new tenants to be onboarded through database configuration without infrastructure changes.

---

## APPENDIX A: KEY SOURCE CODE REFERENCES

The following source code files implement the subsystems described in this application:

| Subsystem | Primary Implementation File(s) |
|-----------|-------------------------------|
| 1. Commission Economics | `lib/workers/master-earnings-worker.js`, `lib/workers/discount-engine-worker.js` |
| 2. Referral Analytics | `lib/analytics/referral-analytics-refresh.js` |
| 3. Event Processing | `app/api/webhooks/square/route.js`, `app/api/webhooks/square/webhook-processors.js`, `lib/workers/webhook-job-runner.js` |
| 4. Customer Intelligence | `app/api/cron/refresh-customer-analytics/route.js`, `lib/analytics/admin-created-booking-facts.js` |
| 5. Digital Wallet | `lib/wallet/pass-generator.js`, `lib/wallet/giftcard-context.js` |
| 6. AI Business Analyst | *In development — architecture defined in this provisional* |
| 7. Communication Tracking | *In development — architecture defined in this provisional* |
| 8. Standalone POS/Booking | *In development — architecture defined in this provisional* |
| Data Models | `prisma/schema.prisma` |

---

## APPENDIX B: PRIOR ART DIFFERENTIATION

| Existing Solution | Limitation | Present Invention's Improvement |
|---|---|---|
| Square Dashboard | Single-tenant; computes commission on current prices; no snapshot locking | Multi-tenant SaaS with immutable snapshot captures economics at booking time |
| Square Loyalty / Referrals | Single-tenant; no self-referral prevention; basic analytics | SaaS-delivered cascading 4-check abuse prevention; 9-dimension single-query analytics |
| Generic webhook processors | Synchronous processing or simple queuing; no multi-tenant routing | Multi-tenant webhook routing with multi-strategy reconciliation and service-type scoring |
| CRM analytics (Salesforce, HubSpot) | Compute metrics on-demand via joins; expensive per-seat licensing | SaaS platform with 65+ precomputed metrics and temporal segmentation; serverless scaling |
| PassKit libraries | Require persistent filesystem; not SaaS-compatible | Serverless SaaS-compatible with ephemeral certificate management |
| Gusto / Homebase (payroll) | Commission based on payment amount; separate from booking platform | Integrated SaaS platform with commission based on snapshot price (pre-discount, pre-change) |
| Vagaro / Fresha / Mindbody | Monolithic SaaS; no snapshot-based economics; no ledger audit trail | Serverless SaaS with immutable snapshots, append-only ledger, and dual-stage processing |

---

## APPENDIX C: DETAILED COMPETITIVE DIFFERENTIATION VS. SQUARE PLATFORM

Square is the third-party POS platform upon which the current implementation of the present invention operates. The following analysis demonstrates the substantial technical and functional differentiation between Square's native capabilities and the present invention. The present invention is designed to progressively replace Square entirely with a standalone SaaS platform.

### C.1 Features Square Does Not Provide (Complete Gaps)

| Feature | Square Status | Present Invention |
|---|---|---|
| **Customer Referral Program** | Not available. Merchants have requested since 2017; Square has not built it. Square's "referral program" is merchant-to-merchant only. | Full dual-code referral system with automated $10 gift card rewards for both referrer and friend, 4-level cascading self-referral prevention, and 9-dimension analytics |
| **Referral Analytics** | None | Single-query refresh across new customers, referrer rewards, friend bonuses, email notifications, wallet activations, and redemptions with JSON detail preservation |
| **Self-Referral Abuse Prevention** | None | Cascading 4-check identity resolution: direct code match, cross-code match, customer ID match, configurable exclusion lists |
| **Booking-to-Payment Reconciliation** | None. Square's Bookings API and Payments API are entirely separate with no linking mechanism. No `booking_id` exists on payment records. | Two-phase reconciliation engine: API-based service-type overlap scoring with time-window validation (primary) + database customer/location/temporal matching (fallback) |
| **Per-Service Commission Rates** | Not available. Square allows only one flat commission rate per team member across all services. | Per-service commission rates captured in BookingSnapshot, allowing different rates for colorist vs. blowdry vs. nail services for the same technician |
| **Commission Snapshot Locking** | Not available. Square records commission "at the time of sale" (payment), not at booking time. Rate changes between booking and payment affect commission. | Immutable BookingSnapshot captures price and commission rate at booking time. Subsequent price/rate changes do not affect existing snapshots. |
| **Commission Audit Ledger** | Not available. Square shows "estimated commission figures" with disclaimer that "actual commission earnings may vary." No historical audit trail. | Append-only MasterEarningsLedger with entry-type classification (SERVICE_COMMISSION, TIP, DISCOUNT_ADJUSTMENT), JSONB metadata containing calculation basis, and full traceability to source snapshot |
| **Discount Allocation Rules** | Not available. Square tracks total discount amount but does not allocate discount costs between business and technician. | Rule-based DiscountAllocationEngine: configurable rules map discount names to master_share_percent, generating negative DISCOUNT_ADJUSTMENT ledger entries |
| **AI Business Analyst Agent** | Not available | Autonomous AI agent consuming all subsystem data, generating domain-specific actionable recommendations, detecting blind spots, and providing team coaching insights |
| **Communication Tracking** | Not available | Multi-channel tracking (SMS, phone, email, in-app) with per-administrator performance metrics and communication-to-business-outcome correlation |
| **Customer Lifecycle Segmentation** | Not available. Square provides only 2 static groups: "Regulars" (3+ visits in 6 months) and "Lapsed" (no visit in 6 weeks). | 5 temporal segments (NEW, ACTIVE, AT_RISK, LOST, NEVER_BOOKED) × 5 behavioral types (SALON_CLIENT, STUDENT, RETAIL, CANCELLED_ONLY, POTENTIAL) computed via 7-stage CTE pipeline |
| **Customer Metrics (65+)** | ~5 basic metrics: total spend, average spend, total visits, average visits, satisfaction. Cash transactions excluded. | 65+ precomputed metrics including: visit patterns, revenue trends, booking status breakdowns, referral participation, churn indicators, JSONB booking notes with GIN indexing |
| **Customer Deduplication Engine** | Basic card-based dedup only. No merge across phone/email/name. | 3-stage identity resolution: phone normalization → email normalization → COALESCE merge using FIRST_VALUE window functions with phone-match priority |

### C.2 Features Where Square Provides Basic Functionality but Present Invention Is Substantially Superior

| Feature | Square (Basic) | Present Invention (Advanced) |
|---|---|---|
| **Tip Reporting** | Aggregate credit card tips per employee. No per-service breakdown. Tip pooling with 3 allocation methods. | Per-payment tip aggregation linked to specific bookings and technicians. Tips from split-tender payments summed. TIP ledger entries with source payment metadata. |
| **Discount Reporting** | Aggregate discount/comp/void reports. Groupable by discount name or item. | Discount allocation to specific technicians with configurable business-vs-technician cost split. Per-order-line-item tracking with rule-based engine. |
| **Apple Wallet** | eGift cards can be added to Apple Wallet via email link. Static pass (no dynamic updates). | Dynamic .pkpass generation in serverless environment with real-time balance updates via APNs push notifications. Templateless construction with ephemeral certificate management. |
| **Multi-Location** | Per-location bank accounts, hours, profiles. Filterable reports. | All of Square's capabilities PLUS: cross-location customer journey tracking, per-location commission economics, location-level referral analytics, location-comparative AI analysis |
| **Dashboard Analytics** | Sales summary, trends, payment methods, item/category sales, tax reports, gift card reports. | All revenue/booking analytics PLUS: commission-level analytics per technician, referral program ROI, customer lifecycle funnels, AI-generated insights, admin performance scorecards |
| **Webhook Delivery** | POST with HMAC signature. 12 retry attempts over 24 hours with exponential backoff. Idempotency via event_id. | All of Square's delivery guarantees PLUS: selective sync/async routing, database-backed job queue with FOR UPDATE SKIP LOCKED concurrency control, multi-strategy tenant resolution, multi-phase entity reconciliation |
| **Team Management** | Roles, permissions, time tracking, scheduling. Basic commission (flat rate). | All team management PLUS: per-service commission with snapshot locking, dual-stage processing, discount allocation, per-technician analytics with AI coaching, admin communication performance tracking |

### C.3 Square's Architectural Limitations That Necessitate Replacement

| Limitation | Business Impact | How Present Invention Solves It |
|---|---|---|
| Commission based on payment amount, not booking value | Technicians lose money when customers get discounts | Snapshot captures booking-time price; commission is on service value |
| No booking-payment link in data model | Cannot compute per-service profitability | Reconciliation engine creates the missing link |
| 5 customer metrics vs. 65+ needed | No customer intelligence; all decisions are gut-feel | Precomputed analytics with temporal segmentation and AI analysis |
| No referral program after 7+ years of requests | Owners use manual spreadsheets or third-party tools | Native, automated, abuse-resistant referral program |
| 2.6% + $0.10 per transaction | $26,100/year overhead on $1M revenue | Standalone platform with direct processor integration (~2.2% + $0.05) saves ~$4,500/year |
| Feature roadmap controlled by Square | Cannot build features Square doesn't prioritize | Full control over product roadmap; ship features monthly |
| Data available only via API with rate limits | Incomplete data picture; API quota issues | Direct database access; all data available instantly |
| No AI analytics capability | Owners must interpret data themselves | AI Business Analyst Agent provides actionable recommendations |

---

## NOTES FOR PATENT ATTORNEY

1. **Priority Date**: File this provisional as soon as possible to establish the earliest priority date. The system is already deployed in production.

2. **Restriction Risk**: The USPTO may issue a restriction requirement separating these into 3-4 distinct inventions. The most natural groupings would be:
   - Group A: Claims 1-6, 26-30 (SaaS Platform + Snapshot Economics) + Claims 12-16 (Event Processing) — tightly coupled
   - Group B: Claims 7-11 (Referral Analytics) + Claims 17-21 (Customer Intelligence) — analytics cluster
   - Group C: Claims 22-25 (Digital Wallet) — standalone
   - Group D: Claims 31-36 (AI Agent) + Claims 37-40 (Communication Tracking) — AI intelligence cluster

3. **Alice Considerations**: Each subsystem is framed as a technical solution to a technical problem (not an abstract business method). The SaaS delivery model strengthens the claims because it introduces specific technical architecture (serverless compute, shared infrastructure with tenant isolation, ephemeral certificate management) rather than merely implementing a business method on a generic computer. The strongest claims under Alice are:
   - SaaS multi-tenant architecture with automatic webhook routing (specific cloud architecture)
   - Snapshot locking with dual processing flags (specific data architecture)
   - Multi-strategy reconciliation with scoring (specific algorithm)
   - Serverless certificate management (specific technical adaptation for SaaS constraints)
   - AI Agent with structured context construction, recommendation validation, and domain-specialized analysis (specific AI pipeline architecture — note: AI-related patents face additional scrutiny; emphasize the structured data pipeline, validation steps, and domain specialization as technical innovations, not the LLM itself)
   - Communication-to-business-outcome correlation engine (specific method linking communication events to revenue/retention outcomes)

4. **SaaS Business Method Consideration**: The SaaS delivery model itself is not patentable as it is a well-known delivery mechanism. However, the *specific technical methods* used to deliver this particular SaaS (shared webhook endpoint with automatic tenant routing, serverless-compatible certificate handling, database-level tenant isolation with composite indexes) represent technical innovations within the SaaS architecture that strengthen patentability.

5. **AI Patent Considerations**: Claims 31-36 describe an AI-powered business intelligence agent. Note that:
   - The LLM model itself is NOT being claimed (it is a third-party model). What is being claimed is the specific method of: (a) constructing domain-specialized context payloads from multi-subsystem data; (b) validating AI-generated recommendations against actual database records; (c) filtering, deduplicating, and ranking recommendations by impact × feasibility; and (d) the specific cross-dimensional blind-spot detection across service business operational data.
   - Frame AI claims around the DATA PIPELINE and VALIDATION, not the model. This is consistent with post-Alice guidance on AI patents.
   - The domain specialization (service business expertise embedded in system prompts) may be challenged as a mere "abstract idea" — counter by emphasizing the structured context construction and recommendation validation steps as concrete technical improvements.

6. **Platform Independence Strategy**: The provisional covers the current system (operating on top of Square) AND the target standalone platform. This is intentional — it establishes priority for the full vision while the standalone features are being built. The continuation-in-part (CIP) strategy should add implementation details for the standalone POS/booking/payment modules as they are completed.

7. **Continuation Strategy**: Consider filing continuation-in-part applications as each major module reaches production:
   - CIP 1: AI Business Analyst Agent (when deployed to production)
   - CIP 2: Communication Tracking Module (when deployed)
   - CIP 3: Standalone POS/Booking Engine (when Square is fully replaced)
   - CIP 4: Additional AI capabilities (churn prediction models, automated pricing optimization, demand forecasting)

---

*This document was prepared as a technical description for provisional patent filing purposes. It is not a formal patent application and requires review by a registered patent attorney before submission to the USPTO.*

*Document generated: March 22, 2026*
*System version: Subsystems 1-5 deployed in production; Subsystems 6-8 in architectural design phase*
*Note: Provisional patent applications may include both implemented and planned features to establish priority date for the complete invention.*
