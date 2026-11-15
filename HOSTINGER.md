# Deploying The Umrah Store CRM on Hostinger (Node.js Web App + GitHub)

**Golden rule: MySQL is the permanent home of all CRM data.** A GitHub push or a redeploy replaces the *code* only. Records live in MySQL; uploaded files (receipts, KYC documents, logo, promotion images) are mirrored into MySQL and restored automatically at start. Nothing in the application drops, truncates or resets tables.

## 1. One-time setup

### 1.1 Create the database (hPanel → Databases → MySQL Databases)
Create a database and a user, and note the **full** database name and user name Hostinger shows (they are prefixed, e.g. `u123456789_umrah`). You do not need to create tables: the app creates `crm_state`, `crm_state_backups`, `crm_files` and `crm_cloud_backup_runs` itself (additive, `CREATE TABLE IF NOT EXISTS`).

### 1.2 Node.js app settings
* Node.js **20** (18+ works), entry file **`server.js`**, install from the lockfile with `npm ci --omit=dev`, then start with `npm start`.
* Connect the GitHub repository (branch `main`). Do **not** commit `.env`.

### 1.3 Environment variables (hPanel → Node.js app → Environment variables)
| Variable | Value |
|---|---|
| `DB_HOST` | `127.0.0.1` (not `localhost`, which can resolve to IPv6) |
| `DB_PORT` | `3306` |
| `DB_NAME` | full database name from hPanel |
| `DB_USER` | full database user from hPanel |
| `DB_PASSWORD` | the database password |
| `CLOUD_BACKUP_ENCRYPTION_KEY` | required stable random server-side encryption key (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`) |
| `DB_SSL` | `0` |
| `PUBLIC_URL` | `https://portal.theumrahstore.com` |
| `REQUIRE_MYSQL` | `1` (keep enabled after MySQL is confirmed healthy in steps 5–7 below) |
| `DATA_DIR` | optional. A folder **outside** the app, e.g. `/home/<user>/umrah-data`, is still best (faster, keeps WhatsApp session files), but it is no longer required for data safety |
| `ADMIN_PASSWORD` | only used if the admin account does not exist yet. Your existing admin login and password are **never** changed by a deploy |

Leave `RESET_ADMIN` unset.

## 2. First deployment of this version (existing live CRM)

1. **Back up first (belt and braces).** hPanel → Backups, and copy your current `DATA_DIR` folder (db.json, receipts, brand, kyc, promos, backups) somewhere safe. Do not delete the old folder afterwards.
2. Keep the existing Hostinger environment variables and MySQL database values unchanged. Do not set `RESET_ADMIN`. If your existing data folder is not already the folder you will use as `DATA_DIR`, **copy** (don't move) its contents into it. The app imports `db.json` into MySQL and uploads the files in `receipts/`, `kyc/`, `promos/` and the logo into MySQL on first start.
3. Set the variables above and deploy.
4. Check the startup log. You should see: `Pre-migration backup stored`, `Storage driver: MySQL`, and (if you had files) `Migrated N existing uploaded file(s) into MySQL`.
5. Open `https://portal.theumrahstore.com/healthz`. It must show `"driver":"mysql"` and `"healthy":true`.
6. Sign in as `admin` with your **existing** password. Open **Settings → Data & activity → Data safety & backups**: status must be green, record counts must match what you expect, and a restore point list must be present.
7. Now add `REQUIRE_MYSQL=1` and restart. From here, a missing or mistyped database variable stops the app instead of silently starting an empty CRM.

## 3. Normal updates (GitHub push)
Push to `main`; Hostinger rebuilds and restarts. On start the app:
1. takes a **pre-migration restore point** if the application version changed,
2. loads state from MySQL (never from a stale local file),
3. restores any uploaded file that is in MySQL but missing on disk, and uploads any file that is on disk but not yet in MySQL.

A redeploy therefore cannot erase CRM records or uploads. Verify with `/healthz` after each deploy.

## 4. Backups and recovery
* **Automatic restore points** (MySQL table `crm_state_backups`): about every 6 hours (when data changed), once per day, before every version upgrade, before every restore. Scheduled/daily ones are pruned by count (`DB_BACKUP_KEEP`, `DB_BACKUP_DAILY_KEEP`); upgrade/restore/manual ones are kept.
* **Settings → Data & activity → Data safety & backups** (admin): create a restore point, download one as JSON, or restore one. A restore saves the current data first (so it can be undone) and keeps the current admin password. Restoring needs the administrator and typing `RESTORE`.
* **Whole-database copy:** phpMyAdmin → your database → **Export** (Quick, SQL). This captures state, restore points **and uploaded files** (`crm_files`). Do this regularly and store it off the server.
* **If the app will not start:** `node scripts/verify-storage.js` shows what is in MySQL (read-only). `node scripts/restore-backup.js list` and `node scripts/restore-backup.js <id> --yes` restore a restore point directly in the database.
* If `crm_state` is ever emptied, the app recovers the freshest source (local snapshot or newest restore point) instead of creating a blank CRM.

## 5. Cloudflare R2 database backups (v3.23.1)

1. In Cloudflare, create an R2 bucket and create an R2 API token with **Object Read & Write** permission scoped to that bucket. Keep the generated Access Key ID and Secret Access Key private.
2. In Hostinger → Node.js app → Environment variables, set `CLOUD_BACKUP_ENCRYPTION_KEY` to a newly generated random value. Generate it once with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Keep the same value permanently and store it outside Git. Do not rotate it after saving credentials unless you are prepared to re-enter R2 credentials and retain old archive decryption access separately.
3. Deploy/restart the app after setting the environment key. Sign in with the administrator account and open **Settings → Cloud Backup**.
4. Enter the Cloudflare Account ID, bucket name, S3 API endpoint (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`; use the matching EU, US or FedRAMP hostname for jurisdictional buckets), Access Key ID and Secret Access Key. Save, then run **Test R2 connection**. It checks list, upload, head, download/checksum and delete operations.
5. Run **Backup Now** and confirm a `success` entry in Cloud backup history before relying on the scheduler. The last successful time is displayed in Pakistan time. Daily runs begin at 02:00 `Asia/Karachi`; after a missed schedule during downtime, the scheduler catches up on the next start. Failed attempts stay visible and retry after a cooldown.
6. The latest 30 daily R2 database backups are retained automatically. Manual backups are stored separately. An upload is not marked successful until the server reads it back and verifies its SHA-256 and encryption tag.

**Archive scope:** all current CRM business records stored in MySQL `crm_state` are included. The separate `crm_files` table and upload bytes (receipts, KYC, images, QR codes and chat attachments) are excluded. Server-only R2 credentials are also excluded from downloadable exports and backup archives. Restore first creates a pre-restore MySQL point, preserves the current admin password, sessions, R2 credentials and present uploaded files, and restores database records only. The selected backup is not a substitute for a separate offsite file/document backup if those uploads must also be recoverable.

The app requires a dedicated `CLOUD_BACKUP_ENCRYPTION_KEY` of at least 32 characters and deliberately does not fall back to `DB_PASSWORD`. A normal MySQL password rotation therefore does not break archive decryption. The key is not stored in MySQL, Git or the browser. Losing or changing it prevents decryption of existing archives, so keep a secure off-server copy.

## 6. Troubleshooting
| Symptom | Meaning / fix |
|---|---|
| App stops: *MySQL configuration is incomplete* | one of `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` is missing |
| App stops: *REQUIRE_MYSQL is set but...* | database variables are missing: fix them, do **not** remove `REQUIRE_MYSQL` |
| `/healthz` 503, `connected:false` | wrong host/user/password, or the DB user lacks privileges on that database |
| `/healthz` 503, *write conflict* | two app instances are running with different data; stop the old one. Nothing was overwritten |
| `/healthz` 503, retrying | MySQL briefly unavailable. Saves are retried automatically and nothing is lost while the app stays up |
| Settings panel says *Temporary storage* | `DB_*` variables are not set: data is only on disk. Configure MySQL now |

## 7. Other settings
* Settings → AI assistant (xAI Grok keys, model and failover; legacy Groq remains supported), Settings → Email & notifications (SMTP; Hostinger mailbox: `smtp.hostinger.com`, port 465, SSL/TLS), Settings → Integrations (WhatsApp, PayFast and Travelport (Travelport secrets belong in Hostinger Environment Variables)). For server-managed AI keys, set `XAI_API_KEY` or comma/newline-separated `XAI_API_KEYS`, and optionally `XAI_MODEL` / `XAI_BASE_URL`. Keep all keys in Hostinger Environment Variables, never in Git. xAI keys on the same team share that team’s model quota, so key rotation is not a way to multiply one team’s quota.
* Enable HTTPS for the domain in hPanel. Live chat uses Server-Sent Events with a polling fallback; visitor email replies require a valid visitor email and working SMTP configuration. Browser desktop notifications require the visitor or staff member to grant notification permission.
* WhatsApp login files live in `DATA_DIR/wa-auth`; keep `DATA_DIR` outside the app folder to avoid re-linking the phone after a redeploy.


## Travelport TripServices setup

Add the following server environment variables in Hostinger (never in browser code or Git): `TRAVELPORT_ENV=preproduction`, `TRAVELPORT_USERNAME`, `TRAVELPORT_PASSWORD`, `TRAVELPORT_CLIENT_ID`, `TRAVELPORT_CLIENT_SECRET`, and `TRAVELPORT_ACCESS_GROUP` (or the alternative `TRAVELPORT_PCC_CORE` only if Travelport assigns it). Optionally set `TRAVELPORT_CONTENT_SOURCES=GDS` (enable `NDC` only after Travelport confirms entitlement) and `TRAVELPORT_HOTEL_CURRENCY=SAR`. Ask Travelport to confirm Air API and Stays API entitlements separately.

The agent flight workflow performs Travelport search, live fare revalidation, reservation hold, then PKR collection through the configured PayFast gateway. A successful agent payment changes the order to **Payment Received - Ticketing Required**; it does not falsely mark the reservation as ticketed. The office must complete the supplier ticketing workflow using the agency's Travelport-approved form of payment and ticketing entitlement. Hotel search uses SearchComplete; hotel booking is not enabled until Stays booking/FOP and payment access are confirmed. Ground transfers continue to use the portal's existing transport supplier and booking workflow; they are not Travelport transfer inventory.

Custom airline logos uploaded by an administrator in **Settings → Airline logos** are persisted through the existing `DATA_DIR` and mirrored to the existing `crm_files` table. Do not delete either during deployment; replacing an application folder must not replace the persistent data directory.
