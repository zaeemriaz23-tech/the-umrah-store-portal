'use strict';
/**
 * Durable copy of every uploaded file (payment receipts, partner KYC documents, logo, promotion images) in MySQL table crm_files.
 *
 * Why: files are written under DATA_DIR on disk. On a Git-driven host the application folder is replaced on every deploy, so
 * anything stored there can vanish. MySQL is the permanent store, therefore each file is mirrored there and any file missing
 * on disk is restored from MySQL at start-up. Rules, deliberately conservative:
 *   - a file is never overwritten on disk by a restore (restore only fills gaps)
 *   - existing files on disk that MySQL does not have yet are uploaded once (backfill), so current files are migrated
 *   - nothing is deleted from MySQL unless the CRM itself deleted/replaced that file (logo reset, promotion image replaced)
 *   - without MySQL every function is a harmless no-op and the app keeps using DATA_DIR only
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const D = require('./db');

const TRACKED = ['receipts', 'promos', 'kyc', 'brand'];
const MAX_BYTES = 24 * 1024 * 1024;
const stats = { mirrored: 0, restored: 0, backfilled: 0, errors: 0, lastError: '', skippedTooLarge: 0 };
let queue = Promise.resolve();

const on = () => !!D.mysqlEnabled() && !!D.pool;
const norm = rel => String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
/** only tracked folders; brand/ is limited to its top level (brand/airlines/ is a re-downloadable cache) */
function ok(rel) {
  rel = norm(rel); const parts = rel.split('/');
  if (!rel || rel.length > 250 || parts.includes('..') || parts.includes('.') || parts.some(p => !p)) return false;
  if (!TRACKED.includes(parts[0])) return false;
  if (parts[0] === 'brand' && parts.length !== 2) return false;
  return parts.length >= 2;
}
const enqueue = fn => { queue = queue.then(fn).catch(e => { stats.errors++; stats.lastError = e.message; console.error('File mirror warning:', e.message); }); return queue; };

/** mirror one file (call right after writing it to disk) */
function put(rel, buf) {
  rel = norm(rel); if (!on() || !ok(rel)) return Promise.resolve();
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length > MAX_BYTES) { stats.skippedTooLarge++; console.warn('File mirror: ' + rel + ' is larger than ' + MAX_BYTES + ' bytes and was not mirrored'); return Promise.resolve(); }
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  return enqueue(async () => {
    await D.pool.execute('INSERT INTO crm_files (path, size_bytes, sha256, data) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE size_bytes = ?, sha256 = ?, data = ?', [rel, buf.length, sha, buf, buf.length, sha, buf]);
    stats.mirrored++;
  });
}
/** forget one file (call only when the CRM itself deletes or replaces it) */
function del(rel) {
  rel = norm(rel); if (!on() || !ok(rel)) return Promise.resolve();
  return enqueue(async () => { await D.pool.execute('DELETE FROM crm_files WHERE path = ?', [rel]); });
}
async function flush() { await queue; }

/** read a file from MySQL (used as a fallback when a file is missing on disk) */
async function get(rel) {
  rel = norm(rel); if (!on() || !ok(rel)) return null;
  const [r] = await D.pool.execute('SELECT data FROM crm_files WHERE path = ?', [rel]);
  return r.length ? r[0].data : null;
}

function walk(dir, base, out) {
  let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of list) {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) { if (rel !== 'brand/airlines') walk(path.join(dir, e.name), rel, out); }
    else if (e.isFile() && !/\.tmp$/.test(e.name)) out.push(rel);
  }
  return out;
}
const localFiles = () => TRACKED.flatMap(t => walk(path.join(D.DATA, t), t, [])).filter(ok);

/** at start-up: bring back every file MySQL has but the disk lost. Never overwrites an existing file. */
async function restoreMissing() {
  if (!on()) return { restored: 0, skipped: true };
  const [rows] = await D.pool.query('SELECT path, size_bytes FROM crm_files');
  let n = 0;
  for (const r of rows) {
    const rel = norm(r.path); if (!ok(rel)) continue;
    const dest = path.join(D.DATA, rel);
    if (fs.existsSync(dest)) continue;
    const [d] = await D.pool.execute('SELECT data FROM crm_files WHERE path = ?', [rel]);
    if (!d.length) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.tmp'; fs.writeFileSync(tmp, d[0].data); fs.renameSync(tmp, dest); n++;
  }
  stats.restored += n;
  if (n) console.log('Restored ' + n + ' uploaded file(s) from MySQL into ' + D.DATA);
  return { restored: n };
}

/** at start-up: upload files that exist on disk but are not in MySQL yet (migrates all existing files once) */
async function backfill() {
  if (!on()) return { uploaded: 0, skipped: true };
  const [rows] = await D.pool.query('SELECT path FROM crm_files');
  const have = new Set(rows.map(r => norm(r.path)));
  let n = 0;
  for (const rel of localFiles()) {
    if (have.has(rel)) continue;
    let buf; try { buf = fs.readFileSync(path.join(D.DATA, rel)); } catch { continue; }
    if (buf.length > MAX_BYTES) { stats.skippedTooLarge++; continue; }
    await put(rel, buf); n++;
  }
  await queue; stats.backfilled += n;
  if (n) console.log('Migrated ' + n + ' existing uploaded file(s) into MySQL (crm_files)');
  return { uploaded: n };
}

/** compare disk and MySQL (admin status page) */
async function status() {
  if (!on()) return { enabled: false };
  const [rows] = await D.pool.query('SELECT path FROM crm_files');
  const have = new Set(rows.map(r => norm(r.path))), local = localFiles();
  return { enabled: true, inMysql: have.size, onDisk: local.length, notInMysql: local.filter(f => !have.has(f)).length, missingOnDisk: [...have].filter(f => !fs.existsSync(path.join(D.DATA, f))).length, ...stats };
}

module.exports = { put, del, get, flush, restoreMissing, backfill, status, stats, ok };
