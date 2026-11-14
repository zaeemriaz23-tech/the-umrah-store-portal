## 3.20.0 — Travelport TripServices integration foundation

- Replaced public flight and hotel search provider routing with Travelport TripServices; SerpApi calls, settings and deployment variables are retired.
- Added cached Travelport OAuth authentication, API status and a credential-only connection test; credentials remain server environment variables.
- Added live one-way/return Air search, fare revalidation, passenger/passport submission and held reservation creation with a Travelport PNR.
- Added PayFast checkout tied to each Travelport reservation, payment verification states, duplicate-checkout protection, agent reservation tracking and an admin reservation queue.
- Agent flight payments are not incorrectly credited to the agent wallet a second time. A paid PNR remains explicitly marked as awaiting ticket issuance until the airline ticketing workflow is completed.
- Added Travelport Stays SearchComplete hotel search with destination, dates, occupancy, optional hotel-name match, room rates and cancellation details.
- Hotel booking and automatic airline ticket issuance remain gated on the relevant Travelport booking/payment entitlements and approved agency form of payment. Existing ground transport booking remains on the portal transport workflow; it is not represented as Travelport transfer inventory.
- Added offline request-contract tests for Travelport Air, Stays and passenger payloads. No database schema migration or destructive data operation introduced.

## 3.19.0 — Native SAR/PKR booking and payment workflow

- New booking services default to native SAR pricing, while each service can be entered in SAR or PKR independently.
- Native amounts preserve two decimal places and save an office-rate FX snapshot alongside the existing PKR accounting-base values.
- Unchanged SAR service amounts retain their original PKR ledger value and FX snapshot when other booking details are edited; changed prices use the current office rate.
- Payment records and office quotes now support native SAR or PKR amounts; payment receipts and transaction rows show the original SAR amount and its PKR ledger equivalent.
- Global display currency defaults to SAR once for existing users, remains user-switchable, and uses the office-maintained SAR/PKR rate for SAR accounting display.
- Legacy PKR-only bookings, payments and quotes retain their original PKR meaning. No database schema migration or destructive data operation is introduced.

## 3.18.0 — Operations workspace & voucher polish

- Expanded administrator quick access for ledgers, receipts, hotel inventory, reports, supplier sync, support and promotions.
- Upgraded account statements with a full-width ledger workspace, date/type/search filters, account balance summaries, printable statements and filtered CSV export.
- Added responsive skeleton loading states and reduced-motion support across slow-loading operational panels.
- Improved booking entry for hotel images, inventory selection, room counts, meal plans, check-in/out, auto-calculated nights and room-night billing units.
- Booking hotel selection now offers saved room types and date-valid supplier rates, converts SAR nightly rates to PKR when the exchange rate exists, and calculates bed-nights for sharing rooms.
- Extended booking voucher metadata to preserve optional IATA, Saudi company, branch, group, issuer, family, contact, passenger and bed totals without a database migration.
- Refined the hotel voucher to a branded A4 document with traveller, accommodation, night totals, flights, transport, notes, QR verification and footer details.
- Improved voucher extraction for PNR vs visa number, hotel names containing city names, and transport class labels.
- Saved hotel photography now appears in booking details and on printable hotel vouchers when available; sharing-bed quantities recalculate with traveller and bed changes, and auto-priced nightly rates refresh when stay dates change without overwriting manual quotes.
- No database schema or destructive data operations introduced.

## 3.17.0 - Booking, ledger and voucher workflow upgrade

- Added structured voucher metadata and preserved traveller bed, visa and PNR fields.
- Improved hotel inventory imagery with URL and compressed upload support in the admin editor.
- Enhanced booking hotel selection, room details and automatic night calculation.
- Redesigned the full-booking printable voucher around a compact hotel-voucher manifest with accommodation nights, traveller details, flights, transport and QR verification.
- Expanded ledger filtering, summaries, search, source type and wide-screen table layout.
- Added refined skeleton loading states for account ledgers and common CRM data surfaces.
- No database schema changes or destructive migrations.

## 3.16.3 — Premium operations UI and document polish
- Added a presentation-only premium UI layer for the internal CRM: refined sidebar, top bar, page hierarchy, cards, controls, tables, dialogs and responsive spacing.
- Refined the Admin Centre control-room visual hierarchy, status indicators and operational cards.
- Improved mobile/tablet overflow handling and horizontal table containment without changing any actions, routes or permissions.
- Refined booking voucher and payment receipt layouts for screen display and A4 printing, including responsive headers, metadata, amount emphasis and safer long-text wrapping.
- No database schema changes, migrations, data writes, imports or storage behaviour changes.

# 3.16.1
- Fixed a duplicate action name that caused the Brand Filter save handler to override booking creation.
- Isolated legacy Settings > Banking actions from the newer Bank accounts workspace actions.
- Added hotel-voucher PDF import to new booking forms: traveller names/passports, accommodation stays, outbound/return flights, transport, voucher metadata and notes are extracted for review.
- Added a required agent/customer account confirmation step when importing a voucher; ambiguous or missing account matches must be selected manually.
- Voucher import does not save a booking automatically; users review the imported fields and prices and explicitly create the booking.
- Added regression coverage for booking save-action collisions and hotel-voucher extraction. No database schema changes or data migrations.

# 3.16.0
- Automatic Meezab group/package inventory sync (lib/supplier.js): GroupOid/PackageCode matching, create/update/deactivate (never delete), seat safety, retries, session renewal, pagination, history. Admin: Services & sync > Supplier sync.
- Admin-only Maintenance mode enforced server-side (lib/maintenance.js), stored in the CRM state.
- New landing page at `/`; the agent workspace (search, sign-up, status) lives at `/portal`.
- Additive only: no tables or records are dropped or rewritten; a pre-migration backup is taken automatically on first start.

# Changelog

## 3.15.0 - simpler sidebar, dashboard quick actions, premium flight search
- Sidebar is now a short flat list in three labelled sections (Sell / Manage / More); no accordions.
- Dashboard has quick-action tiles (flights & hotels, group packages, new booking, record payment, quotes).
- Search panel rebuilt as a white card under a green header band with large fields and a prominent Search button.

## 3.14.0 - navigation shell, design system, departure management, search redesign
- New grouped, collapsible, role-aware sidebar (Sell & quote / Bookings / Inventory / Customers / Finance / Engage / Administration), badge roll-ups, icon-only rail mode, quick-create menu, Ctrl/Cmd+K search. Every route and permission check is unchanged.
- New design system stylesheet (`ds.css`): tokens, typography, buttons, forms, tables, cards, tabs, chips, modals, empty states.
- Group packages rebuilt as departure management: KPI strip, Departures / Table / By-month views, airline filter chips, live inventory meters (sold vs remaining from real bookings), departure workspace (overview, pricing with staff cost/margin, bookings, passenger manifest with copy and CSV export).
- Flight and hotel search restyled (sorting tabs, sticky filters, clearer cards, one-row hotel actions, round-trip step indicator).
- Bookings table made dense and un-clipped; KPI cards redesigned; empty-state icons fixed; phone search restored.

## 3.13.0 - production hardening, green identity, Makkah/Madinah pages

### Data safety (no existing data is touched or reset)
- MySQL stays the permanent primary store; schema changes are additive only (no DROP/TRUNCATE anywhere).
- Fixed: scheduled backups were measured from the last *write*, so a busy CRM almost never got one. Restore points now come from the last *backup*: scheduled (~6 h), daily, `pre-migration` (before every version upgrade), `pre-restore`, `manual`. Only scheduled/daily copies are pruned.
- Fixed: a failed MySQL write was not retried until the next user save. Failed writes are now retried automatically with back-off and reported on `/healthz`.
- New: uploaded files (receipts, KYC documents, logo, promotion images) are mirrored into MySQL (`crm_files`), restored on start, and existing files are migrated once. Redeploys can no longer lose uploads.
- Changed: a deployment-local `DATA_DIR` no longer stops the app in MySQL mode (it was a likely cause of failed Hostinger deployments). Files are protected by the MySQL mirror.
- New: `REQUIRE_MYSQL=1` refuses to start on temporary JSON storage if `DB_*` variables are missing.
- New: if `crm_state` is ever emptied, the app recovers the freshest source (local snapshot or newest restore point) instead of starting a blank CRM. A stale local `db.json` never overrides MySQL.
- New: write-conflict guard (never overwrites a newer MySQL revision).
- Existing admin login and password are never changed by a restart, redeploy or restore.
- New admin tooling: Settings → Data & activity → Data safety & backups (status, create, download, restore with typed confirmation); `scripts/verify-storage.js`; `scripts/restore-backup.js`.

### Interface
- Whole product re-skinned to a green-and-white identity: CRM, agent portal, public website, chat widget, vouchers/receipts, PWA theme colour.
- CRM footer; sidebar contact block reads company settings; global search restored on phones (was hidden by an earlier rule).
- Removed the disabled "Multi-city / Soon" placeholder. Public header no longer wraps. Chat widget always offers Call and WhatsApp.

### Public website / SEO
- New pages `/makkah-hotels` and `/madinah-hotels` (real inventory only, area guide, tips, FAQ, ItemList/Hotel/FAQPage/Place structured data, sitemap + footer links). Hotels page links to both.
- 404 pages are `noindex`; `/app` is disallowed in robots.txt.
- Added CSP (`frame-ancestors`, `base-uri`, `object-src`) and COOP headers.

### Repository
- Removed superseded nested patch folders (v3.9.1, v3.10.0) and a stray `$null` file. Their guidance is in `HOSTINGER.md`.
- CI now runs a real MySQL 8 service so the storage suite runs on every push.
- `.env.example` no longer sets a partial `DB_*` set (which would stop a local start on purpose).


## 3.16.2 — Admin centre and maintenance access
- Internal staff and administrators retain portal access during maintenance; agents and suppliers remain blocked.
- Replaced the optional staff-maintenance checkbox with a clear internal-team access policy.
- Added an Admin Centre with operational KPIs, integration status, storage health, restore-point creation, quick access and recent audit activity.
- No database schema changes or data migrations.
