# Travel Agency Management SaaS — Product & Technical Specification

| | |
|---|---|
| Document status | Specification only. **Nothing described here is implemented yet.** A feature counts as implemented only when its code, tests and acceptance criteria in this file pass. |
| Version | 1.0 (2026-10-19) |
| Primary market | Kingdom of Saudi Arabia (KSA), architecture ready for other countries and currencies |
| Audience | Engineers and AI coding agents building the product. This file is self-contained. |

## 0. How to read this document

- **MUST / MUST NOT / SHOULD / MAY** follow RFC 2119 meanings.
- Requirements carry IDs (e.g. `TEN-03`) so code, tests and pull requests can reference them.
- "Tenant" and "agency" mean the same thing: one subscribing travel business.
- "Phase N" refers to the delivery plan in §27. A requirement without a phase tag belongs to the phase that owns its module (see §27.1).
- Items marked **[EXTERNAL]** need credentials, a commercial contract, a licence or regulatory review before they can work in production. They MUST be built behind the integration interfaces in §18 and MUST NOT be simulated as real (see §28).
- Items marked **[DECISION]** are unresolved and are collected in Appendix A.
- Where this spec states a regulatory fact (ZATCA, VAT, PDPL), the fact MUST be re-verified against the regulator's current publications before go-live. Regulations change; the spec does not replace professional tax or legal advice.

---

## 1. Product vision, goals, users, roles and terminology

### 1.1 Vision
One system where a travel agency runs its whole business: customers, quotations, bookings, suppliers, money in and out, documents, staff and reports. It works in Arabic and English, follows Saudi tax and e-invoicing rules, and keeps every agency's data strictly separate.

### 1.2 Goals
1. Replace spreadsheets, WhatsApp threads and disconnected accounting tools for small and mid-size agencies (1–200 staff, 1–20 branches).
2. Make every riyal traceable from quotation to booking to invoice to payment to supplier settlement.
3. Be compliant by design: ZATCA-ready invoices, auditable financial history, protected traveler identity data.
4. Save staff time with AI-assisted data entry that a human always confirms.
5. Stay simple to operate: one deployable application, one worker process, one PostgreSQL database, one object store.

### 1.3 Non-goals (product level)
- Not a consumer-facing online travel agency (OTA) storefront. A customer self-service portal is out of scope for v1 (§28).
- Not a full ERP. Payroll, HR leave management, inventory and procurement beyond supplier bills are out of scope.
- Not a GDS or a booking engine. Live search and ticketing happen only through contracted provider integrations (§18).

### 1.4 User types
| User type | Description |
|---|---|
| Platform administrator | Employee of the SaaS operator. Manages tenants, plans and platform health. Has no default access to tenant business data (§19.4). |
| Agency owner | Created the tenant or received ownership. Full control of the tenant, including billing and deleting the tenant. |
| Agency staff | Users invited by the agency with one of the roles below. |
| Customer / traveler | Records in the CRM. They do not log in in v1. They receive emails, PDFs and payment links. |

### 1.5 Tenant roles (system roles)
Roles are fixed in code for v1 (custom roles are listed in Appendix A). A user has exactly one role per tenant.

| Role | Purpose |
|---|---|
| `OWNER` | Everything, including subscription, tenant deletion and ownership transfer. At least one active owner per tenant at all times. |
| `ADMIN` | Everything except subscription billing, tenant deletion and ownership transfer. |
| `BRANCH_MANAGER` | Full operational and sales access within assigned branches; approves discounts and refunds up to tenant-defined limits; reads branch financial reports. |
| `SALES_AGENT` | Manages customers, quotations and bookings they own or that belong to their branches (per data scope §4.6). Records customer payments. |
| `OPERATIONS_AGENT` | Manages bookings, supplier confirmations, tickets/vouchers, documents and itineraries in their branches. No quotation pricing approval. |
| `ACCOUNTANT` | Invoices, receipts, refunds, expenses, supplier bills and payments, reports, ledger. Read-only on bookings and customers. |
| `VIEWER` | Read-only on non-sensitive data in assigned branches. Cannot see passport numbers or export data. |

### 1.6 Terminology
| Term | Meaning |
|---|---|
| Tenant / agency | The subscribing business. Every business record belongs to exactly one tenant. |
| Branch | A physical or logical office of a tenant. Records may be scoped to a branch. |
| Customer | The party that pays: an individual or a corporate account. |
| Traveler | A person who travels. May be the customer, a family member or a corporate employee. A customer has 0..n travelers. |
| Passenger | A traveler's snapshot attached to a specific booking (names and document data as used for that trip). |
| Supplier | A provider of travel services: airline, consolidator, hotel, DMC, transfer company, visa service, insurer. |
| Service / product | A sellable travel component: flight, hotel, transfer, tour, package, visa, insurance, other. |
| Quotation | A priced offer to a customer, with versions. Converted into a booking when accepted. |
| Booking | A customer's order containing one or more booking items (services), passengers and an itinerary. |
| Booking item | One service in a booking with its own supplier, cost, sell price, status and confirmation number. |
| PNR | Passenger Name Record locator from an airline/GDS. Stored as text; never generated by this system. |
| Invoice | A tax invoice issued to a customer. Immutable after issue. |
| Credit note | A document that reverses or reduces an issued invoice. |
| Receipt / payment | Money received from a customer. |
| Refund | Money returned to a customer. |
| Supplier bill | An amount the agency owes a supplier. |
| Supplier payment | Money paid to a supplier. |
| Expense | An operating cost not tied to a supplier bill (rent, salaries summary, utilities, marketing). |
| Operational finance | Phase 3 finance: documents, balances, statuses and reports computed from them. No double-entry ledger. |
| Ledger | Phase 6 double-entry accounting: chart of accounts, journal entries, periods, reconciliation. |
| Base currency | The tenant's reporting currency (default SAR). |
| Minor units | Not used for storage. Money is stored as `NUMERIC` (see §11.1). |
| AI suggestion | Any value produced by an AI model. Unverified until a user confirms it (§17). |

---

## 2. Feature inventory and functional requirements

### 2.1 Feature inventory
| Module | Key features | Phase |
|---|---|---|
| Foundation | Project skeleton, DB, migrations, logging, error handling, i18n/RTL shell, design system | 1 |
| Identity | Sign-up, login, logout, sessions, email verification, password reset, invitations | 1 |
| Tenancy | Tenant creation, isolation enforcement, tenant context, membership | 1 |
| Agency setup | Profile, branding, branches, currencies, locale, timezone, tax settings, numbering | 1 |
| Users & roles | Invite, change role, deactivate, branch assignment, permission checks | 1 |
| Dashboard | Setup checklist (Phase 1), KPIs (Phase 3+) | 1, 3 |
| CRM | Customers, contacts, travelers, travel documents, interactions, tags, follow-ups | 2 |
| Suppliers | Suppliers, contacts, commission rules, payment terms | 2 |
| Catalog | Travel products (tours, packages, transfers, visa types, other) with default prices | 2 |
| Bookings | Booking lifecycle, items, passengers, itinerary, status history, cancellations, amendments | 2 |
| Sales | Quotations with versions, PDF proposals, conversion to booking, follow-ups | 3 |
| Finance | Invoices, credit notes, receipts, refunds, supplier bills, supplier payments, expenses, financial accounts, FX rates | 3 |
| Financial reports | Receivables, payables, sales, margin, VAT summary, cash position | 3 |
| Documents | Secure upload, scanning, entity attachment, access logging, retention | 4 |
| Notifications | In-app and email notifications, preferences, reminders | 4 |
| Tasks | Tasks, assignments, due dates, reminders linked to entities | 4 |
| Audit | Append-only audit log and activity timelines | 4 (audit writes start in Phase 1, see AUD-01) |
| Exports & reports | CSV/XLSX exports, operational reports | 4 |
| AI | Document extraction, review queue, booking/customer-service assistant, natural-language reporting | 5 |
| Integrations | Email provider, SMS/WhatsApp, payment gateways, GDS/NDC, hotel suppliers, accounting exports, ZATCA Phase 2 | 6 |
| SaaS admin | Plans, entitlements, subscription billing, platform console | 6 (plan limits enforced from Phase 1) |
| Accounting | Chart of accounts, journal entries, fiscal periods, bank reconciliation | 6 |
| Hardening | MFA, RLS (if chosen), load tests, backup drills, security review | 6 |

### 2.2 Cross-cutting functional requirements
- `FR-01` Every list page MUST support search, filters, sorting and pagination (§22).
- `FR-02` Every business record MUST show who created and last changed it, and when (in tenant timezone).
- `FR-03` Every entity with a lifecycle MUST show its status history.
- `FR-04` All user-facing text MUST be translatable (Arabic and English shipped).
- `FR-05` Every create/update form MUST validate on the client for usability and on the server for correctness, using the same schema (§22.6).
- `FR-06` Destructive or irreversible actions (cancel booking, issue invoice, refund, delete) MUST require explicit confirmation and MUST state the consequence.
- `FR-07` The system MUST NOT display a success message unless the operation committed. Operations handed to a background job MUST say "queued" or "in progress" and expose the eventual result.
- `FR-08` Any field filled by AI MUST be visibly marked until a user confirms it (§17).
- `FR-09` Master data (customers, suppliers, products, branches, users) MUST be archived, not hard-deleted, once referenced by any transaction. Unreferenced drafts MAY be hard-deleted.
- `FR-10` Financial documents (issued invoices, credit notes, receipts, refunds, supplier payments, posted journal entries) MUST NEVER be edited or deleted after issue/post. Corrections use reversing documents.

---

## 3. Multi-tenancy and strict agency data isolation

### 3.1 Model
Shared database, shared schema, `tenantId` column on every tenant-owned table. This is the simplest model that scales to thousands of tenants. Schema-per-tenant and database-per-tenant are rejected for v1 (operational cost, migration fan-out).

### 3.2 Requirements
- `TEN-01` Every tenant-owned table MUST have `tenantId UUID NOT NULL` with a foreign key to `Tenant`. Global tables (e.g. `User`, `Plan`, `Currency`) are explicitly listed in §21 as global.
- `TEN-02` The tenant of a request MUST be derived on the server from the authenticated session's active membership. It MUST NEVER be taken from a URL, header, query parameter or request body.
- `TEN-03` All database access to tenant-owned tables MUST go through a tenant-scoped data access helper (`db.forTenant(ctx)`, implemented as a Prisma Client extension) that:
  - injects `tenantId` into every `where` for `find*`, `count`, `aggregate`, `groupBy`, `update*`, `delete*`;
  - sets `tenantId` on every `create`/`createMany`/`upsert`;
  - throws if a caller passes a different `tenantId`.
- `TEN-04` Raw SQL (`$queryRaw`) against tenant-owned tables MUST include an explicit `tenantId = $1` predicate and MUST live only in `src/server/db/raw/` so it can be reviewed. A lint rule or CI grep MUST block `$queryRaw` elsewhere.
- `TEN-05` Foreign keys between tenant-owned tables MUST be composite `(tenantId, id)` references, so the database itself rejects a booking pointing at another tenant's customer. Every tenant-owned table therefore has `@@unique([tenantId, id])`.
- `TEN-06` Looking up a record by ID that belongs to another tenant MUST return `404 Not Found`, not `403`, so IDs cannot be probed.
- `TEN-07` IDs MUST be UUIDs (v7, time-ordered for index locality). Human-readable numbers (booking reference, invoice number) are per-tenant and never used alone for lookups across tenants.
- `TEN-08` Background jobs MUST carry `tenantId` in their payload and MUST re-establish tenant context with the same helper before touching data.
- `TEN-09` File storage keys MUST be prefixed `tenants/{tenantId}/…`, and every download MUST check the owning record's tenant and permissions before issuing a signed URL (§14).
- `TEN-10` Caches (if any) MUST include `tenantId` in the key.
- `TEN-11` Search indexes, exports, reports and AI context MUST be built only from tenant-scoped queries.
- `TEN-12` A cross-tenant isolation test suite MUST exist and run in CI (§25.3): for every API route, a user of tenant B requests tenant A's resource IDs and must get 404 on reads and 404 on writes, with no data change.
- `TEN-13` PostgreSQL Row-Level Security as defence in depth is **[DECISION]** (Appendix A, D-01). The application-level enforcement above is mandatory regardless.

### 3.3 Users in several tenants
A `User` is a global identity (one email). `Membership` links a user to a tenant with a role. A user MAY belong to several tenants and switch the active tenant; switching rotates the session (AUTH-12). Platform administrators are users with `isPlatformAdmin = true` and no implicit membership.

---

## 4. Authentication, authorization, invitations, password recovery and sessions

### 4.1 Authentication
- `AUTH-01` Email + password login. Email is case-insensitive and unique (stored lowercased, `citext` or normalized column).
- `AUTH-02` Passwords hashed with Argon2id (memory ≥ 19 MiB, iterations ≥ 2, parallelism 1; OWASP baseline) via `@node-rs/argon2`. Never logged, never returned.
- `AUTH-03` Password policy: minimum 12 characters, maximum 128, no composition rules, rejected if it appears in a bundled list of the 100k most common passwords. (Breached-password API check is optional, Appendix A D-08.)
- `AUTH-04` Login errors MUST be generic ("Email or password is incorrect"), with the same response time whether the email exists or not (hash a dummy password when the user is missing).
- `AUTH-05` Email verification is required before a new self-signed-up tenant becomes active. Verification tokens: 32 random bytes, stored as SHA-256 hash, single use, 24 h expiry.
- `AUTH-06` Login is rate limited (§23.4) and progressively delayed per account and per IP; after 10 failures in 15 minutes the account is locked for 15 minutes and the owner email is notified. Locks never reveal account existence to the requester.
- `AUTH-07` MFA (TOTP, RFC 6238) with recovery codes: Phase 6. Mandatory for platform administrators; tenant owners can require it for their tenant.
- `AUTH-08` SSO (SAML/OIDC) is excluded from v1 (§28).

### 4.2 Sessions
- `AUTH-09` Server-side sessions in the `Session` table. Session token: 32 random bytes (base64url) in an `HttpOnly; Secure; SameSite=Lax; Path=/` cookie named `__Host-session`. Only the SHA-256 hash of the token is stored.
- `AUTH-10` Session lifetime: idle timeout 8 h (configurable per tenant 1–24 h), absolute timeout 7 days. `lastSeenAt` updated at most once per minute to limit writes.
- `AUTH-11` Session record stores: userId, active tenantId, createdAt, lastSeenAt, expiresAt, ip, userAgent.
- `AUTH-12` The session ID MUST be rotated on login, privilege change, tenant switch and password change.
- `AUTH-13` Password change or reset MUST revoke all other sessions of that user. Users can list and revoke their own sessions; owners/admins can revoke all sessions of a tenant member.
- `AUTH-14` Deactivating a membership MUST immediately invalidate access to that tenant (checked on every request, not cached past the request).
- `AUTH-15` CSRF: all state-changing requests MUST use non-GET methods and MUST pass an `Origin`/`Sec-Fetch-Site` check against the configured app origin. SameSite=Lax cookies are the second layer.
- `AUTH-16` Library choice: hand-rolled session module (≈200 lines: create, validate, rotate, revoke) on top of Argon2id and `crypto.randomBytes`. No auth framework is required. **[DECISION]** D-02 records the alternative (Auth.js / Better Auth).

### 4.3 Password recovery
- `AUTH-17` "Forgot password" always responds "If an account exists, we sent an email." Reset token: 32 random bytes, SHA-256 hashed, single use, 30 min expiry, invalidated by any newer token or successful login.
- `AUTH-18` Completing a reset sets the new password, revokes all sessions, and emails a "your password was changed" notice.

### 4.4 Invitations
- `AUTH-19` Owners and admins (and branch managers for their branches, with roles ≤ `SALES_AGENT`/`OPERATIONS_AGENT`/`VIEWER`) invite by email with a role and branch assignments.
- `AUTH-20` Invitation token: 32 random bytes, hashed, 7 day expiry, single use, revocable, resendable (resend issues a new token and invalidates the old one).
- `AUTH-21` Accepting: if the email has no `User`, the invitee sets name and password; if it does, they log in. The accepting user's email MUST match the invitation email.
- `AUTH-22` Invitations count toward the plan's user limit while pending (§19.2).
- `AUTH-23` Nobody can invite or assign a role higher than their own. Only an owner can create another owner.

### 4.5 Authorization model
- `AUTHZ-01` Permissions are strings `resource:action` (e.g. `booking:read`, `invoice:issue`). A static map in code (`src/server/auth/permissions.ts`) assigns permissions to roles. Checks use `can(ctx, 'invoice:issue', record?)`.
- `AUTHZ-02` Every API handler and service function MUST perform its permission check on the server. UI hiding is cosmetic only.
- `AUTHZ-03` Sensitive-field permissions are separate: `traveldoc:reveal` (see full passport/ID number), `customer:export`, `finance:approve`.

### 4.6 Data scope (branch and ownership)
Each permission is granted with a scope: `ALL` (whole tenant), `BRANCH` (records whose `branchId` is in the user's assigned branches), or `OWN` (records the user owns or is assigned to). Records without a branch are visible only with `ALL`.

### 4.7 Permission matrix (v1)
Legend: A = all, B = assigned branches, O = own/assigned, R = read only in scope, — = none.

| Permission | OWNER | ADMIN | BRANCH_MGR | SALES | OPS | ACCOUNTANT | VIEWER |
|---|---|---|---|---|---|---|---|
| tenant:settings | A | A | — | — | — | — | — |
| tenant:billing / tenant:delete / owner:transfer | A | — | — | — | — | — | — |
| user:invite / user:manage | A | A | B (limited, AUTH-19) | — | — | — | — |
| branch:manage | A | A | — | — | — | — | — |
| customer:read | A | A | B | B | B | A (R) | B (R) |
| customer:write | A | A | B | B | B | — | — |
| customer:export | A | A | B | — | — | A | — |
| traveldoc:read (masked) | A | A | B | B | B | — | — |
| traveldoc:reveal | A | A | B | O | B | — | — |
| supplier:read | A | A | B | B | B | A | B (R) |
| supplier:write | A | A | B | — | B | A | — |
| product:write | A | A | B | — | B | — | — |
| quotation:read / write | A | A | B | B (write O) | B (R) | A (R) | B (R) |
| quotation:approve-discount | A | A | B (≤ limit) | — | — | — | — |
| booking:read | A | A | B | B | B | A (R) | B (R) |
| booking:write | A | A | B | O | B | — | — |
| booking:cancel / amend | A | A | B | O (request only) | B | — | — |
| invoice:read | A | A | B | B | B (R) | A | — |
| invoice:issue / creditnote:issue | A | A | B | — | — | A | — |
| payment:record (customer receipts) | A | A | B | B | — | A | — |
| refund:request | A | A | B | O | B | A | — |
| refund:approve (finance:approve) | A | A | B (≤ limit) | — | — | A | — |
| supplierbill / supplierpayment:write | A | A | B | — | B (bill only) | A | — |
| expense:write | A | A | B | — | — | A | — |
| report:operational | A | A | B | O | B | A | B |
| report:financial | A | A | B | — | — | A | — |
| ledger:read / ledger:post | A | A (R) | — | — | — | A | — |
| document:read / write | A | A | B | B | B | A | B (R) |
| audit:read | A | A | B | — | — | A | — |
| ai:use | A | A | B | B | B | A | — |
| integration:manage | A | A | — | — | — | — | — |

---

## 5. Agency onboarding, settings, branding, branches, currencies and locale

### 5.1 Onboarding flow
1. Visitor signs up: name, email, password, agency legal name, country (default `SA`), preferred language.
2. Email verification (AUTH-05).
3. Tenant created on a trial plan (§19); user becomes `OWNER`; a default branch "Head Office" is created.
4. Setup checklist on the dashboard (each item links to its settings page and shows done/not done from real data):
   - Agency profile and legal details (CR number, VAT number, address).
   - Logo and colors.
   - Tax settings.
   - Branches.
   - Invite team.
   - First supplier, first customer, first booking (Phase 2+).
- `ONB-01` A tenant cannot issue invoices until legal name, VAT registration status, address and invoice numbering are complete (validated on `invoice:issue`).
- `ONB-02` Tenant `slug` (URL-safe, unique, 3–40 chars) is chosen at signup and used only for display and public links, never for authorization.

### 5.2 Agency profile
Fields: legal name (ar, en), trade name (ar, en), commercial registration (CR) number, VAT registration number (15 digits, KSA format: starts and ends with `3` — validated only when country = SA), tourism licence number (free text), address (building number, street, district, city, postal code, additional number, country — KSA national address format), phone, email, website.

### 5.3 Branding
- Logo (PNG/SVG/JPEG ≤ 1 MB, SVG sanitized or rasterized on upload), primary color (validated for WCAG AA contrast against white text; reject otherwise), document footer text (ar/en).
- Branding applies to PDFs (quotations, invoices, vouchers, itineraries) and emails. The app UI keeps the product design; only logo and accent color change.

### 5.4 Branches
- Fields: name (ar/en), code (unique per tenant, 2–10 chars), address, phone, email, timezone override (optional), active flag.
- `BR-01` A tenant always has at least one active branch.
- `BR-02` Every booking, quotation, invoice, payment and expense has a `branchId`. Default is the user's primary branch.
- `BR-03` Archiving a branch is blocked while it has open bookings or unpaid invoices.
- `BR-04` Number of branches is limited by plan (§19).

### 5.5 Currencies and exchange rates
- `CUR-01` Base currency set at tenant creation (default `SAR`). It MUST NOT change after the first financial document is issued.
- `CUR-02` Enabled transaction currencies chosen from ISO 4217 (`Currency` global table with code, decimal places, symbol).
- `CUR-03` Exchange rates are entered manually per tenant (`ExchangeRate`: from, to, rate `NUMERIC(20,10)`, effective date). An FX provider is an optional integration (§18).
- `CUR-04` Every monetary document in a foreign currency stores the rate used and the base-currency amount at the time of the document (snapshot). Reports use the snapshot, never today's rate.
- `CUR-05` SAR ↔ USD default rate MAY be pre-filled as 3.75 (official peg) and is editable.

### 5.6 Locale, time and formats
- `LOC-01` Tenant default language (`ar` or `en`), user override.
- `LOC-02` Tenant timezone (IANA, default `Asia/Riyadh`). All `timestamptz` values are stored in UTC and displayed in tenant timezone (branch override where set).
- `LOC-03` Date-only business values (travel dates, check-in, date of birth, passport expiry) are stored as `DATE` and never converted between timezones.
- `LOC-04` Week starts Sunday by default (configurable). Weekend default Friday–Saturday (affects reminders and due-date calculations only when configured).
- `LOC-05` Optional Hijri (Umm al-Qura) display alongside Gregorian dates, using the platform `Intl.DateTimeFormat` with `-u-ca-islamic-umalqura`. Storage is always Gregorian.
- `LOC-06` Numbers display with Western Arabic digits (0–9) by default in both languages; Eastern Arabic digits are a user preference.
- `LOC-07` Phone numbers stored in E.164, validated with `libphonenumber-js`, default region SA.

### 5.7 Tax settings
- `TAX-01` Tax registration status: registered / not registered. If registered: VAT number, registration date.
- `TAX-02` Tax rates table per tenant: code, name (ar/en), rate `NUMERIC(7,4)`, category (`STANDARD`, `ZERO_RATED`, `EXEMPT`, `OUT_OF_SCOPE`), ZATCA category code (S, Z, E, O), exemption reason code/text where required, active flag. Seeded for KSA with VAT 15% standard, 0% zero-rated, exempt and out-of-scope.
- `TAX-03` Default tax treatment per service type (flight, hotel, …) and per tax basis (`FULL_AMOUNT` or `SERVICE_FEE_ONLY`), editable by the tenant. **Seeded defaults MUST be reviewed by a KSA tax adviser before go-live**; travel services have specific VAT treatment (e.g. international transport, services consumed outside KSA, agent-vs-principal) that the software must not decide on the tenant's behalf. **[EXTERNAL: tax review]**
- `TAX-04` Prices can be entered tax-inclusive or tax-exclusive (tenant default, overridable per document). Tax is computed per line and rounded per line to the currency's decimal places using half-up rounding; document totals are sums of rounded lines.

### 5.8 Document numbering
- `NUM-01` Per-tenant, per-series sequences stored in `NumberSequence` (tenantId, series, year, prefix, nextValue). Series: `BOOKING`, `QUOTATION`, `INVOICE`, `CREDIT_NOTE`, `RECEIPT`, `REFUND`, `SUPPLIER_PAYMENT`, `EXPENSE`.
- `NUM-02` Numbers are allocated inside the same transaction that creates the document, using `UPDATE … RETURNING` on the sequence row (row lock). This makes invoice numbers gapless and strictly increasing per series, as ZATCA requires.
- `NUM-03` Format default `{PREFIX}-{YYYY}-{seq:6}` (e.g. `INV-2026-000042`). Prefix configurable before first use of the series; immutable afterwards.
- `NUM-04` Draft documents have no number. A number is assigned on issue/confirm.

---

## 6. Customer CRM

### 6.1 Customers
- Types: `INDIVIDUAL`, `CORPORATE`.
- Common fields: display name, name (ar/en), customer code (per-tenant sequence or manual, unique per tenant), lifecycle stage (`LEAD`, `ACTIVE`, `INACTIVE`), source (walk-in, phone, website, referral, social, corporate, other), owner (user), branch, preferred language, phone (E.164), email, address, tags, notes, marketing consent (with timestamp and source), credit limit (corporate), payment terms in days (corporate), VAT number (corporate, required for B2B standard tax invoices), CR number (corporate).
- Individual extras: first/last name (ar/en), gender, date of birth, nationality (ISO 3166-1 alpha-2).
- `CRM-01` Duplicate detection on create: same phone (E.164) or same email (case-insensitive) within the tenant shows a warning with a link; user can continue. Not a unique constraint, because families share contact details.
- `CRM-02` Customer code unique per tenant (`@@unique([tenantId, code])`).
- `CRM-03` Customers can be merged (admin/branch manager): all references move to the surviving record inside one transaction; the merged record is archived with `mergedIntoId`; audit logged.
- `CRM-04` Archiving a customer hides it from pickers but keeps history.
- `CRM-05` Customer balance (receivable) is computed from invoices, credit notes, payments and refunds, shown on the profile, never stored as an editable field.

### 6.2 Contacts (corporate customers)
Name, job title, phone, email, is-primary, receives-invoices flag. At most one primary contact per customer (partial unique index).

### 6.3 Travelers
- Fields: first/middle/last name as in passport (Latin, required for international travel), Arabic name (optional), title (MR, MRS, MS, MSTR, MISS), gender, date of birth, nationality, phone, email, frequent flyer numbers (airline code + number), meal and seat preferences, special assistance notes.
- A traveler belongs to one customer (`customerId`); an individual customer can be linked to "self" traveler.
- `CRM-06` Passenger type derived from date of birth at travel date: ADT (≥12), CHD (2–11), INF (<2).

### 6.4 Travel documents (sensitive)
- Types: `PASSPORT`, `NATIONAL_ID`, `IQAMA` (resident ID), `VISA`, `OTHER`.
- Fields: type, number (**encrypted**, §23.3), issuing country, nationality, issue date, expiry date, holder name as printed, scan (Document link, §14), verified-by and verified-at.
- `CRM-07` Document numbers are stored encrypted and displayed masked (`•••••1234`). Revealing the full number requires `traveldoc:reveal` and writes an audit entry (`TRAVELDOC_REVEALED`).
- `CRM-08` Searchable by a keyed hash (HMAC-SHA-256 with a server secret) of the normalized number, so "find traveler by passport" works without decrypting.
- `CRM-09` Validation: passport number 5–20 alphanumeric; Saudi National ID 10 digits starting with `1`; Iqama 10 digits starting with `2`; expiry after issue.
- `CRM-10` Warnings: passport expires within 6 months of the trip's return date (configurable); missing passport for international flight items.

### 6.5 Communication history (interactions)
- Interaction record: customer, optional booking/quotation, channel (`CALL`, `EMAIL`, `WHATSAPP`, `SMS`, `MEETING`, `NOTE`, `OTHER`), direction (in/out), subject, body (plain text ≤ 10,000 chars), occurredAt, user, attachments.
- `CRM-11` Interactions are logged manually in v1. Emails sent by the system (quotation sent, invoice sent) are logged automatically. Inbound email/WhatsApp capture is an integration (§18).
- `CRM-12` Customer timeline merges interactions, quotations, bookings, invoices, payments, tasks and audit events in reverse chronological order, paginated.

### 6.6 Follow-ups
Follow-ups are Tasks (§16) linked to a customer, quotation or booking, with due date and assignee. Quotations auto-create a follow-up task when sent (configurable offset, default 2 days).

### 6.7 Customer documents
Any customer, traveler or booking can have attached documents (§14). Travel document scans are stored with `sensitivity = HIGH`.

---

## 7. Travel products and services

### 7.1 Service types
Every booking item and quotation item has one `serviceType`:

| Type | Type-specific details (stored in `details` JSONB, validated by a Zod discriminated union) |
|---|---|
| `FLIGHT` | Segments: marketing carrier (IATA 2-char), flight number, operating carrier, origin/destination (IATA 3-letter airport), departure/arrival local date-time + airport timezone, cabin, booking class, fare basis, baggage allowance, terminal; PNR / airline locator; ticket numbers per passenger (13 digits); trip type (one-way, return, multi-city); fare breakdown (base fare, taxes, YQ/YR) |
| `HOTEL` | Hotel name, supplier hotel code, city, country, address, star rating, check-in/check-out dates, rooms (room type, board basis RO/BB/HB/FB/AI, occupancy adults/children with ages), cancellation policy text and deadline, special requests |
| `TRANSFER` | Pickup/drop-off location and datetime, vehicle type, passengers count, flight reference, private/shared |
| `TOUR` | Tour/activity name, date, start time, duration, meeting point, language, inclusions |
| `PACKAGE` | Package name, start/end dates, components (references to other items in the same booking or free-text inclusions), destinations |
| `VISA` | Destination country, visa type (tourist, business, transit, Umrah — see §28), entries, validity, processing time, application status (`NOT_STARTED`, `DOCUMENTS_PENDING`, `SUBMITTED`, `APPROVED`, `REJECTED`), application reference, visa number on approval |
| `INSURANCE` | Insurer, policy number, coverage, start/end dates |
| `OTHER` | Free-text description, dates |

- `SVC-01` Common item columns (not in JSON, for querying and reporting): serviceType, supplierId, description, startDate, endDate, status, supplier confirmation number, cost/sell/tax amounts, currency, quantity.
- `SVC-02` The Zod schema for `details` is versioned (`detailsVersion` integer). Old versions stay readable; writes use the current version.
- `SVC-03` Reference data for IATA airline and airport codes is a seeded global table (`Airport`: IATA code, name, city, country, IANA timezone; `Airline`: IATA code, name). Data source must have a licence permitting redistribution **[DECISION D-09]**; OpenFlights/OurAirports public-domain datasets are candidates.

### 7.2 Product catalog
- `Product`: tenant-defined reusable services (tours, packages, transfers, visa services, other). Fields: type, code, name (ar/en), description (ar/en), default supplier, default cost, default sell price, currency, tax rate, pricing model, active flag, validity dates, images (Documents).
- `SVC-04` Flights and hotels are not catalog products (prices are always per booking), but hotels can be saved as `Supplier` records with `supplierType = HOTEL` for reuse.
- `SVC-05` Adding a catalog product to a quotation/booking copies its values into the item (snapshot). Later catalog changes do not change existing items.
- `SVC-06` Packages: a package product lists component products with quantities; adding it creates one `PACKAGE` item plus optional component items for supplier-cost tracking. The customer sees one package price; costs are tracked per component.

### 7.3 Pricing model per item
- `pricingModel`: `NET` (agency buys at net cost and adds markup) or `COMMISSIONABLE` (agency sells at supplier's gross price and earns a commission).
- Amounts per item: `costAmount` (what the agency owes the supplier), `sellAmount` (what the customer pays, before tax), `commissionAmount` (receivable from supplier for commissionable items, or deducted from cost), `serviceFeeAmount` (agency's own fee line), `taxAmount`, `discountAmount`.
- `SVC-07` Gross margin per item = sellAmount + serviceFeeAmount + commissionAmount − costAmount − discountAmount (all in base currency via snapshot rate). Shown to users with `report:financial` or booking owners; hidden from `VIEWER`.
- `SVC-08` Selling below cost or discount above the tenant's threshold (percentage, default 10%) requires `quotation:approve-discount` (§10.4).

---

## 8. Booking lifecycle

### 8.1 Booking record
Fields: booking reference (NUM-01, e.g. `BK-2026-000123`), customer, branch, owner (user), source quotation (optional), status, travel start/end date (derived from items, stored for indexing), destination summary, currency, totals (derived and stored for listing: sell, cost, tax, paid, balance — recalculated in the same transaction as any item/payment change), notes (internal), customer notes (printed), tags, `version` (optimistic lock).

### 8.2 Booking statuses
```
DRAFT ──confirm──► CONFIRMED ──(all items issued/vouchered)──► ISSUED ──(end date passed, job)──► COMPLETED
  │                    │                                          │
  │                    └──────────────── cancel ──────────────────┴──► CANCELLED
  └── delete (only if never confirmed, no payments) / cancel ──► CANCELLED
ON_HOLD: optional state between DRAFT and CONFIRMED when any item is held/on request with a deadline.
```
| Status | Meaning |
|---|---|
| `DRAFT` | Being built. Already has its reference (BKG-01) so staff can quote it to suppliers. |
| `ON_HOLD` | At least one item is `HELD`/`ON_REQUEST` with an option/ticketing deadline. |
| `CONFIRMED` | Customer confirmed; all items `CONFIRMED` or later. |
| `ISSUED` | All non-cancelled items are `ISSUED` (tickets, vouchers, visas delivered). |
| `COMPLETED` | Travel end date passed and status was `ISSUED`/`CONFIRMED`. Set by a nightly job. |
| `CANCELLED` | All items cancelled. Terminal. |

- `BKG-01` Booking reference is assigned when the booking is created (including drafts) because operations staff use it with suppliers immediately. It is unique per tenant (`@@unique([tenantId, reference])`).
- `BKG-02` Allowed transitions are defined in one table in code (`bookingTransitions`) and enforced in the service. Any other transition returns `409 INVALID_STATE_TRANSITION`.
- `BKG-03` Every status change writes `BookingStatusHistory` (from, to, userId, reason, at) and an audit entry.
- `BKG-04` Booking status is partly derived: after any item status change, the service recomputes booking status by rule (e.g. all items cancelled ⇒ booking `CANCELLED`; any item held ⇒ `ON_HOLD` if booking not yet confirmed).

### 8.3 Booking item statuses
`REQUESTED` → `ON_REQUEST` (waiting supplier) → `HELD` (option with deadline) → `CONFIRMED` (supplier confirmation number recorded) → `ISSUED` (ticket/voucher/visa issued) → `CANCELLED` / `REFUNDED`; `FAILED` for supplier rejection.
- `BKG-05` `CONFIRMED` requires a supplier confirmation number or PNR (except `OTHER`). `ISSUED` on `FLIGHT` requires a ticket number for every passenger on the item.
- `BKG-06` `HELD` requires `optionDeadline` (timestamptz). A reminder task is created for the item owner at deadline − 24 h (configurable) and a dashboard alert lists items with deadlines in the next 48 h.
- `BKG-07` Manual status changes are records of what happened at the supplier. The UI MUST say "Mark as confirmed" (manual), never "Confirm with airline", unless a real integration performs the action (§18, §28).

### 8.4 Passengers
- `BookingPassenger`: snapshot of traveler data used for this booking (names, DOB, gender, nationality, passport number encrypted + hash, passport expiry), passenger type (ADT/CHD/INF), link to source `Traveler` (optional), lead passenger flag.
- `BookingItemPassenger`: which passengers are on which items, with per-passenger ticket number, seat, and per-passenger price split (optional).
- `BKG-08` A booking has exactly one lead passenger once it has passengers.
- `BKG-09` Editing a traveler's master record does not change existing bookings; the UI offers "update booking passenger from profile" explicitly.
- `BKG-10` Infants must be linked to an adult passenger on flight items (`infantOfPassengerId`), max one infant per adult.

### 8.5 Itinerary
- `BKG-11` The itinerary is generated from items, ordered by start date-time, grouped by day (in each segment's local timezone for flights; date-only for hotel stays). Not stored separately; rendered on demand.
- `BKG-12` Staff can add itinerary-only notes per day (`ItineraryNote`: date, text ar/en).
- `BKG-13` Itinerary PDF and customer-facing web view (signed, expiring link, no login, read-only, no sensitive data such as passport numbers) in Arabic or English.

### 8.6 Cancellations
- `BKG-14` Cancel a single item or the whole booking. Inputs: reason (required), supplier cancellation fee (cost side), agency cancellation fee (sell side), whether the supplier refunds anything (expected supplier refund amount).
- `BKG-15` Cancelling records the operational fact only. If the item was invoiced, the user is guided to issue a credit note (and, if money was received, a refund request) — the system computes suggested amounts: refundable to customer = paid for item − agency fee − non-refundable supplier fee as charged to customer.
- `BKG-16` A cancelled item keeps its original amounts for history; cancellation amounts are stored in `BookingItemCancellation`.
- `BKG-17` Cancelling a booking with `HELD` items creates a task reminding ops to release the hold at the supplier (unless an integration released it).

### 8.7 Amendments
- `BKG-18` Changes to a `CONFIRMED`/`ISSUED` booking (dates, passengers, items, prices) go through an amendment: `BookingAmendment` (number per booking, reason, changes JSON diff, supplier fee, agency fee, price difference, status `DRAFT`/`APPLIED`/`CANCELLED`, userId).
- `BKG-19` Applying an amendment updates the booking items in one transaction and records the diff. If the amendment increases the amount due on invoiced items, the user is offered a new invoice for the difference; if it decreases it, a credit note.
- `BKG-20` Edits to `DRAFT`/`ON_HOLD` bookings do not need amendments but are audit logged.

### 8.8 Concurrency and duplicates
- `BKG-21` Booking updates use optimistic locking: the client sends `version`; a mismatch returns `409 CONFLICT` with the current version, and the UI asks the user to reload.
- `BKG-22` `POST /bookings` and `POST /bookings/{id}/items` accept an `Idempotency-Key` header (§20.3). Repeated keys return the original response without creating a second booking.
- `BKG-23` Soft duplicate warning: same customer, same first item type and start date, created in the last 24 h.

---

## 9. Supplier management

### 9.1 Supplier record
Fields: type (`AIRLINE`, `CONSOLIDATOR`, `HOTEL`, `HOTEL_WHOLESALER`, `DMC`, `TRANSFER`, `TOUR_OPERATOR`, `VISA_SERVICE`, `INSURANCE`, `OTHER`), name (ar/en), code (unique per tenant), country, city, address, phone, email, website, VAT number, CR number, default currency, payment terms (days, or prepaid), bank details (IBAN — encrypted, masked display; validated with ISO 13616 checksum), notes, active flag, IATA code (airlines).

### 9.2 Supplier contacts
Name, role (reservations, accounts, sales, emergency), phone, email, primary flag.

### 9.3 Commission rules
- `SUP-01` `CommissionRule`: supplier, optional service type, optional product, rate (percentage `NUMERIC(7,4)`) or fixed amount + currency, valid from/to, notes. The most specific active rule pre-fills `commissionAmount` on new items; users can override.
- `SUP-02` Commission receivable from supplier is reported separately (supplier statement shows commission owed to the agency).

### 9.4 Supplier costs, bills and payments
- `SUP-03` Each booking item's `costAmount` is a commitment to the supplier. A `SupplierBill` (§11.6) records what the supplier actually invoiced and links to one or more booking items. Differences between committed cost and billed amount are shown as a variance.
- `SUP-04` Supplier balance (payable) = bills − supplier payments − supplier credit notes; computed, never edited.
- `SUP-05` Supplier statement report: opening balance, bills, payments, credits, closing balance for a date range, exportable.
- `SUP-06` Prepaid suppliers: payment can be recorded before the bill; it remains unallocated until a bill exists.

---

## 10. Sales: quotations, proposals, confirmations and follow-ups

### 10.1 Quotation
- Fields: quotation number (NUM-01, assigned on first send), version number, customer, branch, owner, status, valid-until date (default +7 days, configurable), currency, items (same shape as booking items incl. `details`), passengers count/summary, terms and conditions (ar/en, from tenant template), notes, totals (derived), discount, internal margin view.
- Statuses: `DRAFT` → `SENT` → `ACCEPTED` → `CONVERTED`; or `REJECTED`, `EXPIRED`, `SUPERSEDED`.
- `QT-01` Editing a `SENT` quotation creates a new version (copy with version+1, same number); the previous version becomes `SUPERSEDED`. All versions remain viewable.
- `QT-02` A nightly job marks `SENT` quotations past `validUntil` as `EXPIRED`.
- `QT-03` Converting an `ACCEPTED` quotation creates a booking in `DRAFT` with copied items and links `booking.quotationId`. Conversion is idempotent: a quotation can be converted only once (unique `quotationId` on Booking).
- `QT-04` Quotation prices are offers, not reservations. The PDF MUST state "Prices and availability are subject to confirmation at time of booking" (tenant-editable text, default present).

### 10.2 Proposals (customer-facing output)
- `QT-05` PDF and web view in Arabic (RTL) or English (LTR), tenant branding, itinerary summary, per-item descriptions, total per traveler type or grand total (tenant chooses whether per-item prices are shown), terms, validity.
- `QT-06` "Send" emails the PDF/link to the customer (requires a configured email provider, §18.1), logs an interaction and creates a follow-up task. If email sending fails, the quotation stays `DRAFT` and the error is shown; a "Mark as sent manually" action exists for quotations shared via WhatsApp/printing.
- `QT-07` Optional online acceptance: the web view has an "Accept" button that records acceptance (name, timestamp, IP) and moves the quotation to `ACCEPTED`. **[DECISION D-10]** whether this ships in Phase 3 or later.

### 10.3 Booking confirmation
- `QT-08` Booking confirmation document (PDF/email) generated from a `CONFIRMED` booking: reference, passengers, itinerary, confirmation numbers, amounts paid and due, payment instructions. Sending is logged.
- `QT-09` Vouchers per hotel/transfer/tour item with supplier confirmation number and emergency contact.

### 10.4 Discounts and approvals
- `QT-10` A quotation or booking whose discount exceeds the threshold or whose item sells below cost is flagged `requiresApproval`. It cannot be sent/confirmed until a user with `quotation:approve-discount` approves (records approver, time, comment). Approval is invalidated by any subsequent price change.

### 10.5 Follow-ups and pipeline
- `QT-11` Sales pipeline view (list grouped by quotation status) with value totals. Kanban drag-and-drop is optional UI sugar over the same status transitions.
- `QT-12` Lost reasons on `REJECTED` (price, availability, competitor, customer cancelled, other + text).

---

## 11. Invoices, receipts, payments, refunds, expenses and financial reporting

### 11.1 Money rules (apply everywhere)
- `FIN-01` Money is stored as PostgreSQL `NUMERIC(18,4)` with a sibling `currency CHAR(3)`. Documents round to the currency's decimal places (SAR 2) at the line level; 4 decimals give headroom for unit prices and FX conversion. Exchange rates use `NUMERIC(20,10)`.
- `FIN-02` In TypeScript, money is `Prisma.Decimal` (decimal.js). Native `number` arithmetic on money is forbidden. Lint cannot reliably detect it, so the rule is enforced by code review and by a single `money.ts` helper module (add, sub, mul, round, allocate) with unit tests. API JSON transports money as **strings** (`"1250.50"`).
- `FIN-03` Every document stores amounts in document currency plus `exchangeRate` and base-currency totals (CUR-04).
- `FIN-04` Financial documents are immutable after issue (FR-10). Their status changes (e.g. paid) are derived from allocations, not edits.
- `FIN-05` All writes that create or change financial documents run in a single database transaction together with their audit entry, sequence allocation and balance recalculation.

### 11.2 Invoices
- Types: `STANDARD` (B2B tax invoice, buyer has VAT number), `SIMPLIFIED` (B2C simplified tax invoice). Chosen automatically from the customer (corporate with VAT number ⇒ standard) and overridable before issue.
- Fields: number, type, issue date-time, supply date (or period), customer snapshot (name, address, VAT number — copied at issue), seller snapshot (tenant legal details), branch, booking (optional; an invoice may cover items of one booking, or be manual), currency, exchange rate, lines, totals (subtotal, discount, taxable amount, tax by category, total), notes, payment terms/due date, status, ZATCA fields (§13.3), PDF document.
- Lines: description (ar/en), booking item link (optional), quantity, unit price, discount, tax rate (snapshot: rate, category, ZATCA code, exemption reason), line net, line tax, line total.
- Statuses: `DRAFT` → `ISSUED`; payment status derived: `UNPAID`, `PARTIALLY_PAID`, `PAID`, `OVERPAID`; credited status derived: `NONE`, `PARTIALLY_CREDITED`, `FULLY_CREDITED`.
- `INV-01` Issuing assigns the number (NUM-02), freezes snapshots, generates the QR code (§13.3) and queues PDF generation, all in one transaction (PDF generation job runs after commit; the invoice is valid without the PDF file; the UI shows "PDF generating").
- `INV-02` A booking item can be invoiced at most once net of credit notes: the service prevents invoicing the same item twice (check `invoicedQuantity` per item inside the transaction with a row lock on the booking).
- `INV-03` Drafts are editable and deletable. Issued invoices cannot be edited, deleted or voided — only credited (§11.3).
- `INV-04` Due date = issue date + customer payment terms (default 0 = due on receipt).
- `INV-05` Invoice PDF is bilingual (Arabic and English side by side) for KSA tenants, as commonly expected for tax invoices; layout must include all mandatory fields from §13.3.
- `INV-06` Issuing requires ONB-01 completeness and, for `STANDARD` type, buyer name, buyer VAT number and buyer address.

### 11.3 Credit notes (and debit notes)
- `INV-07` Credit note references exactly one issued invoice, has a reason (required — ZATCA requires a reason for credit/debit notes), lines referencing the original lines, amounts not exceeding the remaining creditable amount per line.
- `INV-08` Debit notes (increase an issued invoice) are supported with the same structure. In v1 the UI offers "additional invoice" for increases; debit note support is **[DECISION D-11]**.
- `INV-09` Credit notes have their own number series and follow the same ZATCA flow as invoices.

### 11.4 Customer payments (receipts)
- Fields: receipt number, customer, branch, date, amount, currency, exchange rate, method (`CASH`, `BANK_TRANSFER`, `CARD_POS` (card terminal, recorded manually), `ONLINE_GATEWAY`, `CHEQUE`, `OTHER`), reference (transfer ref, POS approval code — never card number), financial account (cash box / bank account), notes, status (`RECORDED`, `REVERSED`).
- `PAY-01` A payment is allocated to one or more invoices (`PaymentAllocation`: invoice, amount). Unallocated remainder is a customer advance/credit balance, usable later.
- `PAY-02` Payments can be recorded against a booking before an invoice exists (deposit). They appear as unallocated customer credit linked to the booking and are auto-suggested for allocation when the booking's invoice is issued. VAT treatment of advance payments may require an invoice at receipt time under KSA rules — **[EXTERNAL: tax review]**; the tenant setting `issueInvoiceOnAdvancePayment` controls the prompt.
- `PAY-03` Sum of allocations ≤ payment amount; allocation to an invoice ≤ invoice outstanding amount. Enforced in the service inside a transaction with row locks on the payment and invoices.
- `PAY-04` A recorded payment cannot be edited. Mistakes are corrected by `REVERSED` (requires `finance:approve`, reason, creates reversal audit entry and releases allocations); the receipt number is never reused.
- `PAY-05` Online gateway payments are created only by verified gateway webhooks or verified server-side status checks (§18.3), never by a browser redirect alone.
- `PAY-06` Overpayment is allowed and shown as customer credit.
- `PAY-07` Receipt PDF (bilingual) available after recording.

### 11.5 Refunds
- Flow: `REQUESTED` → `APPROVED` → `PAID` (or `REJECTED`, `CANCELLED`).
- Fields: number, customer, booking (optional), related credit note (optional), amount, currency, method, reason, requested by, approved by, paid date, reference, financial account.
- `REF-01` Approval requires `refund:approve`; the requester cannot approve their own refund unless the tenant has only one user with that permission (setting `allowSelfApproval`, default false).
- `REF-02` Refund amount ≤ customer's available credit (payments − allocations − previous refunds) at approval time, checked in a transaction.
- `REF-03` Marking `PAID` records how and when money left. Gateway refunds go through the gateway adapter (§18.3) and become `PAID` only when the gateway confirms.

### 11.6 Supplier bills and supplier payments
- `SupplierBill`: supplier, supplier invoice number (unique per tenant+supplier), bill date, due date, currency, rate, lines (description, booking item link, amount, tax), total, attachment, status derived (`UNPAID`, `PARTIALLY_PAID`, `PAID`).
- `SupplierPayment`: number, supplier, date, amount, currency, rate, method, financial account, reference, allocations to bills, status (`RECORDED`, `REVERSED`).
- `FIN-06` Same allocation, immutability and reversal rules as customer payments.
- `FIN-07` Input VAT on supplier bills is recorded for the VAT summary report.

### 11.7 Expenses
- Fields: number, date, branch, category (tenant-defined list, seeded: rent, salaries, utilities, marketing, software, bank charges, government fees, other), description, amount, tax amount, tax rate, currency, financial account paid from, payee (free text or supplier), receipt attachment, booking link (optional, for booking-specific costs), status (`RECORDED`, `REVERSED`).
- `FIN-08` Expenses over a tenant-defined threshold require approval (`finance:approve`) before recording takes effect (`PENDING_APPROVAL` → `RECORDED`).

### 11.8 Financial accounts (cash and bank)
`FinancialAccount`: name, type (`CASH`, `BANK`, `GATEWAY_CLEARING`), currency, IBAN (encrypted), branch, active. Balance = opening balance + receipts − refunds − supplier payments − expenses ± transfers. `AccountTransfer` records moves between accounts (e.g. cash deposited to bank, gateway settlement to bank).

### 11.9 Financial reporting (operational finance, Phase 3)
All reports filter by date range, branch and currency, display in base currency using snapshot rates, and export to CSV/XLSX.
| Report | Content |
|---|---|
| Sales summary | Invoiced amounts net of credit notes by period, branch, staff, service type, customer |
| Gross margin | Sell vs cost vs commission per booking, item type, supplier, staff |
| Accounts receivable aging | Outstanding per customer in buckets 0–30, 31–60, 61–90, 90+ days past due |
| Accounts payable aging | Outstanding per supplier, same buckets |
| Customer statement | Opening balance, invoices, credit notes, payments, refunds, closing balance |
| Supplier statement | §9.4 SUP-05 |
| Cash & bank position | Balances and movements per financial account |
| Payments received | Receipts by method, account, staff |
| Expenses | By category, branch, period |
| VAT summary | Output VAT (invoices − credit notes) and input VAT (supplier bills, expenses) by tax category for a period. **Supports, does not replace, the VAT return; the tenant's accountant files the return.** |
| Profit overview | Gross margin − expenses for a period (operational estimate; not a statutory P&L — see §12) |

- `FIN-09` Reports run against the live database with tenant-scoped, indexed queries. Reports covering > 12 months or > 100k rows run as background jobs and deliver an export file (§15.4).

---

## 12. Accounting architecture

### 12.1 Two levels, clearly separated
| | Operational finance (Phase 3) | Accounting ledger (Phase 6) |
|---|---|---|
| Purpose | Run the agency day-to-day: who owes what, what is paid, margins, VAT summary | Produce double-entry books: trial balance, P&L, balance sheet, closed periods |
| Data | Business documents (§11) | Accounts, journal entries, journal lines, fiscal periods |
| Correctness rule | Document immutability + allocations | Every entry balances (Σdebit = Σcredit); posted entries immutable |
| Statutory use | Not statutory accounts | Can support statutory accounts if configured and reviewed by an accountant |
| Alternative | — | Export/sync to external accounting software (§18.6) instead of the internal ledger |

The product MUST NOT label operational reports as "Balance sheet" or "Profit & loss statement". Those names are reserved for ledger reports.

### 12.2 Ledger design (Phase 6)
- `ACC-01` `LedgerAccount`: code (unique per tenant), name (ar/en), type (`ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`), parent (tree), is-postable (leaf), currency (optional), system role (e.g. `AR_CONTROL`, `AP_CONTROL`, `VAT_OUTPUT`, `VAT_INPUT`, `CUSTOMER_ADVANCES`, `SALES_<SERVICE_TYPE>`, `COST_<SERVICE_TYPE>`, `COMMISSION_INCOME`, `FX_GAIN_LOSS`, `ROUNDING`), active.
- `ACC-02` Seeded chart of accounts template for a KSA travel agency (to be reviewed by an accountant **[EXTERNAL: accounting review]**); tenants can add accounts but cannot delete accounts with postings.
- `ACC-03` `JournalEntry`: number, date, period, source type/id (invoice, payment, …) or `MANUAL`, description, status (`DRAFT`, `POSTED`, `REVERSED`), postedBy/At, reversalOf. `JournalLine`: account, debit `NUMERIC(18,4)`, credit, currency, amount in currency, rate, branch, customer/supplier/booking dimension.
- `ACC-04` Database `CHECK` constraints: debit ≥ 0, credit ≥ 0, exactly one of debit/credit > 0 per line. A deferred constraint trigger verifies Σdebit = Σcredit per entry at commit.
- `ACC-05` Posting rules: one function per source document type maps the document to journal lines (e.g. issued invoice ⇒ Dr AR_CONTROL / Cr SALES_<type> / Cr VAT_OUTPUT). Rules are code, covered by unit tests with fixed examples, and run in the same transaction as the document once the ledger is enabled.
- `ACC-06` Enabling the ledger for a tenant with existing documents runs a backfill job that posts historical documents in date order, then compares control-account balances against operational balances and reports differences before activation.
- `ACC-07` Posted entries are immutable; corrections via reversing entry + new entry.
- `ACC-08` `FiscalPeriod` (monthly): `OPEN`, `CLOSED`. Posting into a closed period is rejected; documents dated in a closed period must be dated in the next open period or the period must be reopened by an owner (audit logged).
- `ACC-09` Ledger reports: trial balance, general ledger per account, P&L, balance sheet, all with branch filter.
- `ACC-10` FX: documents post at their snapshot rate. Revaluation of open foreign-currency balances is out of v1 scope (§28).

### 12.3 Reconciliation
- `ACC-11` Bank reconciliation (Phase 6): import bank statement CSV (configurable column mapping, per bank template) into `BankStatement`/`BankStatementLine`; match lines to receipts, refunds, supplier payments, expenses and transfers (suggested by amount ± date window ± reference; user confirms); unmatched items listed; reconciliation report per statement.
- `ACC-12` Gateway reconciliation: gateway settlement reports (API or CSV) matched to `ONLINE_GATEWAY` payments, fees recorded as expenses (bank charges).
- `ACC-13` Customer/supplier balance reconciliation: control-account balance must equal the sum of operational balances; a nightly job checks and raises an admin alert on mismatch.
- Bank feeds via open banking APIs are **[EXTERNAL]** and out of v1 scope.

---

## 13. Saudi-specific requirements

### 13.1 Language and direction
- `KSA-01` Full Arabic (RTL) and English (LTR) UI. `<html lang dir>` set per user language. Layout uses CSS logical properties (`margin-inline-start`, `ps-*`/`pe-*` utilities), never left/right, so one stylesheet serves both directions.
- `KSA-02` Icons that imply direction (arrows, chevrons, "back") flip in RTL; icons that do not (clock, checkmark, media play) do not flip.
- `KSA-03` Mixed-direction content (Latin names, PNRs, flight numbers, IBANs inside Arabic text) wrapped with `<bdi>` or `dir="ltr"` spans to prevent reordering.
- `KSA-04` Arabic font with good UI legibility (e.g. IBM Plex Sans Arabic or Noto Sans Arabic, self-hosted via `next/font`); PDFs embed the same font and must render Arabic shaping correctly (§24.8).
- `KSA-05` Business entities have bilingual name fields where customer-facing (tenant, branch, products, tax rates, invoice lines). Missing translation falls back to the other language.

### 13.2 Currency and VAT
- `KSA-06` Default base currency SAR (2 decimals). Amounts shown with the currency code or the official SAR symbol where the font supports it, else "SAR" / "ر.س".
- `KSA-07` VAT rate is data (TAX-02), never a constant in code. Seeded at 15% standard.
- `KSA-08` VAT registration number format check: 15 digits, first and last digit `3`.

### 13.3 ZATCA e-invoicing (FATOORA)
Background (verify against current ZATCA documentation before implementation): ZATCA e-invoicing has two phases. **Phase 1 (Generation)** requires electronic generation and storage of invoices with mandatory fields, and a QR code on simplified invoices. **Phase 2 (Integration)** requires taxpayers, in waves by revenue, to integrate their e-invoicing solution with the FATOORA platform: invoices in UBL 2.1 XML, cryptographic stamp, invoice hash chain, unique UUID and counter; standard (B2B) invoices are *cleared* by ZATCA before being given to the buyer; simplified (B2C) invoices are *reported* within 24 hours.

Design requirements:
- `ZAT-01` (Phase 3) Invoice data model contains every field needed for Phase 2 from day one, even if unused: invoice UUID (v4), invoice counter value (ICV, per-tenant per-device monotonic integer), previous invoice hash (PIH), invoice hash, invoice type code and transaction subtype flags (standard/simplified, third-party, nominal, export, summary, self-billed), issue date and time, supply date, currency, tax category codes per line, exemption reason codes, buyer/seller identification (VAT number, CR or other ID with scheme), national address fields, payment means code, credit/debit note reason and reference to the original invoice.
- `ZAT-02` (Phase 3) Phase 1-compliant output: bilingual tax invoice PDF with mandatory fields; simplified invoices carry the Phase 1 QR code: Base64 of TLV-encoded tags 1 seller name, 2 VAT number, 3 timestamp (ISO 8601), 4 invoice total with VAT, 5 VAT total. The TLV encoder is pure code with unit tests against ZATCA's published sample values.
- `ZAT-03` (Phase 3) Sequential numbering (NUM-02) and immutability (FR-10) satisfy the "no deletion/alteration" requirement; corrections via credit/debit notes with reason.
- `ZAT-04` (Phase 6, **[EXTERNAL]**) Phase 2 integration behind the `EInvoicingProvider` interface (§18.7):
  - Onboarding per tenant (and per "EGS unit" — the solution instance): generate CSR with required subject fields, obtain Compliance CSID using an OTP the taxpayer obtains from the FATOORA portal, pass compliance checks with sample documents, obtain Production CSID. Private keys encrypted at rest (§23.3).
  - For each invoice: build UBL 2.1 XML, compute hash, sign (XAdES as specified by ZATCA), extend QR with Phase 2 tags (hash, signature, public key, certificate signature), call clearance (standard) or reporting (simplified) API, store request/response, status (`PENDING`, `CLEARED`, `REPORTED`, `REJECTED`, `WARNING`), and the cleared XML returned by ZATCA.
  - Standard invoices MUST NOT be shared with the buyer until cleared. Simplified invoices are given immediately and reported within 24 h by a retrying background job.
  - Rejections surface to the accountant with ZATCA's error messages; fix by issuing a new document per ZATCA rules, never by editing the rejected one.
- `ZAT-05` Building Phase 2 in-house vs using a certified third-party e-invoicing middleware is **[DECISION D-04]**. Either way the `EInvoicingProvider` interface is the same.
- `ZAT-06` Sandbox/simulation environments of ZATCA are used for development and tests; production endpoints require the tenant's real onboarding. The system never presents an invoice as "cleared" unless ZATCA's response says so.
- `ZAT-07` E-invoice records (XML, PDF, hashes, ZATCA responses) are retained per KSA record-keeping rules (at least 6 years is commonly cited for VAT records — **[EXTERNAL: legal review]** to confirm) and cannot be deleted by tenants during that period, including on tenant cancellation (§23.6).

### 13.4 Saudi data and identity formats
- National address format (building number, street, district, city, postal code 5 digits, additional number 4 digits).
- Phone default region +966; mobile numbers `5XXXXXXXX`.
- National ID / Iqama formats per CRM-09.
- Commercial registration number: 10 digits (format validation only).

### 13.5 Privacy (PDPL)
- `KSA-09` The Saudi Personal Data Protection Law (PDPL) applies to processing personal data of individuals in KSA. Requirements that the software supports: purpose-limited collection, consent capture for marketing, data subject access/correction/deletion requests (§23.7), breach logging, retention limits, and controls on transferring personal data outside KSA. Hosting location and cross-border transfers (including to AI providers, §17.6) are **[DECISION D-05]** and **[EXTERNAL: legal review]**.

### 13.6 Hajj and Umrah
Umrah/Hajj services and visas are regulated (licensed operators, Nusuk platform). v1 treats them only as manually recorded `VISA`/`PACKAGE` items. Any integration requires licensing (§28).

---

## 14. Document management

### 14.1 Model
`Document`: tenantId, storage key, original filename (sanitized for display), MIME type (detected), size, SHA-256, sensitivity (`NORMAL`, `HIGH`), category (passport scan, ID, visa, ticket, voucher, invoice PDF, supplier invoice, receipt, contract, photo, other), owner entity (`entityType` + `entityId` — polymorphic link validated in the service against an allowlist of types), uploadedBy, scan status (`PENDING`, `CLEAN`, `INFECTED`, `FAILED`), expiresAt (retention), createdAt, archivedAt.

### 14.2 Upload rules
- `DOC-01` Allowed types: PDF, JPEG, PNG, WebP, HEIC (converted to JPEG on upload), DOCX, XLSX, CSV, TXT, EML. MIME type detected from file content (magic bytes via `file-type`), not from extension or client header. Mismatch ⇒ reject.
- `DOC-02` Max size 20 MB per file (configurable per plan); total storage limited by plan (§19).
- `DOC-03` Uploads go directly from browser to object storage using a **pre-signed POST** with size and content-type conditions, bound to a server-created `Document` row in `PENDING` state. The server finalizes the row after verifying the object (size, hash, magic bytes).
- `DOC-04` Malware scanning with ClamAV (sidecar container) in a background job. Files are not downloadable until `CLEAN`. `INFECTED` files are deleted from storage and the event audit logged. Scanner unavailable ⇒ files remain `PENDING` and the UI says so (no silent pass). Whether to allow download of `PENDING` files to the uploader is **[DECISION D-12]** (default: no).
- `DOC-05` Images are re-encoded server-side (strip EXIF/GPS metadata) before being marked clean. SVG uploads are allowed only for tenant logos and are sanitized.
- `DOC-06` Filenames never used as storage keys. Storage key = `tenants/{tenantId}/{yyyy}/{mm}/{documentId}`.

### 14.3 Access
- `DOC-07` Downloads go through `GET /api/v1/documents/{id}/download`, which checks tenant, permission on the owning entity and sensitivity, writes an access log entry for `HIGH` sensitivity, and redirects to a pre-signed GET URL valid ≤ 5 minutes with `Content-Disposition: attachment` (inline only for PDF/images in the viewer).
- `DOC-08` Object storage bucket is private; no public URLs. Tenant logos are served via the same mechanism with longer cache (public read of logos only through an app route).
- `DOC-09` `HIGH` sensitivity documents (passport/ID scans) require `traveldoc:read` to list and `traveldoc:reveal` to open.

### 14.4 Generated documents
PDFs generated by the system (quotations, invoices, receipts, vouchers, itineraries) are stored as `Document` rows with `generated = true` and regenerated only for drafts. Issued financial PDFs are generated once and kept (immutability).

### 14.5 Retention
- `DOC-10` Tenant setting: delete passport/ID scans N days after the last travel date of all bookings referencing the traveler (default 365, min 0 = never auto-delete is not allowed; max 3650). A nightly job deletes expired sensitive files and logs it. Financial documents follow ZAT-07.

---

## 15. Dashboard, analytics, operational reports and exports

### 15.1 Dashboard (role-aware)
- Phase 1: setup checklist, team members count, plan usage (users, branches, storage).
- Phase 2+: today's departures and returns, held items with deadlines in 48 h, bookings created this week, open tasks assigned to me, passport expiry warnings for upcoming trips.
- Phase 3+: sales this month vs last month, receivables outstanding and overdue, payments received this week, top customers, margin by service type, quotations pipeline value and conversion rate.
- `DSH-01` Every KPI tile links to the filtered list that produces its number. Numbers come from the same service queries as reports (one source of truth).
- `DSH-02` Financial tiles are hidden for users without `report:financial`.

### 15.2 Operational reports (Phase 4)
| Report | Content |
|---|---|
| Departures / arrivals | Passengers travelling in a date range with item details, contact phone |
| Bookings by status | Counts and values per status, branch, owner |
| Held items & deadlines | All `HELD`/`ON_REQUEST` items with deadlines |
| Missing documents | Bookings with international flights lacking passport data or with expiring passports |
| Visa applications | Visa items by status |
| Supplier performance | Bookings, cost and cancellations per supplier |
| Staff activity | Quotations, bookings, sales, conversion per user |
| Customer report | New customers, repeat rate, top customers by sales |

### 15.3 Analytics
Charts (line/bar) for sales and margin over time, service mix, branch comparison. Rendered client-side from report API data. No separate analytics warehouse in v1.

### 15.4 Exports
- `EXP-01` Every list and report exports to CSV (UTF-8 with BOM so Excel shows Arabic correctly) and XLSX (via `exceljs`). PDF export for reports is optional (D-19).
- `EXP-02` Exports respect the user's permissions, data scope and current filters. Masked fields stay masked; passport numbers are never exported unless the user has `traveldoc:reveal` and explicitly ticks "include document numbers" (audit logged).
- `EXP-03` Exports over 5,000 rows run as background jobs; the file is stored as a `Document` (expires after 7 days) and the user is notified.
- `EXP-04` CSV cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` to prevent formula injection.
- `EXP-05` Every export writes an audit entry (who, what, filters, row count).
- `EXP-06` Full tenant data export (owner only): JSON + CSV per entity + documents, as a background job (also used for offboarding, §19.5).

---

## 16. Employees, teams, branch permissions, tasks, reminders and activity history

### 16.1 Employees
v1 "employees" are tenant users (memberships) plus profile fields: job title, phone, employee code (unique per tenant, optional), primary branch, branch assignments, team memberships, active flag. HR features (payroll, leave, attendance) are out of scope (§28).
- `EMP-01` Deactivating a user: revokes sessions, removes from assignment pickers, keeps their name on historic records, reassigns open tasks and owned open bookings/quotations to a chosen user (required step if they own open items).
- `EMP-02` Deleting a membership is not allowed once the user has created any record; deactivate instead.

### 16.2 Teams
`Team`: name, branch (optional), lead user, members. Used for task assignment, report grouping and sales targets (targets optional, D-14).

### 16.3 Branch permissions
Branch scope per §4.6. A user's `BRANCH` scope covers `MembershipBranch` assignments. Changing assignments takes effect on the next request.

### 16.4 Tasks and reminders
- `Task`: title, description, type (`FOLLOW_UP`, `DEADLINE`, `DOCUMENT`, `PAYMENT`, `GENERAL`), status (`OPEN`, `IN_PROGRESS`, `DONE`, `CANCELLED`), priority, due at, remind at, assignee (user or team), linked entity (customer, quotation, booking, booking item, invoice, supplier), created by, completed by/at.
- `TSK-01` System-generated tasks: quotation follow-up (QT-06), held-item deadline (BKG-06), passport expiry (CRM-10), overdue invoice (configurable days after due date), visa application follow-up.
- `TSK-02` Reminders are notifications (§20.1) scheduled by the job system at `remindAt`. Changing `remindAt` reschedules (job keyed by task ID, idempotent).
- `TSK-03` "My tasks" view with overdue, today, upcoming; team view for leads and managers.

### 16.5 Activity history
- `ACT-01` Every entity detail page has an "Activity" tab showing audit entries for that entity (and its children, e.g. booking items), human-readable ("Sara changed status from Held to Confirmed"). Source: `AuditLog` (§20.5).
- `ACT-02` User activity view (admins): actions by a user over a date range.

---

## 17. AI capabilities

### 17.1 Principles
- `AI-01` AI never writes directly to bookings, customers, financial records or documents. AI produces **suggestions** stored in `AiSuggestion`; a user reviews, edits and applies them; applying calls the same services and validation as manual entry.
- `AI-02` Every AI-filled field is labeled "AI suggestion — unverified" in the UI until the user confirms it. Records created from AI suggestions store `sourceAiSuggestionId` and `verifiedById`/`verifiedAt`.
- `AI-03` AI is optional per tenant (`ai.enabled`, default off until the owner accepts AI terms including data processing location). Plan entitlements cap usage (§19).
- `AI-04` All AI calls go through one server module `src/server/ai/` exposing a provider interface (`extract`, `chat`), so the provider can be changed. Default provider: Anthropic Claude via the official SDK, model configured by env `AI_MODEL` (e.g. `claude-sonnet-5-5`). Requires an API key **[EXTERNAL]**.
- `AI-05` Each call is logged in `AiUsage` (tenant, user, feature, model, input/output tokens, latency, status) — not the full prompt by default; prompt/response logging for debugging is off by default and, when on, is retained ≤ 30 days.
- `AI-06` Model output is parsed with strict Zod schemas (structured output / tool-use JSON). Unparseable or schema-invalid output ⇒ suggestion status `FAILED` with a readable error; never partially applied.
- `AI-07` Prompt-injection posture: document contents and user messages are untrusted data. The model gets no tools that mutate state; read tools are tenant-scoped (§17.5). Instructions found inside documents are ignored by design because the model cannot act on them.

### 17.2 Document extraction
Inputs: uploaded PDF/image (`CLEAN` only). Extraction kinds and target schemas:
| Kind | Output |
|---|---|
| `PASSPORT` | Names, nationality, DOB, gender, document number, issue/expiry dates, issuing country. MRZ check-digit validation performed in code (ICAO 9303) on the extracted MRZ; mismatch flags the suggestion. |
| `SUPPLIER_INVOICE` | Supplier name/VAT number, invoice number, dates, currency, lines, tax, total. Code checks Σlines + tax = total. |
| `ITINERARY` / `TICKET` / `E-TICKET RECEIPT` | Passengers, PNR, ticket numbers, flight segments (carrier, number, airports, times), fare. Code validates IATA codes against reference tables and ticket number format. |
| `HOTEL_VOUCHER` | Hotel, dates, rooms, board, confirmation number. |
| `RECEIPT` (expense) | Payee, date, amount, VAT, category guess. |

- `AI-08` Review screen: original document beside the extracted form; each field shows confidence/validation flags; user edits and clicks "Apply" to create/update the target record via normal services (creating draft records only, e.g. draft supplier bill, draft booking items, traveler with document). The applied record still needs normal confirmation steps (e.g. issuing).
- `AI-09` Suggestions have statuses `PENDING`, `READY_FOR_REVIEW`, `APPLIED`, `REJECTED`, `FAILED`, and expire (deleted) after 30 days if not applied.
- `AI-10` Passport extraction is allowed only if the tenant explicitly enables "send identity documents to AI provider" (separate from `ai.enabled`), because it transfers sensitive data to a third party (§13.5).

### 17.3 Booking assistance
- `AI-11` In a booking or quotation, the assistant can: summarize the booking, draft a customer email/WhatsApp message (ar/en), suggest an itinerary description from items, list missing information (passports, ticket numbers, unpaid balance), parse free-text requests ("2 adults 1 child Riyadh–Kuala Lumpur 10–20 Dec, 4* hotel") into a draft quotation structure for review.
- `AI-12` The assistant MUST NOT claim availability, prices or confirmations from suppliers. Any price it shows comes from records in the system, labeled with their source.

### 17.4 Customer-service assistance
- `AI-13` Draft replies for staff from the customer's history (bookings, payments, documents status). Staff send the reply themselves; the assistant has no send capability.
- `AI-14` FAQ-style answers grounded in tenant-provided policy text (cancellation policy, visa document checklists), cited by section. No external web browsing in v1.

### 17.5 Natural-language reporting
- `AI-15` Users ask questions ("sales by branch last quarter", "which customers owe more than 10,000 SAR"). The model selects from a fixed set of **report tools** (the same tenant-scoped report service functions from §11.9/§15.2 with typed parameters). **No model-generated SQL is executed.**
- `AI-16` Results show the tool used and parameters ("Sales summary, 2026-07-01 to 2026-09-30, grouped by branch") with a link to open the standard report, so numbers are verifiable. The user's permissions and data scope apply to every tool call.

### 17.6 Data protection for AI
- `AI-17` Data sent to the AI provider is the minimum for the task. Passport numbers are masked in assistant contexts (only extraction sees them, AI-10). Provider must be configured with zero/limited data retention where the contract allows **[EXTERNAL: provider agreement]**.
- `AI-18` Location of AI processing relative to KSA data-residency obligations is part of D-05.

---

## 18. External integrations

### 18.1 General integration rules
- `INT-01` Each integration is an adapter implementing a small TypeScript interface in `src/server/integrations/<area>/`. Business code depends on the interface only.
- `INT-02` Each adapter has a `NotConfigured` state. If credentials are missing, features depending on it are visibly disabled ("Email sending is not configured") — never faked. A `Fake` adapter exists **only for automated tests and local development**, is selected by `NODE_ENV=test` or an explicit `*_PROVIDER=fake` env var, and the UI shows a persistent "TEST MODE — no real messages/payments" banner whenever any fake adapter is active. Production builds refuse to start if any `*_PROVIDER=fake` is set.
- `INT-03` Tenant-level credentials (e.g. a tenant's own payment gateway keys) are stored in `IntegrationConnection` with secrets encrypted (§23.3), write-only in the UI (never displayed back; show last 4 chars).
- `INT-04` Platform-level credentials (e.g. platform email provider) come from environment variables / secret manager only.
- `INT-05` Outbound calls have timeouts (default 15 s), retries with exponential backoff for idempotent operations only, and circuit-breaking via job retries (no in-process circuit breaker library in v1).
- `INT-06` Inbound webhooks: verify signature (HMAC or provider scheme) with constant-time compare, reject stale timestamps (> 5 min) where supported, store raw event in `WebhookEvent` with unique `(provider, externalEventId)` for idempotency, acknowledge fast (2xx after storing), process in a background job.

### 18.2 Email and notifications
| Interface | `EmailSender.send({to, subject, html, text, attachments, tags})` |
|---|---|
| Providers | SMTP (generic, works with most providers), Amazon SES, Postmark/Resend — choose one for production **[DECISION D-06]** |
| Local dev | Mailpit container (real SMTP capture, not a fake) |
| Requirements | SPF/DKIM/DMARC for the sending domain **[EXTERNAL: DNS access]**; per-tenant "reply-to" set to tenant email; bounce/complaint webhook marks addresses as undeliverable |

SMS: `SmsSender.send({to, body})`. KSA providers (e.g. Unifonic, Taqnyat, Msegat). Sender IDs must be registered with the Saudi regulator (CST) **[EXTERNAL]**.
WhatsApp: WhatsApp Business Platform (Cloud API) via Meta or a BSP; requires business verification and approved message templates **[EXTERNAL]**. v1 MAY instead offer "open in WhatsApp" (`wa.me` link with prefilled text), which needs no integration.

### 18.3 Payment gateways
| Interface | `PaymentGateway.createPaymentLink({invoiceId|bookingId, amount, currency, customer, returnUrl, idempotencyKey})`, `getPaymentStatus(externalId)`, `refund({externalId, amount, idempotencyKey})`, `verifyWebhook(req)` |
|---|---|
| KSA candidates | Moyasar, HyperPay, Tap Payments, PayTabs, Checkout.com (support mada, Visa/Mastercard, Apple Pay, STC Pay per provider) **[EXTERNAL: merchant contract, SAMA-licensed provider]** |
| Card data | Hosted payment page or provider-hosted fields only. The platform never receives, stores, logs or transmits PAN/CVV. This keeps PCI DSS scope at SAQ A (confirm with the provider). |
| Flow | Create `PaymentIntent` row (`PENDING`) with idempotency key → redirect customer to gateway → on webhook (or server-side status poll after return), verify amount/currency/status with the gateway API → create `Payment` (`ONLINE_GATEWAY`) and allocations in one transaction. Browser return alone never marks paid (PAY-05). |
| Reconciliation | ACC-12 |

### 18.4 Flight distribution (GDS / NDC)
- **[EXTERNAL]** Amadeus, Sabre, Travelport (GDS) and airline NDC APIs require commercial agreements, often IATA accreditation (for ticketing via BSP) and certification. Self-service developer sandboxes are not production access.
- Interface (Phase 6+, only once a contract exists): `FlightProvider.search(criteria)`, `price(offerId)`, `book(offer, passengers, idempotencyKey)`, `retrieve(pnr)`, `cancel(pnr)`, `issueTicket(pnr)` (only if contract permits), `void/refund`.
- Until then: manual entry of flight items, and **PNR import by paste**: staff paste GDS screen output or e-ticket text; a parser (and/or AI extraction §17.2) produces a reviewed suggestion. This is labeled "imported from text", not "synced with GDS".
- Search results from a real provider are offers with expiry; the UI shows the expiry and re-prices before booking.

### 18.5 Hotel suppliers
- **[EXTERNAL]** Bedbanks/wholesalers (e.g. Hotelbeds, WebBeds, Expedia Rapid, RateHawk) require contracts and certification.
- Interface: `HotelProvider.search`, `checkRate`, `book(idempotencyKey)`, `retrieve`, `cancel`. Booking via provider sets item status from the provider response only.
- v1: manual hotel items + supplier confirmation numbers.

### 18.6 Accounting integrations
- **[EXTERNAL]** Xero, QuickBooks Online, Zoho Books APIs (OAuth apps, tenant authorization).
- Interface: `AccountingExporter.syncContacts`, `syncInvoices`, `syncPayments` with mapping tables (`ExternalReference`: entityType, entityId, provider, externalId).
- Phase 6 baseline without credentials: CSV/XLSX export of invoices, credit notes, payments, supplier bills and journal entries in a documented column layout for import into accounting software.

### 18.7 E-invoicing (ZATCA Phase 2)
`EInvoicingProvider.onboard(tenant, otp)`, `submit(invoice) → {status, clearedXml?, warnings[], errors[]}`, `getStatus(id)`. See §13.3.

### 18.8 Other optional providers
FX rates (`FxRateProvider.getRates(base, date)`), address/geo lookups, virus scanning (ClamAV is self-hosted — no credential needed).

---

## 19. Subscription plans, tenant limits, feature entitlements and SaaS administration

### 19.1 Plans
`Plan` (global): code, name (ar/en), price per month/year, currency, active, entitlements JSON validated by Zod:
```
{ maxUsers, maxBranches, storageGb, maxBookingsPerMonth|null, aiCreditsPerMonth,
  features: { ai, zatcaPhase2, ledger, apiAccess, customBranding, paymentGateway, exportsXlsx } }
```
Seed plans (names/prices are business decisions, D-07): Trial (14 days), Starter, Professional, Enterprise.

### 19.2 Enforcement
- `SUB-01` `entitlements(ctx)` returns the effective entitlements (plan + per-tenant overrides set by platform admins). Checked server-side at the action that consumes the limit (invite user, create branch, upload, create booking, AI call), inside the same transaction where a count is involved.
- `SUB-02` Hitting a limit returns `402 PLAN_LIMIT_REACHED` with the limit name; UI explains and links to upgrade. Existing data is never deleted or hidden because of a downgrade; only creation of new items beyond the limit is blocked.
- `SUB-03` Feature flags disabled by plan hide the navigation entry and return `403 FEATURE_NOT_IN_PLAN` from the API.
- `SUB-04` Usage counters (`TenantUsage`: period, bookingsCreated, aiCredits, storageBytes) updated transactionally or by job; storage computed from `Document.size` sum.

### 19.3 Subscription lifecycle
`TRIALING` → `ACTIVE` → `PAST_DUE` (grace 14 days, full access, banner) → `SUSPENDED` (read-only: users can view and export, cannot create/modify) → `CANCELLED` (data retained 90 days, then deleted except legally retained records, §23.6).
- `SUB-05` Phase 1–5: subscription status managed manually by platform admin (invoices sent outside the system). Phase 6: automated billing via a billing provider **[DECISION D-07]** (Stripe Billing availability for the operator's entity, or a KSA gateway with recurring/tokenized payments such as Moyasar/Tap/HyperPay) **[EXTERNAL]**. The platform's own invoices to tenants must also be ZATCA-compliant if the operator is KSA VAT registered.

### 19.4 Platform administration
- `ADM-01` Platform console at `/admin` (separate layout), accessible only to `isPlatformAdmin` users with MFA (AUTH-07).
- `ADM-02` Features: list/search tenants, view tenant metadata (plan, status, usage, created date, owner email), change plan/overrides, suspend/reactivate, extend trial, view platform health (job queue depth, failed jobs, error rates), manage plans, platform announcements.
- `ADM-03` Platform admins cannot read tenant business data by default. "Support access" requires the tenant owner to grant time-limited access (default 24 h) from tenant settings; every action during support access is audit logged in the tenant's audit log with `actorType = PLATFORM_SUPPORT` and is visible to the tenant.
- `ADM-04` Platform admin actions are logged in a platform audit log.

### 19.5 Tenant offboarding
Owner can request cancellation and full data export (EXP-06). Deletion job after retention period removes tenant data and storage objects except records under legal retention (ZAT-07), which are kept in restricted storage until expiry.

---

## 20. Notifications, background jobs, retries, idempotency and audit logs

### 20.1 Notifications
- `NTF-01` Channels: in-app (bell + list, stored in `Notification`), email; SMS/WhatsApp when integrated.
- `NTF-02` Events: assigned task, task reminder, held-item deadline, quotation accepted, payment received (online), refund approval requested/decided, mention in note (optional), export ready, AI extraction ready, invitation accepted, plan limit approaching (80%), ZATCA rejection.
- `NTF-03` Per-user preferences per event and channel (in-app always on for critical events: deadlines, ZATCA rejections).
- `NTF-04` In-app notifications delivered by polling (every 60 s while the tab is visible) in v1. Real-time push (SSE/WebSocket) is optional later (D-15).
- `NTF-05` Customer-facing messages (quotation, invoice, confirmation emails) are templates per tenant per language with variables; preview before send.

### 20.2 Background jobs
- `JOB-01` A PostgreSQL-backed job table (`Job`: id, tenantId nullable, type, payload JSONB, status `QUEUED|RUNNING|SUCCEEDED|FAILED|DEAD`, runAt, attempts, maxAttempts, lastError, lockedAt, lockedBy, dedupeKey unique nullable, createdAt). Rationale: enqueueing happens **in the same transaction** as the business change (transactional outbox for free), no Redis to operate.
- `JOB-02` A separate worker process (same codebase, `node dist/worker.js`) claims jobs with `SELECT … FOR UPDATE SKIP LOCKED LIMIT n`, runs handlers with a timeout, and updates status. Multiple worker replicas are safe.
- `JOB-03` Retries: exponential backoff with jitter (e.g. 30 s × 2^attempt, max 6 h), default `maxAttempts` 8; then `DEAD` and an admin alert. Handlers MUST be idempotent (safe to run twice).
- `JOB-04` `dedupeKey` prevents duplicate scheduling (e.g. `task-reminder:{taskId}`).
- `JOB-05` Scheduled (cron-like) jobs: a scheduler loop in the worker inserts due recurring jobs with dedupe keys per period (e.g. `expire-quotations:2026-10-19`). Recurring jobs: expire quotations, complete bookings, deadline reminders, overdue invoice tasks, retention deletions, ZATCA reporting retries, session cleanup, idempotency-key cleanup, AI suggestion expiry, reconciliation checks.
- `JOB-06` Stuck job recovery: `RUNNING` jobs with `lockedAt` older than their timeout × 2 are returned to `QUEUED`.
- `JOB-07` Ceiling: suitable up to roughly hundreds of jobs per second. If exceeded, migrate to a dedicated queue (pg-boss or a broker) behind the same `enqueue()` function.
- `JOB-08` Job list visible to platform admins; tenant-visible job results appear as notifications or status fields on the related record (e.g. "PDF generating", "ZATCA: reporting failed, retrying").

### 20.3 Idempotency
- `IDM-01` `POST` endpoints that create bookings, booking items, quotations conversions, invoices (issue), payments, refunds, supplier payments, expenses and payment links accept `Idempotency-Key` (UUID). The UI always sends one per form submission.
- `IDM-02` `IdempotencyKey` table: tenantId, userId, key, method+path, request body SHA-256, status (`IN_PROGRESS`, `COMPLETED`), response status, response body, createdAt, expiresAt (24 h). Unique `(tenantId, userId, key)`.
- `IDM-03` Same key + same body ⇒ replay the stored response. Same key + different body ⇒ `422 IDEMPOTENCY_KEY_REUSED`. Same key while `IN_PROGRESS` ⇒ `409 REQUEST_IN_PROGRESS`.
- `IDM-04` The key row is inserted in the same transaction as the business change, so a crash cannot leave a "completed" key without its effect.
- `IDM-05` Outbound calls to providers pass our idempotency key where supported (payment gateways), derived from the business record ID.

### 20.4 Duplicate-safe references
Booking references and document numbers come from NUM-02 inside transactions; unique constraints `(tenantId, series number)` are the final guard. A unique-violation on retry is mapped to the idempotent replay or `409`.

### 20.5 Audit log
- `AUD-01` (from Phase 1) `AuditLog`: id, tenantId (nullable for platform events), actorType (`USER`, `SYSTEM`, `PLATFORM_SUPPORT`, `AI` — never alone for business changes), actorId, action (e.g. `booking.status_changed`, `invoice.issued`, `traveldoc.revealed`, `auth.login_failed`), entityType, entityId, parentEntityType/Id (e.g. booking for an item), changes JSONB (field: [old, new]; sensitive fields redacted as `"[redacted]"`), metadata (reason, ip, userAgent, requestId), createdAt.
- `AUD-02` Written in the same transaction as the change by the service layer (explicit `audit()` calls, not ORM magic, so actions have business meaning).
- `AUD-03` Append-only: the application DB role has `INSERT, SELECT` only on `AuditLog`; a trigger rejects `UPDATE`/`DELETE`. Partitioned by month (declarative partitioning) once volume warrants it (D-16).
- `AUD-04` Required audited events at minimum: auth events (login success/failure, logout, password reset, session revoke), membership/role changes, invitations, settings changes, every create/update/status change/delete of business entities, financial document issue/reverse/credit, approvals, sensitive data reveal, document downloads of `HIGH` sensitivity, exports, AI suggestion apply/reject, integration configuration changes, support access.
- `AUD-05` Retention: 7 years for financial events, 2 years for others (configurable upward), then deleted by job.

---

## 21. Database entities, relationships, indexes, constraints and migrations

### 21.1 Conventions
- PostgreSQL ≥ 16. Prisma schema in `prisma/schema.prisma`; models in PascalCase, tables mapped to snake_case (`@@map`), columns snake_case (`@map`).
- Primary key `id UUID` (v7 generated in application code).
- Every tenant-owned table: `tenant_id UUID NOT NULL`, `@@unique([tenantId, id])`, composite FKs `(tenant_id, x_id) → x(tenant_id, id)` (TEN-05), and an index starting with `tenant_id` for every list query.
- Timestamps: `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL` (Prisma `@updatedAt`), plus `created_by_id`, `updated_by_id` where users edit records.
- Soft archive: `archived_at timestamptz NULL` on master data. Financial documents have no archive/delete.
- Optimistic locking: `version INT NOT NULL DEFAULT 1` on Booking, Quotation, Customer, Supplier, drafts of financial documents.
- Enums: Prisma enums for stable sets (statuses, types). Tenant-configurable lists (expense categories, tags) are tables.
- Money: `Decimal @db.Decimal(18,4)`; rates `@db.Decimal(20,10)`; percentages `@db.Decimal(7,4)`.
- Encrypted fields: `bytea` columns named `*_enc`, with `*_hash` (HMAC) for lookups and `*_last4` for display.
- JSONB only for: service `details`, audit `changes`, job payloads, AI outputs, plan entitlements, integration config. Anything filtered/aggregated frequently gets a real column.

### 21.2 Global (non-tenant) tables
| Entity | Key fields | Constraints / indexes |
|---|---|---|
| `User` | email (citext), name, passwordHash, emailVerifiedAt, locale, isPlatformAdmin, mfaSecretEnc, mfaEnabledAt, lastLoginAt, disabledAt | unique(email) |
| `Session` | tokenHash, userId, activeTenantId?, ip, userAgent, createdAt, lastSeenAt, idleExpiresAt, absoluteExpiresAt, revokedAt | unique(tokenHash); index(userId) |
| `PasswordResetToken` / `EmailVerificationToken` | tokenHash, userId, expiresAt, usedAt | unique(tokenHash) |
| `Tenant` | slug, legalNameAr/En, tradeNameAr/En, country, baseCurrency, timezone, defaultLocale, status (`TRIALING`,`ACTIVE`,`PAST_DUE`,`SUSPENDED`,`CANCELLED`), crNumber, vatNumber, vatRegistered, address fields, logoDocumentId, primaryColor, settings JSONB (validated: numbering, tax-inclusive default, thresholds, retention days, session timeout, AI flags), planId, trialEndsAt | unique(slug) |
| `Plan` | code, nameAr/En, priceMonthly, priceYearly, currency, entitlements JSONB, active | unique(code) |
| `Currency` | code (PK, ISO 4217), decimals, symbol, nameAr/En | |
| `Country` | code (PK, ISO 3166-1 alpha-2), nameAr/En, dialCode | |
| `Airport`, `Airline` | IATA code (PK), names, city, country, timezone | |
| `Job` | §20.2 | index(status, runAt); unique(dedupeKey) where not null |
| `WebhookEvent` | provider, externalEventId, tenantId?, payload, signatureValid, receivedAt, processedAt, error | unique(provider, externalEventId) |
| `PlatformAuditLog` | actorId, action, target, metadata, createdAt | index(createdAt) |
| `RateLimitBucket` | key, windowStart, count | PK(key, windowStart) |

### 21.3 Tenant-owned tables (all include tenantId)
**Identity & organization**
| Entity | Key fields | Relationships | Constraints / indexes |
|---|---|---|---|
| `Membership` | userId, role, status (`ACTIVE`,`DEACTIVATED`), primaryBranchId, jobTitle, phone, employeeCode | User 1–n Membership n–1 Tenant | unique(tenantId, userId); unique(tenantId, employeeCode) where not null |
| `MembershipBranch` | membershipId, branchId | n–n Membership/Branch | PK(membershipId, branchId) |
| `Invitation` | email, role, branchIds, tokenHash, invitedById, expiresAt, acceptedAt, revokedAt | | unique(tokenHash); unique(tenantId, email) where pending |
| `Branch` | code, nameAr/En, address, phone, email, timezone?, active | | unique(tenantId, code) |
| `Team` / `TeamMember` | name, branchId?, leadMembershipId / teamId, membershipId | | unique(tenantId, name) |
| `NumberSequence` | series, year, prefix, nextValue | | unique(tenantId, series, year) |
| `TaxRate` | code, nameAr/En, rate, category, zatcaCode, exemptionReasonCode/Text, active | | unique(tenantId, code) |
| `ExchangeRate` | fromCurrency, toCurrency, rate, effectiveDate | | unique(tenantId, from, to, effectiveDate) |
| `IntegrationConnection` | provider, area, status, configJson, secretsEnc, lastCheckedAt, lastError | | unique(tenantId, area, provider) |
| `SupportAccessGrant` | grantedById, expiresAt, revokedAt | | |

**CRM**
| Entity | Key fields | Relationships | Constraints / indexes |
|---|---|---|---|
| `Customer` | type, code, displayName, nameAr/En, firstName, lastName, lifecycleStage, source, ownerId, branchId, phone, email, vatNumber, crNumber, address, creditLimit, paymentTermsDays, preferredLocale, marketingConsentAt/Source, notes, mergedIntoId, version, archivedAt | n–1 Branch, n–1 Membership(owner) | unique(tenantId, code); index(tenantId, phone); index(tenantId, lower(email)); trigram GIN index on displayName (pg_trgm) for search |
| `CustomerContact` | customerId, name, title, phone, email, isPrimary, receivesInvoices | n–1 Customer | unique(customerId) where isPrimary |
| `Traveler` | customerId, title, firstName, middleName, lastName, nameAr, gender, dateOfBirth, nationality, phone, email, preferences JSONB, frequentFlyer JSONB | n–1 Customer | index(tenantId, customerId); trigram index on names |
| `TravelDocument` | travelerId, type, numberEnc, numberHash, numberLast4, issuingCountry, nationality, issueDate, expiryDate, holderName, scanDocumentId, verifiedById, verifiedAt | n–1 Traveler | index(tenantId, numberHash); index(tenantId, expiryDate) |
| `Interaction` | customerId, bookingId?, quotationId?, channel, direction, subject, body, occurredAt, userId | | index(tenantId, customerId, occurredAt desc) |
| `Tag` / `CustomerTag` | name, color / customerId, tagId | | unique(tenantId, name) |

**Suppliers & catalog**
| Entity | Key fields | Constraints / indexes |
|---|---|---|
| `Supplier` | type, code, nameAr/En, country, city, contact fields, vatNumber, crNumber, defaultCurrency, paymentTermsDays, prepaid, ibanEnc, ibanLast4, iataCode, notes, active, archivedAt | unique(tenantId, code); trigram on name |
| `SupplierContact` | supplierId, name, role, phone, email, isPrimary | |
| `CommissionRule` | supplierId, serviceType?, productId?, ratePercent?, fixedAmount?, currency?, validFrom, validTo | CHECK(exactly one of ratePercent/fixedAmount) |
| `Product` | type, code, nameAr/En, descriptionAr/En, defaultSupplierId, defaultCost, defaultSell, currency, taxRateId, pricingModel, validFrom/To, active | unique(tenantId, code) |
| `ProductComponent` | packageProductId, componentProductId, quantity | |

**Sales & bookings**
| Entity | Key fields | Constraints / indexes |
|---|---|---|
| `Quotation` | number?, versionNo, rootQuotationId, customerId, branchId, ownerId, status, validUntil, currency, exchangeRate, totals (subtotal, discount, tax, total, cost), requiresApproval, approvedById/At, termsAr/En, lostReason, sentAt, acceptedAt, acceptance JSON, version | unique(tenantId, number, versionNo) where number not null; index(tenantId, status, validUntil); index(tenantId, customerId) |
| `QuotationItem` | quotationId, serviceType, productId?, supplierId?, description, startDate, endDate, quantity, costAmount, sellAmount, commissionAmount, serviceFeeAmount, discountAmount, taxRateId, taxAmount, currency, pricingModel, details JSONB, detailsVersion, sortOrder | index(quotationId) |
| `Booking` | reference, customerId, branchId, ownerId, quotationId?, status, travelStartDate, travelEndDate, destinationSummary, currency, totals (sell, cost, tax, total, paid, balance), notes, customerNotes, version | unique(tenantId, reference); unique(tenantId, quotationId) where not null; index(tenantId, status); index(tenantId, travelStartDate); index(tenantId, customerId); index(tenantId, branchId, createdAt desc) |
| `BookingItem` | bookingId, serviceType, productId?, supplierId, description, status, startDate, endDate, optionDeadline, supplierConfirmation, pnr, quantity, costAmount, sellAmount, commissionAmount, serviceFeeAmount, discountAmount, taxRateId, taxRateSnapshot JSON, taxAmount, currency, exchangeRate, pricingModel, details JSONB, detailsVersion, invoicedQuantity, sortOrder, sourceAiSuggestionId?, verifiedById? | index(tenantId, bookingId); index(tenantId, supplierId); index(tenantId, status, optionDeadline); index(tenantId, startDate) |
| `BookingPassenger` | bookingId, travelerId?, paxType, title, firstName, middleName, lastName, gender, dateOfBirth, nationality, docType, docNumberEnc, docNumberHash, docLast4, docExpiry, isLead, infantOfPassengerId? | unique(bookingId) where isLead |
| `BookingItemPassenger` | bookingItemId, bookingPassengerId, ticketNumber, seat, sellAmount? | PK(bookingItemId, bookingPassengerId); unique(tenantId, ticketNumber) where not null |
| `BookingStatusHistory` | bookingId, bookingItemId?, fromStatus, toStatus, reason, userId, createdAt | index(bookingId, createdAt) |
| `BookingItemCancellation` | bookingItemId, reason, supplierFee, agencyFee, expectedSupplierRefund, cancelledById, cancelledAt | unique(bookingItemId) |
| `BookingAmendment` | bookingId, number, reason, changes JSONB, supplierFee, agencyFee, priceDifference, status, appliedById/At | unique(bookingId, number) |
| `ItineraryNote` | bookingId, date, textAr, textEn | |

**Finance**
| Entity | Key fields | Constraints / indexes |
|---|---|---|
| `Invoice` | kind (`INVOICE`,`CREDIT_NOTE`,`DEBIT_NOTE`), type (`STANDARD`,`SIMPLIFIED`), number?, status, issuedAt, supplyDate, dueDate, customerId, customerSnapshot JSON, sellerSnapshot JSON, branchId, bookingId?, originalInvoiceId? (notes), reason?, currency, exchangeRate, subtotal, discount, taxableAmount, taxAmount, total, baseTotal, amountPaid, amountCredited, zatca fields (zatcaDeviceId, uuid, icv, pih, hash, qrPayload, zatcaStatus, clearedXmlDocumentId), pdfDocumentId, version (draft only) | unique(tenantId, kind, number) where number not null; unique(tenantId, zatcaUuid); unique(tenantId, zatcaDeviceId, icv) where icv not null; index(tenantId, customerId, issuedAt); index(tenantId, status, dueDate) |
| `InvoiceLine` | invoiceId, bookingItemId?, originalLineId?, descriptionAr/En, quantity, unitPrice, discount, taxRateSnapshot JSON, netAmount, taxAmount, totalAmount, sortOrder | index(invoiceId) |
| `Payment` | number, customerId, branchId, bookingId?, date, amount, currency, exchangeRate, baseAmount, method, reference, financialAccountId, status, reversedById/At, reversalReason, paymentIntentId? | unique(tenantId, number); index(tenantId, customerId, date) |
| `PaymentAllocation` | paymentId, invoiceId, amount, createdAt, releasedAt? | index(invoiceId); CHECK(amount > 0) |
| `PaymentIntent` | provider, externalId, invoiceId?, bookingId?, amount, currency, status, idempotencyKey, expiresAt | unique(tenantId, provider, externalId); unique(tenantId, idempotencyKey) |
| `Refund` | number, customerId, bookingId?, creditNoteId?, amount, currency, method, reason, status, requestedById, approvedById, paidAt, reference, financialAccountId | unique(tenantId, number) |
| `SupplierBill` / `SupplierBillLine` | supplierId, supplierInvoiceNumber, billDate, dueDate, currency, exchangeRate, totals, attachmentId / billId, bookingItemId?, description, amount, taxAmount | unique(tenantId, supplierId, supplierInvoiceNumber) |
| `SupplierPayment` / `SupplierPaymentAllocation` | number, supplierId, date, amount, currency, rate, method, financialAccountId, reference, status / paymentId, billId, amount | unique(tenantId, number) |
| `Expense` | number, date, branchId, categoryId, description, amount, taxAmount, taxRateId, currency, exchangeRate, financialAccountId, payee, supplierId?, bookingId?, receiptDocumentId, status, approvedById | unique(tenantId, number); index(tenantId, date) |
| `ExpenseCategory` | nameAr/En, active | unique(tenantId, nameEn) |
| `FinancialAccount` | name, type, currency, ibanEnc, branchId, openingBalance, active | |
| `AccountTransfer` | fromAccountId, toAccountId, date, amount, fee, reference | CHECK(from <> to) |
| `ZatcaSubmission` | invoiceId, attempt, requestHash, responseStatus, responseBody, status, submittedAt | index(invoiceId) |
| `ZatcaDevice` (EGS) | name, csrEnc, privateKeyEnc, complianceCsidEnc, productionCsidEnc, certificateExpiry, lastIcv, lastInvoiceHash, status | unique(tenantId, name) |

**Ledger (Phase 6)**: `LedgerAccount` (unique(tenantId, code)), `FiscalPeriod` (unique(tenantId, year, month)), `JournalEntry` (unique(tenantId, number); unique(tenantId, sourceType, sourceId, kind) to prevent double posting), `JournalLine` (CHECKs per ACC-04; index(tenantId, accountId, entryDate)), `BankStatement`, `BankStatementLine`, `ReconciliationMatch` (unique(statementLineId, targetType, targetId)), `ExternalReference` (unique(tenantId, provider, entityType, entityId)).

**Documents, tasks, notifications, AI, audit, idempotency**
| Entity | Key fields | Constraints / indexes |
|---|---|---|
| `Document` | §14.1 | unique(storageKey); index(tenantId, entityType, entityId); index(tenantId, expiresAt) |
| `DocumentAccessLog` | documentId, userId, action, ip, at | index(tenantId, documentId, at) |
| `Task` | §16.4 | index(tenantId, assigneeId, status, dueAt); index(tenantId, entityType, entityId) |
| `Notification` | userId, type, title, body, link, readAt, createdAt | index(tenantId, userId, readAt, createdAt desc) |
| `NotificationPreference` | userId, eventType, channel, enabled | unique(tenantId, userId, eventType, channel) |
| `MessageTemplate` | key, locale, subject, body | unique(tenantId, key, locale) |
| `AiSuggestion` | kind, documentId?, entityType?, entityId?, status, model, output JSONB, validation JSONB, createdById, reviewedById, appliedEntityType/Id, expiresAt | index(tenantId, status, createdAt) |
| `AiUsage` | userId, feature, model, inputTokens, outputTokens, latencyMs, status, createdAt | index(tenantId, createdAt) |
| `AuditLog` | §20.5 | index(tenantId, entityType, entityId, createdAt desc); index(tenantId, actorId, createdAt desc); index(tenantId, createdAt desc) |
| `IdempotencyKey` | §20.3 | unique(tenantId, userId, key); index(expiresAt) |
| `TenantUsage` | period (YYYY-MM), bookingsCreated, aiCreditsUsed | unique(tenantId, period) |

### 21.4 Key relationships (summary)
```
Tenant 1─n Branch, Membership, Customer, Supplier, Product, Booking, Quotation, Invoice, Payment, ...
User 1─n Membership n─n Branch
Customer 1─n Traveler 1─n TravelDocument
Customer 1─n Quotation (versions via rootQuotationId) 0..1─1 Booking
Customer 1─n Booking 1─n BookingItem n─1 Supplier
Booking 1─n BookingPassenger n─n BookingItem (via BookingItemPassenger)
Invoice 1─n InvoiceLine n─0..1 BookingItem
Invoice(kind=CREDIT_NOTE) n─1 Invoice(original)
Payment 1─n PaymentAllocation n─1 Invoice
SupplierBill 1─n SupplierBillLine n─0..1 BookingItem
SupplierPayment 1─n SupplierPaymentAllocation n─1 SupplierBill
Document n─1 (polymorphic) owner entity
JournalEntry 1─n JournalLine n─1 LedgerAccount
```

### 21.5 Database-level guards (beyond Prisma)
Created in SQL migrations (Prisma supports raw SQL in migration files):
- Composite FKs (TEN-05) where Prisma's relation syntax cannot express them cleanly.
- Partial unique indexes listed above.
- `CHECK` constraints: amounts ≥ 0 where applicable, `endDate >= startDate`, ledger debit/credit rules, allocation amount > 0.
- Triggers: `AuditLog` append-only; issued `Invoice`/`InvoiceLine` immutability (reject UPDATE of financial columns when `status <> 'DRAFT'`, allowing only derived columns `amount_paid`, `amount_credited`, `zatca_status`, `pdf_document_id`); ledger balance check (deferred).
- Extensions: `pg_trgm`, `citext`.

### 21.6 Migration strategy
- `MIG-01` Prisma Migrate. Migrations committed to git, applied by a one-off `migrate deploy` step before new app instances start (never on app boot in production).
- `MIG-02` Expand–contract for breaking changes: add new column/table (nullable or default) → deploy code writing both → backfill via job → switch reads → drop old in a later release. No destructive change in the same release that stops using a column.
- `MIG-03` CI checks: `prisma migrate diff` shows no drift between schema and migrations; migrations apply cleanly to an empty database and to a copy of the previous release's schema with seed data.
- `MIG-04` Large-table index creation uses `CREATE INDEX CONCURRENTLY` in its own migration (non-transactional).
- `MIG-05` Seeds: global reference data (currencies, countries, airports, airlines, plans) via idempotent seed script; demo tenant seed only in development (never in production).

---

## 22. API conventions

### 22.1 Shape
- `API-01` REST-style JSON under `/api/v1/`, implemented as Next.js Route Handlers. Resource paths plural, kebab-case: `/api/v1/bookings`, `/api/v1/bookings/{id}/items`, actions as sub-resources: `POST /api/v1/bookings/{id}/cancel`, `POST /api/v1/invoices/{id}/issue`.
- `API-02` One request surface for mutations: the web UI's client components call `/api/v1` (no parallel Server Actions implementation). Server Components may read via the same service functions directly. Every route handler is a thin adapter: parse → authenticate → authorize → validate → call service → serialize. Business logic lives only in services.
- `API-03` Authentication: session cookie (§4.2). Tenant API keys for third-party access are a Phase 6 entitlement (`apiAccess`): `Authorization: Bearer <key>`, keys hashed at rest, scoped permissions, per-key rate limits (D-17).
- `API-04` Content type `application/json; charset=utf-8`. Field names camelCase. Dates `YYYY-MM-DD`; timestamps ISO 8601 UTC with `Z`; money as decimal strings with `currency`; enums as UPPER_SNAKE strings.

### 22.2 Pagination
- `API-05` Cursor pagination for lists: `?limit=25&cursor=<opaque>` (limit 1–100, default 25). Response:
```json
{ "data": [ ... ], "page": { "nextCursor": "eyJ...", "hasMore": true } }
```
Cursor encodes the sort key + id (keyset pagination), stable under inserts. Total counts only via `?includeTotal=true` (capped/estimated for very large sets).

### 22.3 Filtering and sorting
- `API-06` Filters are plain query parameters defined per endpoint and validated with Zod: equality (`status=CONFIRMED`, repeatable for IN: `status=CONFIRMED&status=ISSUED`), ranges (`travelStartFrom=2026-11-01&travelStartTo=2026-11-30`), search (`q=...`, trigram on documented fields). Unknown parameters ⇒ `400`.
- `API-07` Sorting: `sort=-createdAt` or `sort=travelStartDate,-reference`; only whitelisted fields per endpoint.

### 22.4 Errors
- `API-08` Errors use RFC 9457 Problem Details (`application/problem+json`):
```json
{ "type": "https://docs.example/errors/validation", "title": "Validation failed",
  "status": 422, "code": "VALIDATION_FAILED", "requestId": "01J...",
  "errors": [ { "path": "items.0.sellAmount", "code": "too_small", "message": "Must be ≥ 0" } ] }
```
- Status codes: `400` malformed/unknown params, `401` not authenticated, `402` plan limit, `403` authenticated but not permitted (only for resources the user can know exist in their own tenant), `404` not found or other tenant, `409` conflict (version, state transition, in-progress idempotency), `422` validation/business rule, `429` rate limited (with `Retry-After`), `500` unexpected (generic message, details only in logs), `502/503/504` provider failures with `code` such as `PROVIDER_UNAVAILABLE`.
- `API-09` Error `code` values are stable and documented; messages are localized by `Accept-Language`/user locale.
- `API-10` Stack traces, SQL and provider raw errors never reach clients.

### 22.5 Concurrency and idempotency
`version` in update bodies (§21.1) ⇒ `409 VERSION_CONFLICT`. `Idempotency-Key` header per §20.3.

### 22.6 Validation
- `API-11` Zod schemas per module in `src/modules/<module>/schemas.ts`, imported by both the form (react-hook-form + zodResolver) and the route handler. Server validation always runs; client validation is a convenience.
- `API-12` Business rules needing the database (uniqueness, state, balances, limits) are validated in the service inside the transaction and reported as `422` with field paths where applicable.
- `API-13` String inputs are trimmed; max lengths on every string; HTML is never accepted in user text fields (rendered as text). Rich text is not used in v1.

### 22.7 Documentation
- `API-14` OpenAPI 3.1 document generated from the Zod schemas (`zod-to-openapi` or equivalent) at `/api/v1/openapi.json`, with a rendered reference page for admins. CI fails if a route lacks a registered schema.

### 22.8 Health
`GET /api/health/live` (process up), `GET /api/health/ready` (DB reachable, migrations at expected version, storage reachable). No auth, no sensitive details.

---

## 23. Security, privacy, encryption, rate limiting, backups and retention

### 23.1 Baseline
- `SEC-01` OWASP ASVS Level 2 is the target checklist for the application.
- `SEC-02` HTTPS only (HSTS, `max-age=31536000; includeSubDomains`). TLS terminated at the load balancer/reverse proxy.
- `SEC-03` Security headers: strict CSP with nonces (no `unsafe-inline` scripts), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'`, `Permissions-Policy` minimal.
- `SEC-04` Output encoding by React; `dangerouslySetInnerHTML` forbidden except for sanitized email template preview (DOMPurify) — lint rule enforced.
- `SEC-05` SSRF: the server fetches only allowlisted provider hosts; no user-supplied URLs are fetched.
- `SEC-06` Dependencies: lockfile committed, `npm audit`/OSV scan in CI, Dependabot/Renovate, no install scripts from unknown packages; new runtime dependencies require justification in the PR.
- `SEC-07` Secrets only via environment/secret manager; `.env` files git-ignored; CI secret scanning (gitleaks). No secret in client bundles (only `NEXT_PUBLIC_*` vars, which must contain no secrets).

### 23.2 Authentication and session security
§4 requirements plus: login and reset pages not cacheable; logout clears cookie and revokes session server-side.

### 23.3 Encryption
- `SEC-08` In transit: TLS 1.2+ everywhere, including DB and object storage connections in production.
- `SEC-09` At rest: managed disk/database encryption by the hosting provider; object storage server-side encryption.
- `SEC-10` Field-level encryption for: travel document numbers, IBANs, integration secrets, ZATCA private keys/CSIDs, MFA secrets. AES-256-GCM with a random 96-bit nonce per value, ciphertext format `v1:<keyId>:<nonce>:<ciphertext+tag>`. Data keys from env `ENCRYPTION_KEYS` (JSON map keyId → base64 32-byte key, plus `ENCRYPTION_ACTIVE_KEY_ID`) in v1; KMS-backed envelope encryption is D-18.
- `SEC-11` Key rotation: new key ID becomes active for writes; a background job re-encrypts old values; old key removed after completion.
- `SEC-12` Lookup hashes (CRM-08) use HMAC-SHA-256 with `HMAC_KEY` (separate from encryption keys).
- `SEC-13` Sensitive values never appear in logs, URLs, analytics, error reports or AI prompts (except AI-10). A logger redaction list covers known field names (`password`, `token`, `*Enc`, `documentNumber`, `iban`, `authorization`, `cookie`).

### 23.4 Rate limiting
- `SEC-14` Fixed-window counters in PostgreSQL (`RateLimitBucket`, upsert-increment) — no Redis. Limits (defaults, configurable): login 10/15 min per account and 50/15 min per IP; password reset 5/hour per email and per IP; invitations 50/day per tenant; API 600/min per user; AI 30/min per user and plan quota; exports 10/hour per user; public endpoints (itinerary/quotation links, webhooks) 60/min per IP.
- Ceiling: adds a DB write per limited request; if this becomes a bottleneck, move counters to Redis behind the same `rateLimit(key, limit, window)` function.

### 23.5 Backups and recovery
- `SEC-15` PostgreSQL: automated daily full backups + continuous WAL archiving (point-in-time recovery, RPO ≤ 15 min), retained 35 days; monthly backups retained 12 months. Encrypted, stored in a separate account/region (subject to D-05 data residency).
- `SEC-16` Object storage: versioning enabled, lifecycle to delete non-current versions after 35 days.
- `SEC-17` Restore drill quarterly (and before go-live): restore to a fresh environment, run smoke tests, record RTO (target ≤ 4 h).

### 23.6 Retention
| Data | Default retention |
|---|---|
| Financial documents, e-invoice XML/QR, ledger | ≥ 6 years after the financial year (confirm with legal, ZAT-07); not deletable by tenant |
| Audit logs | 7 years financial events, 2 years other (AUD-05) |
| Passport/ID scans | Tenant setting, default 365 days after last travel (DOC-10) |
| Passport/ID numbers in TravelDocument/BookingPassenger | Same as scans; numbers replaced by `last4` only after expiry of retention |
| Sessions, tokens, idempotency keys | Deleted after expiry + 7 days |
| AI suggestions | 30 days if not applied |
| Exports | 7 days |
| Cancelled tenant data | 90 days then deleted, except legally retained records |

### 23.7 Privacy operations
- `SEC-18` Data subject requests (PDPL): tenant admins can export all data for a customer/traveler (JSON/PDF) and erase/anonymize a customer where no legal retention applies (financial documents keep their snapshots; other personal fields anonymized). Actions audit logged.
- `SEC-19` Privacy notice and terms acceptance recorded per user with version and timestamp.
- `SEC-20` Breach response runbook documented (§26.6) with notification duties per PDPL **[EXTERNAL: legal review]**.

### 23.8 Payment card data
- `SEC-21` Never store, process or log PAN, CVV, track data or PIN. Free-text fields (notes, references) are scanned on save for PAN-like patterns (13–19 digits passing Luhn) and rejected with a message.

### 23.9 Security testing
- `SEC-22` Automated: tenant isolation suite (TEN-12), authz matrix tests per route (§25.3), dependency scan, secret scan, SAST (CodeQL or Semgrep), DAST baseline (OWASP ZAP) against staging.
- `SEC-23` Manual penetration test by a third party before general availability **[EXTERNAL]**.

---

## 24. UI/UX principles, page inventory, navigation and states

### 24.1 Principles
- Business software: dense but calm, fast keyboard workflows, predictable layouts. Tables first, details in pages (not modals) for anything with more than ~6 fields.
- One component library: Tailwind CSS + shadcn/ui (Radix primitives, accessible by default). Icons: lucide-react. Forms: react-hook-form + Zod. Tables: TanStack Table. Charts: Recharts. No other UI kits.
- Server Components for data-heavy pages; client components only where interaction requires it.
- All dates/amounts formatted with `Intl` in the user's locale and tenant timezone.
- Light and dark themes via CSS variables; respects `prefers-color-scheme`, user can override.

### 24.2 Navigation
App shell: sidebar (collapsible; on mobile a drawer) with sections, top bar with global search (customers, bookings by reference/PNR/passenger name, invoices by number), tenant switcher (if multiple memberships), branch filter (persists per user), notifications bell, user menu (profile, language, theme, sessions, logout). Sidebar mirrors in RTL.

### 24.3 Page inventory
| Area | Pages |
|---|---|
| Public/auth | Sign up, Verify email, Log in, Forgot password, Reset password, Accept invitation, Public quotation/itinerary view (signed link), Public payment result page |
| Dashboard | Dashboard |
| CRM | Customers list, Customer detail (tabs: Overview, Travelers, Documents, Quotations, Bookings, Finance, Interactions, Tasks, Activity), Customer form, Traveler detail/form, Merge customers |
| Sales | Quotations list / pipeline, Quotation editor, Quotation detail (versions, send, approve, convert) |
| Bookings | Bookings list, Booking detail (tabs: Overview, Items, Passengers, Itinerary, Documents, Finance, Amendments, Tasks, Activity), Booking item editor per service type, Cancel dialog/page, Amendment editor |
| Suppliers | Suppliers list, Supplier detail (Contacts, Commission rules, Bills, Payments, Statement, Activity), Supplier form |
| Catalog | Products list, Product form |
| Finance | Invoices list, Invoice editor/detail, Credit note form, Payments list, Record payment, Refunds list/detail, Supplier bills, Supplier payments, Expenses, Financial accounts, Transfers, Exchange rates |
| Accounting (Phase 6) | Chart of accounts, Journal entries, Fiscal periods, Bank reconciliation, Ledger reports |
| Reports | Reports index, each report page with filters + export |
| Documents | Document library (filterable), AI review queue |
| Tasks | My tasks, Team tasks |
| AI | Assistant panel (side sheet on booking/customer pages), Ask reports page |
| Settings | Agency profile, Branding, Branches, Users & invitations, Teams, Tax rates, Numbering, Currencies, Message templates, Notifications, Integrations, AI settings, Security (session timeout, MFA policy, support access), Retention, Subscription & usage, Data export |
| Account | Profile, Password, Sessions, MFA, Notification preferences |
| Platform admin | Tenants list/detail, Plans, Jobs, Health, Announcements, Platform audit |
| System | 404, 403, 500, Maintenance, Plan-limit and feature-not-in-plan screens |

### 24.4 States
- `UX-01` Loading: skeletons matching layout for page loads (`loading.tsx`); buttons show spinner and are disabled during submission; no layout shift.
- `UX-02` Empty: every list has an empty state with a one-line explanation and primary action ("No bookings yet — Create booking"); filtered-empty state offers "Clear filters".
- `UX-03` Error: route-level `error.tsx` with retry and requestId; inline field errors next to fields, summary at top for long forms with links to fields; network errors keep form input.
- `UX-04` Success: toast only after confirmed commit (FR-07); for background work, persistent status on the record.
- `UX-05` Unsaved changes warning on navigation away from dirty forms.
- `UX-06` Optimistic UI only for low-risk actions (mark notification read, complete task); never for financial or booking status changes.
- `UX-07` Status badges with text + color (never color alone).

### 24.5 Responsive behavior
- Breakpoints: mobile < 640 px, tablet 640–1024, desktop > 1024. Fully usable at 360 px wide.
- Tables on mobile collapse to cards showing key columns, with horizontal scroll inside the table container only (never the page).
- Primary flows that must work well on mobile: view booking, record payment, view itinerary, upload document from camera (`<input type="file" accept="image/*" capture>`), tasks.

### 24.6 Accessibility
WCAG 2.2 AA: keyboard operable, visible focus, labels for all inputs, error messages linked via `aria-describedby`, contrast ≥ 4.5:1, semantic headings, landmarks, `prefers-reduced-motion` respected, screen-reader tested in Arabic and English for core flows.

### 24.7 Internationalization
`next-intl` with message catalogs `messages/ar.json`, `messages/en.json`; ICU plurals (Arabic has six plural forms); missing key check in CI; no string concatenation for sentences.

### 24.8 PDFs
Generated from HTML templates with headless Chromium (Playwright) in the worker, because it renders Arabic shaping, bidi and fonts correctly. Templates are React components rendered to HTML on the server. PDF/A-3 with embedded XML for ZATCA is a Phase 6 item if required by the chosen approach (D-04). **[DECISION D-13]** keep Chromium vs a lighter renderer.

---

## 25. Automated testing, quality gates, accessibility and acceptance criteria

### 25.1 Test levels and tools
| Level | Tool | Scope |
|---|---|---|
| Unit | Vitest | Pure logic: money helpers, tax calculation, rounding, numbering format, state transition tables, ZATCA TLV/QR encoder, MRZ check digits, IBAN checksum, permission map, posting rules, Zod schemas |
| Integration | Vitest + real PostgreSQL (Docker, `testcontainers` or the compose DB) | Services and route handlers with a real database: transactions, constraints, triggers, tenant scoping, idempotency, concurrency (parallel requests), jobs |
| End-to-end | Playwright | Critical user journeys in a browser against the full stack (app + worker + DB + MinIO + Mailpit), in Arabic and English, desktop and mobile viewport |
| Accessibility | `@axe-core/playwright` | Every page in the E2E suite scanned; zero serious/critical violations |
| Contract | Vitest against provider sandboxes (manual/nightly, needs credentials) | Integration adapters; skipped in CI without credentials, never replaced by fakes in production |

- `TST-01` Integration tests run against a real PostgreSQL, never SQLite or mocks of Prisma. Each test file uses its own database schema or wraps tests in transactions rolled back at the end.
- `TST-02` Fakes are allowed only at external provider boundaries (§18.1 INT-02).
- `TST-03` Test data factories (plain functions) per entity; no fixture framework.
- `TST-04` Time is injectable (`clock.now()`) so deadlines, expiry and timezone logic are tested deterministically, including DST-observing tenant timezones (KSA has no DST; tests must also cover a DST zone for future markets).

### 25.2 Coverage expectations
- Services and domain logic: ≥ 80% line coverage, 100% of state transition table entries, 100% of money/tax helpers.
- Every API route: at least one success test, one validation failure, one unauthorized (401), one forbidden-or-404 test.

### 25.3 Mandatory suites
- `TST-05` **Tenant isolation suite** (TEN-12): seeds tenants A and B; for every registered route (enumerated from the route registry/OpenAPI document so new routes are covered automatically), user B calls the route with A's IDs ⇒ 404, and A's data is unchanged (checksums of A's rows before/after).
- `TST-06` **Authorization matrix suite**: for each permission in §4.7, each role is tested against a representative route ⇒ allowed/denied as specified; branch and own scope tested with records in and out of scope.
- `TST-07` **Idempotency & concurrency suite**: duplicate `Idempotency-Key` replays; 20 parallel identical payment requests create one payment; 20 parallel invoice issues produce gapless unique numbers; parallel allocations cannot over-allocate.
- `TST-08` **Financial integrity suite**: issued invoices reject updates (trigger), credit notes cannot exceed remaining amounts, balances equal Σ documents, totals equal Σ rounded lines, FX snapshots used in reports.
- `TST-09` **No-fake-success suite**: with providers unconfigured, email send / payment link / ZATCA submit return clear "not configured" errors and the UI shows them; nothing is marked sent/paid/cleared.
- `TST-10` **AI safety suite**: schema-invalid model output ⇒ `FAILED`; applying a suggestion runs normal validation; AI module has no access to mutating services (enforced by import boundary lint rule); NL reporting rejects requests that would need unlisted tools.

### 25.4 Quality gates (CI must pass to merge)
1. `tsc --noEmit` (strict mode, `noUncheckedIndexedAccess`).
2. ESLint (incl. import boundaries: `src/server/**` not importable from client components; AI module cannot import mutation services; `$queryRaw` restricted to `src/server/db/raw/`) and Prettier check.
3. Unit + integration tests.
4. `prisma validate`, migration drift check (MIG-03).
5. i18n missing-key check.
6. Dependency audit (fail on high/critical with available fix), secret scan.
7. Production build (`next build`) and Docker image build.
8. E2E + axe suite on main branch and on PRs touching UI (full suite nightly).

### 25.5 Global acceptance criteria (apply to every feature)
- `AC-G1` The feature works in Arabic RTL and English LTR, at 360 px and desktop widths.
- `AC-G2` Server-side permission checks and tenant scoping exist and are covered by TST-05/06.
- `AC-G3` All inputs validated server-side with shared schemas; errors are localized and field-specific.
- `AC-G4` All mutations are audit logged (AUD-04).
- `AC-G5` Loading, empty and error states exist (UX-01..03).
- `AC-G6` No success message without committed result (FR-07).
- `AC-G7` axe scan has zero serious/critical violations.
- `AC-G8` Documented in the user-facing help where behavior is not obvious, and in the OpenAPI document.

---

## 26. Docker, environment configuration, CI/CD, logging, monitoring and deployment

### 26.1 Repository layout (target)
```
/
├─ SPEC.md
├─ README.md                  setup, scripts, architecture overview
├─ docs/                      runbooks, ADRs (one file per decision in Appendix A when resolved)
├─ prisma/                    schema.prisma, migrations/, seed.ts
├─ messages/                  ar.json, en.json
├─ src/
│  ├─ app/                    Next.js App Router: (auth)/, (app)/, admin/, api/v1/, api/health/
│  ├─ components/             shared UI (shadcn/ui based)
│  ├─ modules/<module>/       schemas.ts (Zod), service.ts, queries.ts, ui/ (module components)
│  ├─ server/                 auth/, db/ (client, tenant extension, raw/), jobs/, audit/, crypto/,
│  │                          money/, files/, ai/, integrations/<area>/, rate-limit/, logger.ts
│  ├─ worker.ts               job worker entry point
│  └─ lib/                    isomorphic helpers (formatting, i18n utils)
├─ tests/                     integration/, e2e/, factories/
├─ Dockerfile
├─ docker-compose.yml         postgres, minio, mailpit, clamav, app, worker (dev/test)
└─ .env.example
```
Modules: `tenancy`, `identity`, `settings`, `crm`, `suppliers`, `catalog`, `sales`, `bookings`, `finance`, `ledger`, `documents`, `tasks`, `notifications`, `reports`, `ai`, `billing`, `admin`. A module may call another module's service functions, never its tables directly.

### 26.2 Docker
- `OPS-01` Multi-stage `Dockerfile` on the Node.js active LTS (slim/distroless base): install deps → `prisma generate` → `next build` with `output: 'standalone'` → runtime image running as non-root, read-only filesystem except `/tmp`. Same image runs the web app (`node server.js`) and the worker (`node worker.js`); Playwright Chromium is installed only in a separate `worker` target if PDF rendering stays in-process (D-13).
- `OPS-02` `docker-compose.yml` for local development and CI: `postgres:16`, `minio` (S3-compatible), `mailpit`, `clamav`, `app`, `worker`, plus a one-shot `migrate` service.
- `OPS-03` Image health check uses `/api/health/live`.

### 26.3 Environment variables
All read and validated once at startup by a Zod schema in `src/server/env.ts`; the process exits with a clear message on invalid config. `.env.example` documents every variable.

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | yes | `development` / `test` / `production` |
| `APP_URL` | yes | Public base URL (used for links, Origin check, cookies) |
| `DATABASE_URL` | yes | PostgreSQL connection string (app role) |
| `DATABASE_MIGRATION_URL` | prod | Connection with DDL rights for `migrate deploy` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | yes | Object storage |
| `ENCRYPTION_KEYS`, `ENCRYPTION_ACTIVE_KEY_ID` | yes | Field encryption keys (SEC-10) |
| `HMAC_KEY` | yes | Lookup hashes (SEC-12) |
| `SESSION_IDLE_HOURS`, `SESSION_ABSOLUTE_DAYS` | no | Defaults 8 / 7 |
| `EMAIL_PROVIDER` | yes | `smtp` / `ses` / `postmark` / `fake` (fake forbidden in production) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | if smtp | Email |
| `CLAMAV_HOST`, `CLAMAV_PORT` | yes | Malware scanning |
| `AI_PROVIDER`, `AI_MODEL`, `ANTHROPIC_API_KEY` | if AI enabled | AI (§17) |
| `PAYMENT_PROVIDER` + provider keys, `PAYMENT_WEBHOOK_SECRET` | if platform gateway | Platform-level gateway (tenant keys live in DB) |
| `ZATCA_ENV` | Phase 6 | `sandbox` / `simulation` / `production` |
| `LOG_LEVEL` | no | Default `info` |
| `SENTRY_DSN` / `OTEL_EXPORTER_OTLP_ENDPOINT` | no | Error tracking / tracing |
| `RATE_LIMIT_*` | no | Overrides for SEC-14 |
| `PLATFORM_ADMIN_EMAILS` | first boot | Bootstraps platform admins (one-time seed) |

### 26.4 CI/CD
- `OPS-04` CI (GitHub Actions or equivalent) runs §25.4 gates on every PR. Main branch builds and pushes an immutable image tagged with the commit SHA.
- `OPS-05` Deploy pipeline: staging (automatic on main) → run migrations → deploy app + worker → smoke tests → production (manual approval) → migrations → rolling deploy → smoke tests. Rollback = redeploy previous image (migrations are backward compatible per MIG-02).
- `OPS-06` Environments: development (local compose), test (CI), staging (production-like, sandbox providers), production.

### 26.5 Logging and monitoring
- `OPS-07` Structured JSON logs (`pino`) to stdout with `requestId`, `tenantId`, `userId`, route, status, duration; redaction per SEC-13. Request ID generated at the edge or by middleware and returned in `X-Request-Id`.
- `OPS-08` Error tracking (Sentry or equivalent) with PII scrubbing; tracing via OpenTelemetry optional.
- `OPS-09` Metrics/alerts: HTTP 5xx rate, p95 latency, DB connections and slow queries (`pg_stat_statements`), job queue depth and age, `DEAD` jobs, failed webhooks, ZATCA submission failures, email bounce rate, disk/storage usage, backup success. Alerts to an on-call channel.
- `OPS-10` Uptime checks on `/api/health/ready` and public pages.

### 26.6 Documentation deliverables
README (local setup in ≤ 5 commands), architecture overview, ADRs for resolved decisions, runbooks (deploy, rollback, restore from backup, key rotation, incident/breach response, ZATCA onboarding for a tenant, provider credential setup), API reference (OpenAPI), user help pages for core flows.

### 26.7 Hosting
Any container platform with managed PostgreSQL and S3-compatible storage. Region choice is constrained by D-05 (KSA data residency); KSA-region cloud options should be evaluated. **[DECISION D-03]**.

---

## 27. Development phases, dependencies, risks and definition of done

### 27.1 Module-to-phase map
Phase 1: foundation, identity, tenancy, settings, users/roles, audit (writes), dashboard shell. Phase 2: crm, suppliers, catalog, bookings. Phase 3: sales, finance, financial reports, ZATCA Phase 1 output. Phase 4: documents (full), notifications, tasks, exports, operational reports, audit UI. Phase 5: ai. Phase 6: integrations, billing, ledger, MFA, admin console, hardening, production deployment.

Note: a minimal document upload (for logos) exists in Phase 1, and booking/financial PDFs require the PDF pipeline in Phase 3; Phase 4 completes document management (library, scanning UI, retention, access logs).

### Phase 1 — Foundation
**Deliverables**
- Repository layout (§26.1), TypeScript strict, ESLint/Prettier, Vitest, Playwright, CI gates (§25.4).
- Docker Compose stack, Dockerfile, env validation, `.env.example`, health endpoints.
- Prisma schema + migrations for: User, Session, tokens, Tenant, Plan (seeded), Membership, MembershipBranch, Invitation, Branch, Team/TeamMember, NumberSequence, TaxRate, Currency, Country, ExchangeRate, AuditLog, Job, IdempotencyKey, RateLimitBucket, Document (minimal), Notification (table only).
- Tenant-scoped DB extension (TEN-03), composite FKs, triggers (AuditLog append-only).
- Auth: sign-up, email verification, login, logout, sessions, password reset, invitations, rate limits, tenant switching.
- RBAC permission map and `can()`; data scope helpers.
- Agency settings: profile, branding (logo upload to S3 with validation), branches, currencies & rates, locale/timezone, tax rates (seeded KSA), numbering.
- Users & invitations management, deactivation.
- Job worker skeleton with retry/backoff and scheduler; email sending via SMTP adapter (Mailpit locally).
- App shell: navigation, RTL/LTR, theme, i18n catalogs, error/empty/loading patterns, dashboard with setup checklist and plan usage.
- Plan limits enforcement for users and branches (SUB-01/02).

**Dependencies**: none.

**Tests**: unit (permissions map, numbering, env validation, crypto helpers); integration (auth flows, session expiry/rotation, invitation accept edge cases, tenant extension rejects foreign tenantId, composite FK rejects cross-tenant reference, rate limits, job retries); TST-05 and TST-06 running over all Phase 1 routes; E2E: sign up → verify (via Mailpit) → set up agency → invite user → invitee accepts → role-restricted navigation; axe on all pages.

**Acceptance criteria**
- A new agency can sign up, verify email, configure profile, branches, tax and numbering, and invite users who can log in with their assigned role — in Arabic and English.
- A user of agency B cannot read or modify any agency A resource through any Phase 1 route (TST-05 green).
- Password reset, session revocation on password change, and account lockout behave per AUTH-06/13/17.
- Every settings change appears in the audit log with actor and diff.
- Docker Compose brings up the full stack with one command; CI gates pass.

### Phase 2 — Customers, suppliers, services, bookings
**Deliverables**: CRM (customers, contacts, travelers, travel documents with encryption/masking/reveal, interactions, tags, duplicate warnings, merge), suppliers (contacts, commission rules), catalog products and packages, IATA reference data seed, bookings (items per service type with Zod `details`, passengers, item-passenger mapping, status machine, status history, itinerary view + notes, cancellations operational record, amendments, optimistic locking, idempotent create), global search, dashboard operational tiles.

**Dependencies**: Phase 1 (tenancy, auth, numbering, audit, settings).

**Tests**: unit (transition tables, pax type derivation, passport/ID/IBAN validators, detail schemas per service type, margin calc); integration (booking status derivation, idempotent booking create, version conflicts, encrypted fields round-trip and never returned unmasked without permission, reveal audit, merge moves all references); TST-05/06 extended; E2E: create customer + travelers → create booking with flight + hotel → add passengers → mark items confirmed/issued with numbers → view itinerary (ar/en) → cancel one item.

**Acceptance criteria**
- Staff can record a multi-service booking end to end, with correct statuses and history, without any simulated supplier interaction (all supplier steps labeled manual).
- Passport numbers are encrypted in the DB (verified by direct SQL in a test), masked in UI/API, and revealing is permission-gated and audited.
- Duplicate booking submissions with the same Idempotency-Key create exactly one booking.

### Phase 3 — Quotations, invoices, payments, expenses, financial reporting
**Deliverables**: quotations with versions, approval flow, PDF/web proposal, send (email) or mark sent, convert to booking; booking confirmation and vouchers PDFs; PDF pipeline (Chromium in worker); invoices (standard/simplified), credit notes, ZATCA Phase 1 fields + QR, bilingual invoice PDF; customer payments with allocations and deposits; payment reversal; refunds with approval; supplier bills and payments; expenses with approval threshold; financial accounts and transfers; financial reports (§11.9); dashboard finance tiles; money helper module.

**Dependencies**: Phase 2 (bookings, customers, suppliers).

**Tests**: unit (money helpers, line tax/rounding, tax-inclusive back-calculation, TLV QR against ZATCA samples, allocation logic, aging buckets); integration (TST-07, TST-08, invoice immutability trigger, gapless numbering under concurrency, refund limits, approval rules, report numbers equal Σ documents on seeded data); E2E: quotation → send (Mailpit) → accept → convert → invoice → partial payment → full payment → cancel item → credit note → refund approval → reports reflect all amounts.

**Acceptance criteria**
- The sum of every report equals the sum of the underlying documents for a seeded dataset with multiple currencies, branches and tax categories.
- Issued invoices cannot be changed through API, UI or direct SQL update of financial columns.
- Invoice PDFs contain all mandatory KSA tax invoice fields in Arabic and English; simplified invoice QR decodes to the correct 5 TLV fields.
- No path marks an invoice as paid without a recorded payment allocation.

### Phase 4 — Documents, notifications, audit logs, exports, operational reports
**Deliverables**: full document management (direct uploads, magic-byte validation, ClamAV scanning, EXIF stripping, library, access logs, sensitive gating, retention job), notifications (in-app + email, preferences, templates), tasks and reminders (system-generated tasks), audit log UI and entity activity tabs, CSV/XLSX exports (sync and background), operational reports (§15.2), customer data subject export/anonymize.

**Dependencies**: Phases 1–3.

**Tests**: integration (upload finalization rejects mismatched type/size, infected file never downloadable, signed URL only after permission check, retention job deletes expired scans, export respects scope and masking, CSV injection escaping, reminders fire once despite retries); E2E: upload passport scan from mobile viewport → scanned → visible to permitted role only; export bookings to XLSX and open in test; task reminder notification appears.

**Acceptance criteria**
- No document can be downloaded across tenants or without permission; every `HIGH` sensitivity access is logged.
- Exports open correctly in Excel with Arabic text and contain only permitted, filtered rows.
- Users receive reminders for held-item deadlines and overdue invoices exactly once per schedule.

### Phase 5 — AI-assisted extraction and assistance
**Deliverables**: AI provider module, usage metering and plan quotas, tenant AI settings and consent, extraction for passport (with MRZ check), supplier invoice, e-ticket/itinerary, hotel voucher, expense receipt; review queue and side-by-side review UI; apply via normal services; booking assistant, customer-service reply drafts, NL reporting via report tools.

**Dependencies**: Phase 4 (documents), Phase 3 (reports, finance services).

**Tests**: unit (MRZ check digits, output schemas, tool parameter schemas); integration with a recorded/fake AI adapter (TST-10, quotas, consent gating, passport extraction blocked when identity-document consent is off); evaluation set: ≥ 30 anonymized/synthetic sample documents per kind with expected fields, field-level accuracy reported (target ≥ 95% on MRZ-backed passport fields, ≥ 90% on others) — run manually/nightly with real provider credentials.

**Acceptance criteria**
- No AI output changes any booking, customer or financial record without a user's explicit apply action; applied records show verification metadata.
- AI-filled fields are visibly labeled until confirmed.
- NL report answers show the underlying report and parameters and match the standard report output.

### Phase 6 — Integrations, billing, accounting, hardening, deployment
**Deliverables** (each external item only when credentials/contracts exist; otherwise interface + "not configured" state):
- Payment gateway adapter (one KSA provider first) with payment links, webhooks, refunds, reconciliation.
- Email provider production setup, SMS provider, WhatsApp (templates) or `wa.me` links.
- ZATCA Phase 2 (in-house or middleware per D-04): onboarding, signing, clearance/reporting, retries.
- Accounting export files, then one accounting API connector.
- Flight/hotel provider adapters only under signed contracts; PNR text import parser regardless.
- Ledger: chart of accounts, posting rules, backfill, periods, trial balance/P&L/balance sheet, bank reconciliation.
- Subscription billing automation, platform admin console, support access grants, tenant API keys (if D-17 approved).
- MFA (TOTP), RLS (if D-01 approved), KMS envelope encryption (if D-18 approved).
- Production infrastructure, backups + restore drill, monitoring and alerts, load test (target: 200 concurrent users per instance, p95 < 500 ms for list/detail pages on 1M bookings dataset), third-party penetration test, runbooks.

**Dependencies**: Phases 1–5; external contracts and credentials.

**Tests**: contract tests against provider sandboxes; webhook signature/replay tests; ledger posting rule tests and balance invariants; backfill reconciliation test; MFA flows; load test report; restore drill report; pentest findings resolved (high/critical).

**Acceptance criteria**
- A real (sandbox) gateway payment updates the invoice only after verified webhook/status check; replayed webhooks do not duplicate payments.
- ZATCA sandbox clears standard and reports simplified invoices produced by the system; rejected documents surface with errors; nothing shows "cleared" without ZATCA confirmation.
- Ledger trial balance balances; control accounts equal operational balances after backfill.
- Restore drill meets RTO/RPO; alerts fire in a staged failure test.

### 27.2 Risks
| Risk | Impact | Mitigation |
|---|---|---|
| Tenant data leak through a missed scope | Critical | TEN-03 central helper, composite FKs, TST-05 auto-covering all routes, optional RLS (D-01) |
| Incorrect VAT treatment of travel services | High (tenant tax exposure) | Tax as data, tenant-configured with adviser review (TAX-03), no hardcoded treatment |
| ZATCA Phase 2 complexity and spec changes | High | Model fields from Phase 3, interface isolation, consider certified middleware (D-04) |
| Provider contracts (GDS, hotels, gateways) delayed or unavailable | Medium | Product is fully usable with manual entry; integrations isolated behind interfaces |
| Data residency / PDPL obligations | High | Early legal review, KSA-region hosting option, AI processing consent (D-05) |
| Floating-point or rounding errors in money | High | Decimal-only rule, money helper tests, report-equals-documents tests |
| AI hallucinated data entering records | High | Suggestion-only model, schema validation, code-level checks (MRZ, totals, IATA), human apply |
| Arabic PDF rendering issues | Medium | Chromium-based rendering, visual regression snapshots of PDFs |
| Scope creep toward full ERP | Medium | §28 exclusions; changes require spec update |
| Postgres-based queue/rate limit outgrown | Low (initially) | Ceilings documented (JOB-07, SEC-14) with drop-in upgrade paths |

### 27.3 Definition of done (per feature/PR)
1. Requirements referenced by ID in the PR; spec updated in the same PR if behavior changes.
2. Server-side validation, authorization and tenant scoping implemented.
3. Tests at the levels in §25 pass, including isolation and authz suites for new routes.
4. Global acceptance criteria AC-G1..G8 met.
5. Migrations follow MIG-01..05.
6. Audit entries for mutations; logs free of sensitive data.
7. Arabic and English strings complete.
8. No fake success paths; unconfigured providers show "not configured".
9. Code reviewed; CI green; deployed to staging and smoke-tested.
10. A feature is reported as "implemented" only after 1–9 are true.

---

## 28. Explicit exclusions and items requiring external credentials, licensing, contracts or review

### 28.1 Out of scope for v1
- Customer self-service portal and B2C online booking website / OTA storefront (public quotation/itinerary links and payment links are in scope).
- Live flight/hotel search, booking, ticketing, voiding or refunds without a signed provider contract (manual recording and text import are in scope).
- Payroll, HR leave/attendance, inventory, procurement beyond supplier bills, fixed assets.
- Multi-currency revaluation, consolidation across tenants, budgeting.
- Custom roles and field-level custom permissions (D-20); custom fields on entities.
- SSO (SAML/OIDC), SCIM provisioning.
- Native mobile apps (responsive web only).
- Real-time collaboration and chat; inbound email/WhatsApp inbox (manual interaction logging only).
- Marketing automation and bulk campaigns.
- Hajj/Umrah operator workflows and Nusuk integration.
- Model-generated SQL or autonomous AI agents that act without human approval.
- Offline mode.

### 28.2 Requires credentials, contracts, licensing or regulatory review
| Item | What is needed |
|---|---|
| GDS (Amadeus, Sabre, Travelport) / airline NDC | Commercial agreement, certification; ticketing typically requires IATA accreditation/BSP or a consolidator agreement |
| Hotel bedbanks (Hotelbeds, WebBeds, Expedia Rapid, RateHawk, …) | Commercial agreement, API certification |
| Payment gateways (Moyasar, HyperPay, Tap, PayTabs, Checkout.com, …) | Merchant account per tenant or platform (marketplace model needs provider approval), SAMA-licensed provider, webhook secrets; PCI DSS self-assessment |
| ZATCA Phase 2 | Tenant's FATOORA portal access and OTP per EGS unit, ZATCA sandbox access, compliance checks; optional certified middleware contract |
| Tax treatment of travel services | KSA tax adviser review of seeded defaults (TAX-03, PAY-02) |
| PDPL, data residency, retention periods | Legal review (KSA-09, ZAT-07, SEC-20) |
| Email provider | Account, verified sending domain, SPF/DKIM/DMARC |
| SMS | Provider account and sender ID registration with CST |
| WhatsApp Business Platform | Meta business verification, BSP or Cloud API account, approved templates |
| AI provider (e.g. Anthropic) | API key, commercial terms, data processing agreement, data retention configuration |
| Accounting software APIs (Xero, QuickBooks, Zoho Books) | Registered OAuth app, partner terms |
| FX rate provider | API account (optional; manual rates work without it) |
| Subscription billing provider | Merchant account supporting recurring billing in the operator's jurisdiction |
| Penetration test | Third-party security firm |
| Airport/airline reference data | Licence permitting redistribution (D-09) |
| Travel agency business licensing (Ministry of Tourism) | Responsibility of each tenant, not the software; the platform stores licence numbers only |

---

## Appendix A. Unresolved architectural and product decisions

Each decision has a recommended default so work can start; resolve and record as an ADR in `docs/adr/` before the phase that needs it.

| ID | Decision | Recommended default | Needed by |
|---|---|---|---|
| D-01 | Add PostgreSQL Row-Level Security as defence in depth (requires per-transaction `SET LOCAL app.tenant_id` with Prisma, interacting with connection pooling) | Not in Phase 1; evaluate in Phase 6 hardening. App-level scoping + composite FKs + isolation suite are mandatory regardless | Phase 6 |
| D-02 | Hand-rolled sessions vs auth library (Auth.js, Better Auth) | Hand-rolled (small, fully understood, fits DB sessions + multi-tenant membership) | Phase 1 |
| D-03 | Hosting provider and region | Container platform + managed Postgres in a KSA region if D-05 requires residency | Phase 1 (staging), Phase 6 (prod) |
| D-04 | ZATCA Phase 2: build in-house vs certified middleware | Evaluate middleware cost first; in-house only with dedicated effort and ZATCA sandbox access | Phase 6 |
| D-05 | Data residency for tenant data, backups and AI processing (PDPL) | Assume KSA residency required for primary data until legal review says otherwise; AI processing outside KSA only with tenant consent | Before production |
| D-06 | Production email provider | SMTP adapter first; choose provider by deliverability in KSA and data terms | Phase 3 (sending quotations) |
| D-07 | Plan names, prices, entitlements; subscription billing provider | Manual billing until Phase 6; provider chosen by availability for the operator's legal entity | Phase 6 |
| D-08 | Breached-password check via external API (k-anonymity) | Bundled common-password list only | Phase 1 |
| D-09 | Airport/airline reference data source and licence | OurAirports (public domain) for airports; airline list curated manually | Phase 2 |
| D-10 | Online quotation acceptance by customers | Ship in Phase 3 if time allows; otherwise staff records acceptance | Phase 3 |
| D-11 | Debit notes vs additional invoices for increases | Additional invoice in v1; debit notes in Phase 6 with ZATCA Phase 2 | Phase 3 |
| D-12 | Allow uploader to download files still `PENDING` scan | No | Phase 4 |
| D-13 | PDF rendering engine | Headless Chromium (Playwright) in worker | Phase 3 |
| D-14 | Sales targets per user/team | Excluded from v1 | — |
| D-15 | Real-time notifications (SSE/WebSocket) | Polling in v1 | Phase 4 |
| D-16 | Audit log partitioning | Add monthly partitions when table exceeds ~50M rows | Phase 6 |
| D-17 | Public API keys for tenants | Phase 6 behind `apiAccess` entitlement | Phase 6 |
| D-18 | KMS-backed envelope encryption | Env keys in v1; KMS when hosting is chosen (D-03) | Phase 6 |
| D-19 | PDF export of reports | CSV/XLSX only in v1 | Phase 4 |
| D-20 | Custom roles | Fixed system roles in v1 | After v1 |

## Appendix B. Specification review log

Review performed after drafting (2026-10-19):
- **Completeness**: all 28 required sections present in the required order; each phase in §27 has deliverables, dependencies, tests and acceptance criteria.
- **Critical business rules coverage**: tenant association (TEN-01), server-side isolation (TEN-02/03/06/12), auditable financial history (FR-10, FIN-04, AUD-01..05), decimal money (FIN-01/02), duplicate-safe references and payments (NUM-02, IDM-01..05, BKG-22, PAY-05), consistent timestamps (LOC-02/03), no card data (SEC-21, §18.3), sensitive identity documents (CRM-07/08, DOC-09, SEC-10), AI unverified labels (AI-01/02, FR-08), no simulated integrations (INT-02, BKG-07, §18.4), documented provider interfaces and secrets (INT-01..06, §26.3), no hardcoded secrets (SEC-07), no fake success (FR-07, TST-09).
- **Contradictions resolved**: booking reference is assigned at creation (BKG-01), while financial document numbers are assigned on issue (NUM-04) — intentional; payments before invoices are customer credit (PAY-02) and do not conflict with allocation rules (PAY-03); "operational finance" reports never use statutory report names (§12.1).
- **Known simplifications with ceilings**: PostgreSQL job queue (JOB-07), PostgreSQL rate limiting (SEC-14), polling notifications (NTF-04), env-based encryption keys (D-18).
- **Items needing outside confirmation**: all regulatory facts in §13 and retention periods in §23.6 must be verified with ZATCA publications and legal/tax advisers before production.
