'use strict';
const assert = require('assert');
const fs = require('fs');
process.env.CLOUD_BACKUP_ENCRYPTION_KEY = 'test-only-cloud-backup-key-keep-this-private-123456';
const Cloud = require('../lib/cloud-backup');
const T = Cloud._test;

(async () => {
  const cfg = {
    accountId: '0123456789abcdef0123456789abcdef',
    bucket: 'tus-crm-backups',
    endpoint: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
    accessKeyId: 'TESTACCESSKEY123456789012345',
    secretAccessKey: 'test-secret-access-key-not-real-123456789'
  };
  assert.deepStrictEqual(T.validateConfig(cfg), cfg, 'valid account endpoint and credentials are accepted');
  assert.throws(() => T.validateConfig({ ...cfg, endpoint: 'https://example.com' }), /must match the Cloudflare Account ID/);
  assert.throws(() => T.validateConfig({ ...cfg, endpoint: 'http://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com' }), /HTTPS/);
  assert.strictEqual(T.validateConfig({ ...cfg, endpoint: 'https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com' }).endpoint, 'https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com', 'R2 jurisdiction-specific endpoints are supported');
  assert(!Object.prototype.hasOwnProperty.call(T.safeConfig(cfg), 'secretAccessKey'), 'safe config responses never include the Secret Access Key');

  const adminUi = fs.readFileSync(require('path').join(__dirname, '../public/v-adm.js'), 'utf8');
  assert(adminUi.includes("timeZone: 'Asia/Karachi'") && adminUi.includes("' PKT'"), 'backup timestamps are explicitly displayed in Pakistan time');
  const serverSource = fs.readFileSync(require('path').join(__dirname, '../server.js'), 'utf8');
  const cloudRoutes = serverSource.slice(serverSource.indexOf('/* ---------- Cloudflare R2 encrypted database-only backups'), serverSource.indexOf("app.get('/api/qr'"));
  assert.strictEqual((cloudRoutes.match(/app\.(?:get|post)\('\/api\/cloud-backup[^']*', auth, adminOnly/g) || []).length, 5, 'all cloud-backup API routes require an authenticated administrator');
  assert(serverSource.includes('delete snapshot.settings.cloudBackup'), 'JSON backup exports remove server-only cloud credentials');
  assert(serverSource.includes('delete o.settings.cloudBackup'), 'downloaded restore-point exports redact legacy encrypted cloud credential records');
  const stateSource = fs.readFileSync(require('path').join(__dirname, '../lib/state.js'), 'utf8');
  assert(stateSource.includes('delete out.settings.cloudBackup'), '/api/state snapshots never expose the encrypted credential blob');
  const dbSource = fs.readFileSync(require('path').join(__dirname, '../lib/db.js'), 'utf8');
  assert(dbSource.includes('CREATE TABLE IF NOT EXISTS crm_cloud_backup_runs'), 'backup history schema is additive and safe on existing databases');
  assert(dbSource.includes("'pre-restore', 'before Cloudflare R2 database restore'"), 'restore creates a pre-restore MySQL restore point');
  assert((dbSource.match(/delete preRestore\.settings\.cloudBackup/g) || []).length >= 2, 'local and cloud pre-restore exports omit server-only credential ciphertext');
  assert((dbSource.match(/preRestore\.sessions = \{\}/g) || []).length >= 2, 'pre-restore downloads do not expose active login sessions');
  const indexHtml = fs.readFileSync(require('path').join(__dirname, '../public/index.html'), 'utf8');
  assert(indexHtml.includes('/v-adm.js?v=328'), 'admin UI cache version is bumped for the Cloud Backup controls');
  assert(dbSource.includes('next.sessions = keepSessions'), 'restore preserves active authentication sessions');
  const configuredMaster = process.env.CLOUD_BACKUP_ENCRYPTION_KEY;
  delete process.env.CLOUD_BACKUP_ENCRYPTION_KEY;
  assert.throws(() => T.sealJson(cfg, 'r2-credentials'), /CLOUD_BACKUP_ENCRYPTION_KEY/ , 'cloud backups fail closed without a dedicated encryption key');
  process.env.CLOUD_BACKUP_ENCRYPTION_KEY = configuredMaster;
  const credentialBlob = T.sealJson(cfg, 'r2-credentials');
  assert(!Buffer.from(credentialBlob, 'base64').includes(Buffer.from(cfg.secretAccessKey)), 'secret is not stored as plaintext in the encrypted credential record');
  assert.deepStrictEqual(T.openJson(credentialBlob, 'r2-credentials'), cfg, 'credentials decrypt with the same server key');
  const badCredential = Buffer.from(credentialBlob, 'base64'); badCredential[badCredential.length - 1] ^= 0xff;
  assert.throws(() => T.openJson(badCredential.toString('base64'), 'r2-credentials'));

  const sourceState = {
    v: 3, rev: 77, sessions: { abc: { uid: 'admin' } },
    settings: { cloudBackup: { encryptedConfig: 'SERVER-ONLY-CIPHERTEXT' }, bank: [{ id: 'bank-1', title: 'TUS', logo: 'data:image/png;base64,AAAA', qr: 'data:image/png;base64,BBBB' }] },
    bookings: [{ id: 1, no: 'TUS-BOOK-1', customer: 'Example', notes: 'must remain', uploadedData: 'data:application/pdf;base64,AAAA', passportImage: 'A'.repeat(512) }],
    chats: [{ id: 'chat-1', messages: [{ text: 'keep me', attachments: [{ file: 'chats/a.pdf', name: 'a.pdf', content: 'SENSITIVE FILE PAYLOAD' }] }] }]
  };
  const clean = T.stripUploadPayloads(sourceState);
  assert.deepStrictEqual(clean.sessions, {}, 'authentication sessions are excluded');
  assert.strictEqual(clean.settings.bank[0].logo, '', 'embedded logos are excluded');
  assert.strictEqual(clean.settings.bank[0].qr, '', 'embedded QR images are excluded');
  assert(!Object.prototype.hasOwnProperty.call(clean.settings, 'cloudBackup'), 'server-only R2 credentials are excluded from archive snapshots');
  assert.strictEqual(clean.bookings[0].notes, 'must remain', 'business records remain');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(clean.bookings[0], 'uploadedData'), false, 'data URI upload payloads are excluded');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(clean.bookings[0], 'passportImage'), false, 'legacy naked base64 image fields are excluded');
  assert.strictEqual(clean.chats[0].messages[0].text, 'keep me', 'chat business records remain');
  assert.strictEqual(clean.chats[0].messages[0].attachments[0].name, 'a.pdf', 'file metadata may remain but file bytes are not included');
  assert(!Object.prototype.hasOwnProperty.call(clean.chats[0].messages[0].attachments[0], 'content'), 'attachment content is excluded from database-only cloud backups');

  const archive = { format: 'TheUmrahStoreCRMCloudBackup', formatVersion: 1, createdAt: new Date().toISOString(), timezone: 'Asia/Karachi', revision: 77, content: 'crm_state database records only', state: clean };
  const encrypted = T.encryptArchive(archive);
  assert(encrypted.subarray(0, 8).toString('ascii') === T.magic, 'archive carries the supported encrypted format marker');
  assert(!encrypted.includes(Buffer.from('must remain')), 'backup contents are encrypted and not readable as plaintext');
  const decoded = T.decryptArchive(encrypted);
  assert.strictEqual(decoded.revision, 77);
  assert.strictEqual(decoded.state.bookings[0].notes, 'must remain');
  const corrupted = Buffer.from(encrypted); corrupted[corrupted.length - 3] ^= 0x01;
  assert.throws(() => T.decryptArchive(corrupted), /authentication failed/);

  const signed = T.signedRequest('PUT', 'database/daily/2026/11/sample.tusr2', Buffer.from('sample'), {}, { 'content-type': 'application/octet-stream', 'x-amz-meta-sha256': 'abc' }, cfg);
  assert.match(signed.headers.authorization, /^AWS4-HMAC-SHA256 Credential=TESTACCESSKEY123456789012345\//);
  assert.match(signed.headers.authorization, /SignedHeaders=content-length;content-type;host;x-amz-content-sha256;x-amz-date;x-amz-meta-sha256/);
  assert.match(signed.path, /^\/tus-crm-backups\/database\/daily\//);

  const xml = '<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>next&amp;token</NextContinuationToken><Contents><Key>database/daily/a.tusr2</Key><LastModified>2026-11-15T00:00:00.000Z</LastModified><Size>123</Size></Contents></ListBucketResult>';
  const parsed = T.parseXml(xml);
  assert.strictEqual(parsed.contents[0].key, 'database/daily/a.tusr2');
  assert.strictEqual(parsed.contents[0].size, 123);
  assert.strictEqual(parsed.nextToken, 'next&token');
  assert.strictEqual(parsed.truncated, true);

  const objectStore = new Map();
  T._setTestTransport(async req => {
    const metadata = Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.startsWith('x-amz-meta-')));
    if (req.method === 'PUT') { objectStore.set(req.key, { body: Buffer.from(req.body), metadata }); return { status: 200, headers: {}, body: Buffer.alloc(0) }; }
    if (req.method === 'HEAD') { const o = objectStore.get(req.key); if (!o) return { status: 404, headers: {}, body: Buffer.alloc(0) }; return { status: 200, headers: { 'content-length': String(o.body.length), 'x-amz-meta-sha256': o.metadata['x-amz-meta-sha256'] }, body: Buffer.alloc(0) }; }
    if (req.method === 'GET') { const o = objectStore.get(req.key); return { status: 200, headers: {}, body: Buffer.from(o.body) }; }
    if (req.method === 'DELETE') { objectStore.delete(req.key); return { status: 204, headers: {}, body: Buffer.alloc(0) }; }
    throw new Error('Unexpected test HTTP method ' + req.method);
  });
  const verified = await T.uploadAndVerify(cfg, 'database/daily/2026/11/test.tusr2', encrypted, 77);
  assert.strictEqual(verified.size, encrypted.length, 'upload is checked via HEAD and full GET read-back');
  assert.strictEqual(objectStore.size, 1, 'verified object is present in the fake bucket');
  T._setTestTransport(async req => {
    if (req.method === 'PUT') return { status: 503, headers: {}, body: Buffer.from('service unavailable') };
    throw new Error('Upload failure must stop before read-back');
  });
  await assert.rejects(() => T.uploadAndVerify(cfg, 'database/daily/fail.tusr2', encrypted, 77), /503/);
  T._setTestTransport(null);

  const after2am = new Date('2026-11-15T21:00:00.000Z'); // 02:00 on 16 Nov in Pakistan
  assert.strictEqual(Cloud.dateInPakistan(after2am), '2026-11-16');
  assert.deepStrictEqual(Cloud.timeInPakistan(after2am), { hour: 2, minute: 0 });
  const before2am = new Date('2026-11-15T20:59:00.000Z');
  assert(Cloud.timeInPakistan(before2am).hour < 2, 'the PKT scheduler waits until 02:00 local time');

  console.log('PASS cloud-backup-test: encrypted credentials and archives, upload/document exclusion, SigV4 signing, R2 read-back verification, fail-closed upload errors, and Pakistan-time scheduling');
})().catch(e => { console.error(e); process.exitCode = 1; });
