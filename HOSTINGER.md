# Deploying The Umrah Store CRM on Hostinger (Node.js Web App + GitHub)

**Golden rule: MySQL is the permanent home of all CRM data.** A GitHub push or a redeploy replaces the *code* only. Records live in MySQL; uploaded files (receipts, KYC documents, logo, promotion images) are mirrored into MySQL and restored automatically at start. Nothing in the application drops, truncates or resets tables.

## 1. One-time setup

### 1.1 Create the database (hPanel → Databases → MySQL Databases)
Create a database and a user, and note the **full** database name and user name Hostinger shows (they are prefixed, e.g. `u123456789_umrah`). You do not need to create tables: the app creates `crm_state`, `crm_state_backups` and `crm_files` itself (additive, `CREATE TABLE IF NOT EXISTS`).

### 1.2 Node.js app settings
* Node.js **20** (18+ works), entry file **`server.js`**, install `npm install --omit=dev`, start `npm start`.
* Connect the GitHub repository (branch `main`). Do **not** commit `.env`.

### 1.3 Environment variables (hPanel → Node.js app → Environment variables)
| Variable | Value |
|---|---|
| `DB_HOST` | `127.0.0.1` (not `localhost`, which can resolve to IPv6) |
| `DB_PORT` | `3306` |
| `DB_NAME` | full database name from hPanel |
| `DB_USER` | full database user from hPanel |
| `DB_PASSWORD` | the database password |
| `DB_SSL` | `0` |
| `PUBLIC_URL` | `https://portal.theumrahstore.com` |
| `REQUIRE_MYSQL` | `1` (add this after the first successful start - see 2.4) |
| `DATA_DIR` | optional. A folder **outside** the app, e.g. `/home/<user>/umrah-data`, is still best (faster, keeps WhatsApp session files), but it is no longer required for data safety |
| `ADMIN_PASSWORD` | only used if the admin account does not exist yet. Your existing admin login and password are **never** changed by a deploy |

Leave `RESET_ADMIN` unset.

## 2. First deployment of this version (existing live CRM)

1. **Back up first (belt and braces).** hPanel → Backups, and copy your current `DATA_DIR` folder (db.json, receipts, brand, kyc, promos, backups) somewhere safe. Do not delete the old folder afterwards.
2. If your existing data folder is not already the folder you will use as `DATA_DIR`, **copy** (don't move) its contents into it. The app imports `db.json` into MySQL and uploads the files in `receipts/`, `kyc/`, `promos/` and the logo into MySQL on first start.
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

## 5. Troubleshooting
| Symptom | Meaning / fix |
|---|---|
| App stops: *MySQL configuration is incomplete* | one of `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` is missing |
| App stops: *REQUIRE_MYSQL is set but...* | database variables are missing: fix them, do **not** remove `REQUIRE_MYSQL` |
| `/healthz` 503, `connected:false` | wrong host/user/password, or the DB user lacks privileges on that database |
| `/healthz` 503, *write conflict* | two app instances are running with different data; stop the old one. Nothing was overwritten |
| `/healthz` 503, retrying | MySQL briefly unavailable. Saves are retried automatically and nothing is lost while the app stays up |
| Settings panel says *Temporary storage* | `DB_*` variables are not set: data is only on disk. Configure MySQL now |

## 6. Other settings
* Settings → AI assistant (Groq key), Settings → Email & notifications (SMTP; Hostinger mailbox: `smtp.hostinger.com`, port 465, SSL/TLS), Settings → Integrations (WhatsApp, PayFast, SerpApi).
* Enable HTTPS for the domain in hPanel. Live chat uses Server-Sent Events with a polling fallback.
* WhatsApp login files live in `DATA_DIR/wa-auth`; keep `DATA_DIR` outside the app folder to avoid re-linking the phone after a redeploy.
