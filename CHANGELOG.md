# Changelog

## 3.23.1 — voucher approval clarity and airline logo management

- Forced voucher company name and tagline into separate block rows with print-safe spacing, avoiding browser/font styles that could merge them into one line.
- Increased pending, approved and cancelled watermark contrast for both screen and print.
- Ensured newly created bookings enter the approval queue with a submission timestamp and history entry; administrator-approved-at-creation records clear stale pending metadata. Existing approval/reopen actions continue to record the approver and timestamp.
- Added Settings → Airline logos: upload a custom PNG/JPG/WebP by two-character IATA code, replace or remove it, and automatically use the custom image across group packages and shared airline-image surfaces. Files are retained through the existing MySQL-backed file mirror.
- Made airline logo management administrator-only and refreshed the admin UI asset cache version. All changes are additive; existing booking, voucher, group and customer records are preserved.


## 3.23.0 — encrypted Cloudflare R2 database backups

- Added an administrator-only **Settings → Cloud Backup** panel for Cloudflare Account ID, R2 bucket, S3 endpoint, Access Key ID and Secret Access Key. The secret and all R2 credentials are encrypted at rest with AES-256-GCM; secret values and encrypted credential blobs are excluded from browser state APIs.
- Added direct Cloudflare R2 S3-compatible requests signed with AWS Signature Version 4 (region `auto`), without placing credentials in the browser or adding a runtime SDK dependency.
- Added daily database-only archives at 02:00 `Asia/Karachi`, with a persistent per-day run key and MySQL advisory lock to prevent duplicate scheduled runs across restarts or app instances. Failed runs remain visible and retry after a cooldown; there is no local-only success fallback.
- Cloud archives are gzip-compressed and AES-256-GCM encrypted before upload. Every upload is verified using object size, SHA-256 metadata, full read-back SHA-256 and authenticated decrypt/parse before it is marked successful.
- Added connection testing for list, upload, head, download, checksum and delete permissions; manual Backup Now; run history; last successful backup time; daily retention of the latest 30 objects; and typed-confirmation restore.
- Cloud archives include the authoritative MySQL CRM state records and exclude sessions plus uploaded file/document bytes and the separate `crm_files` table. Restore creates a pre-restore MySQL point and preserves the current administrator password, active sessions, R2 configuration and currently stored uploads.
- Added only additive MySQL schema creation for `crm_cloud_backup_runs`; existing tables and records are not dropped, truncated, reset or overwritten by this feature.
- Added focused tests for credential/archive encryption, upload exclusion, SigV4 signing, read-back verification, failed-upload handling and Pakistan-time scheduling.

## 3.22.3 — quotation engine and voucher document repair

- Removed the phantom blank service from new quotations; service lines are added intentionally and blank placeholders are excluded from save payloads.
- Fixed quotation printing to use the current editor state rather than a stale saved copy, so unsaved edits appear in the generated PDF/print view.
- Made hotel room-night quantity authoritative on the server: valid check-in/check-out dates and room count calculate nights × rooms for quotation totals. Legacy hotel dates are hydrated from existing trip details.
- Improved hotel quotation print breakdown with separate city, check-in, check-out, night, room, room type and meal-plan facts.
- Restyled voucher letterheads so company name and tagline use distinct stacked lines; branch lists are kept out of the header.
- Increased pending/cancelled watermark contrast and preserved it in print output without covering the document content; approved vouchers also retain a visible APPROVED watermark.
- Added UI and generated-document regression tests.


## 3.22.2 — quotation, payment and chat reliability
- Hotel quotation lines calculate nights from check-in/check-out and multiply by room count; existing quotations with legacy hotel dates are hydrated without discarding their prior line data.
- Clarified A4 quotation hotel details and retained nightly-rate calculations.
- Visitor and staff chat composers now use consistent 10 MB per-file / 30 MB combined limits (up to four files), with matching restrictions for recorded voice messages. The JSON request parser is sized to accept the encoded payload with headroom.
- Visitor and staff file inputs support image, audio, video and common document formats in active conversations; upload labels, validation and download routes match the server limits.
- Payment method configuration is described and surfaced consistently; custom methods remain available and bank-account defaults are added to the selector instead of replacing the configured list.
- Cache versions updated for the revised CRM, quotation, chat and payment assets.

## 3.22.1 — Quotation, payment and live-chat usability fixes

* Reworked quotation entry into a smaller core form with optional progressive-disclosure sections.
* Added hotel line-item check-in/check-out, automatic night count, room count and room-night calculation. Nightly rates now calculate per room per night and invalid date ranges are blocked at save.
* Rebuilt quotation A4 print output with clearer customer/meta panels, service pricing, hotel stay details, travel fields, travellers, totals, terms and company contact details.
* Promoted payment method selection to the main payment form and made both add/edit screens use administrator-configured payment methods; receipts emphasise payment method and bank source on A4 and thermal layouts.
* Increased live-chat upload limits to 10 MB per file and 30 MB total (up to four files), aligned browser/server request limits, added initial-message attachments, expanded generic extension handling, and added video attachment preview.
* Retained conversation-token/staff-permission checks and durable file storage. No destructive data migration or reset.

## 3.22.0 — Quotation studio, guarded booking conversion and richer live chat

* Added a dedicated quotation workspace with customer/account details, traveller manifests, hotel, flight, visa, transport, package and custom service lines, per-quote pricing/currency, discounts, tax, inclusions, exclusions, terms, internal notes, editing, print/PDF output and custom fields.
* Added guarded one-click quotation-to-booking conversion. Conversion validates travellers/passports, prevents duplicate bookings, respects permissions and currency support, links the resulting Pending booking back to the quotation, and does not approve bookings or create payments.
* Added live-chat file downloads for visitors and staff, attachment/voice support, visitor reply email notifications when an address and SMTP route are available, desktop notification opt-in, stronger sound cues, and unread updates when the chat is not open.
* Improved quotation conversion auditing and added dedicated quote/chat regression coverage.

## 3.21.0 — Premium documents, safer operations, smarter assistant and richer live chat
- Rebuilt voucher letterheads with a spaced brand/logo/contact hierarchy; branch lists no longer crowd hotel vouchers.
- Pending vouchers show a restrained “PENDING · NOT FOR TRAVEL” watermark; approved vouchers show a matching visible APPROVED watermark.
- Added premium A4 payment receipts and a separate compact 80 mm thermal receipt format, with links between the print views.
- Added permission-controlled editing for manual payments with before/after audit history. Gateway/system-generated payments remain locked against manual edits.
- Added a booking submit lock to prevent repeat clicks from creating duplicate requests.
- Added multi-key xAI Grok configuration, model testing, 429 failover to the next key, and legacy Groq compatibility.
- Expanded visitor and staff live chat to support secure file attachments and recorded voice messages. Files are associated with their conversation and protected by visitor-token or staff-permission checks.
- Added a dedicated maintenance-mode administrator sign-in page and enabled microphone access only for the site origin.
- Changes are additive and retain existing booking, payment, user, and database records. No destructive migration or data reset is included.

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
