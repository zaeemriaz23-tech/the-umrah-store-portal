# The Umrah Store CRM v3

B2B / B2C travel operations: bookings, vouchers, ledgers, payments, queries, live search, group packages.
Node.js 18+, Express, persistent MySQL storage (recommended) or a local JSON data file. Automatic restore points/backups are supported. No fake or demo data - everything starts empty.

## Run
```
npm install
npm start          # http://localhost:3000   login: admin
```
Docker / Render: `Dockerfile` and `render.yaml` included. **Mount a persistent disk at `/data`** (all data lives there).
Set `ADMIN_PASSWORD` before first start. Without it the old default (`Zaeem@1212`) is used and a banner asks you to change it.
Existing v2 databases are migrated automatically (agents, suppliers, payments, journal, bookings -> package services).

## Roles
| Role | Can do |
|---|---|
| admin | everything, settings, journal, approvals, AI assistant |
| staff | bookings, payments, groups, queries, expenses, reports (approve bookings only if enabled in Settings) |
| agent | own bookings (created on own ledger automatically), vouchers, own ledger/wallet, pay online, payment records, queries, search, groups, calculator. Never sees suppliers or costs |
| supplier | only services assigned to them, confirm with confirmation no., own ledger |

## How it works
* **Booking** = travellers (passport first) + category + any mix of services (visa, hotel with stars, transport, flight, package, custom). Each service line has its own supplier and cost.
  Saving posts to the agent/customer ledger (sell) and to every supplier ledger (cost) instantly; editing or cancelling reverses/updates automatically.
  Booking number is random (e.g. `TUS-K6ZS-B2QF`) and searchable. Duplicate passport + overlapping travel dates is blocked (staff can override with confirmation).
* **Vouchers**: one click anywhere (full / per service / custom). Shareable link + QR. Carries a **PENDING** watermark until the administrator approves; **CANCELLED** when cancelled. Supplier names never appear.
* **Agent wallet**: available balance = credit limit - outstanding (advance deposits add to it). Agents can always book, even at zero balance - the balance then shows with a minus sign (e.g. `- PKR 50,000`) in the header, ledger and dashboard until settled.
* **Payments**: PayFast online checkout, one-link payment page (`/pay/<token>`, PayFast or bank transfer + receipt upload), manual records with receipt, bank details + QR, approval queue, editable manual payments with audit history, A4 receipts and separate 80 mm thermal receipts. Gateway/system-generated payments are locked against manual edits.
* **Quotations** (`#/quotations`): build customer-specific A4 quotations with traveller details and hotel, flight, visa, transport, package and custom service lines. Each quote has its own currency, rates, discount, tax, validity, inclusions, exclusions and terms. Save, edit, print or save as PDF independently of bookings. One-click conversion validates traveller/passport data, creates a Pending booking, links it back to the quote and prevents duplicate conversion. Booking conversion currently supports PKR and SAR only.
* **Live chat**: visitors and staff can attach supported files, record/send voice messages, and download shared attachments. Visitors with a valid email can receive email replies when SMTP is configured; desktop notifications require browser permission and are available only while the browser/site can receive them.
* **Queries**: from agents, search results or WhatsApp. Auto-rejected if unanswered (flight 2h, hotel 6h, visa 24h, transport 12h, package/other 24h - editable). Staff reply with quote; agent accepts; staff convert to booking.
* **Group packages**: import the supplier PDF (parsed in the browser, preview before publishing). Package disappears automatically after its departure date.
* **Search**: live flights and hotel search through Travelport TripServices, with markup. Without Travelport credentials it shows a setup message, never sample results.
* **Reports**: sales, cost, profit, margin, expenses, by category / agent / service / supplier, CSV export.
* **AI assistant** (admin): uses xAI Grok with multiple API keys and automatic backup-key retry for rate-limit responses; the legacy Groq configuration remains supported when no xAI key is set. The assistant answers questions across the CRM and only performs changes allowed by its configured permissions/confirmation flow. Configure keys in Settings > AI assistant or with `XAI_API_KEY` / `XAI_API_KEYS`.

## Integrations - set up in Settings
* **PayFast (APPS Pakistan)**: merchant ID + secured key, environment sandbox/live. Give PayFast: success/failure URL `https://YOUR-DOMAIN/payfast/return`, IPN URL `https://YOUR-DOMAIN/payfast/ipn`. Set *Public address* in Settings to your domain.
  A payment is auto-approved only when the PayFast signature matches; otherwise it waits for manual review.
* **Travelport TripServices**: server-only OAuth credentials and assigned access group in Hostinger environment variables.
* **WhatsApp**: Settings > Integrations > Link WhatsApp, scan the QR. Uses the unofficial WhatsApp Web protocol (Baileys): fine for small inbound query capture, but WhatsApp may restrict numbers - use a dedicated number.

## Notes
* Run a single application instance unless your deployment is configured for shared persistent storage. Use MySQL for production; local JSON mode is intended for development/single-instance deployments. Backups: Settings > Data, plus scheduled restore points when MySQL backup settings are enabled.
* Always serve over HTTPS in production.


## v3.1 - what's new

* **Group packages** redesigned: real airline logos (fetched once from a public logo CDN, cached on the persistent disk, coloured code badge as fallback), outbound/return flight timeline, cheapest-room highlight, seats meter, airline chips, month/nights/max-price/sort filters, quick Quote, WhatsApp share and copy.
* **Umrah package calculator** rebuilt on the store's engine: Makkah + Madinah hotels with dated nightly rates, per-room vs per-bed rules, visa tiers by group size, extra stays, private transport legs, flights, margin, WhatsApp/print, one-click booking with services pre-filled. A *Group package* tab prices live departures.
* **Transport booking engine** (`#/transport`): route -> vehicle -> passengers -> fare in SAR and PKR, extra-passenger surcharge, return trips, multi-vehicle, booking or office query.
* **Rates & inventory** (`#/rates`, admin/staff): hotels + room rates, visa tiers, vehicles/routes/fare matrix, SAR->PKR rate, quote terms, public-site switches. Nothing is hard-coded; start by entering the exchange rate, a hotel, visa tiers and one route.
* **Public SEO pages** (no login): `/umrah-group-packages`, `/umrah-package-calculator`, `/umrah-transport-booking` - server-rendered, with titles, meta, canonical, Open Graph, JSON-LD (TravelAgency, ItemList/TouristTrip, FAQPage, BreadcrumbList), plus `sitemap.xml`, `robots.txt`, web manifest. Enquiries land in **Queries** (source "website"). Group prices on the public page are hidden unless enabled in Rates & inventory > Exchange & terms.
* **Logo optimised**: 74 KB PNG -> 18 KB WebP (PNG fallback), retina variant, favicon set, 1200x630 social image, explicit dimensions (no layout shift). The PDF reader (320 KB) now loads only when importing groups.
* Admin login is unchanged.

Set `PUBLIC_URL` (e.g. `https://yourdomain.com`) in the environment so canonical URLs and the sitemap use your real domain. After deploying, submit `/sitemap.xml` in Google Search Console.

Tests: `node scripts/engine-check.js`

## v3.2 - search & branding
* **Flight search rebuilt**: airport autocomplete (built-in directory, no extra API), Return/One way, Direct only, travellers & cabin popover (adults/children/infants), popular-route chips, Best/Cheapest/Fastest tabs with live prices, price-insight badge, filters (stops, departure time, max price, airlines, flight number), expandable segment details with layovers, aircraft, legroom and CO2, loading skeletons.
* **Hotel search rebuilt**: photo gallery cards, guest rating label, nearby places (e.g. distance to Haram), free-cancellation, deal badge, star / rating / price filters, sort by price / rating / reviews.
* **Logo**: sidebar logo reduced from ~175px tall to a compact 46px mark + name; login and voucher logos reduced.
* Travelport results carry live supplier offers; airport lookup at `/api/airports`.


## v3.2 - Staff accounts, roles & permissions

* **Staff & access** (`#/staff`): create staff with their own login, department (label only), job title; assign role templates plus individual grants / removals; suspend, deactivate, reset password, sign out sessions; effective-permission summary showing whether each permission came from a role or was granted directly; role-template and department editors; audit-log viewer.
* **Enforced on the server**: every `/api/rpc` operation, ledger, receipt, search, backup, WhatsApp and export-log checks the permission on each request (permissions are computed live, so a revocation applies on the very next request). The browser state snapshot also omits data the user may not see (costs, suppliers, balances, payments, ledgers, settings, users).
* **Privilege-escalation rules**: you cannot edit your own access; a delegate can only grant permissions they hold and can only manage staff whose access is a subset of theirs; `settings.security`, `assistant.use` and `system.admin` are administrator-only and can never be delegated; the built-in `admin` account cannot be changed, suspended or deleted by anyone.
* **Settings are granular** (company, branding, banking, booking rules, pricing, general, integrations). API keys are always masked; only `integrations.manage` can change them.
* **Audit log** (`db.audit`, append-only, 30,000 entries): staff/role/permission changes, status changes, password resets, settings & integration changes, booking approvals/deletions, payments, journal entries, exports, backups. Secrets are never logged.
* **Existing dashboard preserved**: the original dashboard layout, widgets and calculations are restored unchanged. Staff access to the Overview page is controlled by the `dashboard.view` permission.
* **Migration**: automatic and additive on first start. A copy of `db.json` is saved to `data/backups/pre-rbac-*.json`. Existing `staff` users receive the editable role "Legacy Staff (migrated)" which reproduces what the old staff role could do, so nobody loses access; review it and tighten per employee. The admin login and password are not touched. `staffCanApprove` is superseded by the `bookings.approve` permission.
* Tests: `npm test` (engine checks + `scripts/rbac-test.js`, which boots the real server on a temporary data dir).

Known limits: no record-level restrictions (e.g. "only assigned agents") yet; export permission gates and audits the export action, but CSV files are built in the browser from data the user is already allowed to view; single instance JSON store as before.


## v3.3 - Legacy Groq assistant, bank accounts, deeper settings
* **Legacy AI assistant provider: Groq** (`GROQ_API_KEY` or Settings > AI assistant). This provider remains available as a compatibility fallback; v3.22.0 adds xAI Grok as the primary provider with multi-key 429 failover. It answers questions about anything (bookings, passengers, ledgers, balances, payments, expenses, groups, queries, profit, pending items) through read-only tools, remembers the last messages of the chat, and can still only **add or remove** records after you confirm. Settings: key, model (with a *Test key & load models* button), creativity, read-only switch, max changes per request, extra instructions. Without a key, simple commands still work (`summary`, `pending`, `balance of ...`, `add agent ...`). Anthropic support was removed.
* **Bank accounts page** (`#/banking`, agents and staff): every active bank account, mobile wallet (JazzCash/Easypaisa) and Raast ID as a card with copy buttons, QR, and *I paid this account*, *Copy details*, *WhatsApp share*. Agents also see their outstanding / available credit / awaiting approval.
* **Public bank page** `/bank-accounts` (no login, `noindex`) plus `/api/public/banks`. Shown on the sign-in page too. Per account switch *Show on the public bank page*, and a global switch in Settings > Payments.
* **Add payment record in one tap**: amount (quick-amount chips) -> tap the account you paid -> attach receipt photo -> save. Date, method, booking and note are under *More details*. The payment remembers which bank it went to.
* **Settings rebuilt** into tabs: Company & logo (+WhatsApp, NTN, licence no.), Banking & QR (type, colour, branch, IBAN, SWIFT, wallet, Raast, currency, instruction, active/public, QR, reorder, live preview), **Payments** (minimum, require receipt/reference, auto-approve agent receipts up to X, switch agent records off, methods, quick amounts, note), Bookings & pricing, **AI assistant**, Integrations (PayFast, Travelport, WhatsApp), **General & security** (public address, time zone, session days, minimum password length, login attempts), Team, Data & activity.
* New permission `settings.payments`. Tests: `npm test` now also runs `scripts/bank-ai-test.js` (uses a local mock of the Groq API).

## v3.4 - what's new

* **Real notifications** (bell, top right): booking submitted / approved / cancelled, service confirmed by supplier, new service assigned (supplier), payment pending / received / rejected, new query / quote / auto-rejection / 30-minute deadline warning, support tickets (new, reply, assigned, overdue). Stored per user with read state, filtered by role and permission, toast + tab-title count + optional desktop alerts. Generated by diffing state on every save, so PayFast IPN, payment links, the SLA sweep and the AI assistant all notify too.
* **Global search** (top bar, press `/` or Ctrl/Cmd+K): bookings (no., passport, traveller, confirmation no.), vouchers, queries, accounts, payments, tickets, group packages and pages, grouped, keyboard navigable, role-scoped.
* **Balance chip**: agent = available balance, supplier = balance due to you, staff = total receivable. Click opens the ledger.
* **Currency switcher** PKR / USD / SAR / AED / GBP / EUR: saved office exchange rates and manual SAR/PKR rate management; no external search provider is used for currency conversion. Currencies with no rate stay disabled - no made-up numbers. SAR conversion uses the manually maintained office rate. Display only: everything is stored and paid in PKR.
* **Bookings**: KPI tiles (pending, departing in 7 days, in country, services to confirm, value), status tabs with counts, sort, List / Cards / Arrivals (by day, next 30 days) / Travellers views, supplier-confirmation progress, countdown and urgency flags, bulk approve / cancel / export, inline Approve, detail-page summary strip (countdown, confirmations, linked payments, copy / WhatsApp / raise ticket).
* **Help & support**: agents and suppliers raise tickets (category, priority, optional booking), reply, close and reopen; FAQ and office contact on the page. Staff get a queue with KPIs, filters, reply-due timers by priority, assignment, canned replies and internal notes. New permissions `support.view` / `support.reply` / `support.delete` (granted to Customer Support, Agent Manager and Operations Manager on new installs; existing installs: tick them in Staff & access).


## v3.5 - merged build (v3.4 CRM + agent portal)
* **One codebase**: all v3.4 features (notifications, global search, currency switcher, bookings v2, help & support) plus the agent portal landing page (`/`), gated flight search, B2B partner signup and *Partner applications*. CRM lives at `/app`.
* **Theme**: the whole CRM now uses the landing page's dusk-airport look (navy sidebar, blue actions, sunset accents, Plus Jakarta Sans).
* **Official contact** (default + one-time update on first start): +92 313 693 5568, info@theumrahstore.com, branches Lahore, Okara, Islamabad - on the landing footer, CRM sidebar, support page, vouchers, receipts, public pages.
* **Add payment** rebuilt: shows the total outstanding with a one-tap *Pay total*, quick amounts, booking-linked amount, bank tiles with logos, receipt proof.
* **Agents can book at zero balance**: no credit-limit stop; negative balances are shown as `- PKR x`.
* **Bank logos**: brand-coloured logo badges for Pakistani banks and wallets (Meezan, HBL, UBL, MCB, Allied, Alfalah, Askari, Faysal, JazzCash, Easypaisa, ...) on bank cards, payment form, public bank page and payment links. Upload an official logo per account in Settings > Banking to replace the badge.
* **PayFast**: stricter amount validation, correct customer mobile/email fallbacks, safe handling of bare visits to the return URL.


## v3.6 - SEO, link previews, hotels, new public pages, PayFast hardening
* **Link previews everywhere**: `/`, every public page, voucher links (`/v/...`), payment links (`/pay/...`), receipts and the bank page now carry title, description, `og:image` (new 1200x630 navy/sunset brand card at `public/brand/og-image.jpg`), Twitter card and theme colour, so WhatsApp / Facebook / Telegram / X show a proper card. Private pages stay `noindex`. Set `PUBLIC_URL` (or *Public address* in Settings) so image URLs are absolute.
* **Landing page SEO**: keyword-rich title, meta description, canonical, robots (`max-image-preview:large`), Open Graph + Twitter, JSON-LD (TravelAgency with branches, WebSite, WebPage, FAQPage), crawlable fallback content and an FAQ section. The browser tab keeps the SEO title on the landing page.
* **New public pages** (server-rendered, own meta + JSON-LD + enquiry form): `/umrah-flights`, `/umrah-hotels`, `/umrah-visa`, `/contact`, `/umrah-faq`. Hotels and visa pages read from *Rates & inventory*. Enquiries land in **Queries** (source "website") with the right type (flight / hotel / visa).
* **Public pages re-themed** to the portal's navy / blue / sunset palette and Plus Jakarta Sans (they were emerald/gold).
* **Sitemap & robots** include every page with priorities; friendly 404 page (`noindex`); `/app` is `noindex`.
* **Hotel search in the agent portal**: Flights | Hotels tabs on the search card, destination chips, dates, guests, stars, free-cancellation filter, sort by price / rating / reviews, photo cards with nearby places, *Request quote* goes to the agent's queries. Uses Travelport Stays search and requires the Stays API entitlement.
* Landing page: new nav (Packages, Hotels, Visa, Calculator, Transport), six public tool tiles, FAQ. Deep links `/?from=LHE&to=JED` prefill the flight search (used by the Flights page).
* **PayFast**: constant-time signature check, paid amount must equal the expected amount (otherwise held for review), approved payments cannot be reversed by a late callback, return page links back to the payment link or dashboard, and **Settings > Integrations > Test connection** verifies merchant ID and secured key without moving money. New test: `node scripts/payfast-test.js` (included in `npm test`).
* CRM polish: table headers, row hover, focus rings, button / card motion.

### Go-live checklist
1. Deploy with a persistent disk at `/data`; set `ADMIN_PASSWORD`, `PUBLIC_URL=https://your-domain`, optionally `TRAVELPORT_*` credentials, `XAI_API_KEY` / `XAI_API_KEYS` (or legacy `GROQ_API_KEY`).
2. Settings > Integrations > PayFast: merchant ID, secured key, environment, then **Test connection**. Give PayFast `https://your-domain/payfast/return` (success + failure) and `https://your-domain/payfast/ipn`.
3. Rates & inventory: add the exchange rate, hotels (Makkah / Madinah) and visa tiers so the public hotel, visa and calculator pages fill up.
4. Submit `https://your-domain/sitemap.xml` in Google Search Console. Test a shared link in the Facebook Sharing Debugger / WhatsApp.

## v3.7 - hardening
* **Receipt uploads** are now verified by file signature (JPG, PNG, GIF, WebP, HEIC, PDF), not just the file extension.
* **Rate limits**: flight/hotel search is capped per user per hour (protects supplier API capacity); airport autocomplete is capped per IP.
* **CI**: GitHub Actions workflow (`.github/workflows/ci.yml`) runs `npm test` on every push and pull request.


## Cloudflare R2 database backups (v3.23.1)

When MySQL is the authoritative store, administrators can configure backups under **Admin → Settings → Cloud Backup**. Enter the Cloudflare Account ID, R2 bucket, S3 API endpoint, Access Key ID and Secret Access Key, then run **Test R2 connection**. The test checks list, write, metadata, read-back and delete permissions. Use an R2 API token scoped to Object Read & Write for the selected bucket.

Daily backups run at **02:00 Asia/Karachi**. The service captures the authoritative `crm_state.payload` record set after pending MySQL writes have flushed, removes login sessions and embedded upload bytes, gzip-compresses the archive, encrypts it using AES-256-GCM, and uploads it with the R2 S3-compatible API (SigV4, region `auto`). An upload is marked successful only after HEAD size/metadata checks, a full GET read-back SHA-256 check, and authenticated archive decryption/parsing. The latest **30 daily objects** are retained; manual backups are separately recorded. Failed uploads appear as failures and never count as successful cloud backups or silently fall back to local storage.

**Encryption key:** set a dedicated `CLOUD_BACKUP_ENCRYPTION_KEY` (at least 32 characters) in the server environment before saving R2 credentials. Generate a value with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. The service deliberately fails closed if this key is missing; it never falls back to `DB_PASSWORD`. Keep this key stable and outside Git. It protects R2 credentials in MySQL and backup archive contents; losing or changing it prevents decryption of existing records and archives.

The CRM stores its active business records in the single MySQL `crm_state` row; this is the complete application record set. The separate `crm_files` table (receipts, KYC, logos, QR images, chat attachments and other uploads) is deliberately excluded from R2 backups. Server-only R2 credentials are also excluded from exports/archives and remain configured on the current server. File metadata/paths remain in records where applicable, but the actual upload bytes are not copied. Restoring an R2 backup creates a pre-restore MySQL restore point first, keeps the current administrator password and sessions, retains the current R2 configuration and existing uploaded files, and replaces the CRM records from the selected archive. Type `RESTORE R2` to confirm. The uploaded files themselves are not rolled back by this database-only restore.

The service uses an additive `crm_cloud_backup_runs` history table and a MySQL advisory lock plus a unique persisted Pakistan-date run key. It recovers its schedule after server restarts and avoids duplicate daily backups across simultaneous Node processes. No existing table is dropped or reset.

## MySQL primary storage (v3.13.0)

When `DB_HOST`, `DB_NAME`, `DB_USER` and `DB_PASSWORD` are configured, MySQL is the authoritative store. On first start the app creates `crm_state`, `crm_state_backups`, `crm_files` and `crm_cloud_backup_runs`, imports an existing valid `DATA_DIR/db.json` if the MySQL state row is empty (the file is kept), uploads existing receipts/KYC/logo/promotion files into MySQL, and from then on loads from MySQL only. A stale local file never overrides MySQL.

Safety rules built in: additive schema changes only (no DROP/TRUNCATE), a `pre-migration` restore point before every version upgrade, automatic scheduled and daily restore points, automatic retry of failed writes, refusal to overwrite a newer MySQL revision, recovery (not a blank CRM) if `crm_state` is emptied, and restore of any missing upload from MySQL at start. The existing admin password is never changed by a restart or redeploy. Set `REQUIRE_MYSQL=1` in production so missing database variables stop the app instead of starting on temporary storage. Without `DB_*` variables the CRM runs in local JSON mode (development and tests). Admin tools: Settings → Data & activity → Data safety & backups, `scripts/verify-storage.js`, `scripts/restore-backup.js`. See `HOSTINGER.md`.

Tests: `npm test` runs everything. Set `TEST_MYSQL_HOST`, `TEST_MYSQL_USER`, `TEST_MYSQL_PASSWORD` and `TEST_MYSQL_DB` (the database name must contain "test") to also run the real-database storage suite.


### Custom airline logos for group packages

Only administrators can open **Settings → Airline logos** and upload a PNG, JPG or WebP image against an airline's two-character IATA code (for example `SV`, `PK` or `EK`). The logo is served from the CRM's local brand route and takes priority over the default airline image in group-package cards, departure lists, filters and server-rendered package pages. Replacing or removing the logo refreshes the cache version across those surfaces. Uploaded logo files are stored in `DATA_DIR/brand/airlines/custom/` and mirrored into the existing MySQL `crm_files` table; they are not part of the database-only Cloudflare R2 backup. Keep the existing `DATA_DIR` and `crm_files` table intact during deployment.
