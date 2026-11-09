'use strict';
/**
 * Shared CRM state store. MySQL is primary when DB_* is configured; DATA_DIR/db.json is an atomic recovery snapshot.
 * v3 schema. Older v2 databases are migrated automatically on first start.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
for (const d of ['receipts', 'brand', 'backups']) fs.mkdirSync(path.join(DATA, d), { recursive: true });
const DBF = path.join(DATA, 'db.json');
const DEFAULT_ADMIN_PASSWORD = 'Zaeem@1212';

const hash = (p, s = crypto.randomBytes(16).toString('hex')) => s + ':' + crypto.scryptSync(p, s, 32).toString('hex');
const check = (p, h) => {
  try { const [s, x] = String(h).split(':'); return crypto.timingSafeEqual(Buffer.from(x, 'hex'), crypto.scryptSync(p, s, 32)); }
  catch { return false; }
};

const defaultSettings = () => ({
  company: { name: 'The Umrah Store', tagline: 'Premium Islamic Travel', phone: '+92 313 693 5568', whatsapp: '+92 313 693 5568', email: 'info@theumrahstore.com', address: 'Branches: Lahore · Okara · Islamabad', branches: 'Lahore, Okara, Islamabad', website: '', ntn: '', licence: '', footer: '', terms: '' },
  bank: [],
  categories: ['Long Stay', 'Short Stay', 'Visa Only', 'Accommodation Only', 'Meezab Group', 'QFC', 'Group Package', 'Custom'],
  expenseCats: ['Salaries', 'Rent', 'Utilities', 'Marketing', 'Software & Subscriptions', 'Office', 'Travel', 'Bank Charges', 'Other'],
  sla: { flight: 2, hotel: 6, visa: 24, transport: 12, package: 24, other: 24 },
  prefix: 'TUS', markupPct: 0, groupCostPct: 95, staffCanApprove: false, tz: 'Asia/Karachi',
  payfast: { merchantId: '', merchantName: '', securedKey: '', env: 'sandbox', storeId: '' },
  serpapiKey: '', baseUrl: '',
  groq: { apiKey: '', model: 'openai/gpt-oss-120b', temperature: 0.2, enabled: true, allowWrites: true, maxActions: 10, instructions: '' },
  payments: { minAmount: 1, requireReceipt: false, requireRef: false, autoApproveUnder: 0, agentCanRecord: true, publicBankPage: true, instructions: '', methods: ['Bank transfer', 'Cash', 'Cheque', 'Online banking / Raast', 'JazzCash / Easypaisa', 'Other'], quickAmounts: [50000, 100000, 250000, 500000] },
  security: { sessionDays: 7, minPassword: 8, loginMax: 10 },
  calc: { pkrPerSar: 0, flightPkr: 0, terms: '', tTerms: '', publicPrices: false, publicLeads: true, rateUpdated: '' }
});

let db, fresh = false, localParseError = null;
try { db = JSON.parse(fs.readFileSync(DBF, 'utf8')); }
catch (e) { fresh = !fs.existsSync(DBF); if (!fresh) localParseError = e; db = null; }

function blank() {
  return { v: 3, rev: 1, seq: 1000, users: [], parties: [], bookings: [], vouchers: [], payments: [], entries: [], expenses: [],
    queries: [], paylinks: [], groups: [], hotels: [], visaTiers: [], tVehicles: [], tRoutes: [], tPrices: [], log: [], sessions: {}, settings: defaultSettings() };
}

/* ---------- v2 -> v3 ---------- */
function migrateV2(o) {
  const n = blank();
  n.seq = o.seq || 1000; n.users = o.users || []; n.groups = o.groups || []; n.log = o.log || [];
  n.settings.company = { ...n.settings.company, ...(o.company || {}) };
  if (o.margin && o.margin.t === '%') n.settings.markupPct = +o.margin.v || 0;
  const mk = (a, kind) => ({ id: a.id, kind, name: a.name, phone: a.phone || '', email: a.email || '', city: a.city || '', address: '', notes: a.notes || '', limit: a.limit || 0, opening: 0, active: true, created: '' });
  n.parties = [...(o.agents || []).map(a => mk(a, 'agent')), ...(o.suppliers || []).map(s => mk(s, 'supplier'))];
  n.users.forEach(u => { if (u.aid) { u.pid = u.aid; delete u.aid; } });
  n.payments = (o.payments || []).map(p => { const { pt, pid, ...r } = p; return { ...r, dir: pt === 'agent' ? 'in' : 'out', partyId: pid, via: 'manual' }; });
  n.entries = (o.entries || []).map(e => { const { pt, pid, ...r } = e; return { ...r, partyId: pid }; });
  n.bookings = (o.bookings || []).map(b => ({
    id: b.id, no: makeNo(n, new Set()), partyId: b.agent, category: 'Group Package', status: b.status, pax: (b.px || []).map(x => ({ n: x.n, pp: x.pp, dob: '', nat: '', g: x.g, t: x.t })),
    services: [{ id: 's1', type: 'package', title: 'Umrah group package ' + (b.gid || ''), supId: b.sup || null, qty: b.pax, sell: b.price, cost: Math.round(b.cost || 0), conf: '', cs: 'Requested', from: b.dep, to: b.ret,
      d: { code: b.code, airline: b.airline, out: b.out, inb: b.inb, makkah: b.mk, madinah: b.md, mkn: b.mkn, mdn: b.mdn, mkd: b.mkd, mdd: b.mdd, room: b.room } }],
    from: b.dep, to: b.ret, notes: b.notes || '', internal: '', created: b.created, createdAt: (b.created || '') + 'T00:00:00.000Z', by: b.by, cdate: b.cdate, history: [] }));
  return n;
}

function makeNo(d, taken) {
  const A = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ', pre = (d.settings && d.settings.prefix) || 'TUS';
  for (;;) {
    const r = crypto.randomBytes(8), s = Array.from(r, x => A[x % A.length]).join('');
    const no = pre + '-' + s.slice(0, 4) + '-' + s.slice(4);
    if (/\d/.test(s) && /[A-Z]/.test(s) && !taken.has(no)) { taken.add(no); return no; }
  }
}

function normalizeState(input) {
  let o = input;
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('CRM database document is not a JSON object');
  if (!o.v || o.v < 3) o = migrateV2(o);
  const dflt = defaultSettings();
  o.settings = { ...dflt, ...(o.settings || {}), company: { ...dflt.company, ...((o.settings || {}).company || {}) }, sla: { ...dflt.sla, ...((o.settings || {}).sla || {}) }, payfast: { ...dflt.payfast, ...((o.settings || {}).payfast || {}) }, calc: { ...dflt.calc, ...((o.settings || {}).calc || {}) }, groq: { ...dflt.groq, ...((o.settings || {}).groq || {}) }, payments: { ...dflt.payments, ...((o.settings || {}).payments || {}) }, security: { ...dflt.security, ...((o.settings || {}).security || {}) } };
  delete o.settings.anthropicKey;
  if (!o.settings.contactV) { Object.assign(o.settings.company, { phone: '+92 313 693 5568', whatsapp: '+92 313 693 5568', email: 'info@theumrahstore.com', address: 'Branches: Lahore · Okara · Islamabad', branches: 'Lahore, Okara, Islamabad' }); o.settings.contactV = 1; }
  ['users', 'parties', 'bookings', 'vouchers', 'payments', 'entries', 'expenses', 'queries', 'paylinks', 'groups', 'hotels', 'visaTiers', 'tVehicles', 'tRoutes', 'tPrices', 'log', 'tickets', 'notifs', 'audit'].forEach(k => { if (!Array.isArray(o[k])) o[k] = []; });
  o.sessions = o.sessions && typeof o.sessions === 'object' && !Array.isArray(o.sessions) ? o.sessions : {};
  o.seq = Number.isFinite(+o.seq) ? +o.seq : 1000;
  o.rev = Number.isFinite(+o.rev) && +o.rev > 0 ? +o.rev : 1;
  o.v = 3;
  return o;
}

function replaceState(next) {
  if (next === db) return;
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, next);
}

function ensureAdmin() {
  let a = db.users.find(u => u.id === 'admin');
  const pw = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
  if (!a) { db.users.unshift({ id: 'admin', role: 'admin', name: 'Administrator', login: 'admin', pw: hash(pw), mustChange: !process.env.ADMIN_PASSWORD }); return true; }
  if (process.env.RESET_ADMIN === '1') { a.pw = hash(pw); a.mustChange = !process.env.ADMIN_PASSWORD; return true; }
  return false;
}

/* ---------- persistence: JSON recovery snapshot + MySQL primary store ----------
 * MySQL (when DB_* is configured) is the authoritative store. Nothing in this file ever DROPs, TRUNCATEs or resets a table:
 *  - schema changes are additive only (CREATE TABLE IF NOT EXISTS / ADD COLUMN when missing)
 *  - every application upgrade takes a 'pre-migration' backup before the stored state is touched
 *  - an empty crm_state with existing backups is RECOVERED from the newest backup, never replaced with a blank CRM
 *  - a write is refused if MySQL already holds a newer revision (no overwriting newer data)
 *  - failed writes are retried automatically with back-off
 */
const PKG_VERSION = (() => { try { return require('../package.json').version; } catch { return 'unknown'; } })();
let timer = null, dirty = false, lastBackup = 0;
let pool = null, mysqlEnabled = false, initialized = false, mysqlQueue = Promise.resolve();
let mysqlRevision = 0, persistedRevision = 0, mysqlLastError = '', mysqlLastWriteAt = '', mysqlLastPingAt = 0;
let retryTimer = null, retryDelay = 0, writeConflict = false, recovered = '';
const BACKUP_INTERVAL_MS = Math.max(60 * 60 * 1000, +(process.env.DB_BACKUP_INTERVAL_MS || 6 * 60 * 60 * 1000));
const BACKUP_KEEP = Math.max(5, Math.min(240, +(process.env.DB_BACKUP_KEEP || 30)));
const DAILY_KEEP = Math.max(7, Math.min(730, +(process.env.DB_BACKUP_DAILY_KEEP || 90)));
const LOCAL_KEEP = Math.max(3, Math.min(90, +(process.env.LOCAL_BACKUP_KEEP || 14)));

function mysqlConfig() {
  const keys = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const supplied = keys.some(k => process.env[k] !== undefined && process.env[k] !== '');
  if (!supplied) return { enabled: false };
  const missing = keys.filter(k => !process.env[k]);
  if (missing.length) throw new Error('MySQL configuration is incomplete. Missing: ' + missing.join(', '));
  return { enabled: true, host: process.env.DB_HOST, port: Math.max(1, +(process.env.DB_PORT || 3306)), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: /^(1|true|yes)$/i.test(process.env.DB_SSL || '') };
}

function writeLocalSnapshot(json) {
  const tmp = DBF + '.tmp';
  fs.writeFileSync(tmp, json, { mode: 0o600 });
  fs.renameSync(tmp, DBF);
  if (Date.now() - lastBackup > 864e5) {
    lastBackup = Date.now();
    try {
      fs.copyFileSync(DBF, path.join(DATA, 'backups', 'db-' + new Date().toISOString().slice(0, 10) + '.json'));
      const fl = fs.readdirSync(path.join(DATA, 'backups')).filter(f => /^db-.*\.json$/.test(f)).sort();
      fl.slice(0, Math.max(0, fl.length - LOCAL_KEEP)).forEach(f => fs.unlinkSync(path.join(DATA, 'backups', f)));
    } catch (e) { console.warn('Local backup warning:', e.message); }
  }
}

/** order-independent JSON so "did the data really change?" is not fooled by key ordering */
function canon(v) { return JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x)); }

async function ensureColumn(conn, table, column, ddl) {
  const [r] = await conn.query('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table, column]);
  if (!Number(r[0].n)) await conn.query('ALTER TABLE `' + table + '` ADD COLUMN ' + ddl);
}

async function createMysqlSchema(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS crm_state (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    revision BIGINT UNSIGNED NOT NULL,
    payload LONGTEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await conn.query(`CREATE TABLE IF NOT EXISTS crm_state_backups (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    revision BIGINT UNSIGNED NOT NULL,
    payload LONGTEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_crm_state_backups_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  // additive upgrades of the backup table (older installs only had revision/payload/created_at)
  await ensureColumn(conn, 'crm_state_backups', 'kind', "kind VARCHAR(20) NOT NULL DEFAULT 'auto'");
  await ensureColumn(conn, 'crm_state_backups', 'note', "note VARCHAR(255) NOT NULL DEFAULT ''");
  await ensureColumn(conn, 'crm_state_backups', 'size_bytes', 'size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0');
  // uploaded files (receipts, KYC documents, logo, promotion images) are mirrored here so a redeploy can never lose them
  await conn.query(`CREATE TABLE IF NOT EXISTS crm_files (
    path VARCHAR(255) NOT NULL PRIMARY KEY,
    size_bytes BIGINT UNSIGNED NOT NULL,
    sha256 CHAR(64) NOT NULL,
    data LONGBLOB NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function insertBackup(conn, revision, payload, kind, note) {
  await conn.execute('INSERT INTO crm_state_backups (revision, payload, kind, note, size_bytes) VALUES (?, ?, ?, ?, ?)', [Number(revision) || 0, payload, kind, String(note || '').slice(0, 255), Buffer.byteLength(payload)]);
}

/** retention: only 'auto' and 'daily' copies are pruned; pre-migration / pre-restore / manual / initial copies are kept */
async function pruneBackups(conn) {
  await conn.query("DELETE FROM crm_state_backups WHERE kind = 'auto' AND id NOT IN (SELECT id FROM (SELECT id FROM crm_state_backups WHERE kind = 'auto' ORDER BY id DESC LIMIT ?) keep_rows)", [BACKUP_KEEP]);
  await conn.query("DELETE FROM crm_state_backups WHERE kind = 'daily' AND id NOT IN (SELECT id FROM (SELECT id FROM crm_state_backups WHERE kind = 'daily' ORDER BY id DESC LIMIT ?) keep_rows)", [DAILY_KEEP]);
}

async function mysqlWriteSnapshot(json, revision) {
  if (!pool) return;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT revision, payload, updated_at FROM crm_state WHERE id = 1 FOR UPDATE');
    if (!rows.length) {
      await conn.execute('INSERT INTO crm_state (id, revision, payload) VALUES (1, ?, ?)', [revision, json]);
      await insertBackup(conn, revision, json, 'initial', 'first state written');
    } else {
      const current = Number(rows[0].revision || 0);
      if (current > revision) { writeConflict = true; throw new Error('MySQL revision is newer than this CRM process. Refusing to overwrite newer data.'); }
      if (current === revision && rows[0].payload !== json) {
        let same = false;
        try { same = JSON.stringify(JSON.parse(rows[0].payload)) === json; } catch {}
        if (!same) { writeConflict = true; throw new Error('Concurrent CRM write conflict at revision ' + revision + '. Refusing to overwrite another running process.'); }
      }
      if (current < revision) {
        // The restore point is the last known-good state BEFORE this write. Due-ness is measured from the last backup, not the last write.
        const [age] = await conn.query("SELECT TIMESTAMPDIFF(SECOND, MAX(created_at), NOW()) AS s FROM crm_state_backups WHERE kind IN ('auto', 'daily')");
        const [today1] = await conn.query("SELECT COUNT(*) AS n FROM crm_state_backups WHERE kind = 'daily' AND created_at >= CURDATE()");
        if (!Number(today1[0].n)) await insertBackup(conn, current, rows[0].payload, 'daily', 'daily restore point');
        else if (age[0].s === null || Number(age[0].s) * 1000 >= BACKUP_INTERVAL_MS) await insertBackup(conn, current, rows[0].payload, 'auto', 'scheduled restore point');
        await conn.execute('UPDATE crm_state SET revision = ?, payload = ? WHERE id = 1', [revision, json]);
      }
    }
    await conn.commit();
    mysqlRevision = Math.max(mysqlRevision, revision);
    persistedRevision = Math.max(persistedRevision, revision);
    mysqlLastError = ''; mysqlLastWriteAt = new Date().toISOString(); retryDelay = 0;
    try { await pruneBackups(conn); } catch (e) { console.warn('Backup retention warning:', e.message); }
  } catch (e) {
    try { await conn.rollback(); } catch {}
    mysqlLastError = e.message;
    throw e;
  } finally { conn.release(); }
}

function scheduleRetry() {
  if (retryTimer || writeConflict || !pool) return;
  retryDelay = Math.min(60000, retryDelay ? retryDelay * 2 : 3000);
  retryTimer = setTimeout(() => { retryTimer = null; dirty = true; try { writeNow(); } catch (e) { console.error('retry failed', e); } }, retryDelay);
  if (retryTimer.unref) retryTimer.unref();
}

function queueMysqlSnapshot(json, revision) {
  if (!pool) return mysqlQueue;
  mysqlQueue = mysqlQueue.then(() => mysqlWriteSnapshot(json, revision)).catch(e => {
    mysqlLastError = e.message;
    console.error('MySQL persistence failed (will retry' + (writeConflict ? ' - NOT retrying: write conflict' : '') + '):', e.message);
    scheduleRetry();
  });
  return mysqlQueue;
}

function writeNow() {
  if (!dirty) return;
  dirty = false;
  const json = JSON.stringify(db), revision = Number(db.rev || 1);
  writeLocalSnapshot(json);
  if (pool) queueMysqlSnapshot(json, revision);
}

const hooks = []; let inHook = false;
function save() {
  if (!inHook) { inHook = true; try { hooks.forEach(h => h()); } catch (e) { console.error('hook failed', e); } finally { inHook = false; } }
  db.rev++; dirty = true;
  if (!timer) timer = setTimeout(() => { timer = null; try { writeNow(); } catch (e) { console.error('save failed', e); } }, 120);
}
function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  try { writeNow(); } catch (e) { console.error('flush failed', e); }
}
async function flushAsync() { flush(); await mysqlQueue; if (dirty) { flush(); await mysqlQueue; } }

async function init() {
  if (initialized) return;
  const cfg = mysqlConfig();
  if (!cfg.enabled && /^(1|true|yes)$/i.test(process.env.REQUIRE_MYSQL || '')) throw new Error('REQUIRE_MYSQL is set but DB_HOST / DB_NAME / DB_USER / DB_PASSWORD are not configured. Refusing to start on temporary JSON storage.');
  if (cfg.enabled) {
    mysqlEnabled = true;
    const DATA_ABS = path.resolve(DATA), APP_ABS = path.resolve(__dirname, '..');
    // Uploaded files are mirrored into MySQL (crm_files) and restored at start, so a deployment-local DATA_DIR is safe now. Warn, don't crash.
    if (DATA_ABS === APP_ABS || DATA_ABS.startsWith(APP_ABS + path.sep)) console.warn('NOTE: DATA_DIR is inside the application folder. MySQL is the permanent store and uploaded files are mirrored in MySQL, so redeploys are safe; for best performance set DATA_DIR to a folder outside the app (e.g. /home/<user>/umrah-data).');
    let mysql;
    try { mysql = require('mysql2/promise'); } catch { throw new Error('mysql2 is required for MySQL mode. Deploy with npm install after adding the mysql2 dependency.'); }
    pool = mysql.createPool({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, waitForConnections: true, connectionLimit: Math.max(2, +(process.env.DB_POOL_SIZE || 5)), queueLimit: 0, charset: 'utf8mb4', timezone: 'Z', ssl: cfg.ssl ? {} : undefined, enableKeepAlive: true, keepAliveInitialDelay: 0 });
    await pool.query('SELECT 1');
    await createMysqlSchema(pool);
    const [rows] = await pool.execute('SELECT revision, payload FROM crm_state WHERE id = 1');
    if (rows.length) {
      let stored;
      try { stored = JSON.parse(rows[0].payload); } catch { throw new Error('MySQL crm_state.payload contains invalid JSON. Startup stopped to protect CRM data.'); }
      // SAFE MIGRATION: when the application version changed, snapshot the stored state first.
      if (stored && stored.appVersion !== PKG_VERSION) {
        await insertBackup(pool, rows[0].revision, rows[0].payload, 'pre-migration', 'before upgrade ' + (stored.appVersion || 'unversioned') + ' -> ' + PKG_VERSION);
        console.log('Pre-migration backup stored (' + (stored.appVersion || 'unversioned') + ' -> ' + PKG_VERSION + ')');
      }
      const before = canon(stored);
      const restored = normalizeState(stored);
      restored.appVersion = PKG_VERSION;
      const changed = before !== canon(restored);
      replaceState(restored);
      mysqlRevision = Number(rows[0].revision || restored.rev || 1);
      persistedRevision = mysqlRevision;
      if (changed || Number(db.rev || 1) !== mysqlRevision) { db.rev = Math.max(Number(db.rev || 1), mysqlRevision) + 1; dirty = true; }
    } else {
      const [bk] = await pool.query('SELECT id, revision, payload, kind, created_at FROM crm_state_backups ORDER BY id DESC LIMIT 20');
      let seed = null;
      for (const b of bk) { try { const o = JSON.parse(b.payload); if (o && typeof o === 'object') { seed = { o, b }; break; } } catch { /* try an older backup */ } }
      // A local db.json snapshot is rewritten on every save, so when it is at least as new as the newest backup it is the better source.
      if (seed && !fresh && !localParseError && Number(db.rev || 0) >= Number(seed.b.revision || 0)) seed = null;
      if (seed) {
        // crm_state is empty but backups exist: never start a blank CRM. Recover the newest valid backup.
        replaceState(normalizeState(seed.o)); db.rev = Math.max(Number(db.rev || 1), Number(seed.b.revision || 0)) + 1;
        db.appVersion = PKG_VERSION; recovered = 'Recovered CRM state from backup #' + seed.b.id + ' (' + seed.b.kind + ', revision ' + seed.b.revision + ') because crm_state was empty.';
        console.warn('RECOVERY: ' + recovered);
      } else {
        if (localParseError) throw new Error('The local db.json exists but is invalid, and MySQL has no saved CRM record. Startup stopped to avoid importing an empty database.');
        replaceState(normalizeState(db || blank())); db.appVersion = PKG_VERSION;
      }
      const initial = JSON.stringify(db);
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.execute('INSERT INTO crm_state (id, revision, payload) VALUES (1, ?, ?)', [Number(db.rev || 1), initial]);
        await insertBackup(conn, db.rev, initial, 'initial', seed ? 'recovered state' : (fresh ? 'new database' : 'imported from local db.json'));
        await conn.commit();
      } catch (e) { try { await conn.rollback(); } catch {} throw e; }
      finally { conn.release(); }
      mysqlRevision = Number(db.rev || 1); persistedRevision = mysqlRevision;
    }
    const before = canon(db);
    ensureAdmin();
    if (before !== canon(db)) { db.rev = Math.max(Number(db.rev || 1), mysqlRevision) + 1; dirty = true; }
    // Always refresh the local recovery snapshot from the authoritative MySQL row.
    dirty = true; writeNow();
    await mysqlQueue;
    if (mysqlLastError) throw new Error('MySQL initial persistence failed: ' + mysqlLastError);
    console.log('Storage driver: MySQL (crm_state + crm_state_backups + crm_files)');
    console.log('MySQL database connected; persisted revision ' + persistedRevision);
  } else {
    replaceState(normalizeState(db || blank()));
    db.appVersion = PKG_VERSION;
    ensureAdmin();
    dirty = true; writeNow();
    console.warn('Storage driver: JSON (DATA_DIR/db.json). MySQL environment variables are NOT configured - data lives only in ' + DBF + '. Set DB_HOST, DB_NAME, DB_USER and DB_PASSWORD for permanent storage.');
  }
  initialized = true;
}

/* ---------- backup management (MySQL) ---------- */
const needMysql = () => { if (!pool) fail('Backups are stored in MySQL, which is not configured on this server.'); };
async function listBackups(limit = 200) {
  needMysql();
  const [r] = await pool.query('SELECT id, revision, kind, note, size_bytes, created_at FROM crm_state_backups ORDER BY id DESC LIMIT ?', [Math.max(1, Math.min(1000, +limit || 200))]);
  return r.map(x => ({ id: Number(x.id), revision: Number(x.revision), kind: x.kind, note: x.note, size: Number(x.size_bytes), at: new Date(x.created_at).toISOString() }));
}
async function createBackup(note, kind = 'manual') {
  needMysql(); await flushAsync();
  const json = JSON.stringify({ ...db, sessions: {} });
  await insertBackup(pool, db.rev, json, kind, note || 'manual backup');
  const [r] = await pool.query('SELECT LAST_INSERT_ID() AS id'); return { id: Number(r[0].id), revision: Number(db.rev), size: Buffer.byteLength(json) };
}
async function getBackup(id) {
  needMysql();
  const [r] = await pool.execute('SELECT id, revision, kind, note, payload, created_at FROM crm_state_backups WHERE id = ?', [Number(id) || 0]);
  if (!r.length) fail('Backup not found'); return r[0];
}
/** Restores a backup into the live CRM. Always takes a 'pre-restore' copy of the current state first; the current administrator password is kept. */
async function restoreBackup(id) {
  const b = await getBackup(id);
  let parsed; try { parsed = JSON.parse(b.payload); } catch { fail('That backup is corrupt and cannot be restored'); }
  const next = normalizeState(parsed);
  await flushAsync();
  await insertBackup(pool, db.rev, JSON.stringify(db), 'pre-restore', 'before restoring backup #' + b.id);
  const curAdmin = db.users.find(u => u.id === 'admin'), keepSessions = db.sessions;
  next.sessions = keepSessions; next.appVersion = PKG_VERSION;
  next.rev = Math.max(Number(db.rev || 1), Number(b.revision || 0)) + 1;
  if (curAdmin) { const i = next.users.findIndex(u => u.id === 'admin'); if (i >= 0) next.users[i] = { ...next.users[i], pw: curAdmin.pw, mustChange: curAdmin.mustChange }; else next.users.unshift(curAdmin); }
  replaceState(next); ensureAdmin(); dirty = true; writeNow(); await mysqlQueue;
  if (mysqlLastError) fail('Restore was applied in memory but could not be saved: ' + mysqlLastError);
  return { restoredFrom: Number(b.id), revision: Number(db.rev) };
}

async function health() {
  const base = { driver: mysqlEnabled ? 'mysql' : 'json', configured: mysqlEnabled, revision: Number(db.rev || 1), persistedRevision, lastWriteAt: mysqlLastWriteAt || null };
  if (recovered) base.recovered = recovered;
  if (!mysqlEnabled) return { ...base, connected: false, healthy: false, note: 'MySQL environment variables are not configured: data is on temporary JSON storage.' };
  let connected = false, error = mysqlLastError;
  try { await pool.query('SELECT 1'); connected = true; mysqlLastPingAt = Date.now(); if (!error) mysqlLastError = ''; }
  catch (e) { error = e.message; mysqlLastError = error; }
  // A persistence lag is normal only while a write is pending and not failing; otherwise MySQL is behind memory.
  const lag = persistedRevision < Number(db.rev || 1), pending = (dirty || !!timer) && !retryTimer;
  const healthy = connected && !mysqlLastError && !writeConflict && (!lag || pending);
  return { ...base, connected, healthy, error: error || (writeConflict ? 'write conflict: another CRM process holds newer data' : null) };
}
/** admin-only detail: what is stored where */
async function storageStatus() {
  const h = await health(), out = { ...h, appVersion: PKG_VERSION, dataDir: DATA, retentionAuto: BACKUP_KEEP, retentionDaily: DAILY_KEEP, records: { users: db.users.length, parties: db.parties.length, bookings: db.bookings.length, vouchers: db.vouchers.length, payments: db.payments.length, ledgerEntries: db.entries.length, expenses: db.expenses.length, queries: db.queries.length, groups: db.groups.length, hotels: db.hotels.length } };
  if (pool) {
    try {
      const [b] = await pool.query('SELECT COUNT(*) AS n, MAX(created_at) AS last, COALESCE(SUM(size_bytes),0) AS bytes FROM crm_state_backups');
      const [f] = await pool.query('SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes),0) AS bytes FROM crm_files');
      const [s] = await pool.query('SELECT revision, updated_at, CHAR_LENGTH(payload) AS chars FROM crm_state WHERE id = 1');
      out.backups = { count: Number(b[0].n), last: b[0].last ? new Date(b[0].last).toISOString() : null, bytes: Number(b[0].bytes) };
      out.files = { count: Number(f[0].n), bytes: Number(f[0].bytes) };
      out.stateRow = s.length ? { revision: Number(s[0].revision), updatedAt: new Date(s[0].updated_at).toISOString(), chars: Number(s[0].chars) } : null;
    } catch (e) { out.detailError = e.message; }
  }
  return out;
}

// Normalize the shared object at module load so modules that capture D.db keep the same reference.
db = normalizeState(db || blank());

/* ---------- helpers ---------- */
const nid = () => ++db.seq;
const today = () => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: db.settings.tz || 'Asia/Karachi' }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); } };
const fail = (m, x) => { throw Object.assign(new Error(m), x || {}); };
const need = (c, m = 'Not allowed') => { if (!c) fail(m); };
const str = (v, n = 200) => String(v == null ? '' : v).trim().slice(0, n);
const num = v => Math.max(0, Math.round(+String(v == null ? 0 : v).replace(/[^0-9.\-]/g, '') || 0));
const isoDate = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
const logAct = (u, a, d) => { db.log.push({ t: new Date().toISOString(), u: u ? u.name : 'system', a, d: str(d, 240) }); if (db.log.length > 4000) db.log.splice(0, db.log.length - 4000); };
const party = id => db.parties.find(p => p.id == id);
const token = (n = 18) => crypto.randomBytes(n).toString('base64url');
const uniqueNo = () => makeNo(db, new Set(db.bookings.map(b => b.no)));

module.exports = { hooks, get db() { return db; }, DATA, fresh, hash, check, save, flush, flushAsync, init, health, storageStatus, listBackups, createBackup, getBackup, restoreBackup, get pool() { return pool; }, mysqlEnabled: () => mysqlEnabled, nid, today, fail, need, str, num, isoDate, logAct, party, token, uniqueNo, DEFAULT_ADMIN_PASSWORD };
