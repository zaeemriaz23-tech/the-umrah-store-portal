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
