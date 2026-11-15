'use strict';
/**
 * Cloudflare R2 database-only backups.
 * - MySQL crm_state only; crm_files and local uploads are deliberately excluded.
 * - R2 S3-compatible API signed with AWS Signature Version 4 (no third-party SDK).
 * - Archive is gzip-compressed and AES-256-GCM encrypted before upload.
 * - MySQL GET_LOCK + persistent run keys prevent concurrent / duplicate daily runs.
 */
const crypto = require('crypto');
const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');
const D = require('./db');

const MAGIC = Buffer.from('TUSCR2B1', 'ascii');
const LOCK_NAME = 'the_umrah_store_cloud_backup_v1';
const DAILY_HOUR = 2;
const RETENTION_DAILY = 30;
const RETRY_MINUTES = 15;
const RUNNING = new Set();
let scheduler = null;
let lastSchedulerError = '';
let testTransport = null; // injected only by the isolated unit tests

function masterSecret() {
  // Deliberately require an independent stable key. Reusing DB_PASSWORD would make old
  // archives undecryptable after an ordinary database-password rotation.
  const value = String(process.env.CLOUD_BACKUP_ENCRYPTION_KEY || '');
  if (value.length < 32) throw new Error('Set a stable CLOUD_BACKUP_ENCRYPTION_KEY of at least 32 characters before saving R2 credentials.');
  return value;
}
function deriveKey(secret, salt) {
  return crypto.scryptSync(secret, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
function sealJson(value, purpose) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = deriveKey(masterSecret() + ':' + purpose, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value), 'utf8')), cipher.final()]);
  return Buffer.concat([Buffer.from('TUSCFG01'), salt, iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}
function openJson(blob, purpose) {
  if (!blob) return null;
  const raw = Buffer.from(String(blob), 'base64');
  if (raw.length < 52 || raw.subarray(0, 8).toString('ascii') !== 'TUSCFG01') throw new Error('Saved Cloud Backup credentials cannot be decoded. Re-enter the R2 credentials.');
  const salt = raw.subarray(8, 24), iv = raw.subarray(24, 36), tag = raw.subarray(36, 52), ciphertext = raw.subarray(52);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(masterSecret() + ':' + purpose, salt), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}

function storedConfig() {
  const s = D.db.settings.cloudBackup || {};
  if (!s.encryptedConfig) return null;
  return openJson(s.encryptedConfig, 'r2-credentials');
}
function validateConfig(input) {
  const accountId = String(input.accountId || '').trim();
  const bucket = String(input.bucket || '').trim();
  const endpoint = String(input.endpoint || '').trim();
  const accessKeyId = String(input.accessKeyId || '').trim();
  const secretAccessKey = String(input.secretAccessKey || '');
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('Cloudflare Account ID must be 32 hexadecimal characters.');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..')) throw new Error('Enter a valid R2 bucket name (lowercase letters, numbers, dots and hyphens).');
  let u;
  try { u = new URL(endpoint); } catch { throw new Error('Enter the full S3 API Endpoint, for example https://ACCOUNT_ID.r2.cloudflarestorage.com.'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/') || (u.port && u.port !== '443')) throw new Error('The R2 S3 API Endpoint must be an HTTPS account endpoint without a path, query or credentials.');
  const baseHost = accountId.toLowerCase() + '.r2.cloudflarestorage.com';
  const permittedHosts = new Set([baseHost, accountId.toLowerCase() + '.eu.r2.cloudflarestorage.com', accountId.toLowerCase() + '.us.r2.cloudflarestorage.com', accountId.toLowerCase() + '.fedramp.r2.cloudflarestorage.com']);
  if (!permittedHosts.has(u.hostname.toLowerCase())) throw new Error('The S3 API Endpoint host must match the Cloudflare Account ID and use a supported R2 endpoint (default, EU, US or FedRAMP).');
  if (!/^[A-Za-z0-9/+=._-]{8,256}$/.test(accessKeyId)) throw new Error('Enter a valid R2 Access Key ID.');
  if (secretAccessKey.length < 16 || secretAccessKey.length > 256) throw new Error('Enter the R2 Secret Access Key (16–256 characters).');
  return { accountId, bucket, endpoint: u.origin, accessKeyId, secretAccessKey };
}
function saveConfig(input) {
  if (!D.mysqlEnabled()) throw new Error('Cloud backups require the existing production MySQL storage. Configure MySQL first; no local-only cloud backup fallback is allowed.');
  let old = null, oldConfigError = null;
  try { old = storedConfig() || {}; } catch (e) { oldConfigError = e; }
  // If the server-side encryption key has changed, the previous secret cannot be recovered.
  // Require every field, including the secret, before replacing an unreadable credential blob.
  if (oldConfigError) {
    const complete = ['accountId', 'bucket', 'endpoint', 'accessKeyId', 'secretAccessKey'].every(k => String(input[k] || '').trim());
    if (!complete) throw new Error('The saved R2 credentials cannot be decrypted with the current server key. Re-enter all five R2 fields, including the Secret Access Key, to replace them safely.');
    old = {};
  }
  const merged = {
    accountId: String(input.accountId || old.accountId || '').trim(),
    bucket: String(input.bucket || old.bucket || '').trim(),
    endpoint: String(input.endpoint || old.endpoint || '').trim(),
    accessKeyId: String(input.accessKeyId || old.accessKeyId || '').trim(),
    secretAccessKey: String(input.secretAccessKey || old.secretAccessKey || '')
  };
  const config = validateConfig(merged);
  const encryptedConfig = sealJson(config, 'r2-credentials');
  D.db.settings.cloudBackup = { encryptedConfig, updatedAt: new Date().toISOString() };
  D.save();
  return { ok: true, config: safeConfig(config), updatedAt: D.db.settings.cloudBackup.updatedAt };
}
function safeConfig(c) {
  if (!c) return null;
  return { accountId: c.accountId, bucket: c.bucket, endpoint: c.endpoint, accessKeyId: c.accessKeyId, accessKeyHint: '••••' + c.accessKeyId.slice(-4) };
}
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function encryptArchive(archive) {
  const json = Buffer.from(JSON.stringify(archive), 'utf8');
  const gz = zlib.gzipSync(json, { level: 9 });
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = deriveKey(masterSecret(), salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(gz), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);
}
function decryptArchive(blob) {
  const b = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (b.length < 52 || !b.subarray(0, 8).equals(MAGIC)) throw new Error('The R2 object is not a supported The Umrah Store encrypted backup.');
  const salt = b.subarray(8, 24), iv = b.subarray(24, 36), tag = b.subarray(36, 52), ciphertext = b.subarray(52);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(masterSecret(), salt), iv);
  decipher.setAuthTag(tag);
  let compressed;
  try { compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]); }
  catch { throw new Error('Backup encryption authentication failed. The file may be damaged or the encryption key has changed.'); }
  let json;
  try { json = zlib.gunzipSync(compressed, { maxOutputLength: 512 * 1024 * 1024 }); }
  catch { throw new Error('Backup compression data is invalid or exceeds the restore safety limit.'); }
  let archive;
  try { archive = JSON.parse(json.toString('utf8')); } catch { throw new Error('Decrypted backup is not valid JSON.'); }
  if (archive.format !== 'TheUmrahStoreCRMCloudBackup' || archive.formatVersion !== 1 || !archive.state || Number(archive.state.v) < 3) throw new Error('This file does not contain a supported CRM database backup.');
  return archive;
}
function stripUploadPayloads(input) {
  const value = JSON.parse(JSON.stringify(input));
  const walk = (node, parentKey = '') => {
    if (Array.isArray(node)) return node.map(x => walk(x, parentKey));
    if (!node || typeof node !== 'object') {
      if (typeof node === 'string' && /^data:[^,]{1,160};base64,/i.test(node)) return '';
      return node;
    }
    const out = {};
    for (const [key, raw] of Object.entries(node)) {
      const k = key.toLowerCase();
      // Encryption credentials are server configuration, not CRM business records; restore keeps the current config.
      if (k === 'cloudbackup' && parentKey.toLowerCase() === 'settings') continue;
      // Actual file bytes and in-record data URLs are omitted; file names, paths and business records stay.
      if (/^(?:filedata|rawfile|filebytes|binarydata|contentbase64|attachmentdata|uploadpayload|base64|binary|blobbytes)$/.test(k)) continue;
      const fileContext = /(?:file|attach|document|receipt|proof|image|upload|kyc|scan|photo|signature|avatar)/i.test(parentKey);
      if (typeof raw === 'string' && fileContext && /^(?:data|content|body|payload|bytes|blob)$/i.test(k) && raw.length > 0) continue;
      // Some legacy image/document fields stored naked base64 rather than a data: URL.
      // Remove it only from file-like fields; ordinary identifiers and file paths remain intact.
      const fileField = /(?:file|attach|document|receipt|proof|image|upload|kyc|scan|photo|signature|avatar|logo|qr)/i.test(k) || /^(?:img|photo|signature|avatar|qr)$/i.test(k);
      if (typeof raw === 'string' && fileField) {
        const candidate = raw.trim();
        if (/^data:[^,]{1,160};base64,/i.test(candidate) || (candidate.length >= 64 && candidate.length % 4 === 0 && /^[A-Za-z0-9+/=\r\n]+$/.test(candidate))) continue;
      }
      if (k === 'data' && typeof raw === 'string' && (fileContext || (raw.length > 2048 && /^[a-z0-9+/=\r\n]+$/i.test(raw)) || /^data:[^,]+;base64,/i.test(raw))) continue;
      if ((k === 'logo' || k === 'qr') && typeof raw === 'string' && /^data:image\//i.test(raw)) { out[key] = ''; continue; }
      out[key] = walk(raw, key);
    }
    return out;
  };
  const clean = walk(value);
  clean.sessions = {};
  if (clean.settings && Array.isArray(clean.settings.bank)) clean.settings.bank = clean.settings.bank.map(b => ({ ...b, logo: '', qr: '' }));
  return clean;
}

function enc(s) { return encodeURIComponent(String(s)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()); }
function canonicalPath(pathname) { return pathname.split('/').map((p, i) => i === 0 ? '' : enc(decodeURIComponent(p))).join('/') || '/'; }
function canonicalQuery(query) {
  return Object.entries(query || {}).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map(x => [enc(k), enc(x)]))
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])).map(x => x[0] + '=' + x[1]).join('&');
}
function hmac(key, value, encoding) { const h = crypto.createHmac('sha256', key).update(value); return encoding ? h.digest(encoding) : h.digest(); }
function signedRequest(method, key, body, query, extraHeaders, config) {
  const endpoint = new URL(config.endpoint), objectPath = '/' + enc(config.bucket) + (key ? '/' + String(key).split('/').map(enc).join('/') : '');
  const pathname = canonicalPath(objectPath), q = canonicalQuery(query);
  const payload = body ? (Buffer.isBuffer(body) ? body : Buffer.from(body)) : Buffer.alloc(0);
  const payloadHash = sha256(payload), now = new Date(), amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), date = amzDate.slice(0, 8);
  const headers = { host: endpoint.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...(payload.length ? { 'content-length': String(payload.length) } : {}), ...(extraHeaders || {}) };
  const normalized = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const signedHeaders = Object.keys(normalized).sort().join(';');
  const canonicalHeaders = Object.keys(normalized).sort().map(k => k + ':' + normalized[k] + '\n').join('');
  const canonicalRequest = [method.toUpperCase(), pathname, q, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = date + '/auto/s3/aws4_request';
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(Buffer.from(canonicalRequest))].join('\n');
  const kDate = hmac(Buffer.from('AWS4' + config.secretAccessKey), date), kRegion = hmac(kDate, 'auto'), kService = hmac(kRegion, 's3'), kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign, 'hex');
  const auth = 'AWS4-HMAC-SHA256 Credential=' + config.accessKeyId + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
  return { endpoint, path: pathname + (q ? '?' + q : ''), headers: { ...normalized, authorization: auth }, body: payload };
}
function parseXml(text) {
  const unxml = s => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  const contents = [...String(text).matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(m => {
    const get = tag => { const x = m[1].match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>')); return x ? unxml(x[1]) : ''; };
    return { key: get('Key'), lastModified: get('LastModified'), size: Number(get('Size') || 0) };
  });
  const tokenMatch = String(text).match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
  return { contents, truncated: /<IsTruncated>true<\/IsTruncated>/i.test(String(text)), nextToken: tokenMatch ? unxml(tokenMatch[1]) : '' };
}
function httpRequest(method, key, body, query, extraHeaders, config) {
  const signed = signedRequest(method, key, body, query, extraHeaders, config);
  if (testTransport) return Promise.resolve(testTransport({ method: method.toUpperCase(), key, body: signed.body, query: query || {}, headers: signed.headers, path: signed.path, config })).then(r => {
    const status = Number(r && r.status || 0);
    if (status < 200 || status >= 300) {
      const detail = Buffer.isBuffer(r && r.body) ? r.body.toString('utf8').slice(0, 1200) : String(r && r.body || '').slice(0, 1200);
      throw new Error('Cloudflare R2 ' + method.toUpperCase() + ' failed (HTTP ' + status + ')' + (detail ? ': ' + detail.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''));
    }
    return r;
  });
  return new Promise((resolve, reject) => {
    const req = https.request({ protocol: 'https:', hostname: signed.endpoint.hostname, port: signed.endpoint.port || 443, method: method.toUpperCase(), path: signed.path, headers: signed.headers, timeout: 120000 }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 600 * 1024 * 1024) { req.destroy(new Error('R2 response exceeds the 600 MB safety limit.')); return; } chunks.push(chunk); });
      res.on('end', () => {
        const data = Buffer.concat(chunks), status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          let detail = data.toString('utf8').slice(0, 1200).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          reject(new Error('Cloudflare R2 ' + method.toUpperCase() + ' failed (HTTP ' + status + ')' + (detail ? ': ' + detail : ''))); return;
        }
        resolve({ status, headers: res.headers, body: data });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Cloudflare R2 request timed out.')));
    req.on('error', reject);
    if (signed.body.length) req.write(signed.body);
    req.end();
  });
}
const keyHeader = (key, value) => ({ ['x-amz-meta-' + key]: value });
async function putObject(config, key, blob, metadata = {}) {
  const headers = { 'content-type': 'application/octet-stream', ...Object.fromEntries(Object.entries(metadata).map(([k, v]) => ['x-amz-meta-' + k.toLowerCase(), String(v)])) };
  return httpRequest('PUT', key, blob, {}, headers, config);
}
async function headObject(config, key) { return httpRequest('HEAD', key, null, {}, {}, config); }
async function getObject(config, key) { const r = await httpRequest('GET', key, null, {}, {}, config); return r.body; }
async function deleteObject(config, key) { return httpRequest('DELETE', key, null, {}, {}, config); }
async function listObjects(config, prefix, continuationToken) {
  const q = { 'list-type': '2', 'max-keys': '1000', prefix };
  if (continuationToken) q['continuation-token'] = continuationToken;
  const r = await httpRequest('GET', '', null, q, {}, config);
  return parseXml(r.body.toString('utf8'));
}
async function listAll(config, prefix) {
  let token = '', out = [];
  do { const page = await listObjects(config, prefix, token); out.push(...page.contents); token = page.truncated ? page.nextToken : ''; if (page.truncated && !token) throw new Error('R2 returned a truncated object listing without a continuation token.'); } while (token);
  return out;
}
async function uploadAndVerify(config, objectKey, blob, revision) {
  const digest = sha256(blob);
  await putObject(config, objectKey, blob, { sha256: digest, revision: String(revision), format: 'tus-crm-db-v1' });
  const head = await headObject(config, objectKey);
  const remoteSize = Number(head.headers['content-length'] || 0), remoteDigest = String(head.headers['x-amz-meta-sha256'] || '');
  if (remoteSize !== blob.length || remoteDigest !== digest) throw new Error('R2 upload verification failed: the object size or SHA-256 metadata does not match.');
  const downloaded = await getObject(config, objectKey);
  if (downloaded.length !== blob.length || sha256(downloaded) !== digest) throw new Error('R2 upload verification failed: read-back SHA-256 does not match the uploaded backup.');
  const decoded = decryptArchive(downloaded);
  if (Number(decoded.revision) !== Number(revision)) throw new Error('R2 upload verification failed: the restored revision does not match the uploaded revision.');
  return { sha256: digest, size: blob.length };
}
async function pruneDaily(config, conn) {
  const objects = await listAll(config, 'database/daily/');
  objects.sort((a, b) => String(b.lastModified).localeCompare(String(a.lastModified)));
  const remove = objects.slice(RETENTION_DAILY);
  for (const o of remove) {
    await deleteObject(config, o.key);
    await conn.execute("UPDATE crm_cloud_backup_runs SET status = 'expired', deleted_at = NOW(), error = NULL WHERE object_key = ? AND status = 'success'", [o.key]);
  }
  return { deleted: remove.length, retained: Math.min(RETENTION_DAILY, objects.length) };
}
async function acquireLock() {
  const conn = await D.pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT GET_LOCK(?, 0) AS acquired', [LOCK_NAME]);
    if (Number(rows[0] && rows[0].acquired) !== 1) { conn.release(); return null; }
    return conn;
  } catch (e) { conn.release(); throw e; }
}
async function releaseLock(conn) {
  if (!conn) return;
  try { await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]); } catch {}
  conn.release();
}
async function runRow(conn, runKey) {
  const [rows] = await conn.execute('SELECT * FROM crm_cloud_backup_runs WHERE run_key = ? LIMIT 1', [runKey]);
  return rows[0] || null;
}
async function markStarted(conn, runKey, kind, who) {
  await conn.execute(`INSERT INTO crm_cloud_backup_runs (run_key, kind, status, attempts, triggered_by, last_attempt_at, error)
    VALUES (?, ?, 'running', 1, ?, NOW(), NULL)
    ON DUPLICATE KEY UPDATE status = 'running', attempts = attempts + 1, triggered_by = VALUES(triggered_by), last_attempt_at = NOW(), error = NULL`, [runKey, kind, String(who || 'scheduler').slice(0, 100)]);
}
async function markFailed(conn, runKey, error) {
  await conn.execute("UPDATE crm_cloud_backup_runs SET status = 'failed', error = ?, last_attempt_at = NOW() WHERE run_key = ?", [String(error && error.message || error || 'Unknown cloud backup failure').slice(0, 4000), runKey]);
}
async function markSuccess(conn, runKey, data) {
  await conn.execute("UPDATE crm_cloud_backup_runs SET status = 'success', object_key = ?, revision = ?, size_bytes = ?, sha256 = ?, completed_at = NOW(), error = ? WHERE run_key = ?", [data.objectKey, data.revision, data.size, data.sha256, data.warning ? String(data.warning).slice(0, 4000) : null, runKey]);
}
async function runBackup({ kind = 'manual', runKey = '', triggeredBy = 'administrator' } = {}) {
  if (!D.mysqlEnabled() || !D.pool) throw new Error('Cloud backups require the existing MySQL database. No local-only backup was created.');
  const daily = kind === 'daily';
  if (!runKey) runKey = daily ? 'daily:' + dateInPakistan(new Date()) : 'manual:' + crypto.randomUUID();
  if (RUNNING.has(runKey)) return { ok: false, skipped: true, reason: 'This backup is already running.' };
  const conn = await acquireLock();
  if (!conn) return { ok: false, skipped: true, reason: 'Another CRM process is already running a cloud backup.' };
  RUNNING.add(runKey);
  try {
    const old = await runRow(conn, runKey);
    if (old && old.status === 'success') return { ok: true, skipped: true, alreadyDone: true, objectKey: old.object_key, completedAt: old.completed_at };
    if (daily && old && old.last_attempt_at && Date.now() - new Date(old.last_attempt_at).getTime() < RETRY_MINUTES * 60000) return { ok: false, skipped: true, reason: 'The scheduled backup failed recently and is waiting for its retry window.' };
    const config = storedConfig();
    if (!config) throw new Error('Cloudflare R2 is not configured. Enter the R2 credentials in Admin → Settings → Cloud Backup first.');
    await markStarted(conn, runKey, kind, triggeredBy);
    try {
      const { revision, state } = await D.readPersistedState();
      const cleanState = stripUploadPayloads(state);
      const archive = { format: 'TheUmrahStoreCRMCloudBackup', formatVersion: 1, createdAt: new Date().toISOString(), timezone: 'Asia/Karachi', revision, content: 'crm_state database records only; crm_files/uploads excluded', state: cleanState };
      const blob = encryptArchive(archive);
      const now = new Date(), date = dateInPakistan(now), stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
      const objectKey = 'database/' + (daily ? 'daily/' : 'manual/') + date.slice(0, 4) + '/' + date.slice(5, 7) + '/the-umrah-store-crm-' + date + '-' + stamp + '-r' + revision + '.tusr2';
      const verified = await uploadAndVerify(config, objectKey, blob, revision);
      let warning = '';
      if (daily) {
        try { const p = await pruneDaily(config, conn); if (p.deleted) warning = 'Backup uploaded and verified; retention removed ' + p.deleted + ' older daily backup(s).'; }
        catch (e) { warning = 'Backup uploaded and verified, but 30-day retention cleanup failed: ' + e.message; }
      }
      await markSuccess(conn, runKey, { objectKey, revision, size: verified.size, sha256: verified.sha256, warning });
      return { ok: true, kind, objectKey, revision, size: verified.size, sha256: verified.sha256, warning, uploadsIncluded: false };
    } catch (e) {
      try { await markFailed(conn, runKey, e); } catch (historyErr) { console.error('Cloud backup failure could not be written to history:', historyErr.message); }
      throw e;
    }
  } finally { RUNNING.delete(runKey); await releaseLock(conn); }
}
async function restoreBackup(id) {
  if (!D.mysqlEnabled() || !D.pool) throw new Error('Cloud restore requires the existing MySQL database.');
  const conn = await acquireLock();
  if (!conn) throw new Error('Another backup or restore is running. Please retry in a moment.');
  try {
    const [rows] = await conn.execute("SELECT id, status, object_key, revision, sha256, size_bytes FROM crm_cloud_backup_runs WHERE id = ? LIMIT 1", [Number(id) || 0]);
    const row = rows[0];
    if (!row || row.status !== 'success' || !row.object_key) throw new Error('That R2 backup is not available for restore. It may have failed or expired.');
    const config = storedConfig();
    if (!config) throw new Error('Cloudflare R2 credentials are not configured.');
    const blob = await getObject(config, row.object_key);
    if (blob.length !== Number(row.size_bytes) || sha256(blob) !== String(row.sha256)) throw new Error('The downloaded R2 backup failed its SHA-256 or size verification. Nothing was restored.');
    const archive = decryptArchive(blob);
    if (Number(archive.revision) !== Number(row.revision)) throw new Error('The R2 backup revision does not match its verified history record. Nothing was restored.');
    const result = await D.restoreCloudState(archive.state);
    return { ok: true, restoredFrom: Number(row.id), objectKey: row.object_key, revision: result.revision, preRestoreBackupCreated: true, uploadsRestored: false };
  } finally { await releaseLock(conn); }
}

async function connectionTest() {
  const config = storedConfig();
  if (!config) throw new Error('Save the Cloudflare R2 credentials first.');
  const key = 'connection-test/' + Date.now() + '-' + crypto.randomBytes(6).toString('hex') + '.txt';
  const payload = Buffer.from('The Umrah Store CRM R2 connection verification · ' + new Date().toISOString(), 'utf8');
  let putDone = false;
  try {
    await putObject(config, key, payload, { sha256: sha256(payload), purpose: 'connection-test' }); putDone = true;
    const listed = await listObjects(config, 'connection-test/');
    if (!listed.contents.some(item => item.key === key)) throw new Error('R2 list permission test failed: the temporary object was not returned by ListObjectsV2.');
    const head = await headObject(config, key);
    if (Number(head.headers['content-length'] || 0) !== payload.length) throw new Error('R2 test object size verification failed.');
    const read = await getObject(config, key);
    if (sha256(read) !== sha256(payload)) throw new Error('R2 test object read-back verification failed.');
    await deleteObject(config, key); putDone = false;
    return { ok: true, tested: ['upload', 'head', 'download', 'sha256 verification', 'delete'], message: 'R2 connection and read/write permissions verified.' };
  } finally { if (putDone) { try { await deleteObject(config, key); } catch (e) { console.warn('R2 connection-test cleanup failed:', e.message); } } }
}
function dateInPakistan(date) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const v = Object.fromEntries(p.map(x => [x.type, x.value])); return v.year + '-' + v.month + '-' + v.day;
}
function timeInPakistan(date) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const v = Object.fromEntries(p.map(x => [x.type, x.value])); return { hour: Number(v.hour), minute: Number(v.minute) };
}
async function schedulerTick(now = new Date()) {
  if (!D.mysqlEnabled() || !D.pool) return { skipped: true, reason: 'MySQL is not configured.' };
  const t = timeInPakistan(now);
  if (t.hour < DAILY_HOUR) return { skipped: true, reason: 'The daily 02:00 Asia/Karachi backup time has not arrived.' };
  // A presence check avoids deriving the encryption key every 30-second scheduler poll.
  // runBackup decrypts credentials once, only when a run is actually due.
  if (!(D.db.settings.cloudBackup || {}).encryptedConfig) return { skipped: true, reason: 'Cloudflare R2 is not configured.' };
  const runKey = 'daily:' + dateInPakistan(now);
  try {
    const result = await runBackup({ kind: 'daily', runKey, triggeredBy: 'scheduler · Asia/Karachi 02:00' });
    lastSchedulerError = result && result.ok ? '' : (result && result.reason || 'Backup was skipped.');
    return result;
  } catch (e) {
    lastSchedulerError = e.message; console.error('Scheduled R2 backup failed:', e.message); return { ok: false, error: e.message };
  }
}
function start() {
  if (scheduler || !D.mysqlEnabled()) return;
  // Polling in PKT makes the schedule independent of the host's configured timezone and survives process restarts.
  scheduler = setInterval(() => schedulerTick().catch(e => { lastSchedulerError = e.message; console.error('R2 scheduler error:', e.message); }), 30000);
  if (scheduler.unref) scheduler.unref();
  schedulerTick().catch(e => { lastSchedulerError = e.message; console.error('R2 scheduler startup check failed:', e.message); });
}
async function status(limit = 40) {
  if (!D.mysqlEnabled() || !D.pool) return { storageReady: false, configured: false, encryptionReady: (() => { try { masterSecret(); return true; } catch { return false; } })(), schedule: '02:00 Asia/Karachi', retentionDaily: RETENTION_DAILY, history: [], lastSuccessAt: null, schedulerError: 'MySQL is not configured.' };
  let c = null, configError = '';
  try { c = storedConfig(); } catch (e) { configError = e.message; }
  const [rows] = await D.pool.query('SELECT id, run_key, kind, status, object_key, revision, size_bytes, sha256, attempts, triggered_by, error, created_at, last_attempt_at, completed_at, deleted_at FROM crm_cloud_backup_runs ORDER BY COALESCE(completed_at, last_attempt_at, created_at) DESC, id DESC LIMIT ?', [Math.max(1, Math.min(200, Number(limit) || 40))]);
  const [last] = await D.pool.query("SELECT MAX(completed_at) AS last_ok FROM crm_cloud_backup_runs WHERE status IN ('success','expired')");
  const details = rows.map(r => ({ id: Number(r.id), kind: r.kind, status: r.status, objectKey: r.object_key, revision: Number(r.revision), size: Number(r.size_bytes), sha256: r.sha256, attempts: Number(r.attempts), triggeredBy: r.triggered_by, error: r.error, createdAt: r.created_at ? new Date(r.created_at).toISOString() : null, lastAttemptAt: r.last_attempt_at ? new Date(r.last_attempt_at).toISOString() : null, completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null, deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null }));
  let publicCfg = safeConfig(c);
  return { storageReady: true, configured: !!c, configError, config: publicCfg, updatedAt: (D.db.settings.cloudBackup || {}).updatedAt || '', encryptionReady: (() => { try { masterSecret(); return true; } catch { return false; } })(), schedule: '02:00 Asia/Karachi', retentionDaily: RETENTION_DAILY, lastSuccessAt: last[0] && last[0].last_ok ? new Date(last[0].last_ok).toISOString() : null, schedulerError: lastSchedulerError, history: details };
}
function _setTestTransport(fn) { testTransport = fn; }
module.exports = { saveConfig, connectionTest, runBackup, restoreBackup, status, start, schedulerTick, dateInPakistan, timeInPakistan,
  _test: { sealJson, openJson, encryptArchive, decryptArchive, stripUploadPayloads, validateConfig, signedRequest, parseXml, uploadAndVerify, safeConfig, _setTestTransport, magic: MAGIC.toString('ascii') } };
