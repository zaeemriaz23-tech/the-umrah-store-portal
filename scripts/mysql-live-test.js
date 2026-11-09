'use strict';
/**
 * Storage safety tests against a REAL MySQL/MariaDB server.
 *   TEST_MYSQL_HOST / TEST_MYSQL_PORT / TEST_MYSQL_USER / TEST_MYSQL_PASSWORD / TEST_MYSQL_DB
 * The database name MUST contain "test": the test creates and empties CRM tables and refuses to touch anything else.
 * Skipped (exit 0) when TEST_MYSQL_* is not set, so it never runs against production by accident.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const H = process.env.TEST_MYSQL_HOST, DBN = process.env.TEST_MYSQL_DB;
if (!H || !DBN) { console.log('  SKIP  real MySQL storage tests (set TEST_MYSQL_HOST, TEST_MYSQL_USER, TEST_MYSQL_PASSWORD, TEST_MYSQL_DB to run)'); process.exit(0); }
if (!/test/i.test(DBN)) { console.error('Refusing to run: TEST_MYSQL_DB must contain "test" (got "' + DBN + '").'); process.exit(2); }

const root = path.join(__dirname, '..');
let failed = 0;
const check = (ok, name, detail = '') => { console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : '')); if (!ok) failed++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umrah-live-mysql-'));
const baseEnv = { ...process.env, CRM_TEST_MODE: '1', NODE_ENV: 'test', ENV_FILE: '', DB_HOST: H, DB_PORT: process.env.TEST_MYSQL_PORT || '3306', DB_NAME: DBN, DB_USER: process.env.TEST_MYSQL_USER, DB_PASSWORD: process.env.TEST_MYSQL_PASSWORD, DB_SSL: '0' };
delete baseEnv.REQUIRE_MYSQL;

/** run a script in a fresh process = a fresh "deployment" with its own (new, empty) DATA_DIR */
function run(body, { dataDir, env = {}, timeout = 40000 } = {}) {
  const dir = dataDir || fs.mkdtempSync(path.join(tmp, 'data-'));
  const script = `const D=require(${JSON.stringify(path.join(root, 'lib/db.js'))});const F=require(${JSON.stringify(path.join(root, 'lib/files.js'))});const fs=require('fs'),path=require('path');
    (async()=>{ const OUT={}; ${body}; console.log('@@'+JSON.stringify(OUT)); process.exit(0); })().catch(e=>{console.error('ERR '+(e&&e.stack||e));process.exit(1)});`;
  const r = spawnSync(process.execPath, ['-e', script], { cwd: root, env: { ...baseEnv, DATA_DIR: dir, ...env }, encoding: 'utf8', timeout });
  const m = /@@(.*)$/m.exec(r.stdout || '');
  return { ok: r.status === 0 && !!m, out: m ? JSON.parse(m[1]) : null, err: (r.stderr || '').trim().split('\n').slice(-3).join(' | '), log: r.stdout, dir };
}
async function sql(q, args = []) {
  const mysql = require(path.join(root, 'node_modules/mysql2/promise'));
  const c = await mysql.createConnection({ host: H, port: +(process.env.TEST_MYSQL_PORT || 3306), user: process.env.TEST_MYSQL_USER, password: process.env.TEST_MYSQL_PASSWORD, database: DBN });
  try { const [r] = await c.query(q, args); return r; } finally { await c.end(); }
}

(async () => {
  // clean slate for the TEST database only
  for (const t of ['crm_state', 'crm_state_backups', 'crm_files']) await sql('DROP TABLE IF EXISTS ' + t);

  // 0. THE MIGRATION PATH: an existing JSON database (what the live CRM has today) is imported into an EMPTY MySQL, untouched
  let r;
  const NODB = { DB_HOST: '', DB_NAME: '', DB_USER: '', DB_PASSWORD: '' };
  r = run(`await D.init(); const d=D.db; d.parties.push({id:701,kind:'agent',name:'Legacy Agent',phone:'1',limit:0,opening:250,active:true}); d.bookings.push({id:'lg1',no:'TUS-LEGACY-1',partyId:701,status:'Approved',services:[],pax:[],created:'2025-01-01'}); d.payments.push({id:'PY-L1',dir:'in',partyId:701,amt:777,status:'Approved',date:'2025-01-02'}); d.settings.company.name='Legacy Co'; D.save(); D.flush(); OUT.pw=d.users.find(u=>u.id==='admin').pw;`, { env: { ...NODB, ADMIN_PASSWORD: 'Legacy#Admin1' } });
  const legacyDir = r.dir, legacyPw = r.ok && r.out.pw, legacyBytes = r.ok && fs.readFileSync(path.join(legacyDir, 'db.json'), 'utf8');
  check(r.ok && legacyBytes, 'set-up: a legacy JSON-only CRM with an agent, booking, payment and its own admin password', r.err);
  r = run(`await D.init(); const d=D.db; OUT.agent=!!d.parties.find(p=>p.name==='Legacy Agent'); OUT.counts=[d.bookings.length,d.payments.length]; OUT.name=d.settings.company.name; OUT.pw=d.users.find(u=>u.id==='admin').pw; OUT.h=await D.health();`, { dataDir: legacyDir, env: { ADMIN_PASSWORD: 'Some#Other9' } });
  check(r.ok && r.out.agent && r.out.counts.join() === '1,1' && r.out.name === 'Legacy Co', 'existing db.json is imported into the empty MySQL with every record', r.err + JSON.stringify(r.out));
  check(r.ok && r.out.pw === legacyPw, 'the legacy admin password is carried over unchanged');
  check(fs.existsSync(path.join(legacyDir, 'db.json')) && JSON.parse(fs.readFileSync(path.join(legacyDir, 'db.json'), 'utf8')).parties.some(p => p.name === 'Legacy Agent'), 'the original db.json is left in place (never deleted)');
  const stored = await sql('SELECT payload FROM crm_state WHERE id = 1');
  check(stored.length === 1 && /Legacy Agent/.test(stored[0].payload), 'the imported data is physically in the crm_state table');
  // MySQL is now authoritative: a STALE local file must not win
  fs.writeFileSync(path.join(legacyDir, 'db.json'), fs.readFileSync(path.join(legacyDir, 'db.json'), 'utf8').replace('Legacy Co', 'STALE LOCAL FILE'));
  r = run(`await D.init(); OUT.name=D.db.settings.company.name; OUT.agent=!!D.db.parties.find(p=>p.name==='Legacy Agent');`, { dataDir: legacyDir });
  check(r.ok && r.out.name === 'Legacy Co' && r.out.agent, 'once on MySQL, a stale local db.json never overrides the database', r.err + JSON.stringify(r.out));
  for (const t of ['crm_state', 'crm_state_backups', 'crm_files']) await sql('DROP TABLE IF EXISTS ' + t);

  // 1. first start: schema + admin
  r = run(`await D.init(); const h=await D.health(); OUT.h=h; OUT.pw=D.db.users.find(u=>u.id==='admin').pw; OUT.adm=D.db.users.length;`, { env: { ADMIN_PASSWORD: 'First#Pass1' } });
  check(r.ok && r.out.h.driver === 'mysql' && r.out.h.healthy, 'first start creates the schema and is healthy on MySQL', r.err);
  const adminPw = r.ok && r.out.pw;
  const cols = (await sql("SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_state_backups'")).map(x => x.c);
  check(['kind', 'note', 'size_bytes'].every(c => cols.includes(c)), 'backup table has kind / note / size columns (additive migration)');
  check((await sql("SHOW TABLES LIKE 'crm_files'")).length === 1, 'crm_files table exists for uploaded files');

  // 2. write CRM data, then "redeploy": brand-new process, brand-new EMPTY data folder
  r = run(`await D.init(); const d=D.db; d.parties.push({id:501,kind:'agent',name:'Persistence Agent',phone:'1',limit:100000,opening:0,active:true});
    d.parties.push({id:502,kind:'supplier',name:'Persistence Supplier',active:true});
    d.bookings.push({id:'bk1',no:'TUS-TEST-0001',partyId:501,status:'Approved',services:[],pax:[],created:'2026-11-01'});
    d.payments.push({id:'PY-9',dir:'in',partyId:501,amt:12345,status:'Approved',date:'2026-11-02'});
    d.vouchers.push({id:'vc1',token:'tok123',bookingId:'bk1'});
    d.entries.push({id:'e1',partyId:501,amt:500});
    d.settings.company.name='Persisted Co'; D.save(); await D.flushAsync(); OUT.rev=d.rev;`, { env: { ADMIN_PASSWORD: 'Different#Pass2' } });
  check(r.ok, 'CRM records written (agent, supplier, booking, payment, voucher, ledger entry, settings)', r.err);
  const rev1 = r.ok && r.out.rev;
  r = run(`await D.init(); const d=D.db; OUT.counts=[d.parties.length,d.bookings.length,d.payments.length,d.vouchers.length,d.entries.length]; OUT.name=d.settings.company.name; OUT.pw=d.users.find(u=>u.id==='admin').pw; OUT.rev=d.rev; OUT.hasAgent=!!d.parties.find(p=>p.name==='Persistence Agent'); OUT.dbjson=fs.existsSync(path.join(D.DATA,'db.json'));`, { env: { ADMIN_PASSWORD: 'Yet#AnotherPass3' } });
  check(r.ok && r.out.counts.join() === '2,1,1,1,1' && r.out.hasAgent, 'REDEPLOY (new process, empty data folder): all records come back from MySQL', r.err + JSON.stringify(r.out));
  check(r.ok && r.out.name === 'Persisted Co', 'settings survive the redeploy');
  check(r.ok && r.out.pw === adminPw, 'existing admin password is NOT changed by redeploy, even with a different ADMIN_PASSWORD env var');
  check(r.ok && r.out.rev >= rev1, 'revision never goes backwards');

  // 3. backups
  const bk = await sql('SELECT kind, COUNT(*) n FROM crm_state_backups GROUP BY kind');
  const kinds = Object.fromEntries(bk.map(x => [x.kind, Number(x.n)]));
  check(kinds.initial >= 1, 'an initial backup exists', JSON.stringify(kinds));
  check(kinds.daily >= 1 || kinds.auto >= 1, 'a restore point is created by normal saves (daily/auto) even when the CRM is written continuously', JSON.stringify(kinds));

  // 4. safe migration: pretend the stored state came from an older application version
  await sql("UPDATE crm_state SET payload = JSON_SET(payload, '$.appVersion', '0.0.1') WHERE id = 1");
  const before = Number((await sql("SELECT COUNT(*) n FROM crm_state_backups WHERE kind='pre-migration'"))[0].n);
  r = run(`await D.init(); OUT.n=D.db.parties.length;`);
  const after = await sql("SELECT note FROM crm_state_backups WHERE kind='pre-migration' ORDER BY id DESC LIMIT 1");
  check(r.ok && r.out.n === 2 && Number((await sql("SELECT COUNT(*) n FROM crm_state_backups WHERE kind='pre-migration'"))[0].n) === before + 1 && /0\.0\.1/.test(after[0].note), 'an upgrade stores a pre-migration backup first and keeps all data', r.err);
  r = run(`await D.init(); OUT.n=D.db.parties.length;`);
  check(Number((await sql("SELECT COUNT(*) n FROM crm_state_backups WHERE kind='pre-migration'"))[0].n) === before + 1, 'a plain restart does not create another pre-migration backup');

  // 5. emptied crm_state must be RECOVERED, never replaced by a blank CRM
  await sql('DELETE FROM crm_state');
  r = run(`await D.init(); const d=D.db; OUT.n=[d.parties.length,d.bookings.length,d.payments.length]; OUT.rec=(await D.health()).recovered||''; OUT.pw=d.users.find(u=>u.id==='admin').pw;`);
  check(r.ok && r.out.n.join() === '2,1,1' && /Recovered/.test(r.out.rec), 'empty crm_state is recovered from the newest backup (no blank CRM)', r.err + JSON.stringify(r.out));
  check(r.ok && r.out.pw === adminPw, 'admin password also survives recovery');
  check(Number((await sql('SELECT COUNT(*) n FROM crm_state'))[0].n) === 1, 'recovered state is written back to crm_state');

  // 5b. ...but when a fresher local snapshot exists it wins over an older backup
  r = run(`await D.init(); D.db.settings.company.name='Newest Local Change'; D.save(); await D.flushAsync(); OUT.ok=1;`);
  const fresherDir = r.dir;
  await sql('DELETE FROM crm_state');
  r = run(`await D.init(); OUT.name=D.db.settings.company.name; OUT.n=D.db.parties.length;`, { dataDir: fresherDir });
  check(r.ok && r.out.name === 'Newest Local Change' && r.out.n === 2, 'when crm_state is empty, a fresher local snapshot beats an older backup (no lost changes)', r.err + JSON.stringify(r.out));

  // 6. outage + automatic retry (state table temporarily unavailable)
  r = run(`await D.init(); const mysql=require('mysql2/promise'); const c=await mysql.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
    await c.query('RENAME TABLE crm_state TO crm_state_away');
    D.db.settings.company.name='Written During Outage'; D.save(); await D.flushAsync();
    const h1=await D.health(); OUT.unhealthy=!h1.healthy;
    await c.query('RENAME TABLE crm_state_away TO crm_state');
    await new Promise(r=>setTimeout(r,9000)); const h2=await D.health(); OUT.recovered=h2.healthy; OUT.p=h2.persistedRevision>=h2.revision;
    const [row]=await c.query('SELECT payload FROM crm_state WHERE id=1'); OUT.saved=JSON.parse(row[0].payload).settings.company.name; await c.end();`, { timeout: 60000 });
  check(r.ok && r.out.unhealthy, 'a failed MySQL write is reported as unhealthy (never silent)', r.err);
  check(r.ok && r.out.recovered && r.out.saved === 'Written During Outage', 'the failed write is retried automatically and reaches MySQL once it is back', r.err + JSON.stringify(r.out));

  // 7. never overwrite newer data
  r = run(`await D.init(); const mysql=require('mysql2/promise'); const c=await mysql.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
    await c.query('UPDATE crm_state SET revision = revision + 5000 WHERE id=1'); const [b]=await c.query('SELECT payload FROM crm_state WHERE id=1');
    D.db.settings.company.name='MUST NOT OVERWRITE'; D.save(); await D.flushAsync(); const [a]=await c.query('SELECT payload FROM crm_state WHERE id=1');
    OUT.same=a[0].payload===b[0].payload; OUT.h=(await D.health()); await c.end();`, { timeout: 30000 });
  check(r.ok && r.out.same && !r.out.h.healthy, 'a process holding older data refuses to overwrite a newer MySQL revision and reports it', r.err);
  await sql('UPDATE crm_state SET revision = revision - 5000 WHERE id=1');

  // 8. manual backup, damage, restore (admin password kept)
  r = run(`await D.init(); const b=await D.createBackup('test point'); D.db.parties.length=0; D.db.settings.company.name='DAMAGED'; D.save(); await D.flushAsync();
    const before=D.db.parties.length; D.db.users.find(u=>u.id==='admin').pw='changed-after-backup'; D.save(); await D.flushAsync();
    const res=await D.restoreBackup(b.id); OUT.before=before; OUT.after=D.db.parties.length; OUT.name=D.db.settings.company.name; OUT.pw=D.db.users.find(u=>u.id==='admin').pw; OUT.list=(await D.listBackups()).map(x=>x.kind);`);
  check(r.ok && r.out.before === 0 && r.out.after === 2 && r.out.name !== 'DAMAGED', 'restore brings back the records from a restore point', r.err + JSON.stringify(r.out));
  check(r.ok && r.out.pw === 'changed-after-backup', 'restore keeps the CURRENT admin password');
  check(r.ok && r.out.list.includes('pre-restore') && r.out.list.includes('manual'), 'restore first stores a pre-restore copy of the current state');

  // 9. uploaded files: mirrored, wiped from disk by a "redeploy", restored
  r = run(`await D.init(); fs.mkdirSync(path.join(D.DATA,'receipts'),{recursive:true}); const b=Buffer.from('%PDF-1.4 receipt body'); fs.writeFileSync(path.join(D.DATA,'receipts','PY-9.pdf'),b); await F.put('receipts/PY-9.pdf',b);
    fs.mkdirSync(path.join(D.DATA,'kyc','APP-1'),{recursive:true}); const k=Buffer.from('kyc-image'); fs.writeFileSync(path.join(D.DATA,'kyc','APP-1','cnic.png'),k); await F.put('kyc/APP-1/cnic.png',k); await F.flush(); OUT.st=await F.status();`);
  check(r.ok && r.out.st.inMysql >= 2, 'receipts and KYC documents are mirrored into MySQL', r.err);
  r = run(`await D.init(); const res=await F.restoreMissing(); OUT.res=res; OUT.a=fs.readFileSync(path.join(D.DATA,'receipts','PY-9.pdf'),'utf8'); OUT.b=fs.readFileSync(path.join(D.DATA,'kyc','APP-1','cnic.png'),'utf8');`);
  check(r.ok && r.out.a === '%PDF-1.4 receipt body' && r.out.b === 'kyc-image', 'REDEPLOY with empty disk: receipts and KYC files are restored byte-for-byte', r.err);
  r = run(`await D.init(); fs.mkdirSync(path.join(D.DATA,'receipts'),{recursive:true}); fs.writeFileSync(path.join(D.DATA,'receipts','OLD-1.pdf'),'%PDF old file'); fs.mkdirSync(path.join(D.DATA,'brand','airlines'),{recursive:true}); fs.writeFileSync(path.join(D.DATA,'brand','airlines','EK.png'),'cache');
    fs.writeFileSync(path.join(D.DATA,'receipts','PY-9.pdf'),'LOCAL EDIT'); const bf=await F.backfill(); await F.restoreMissing(); OUT.up=bf.uploaded; OUT.keep=fs.readFileSync(path.join(D.DATA,'receipts','PY-9.pdf'),'utf8'); OUT.st=await F.status();`);
  check(r.ok && r.out.up === 1 && r.out.keep === 'LOCAL EDIT', 'existing disk files not yet in MySQL are migrated; restore never overwrites an existing file', r.err + JSON.stringify(r.out));
  check(r.ok && !r.out.st.notInMysql, 'the airline logo cache is not mirrored (re-downloadable)', JSON.stringify(r.out && r.out.st));

  // 10. REQUIRE_MYSQL guard
  r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(root, 'lib/db.js'))}).init().then(()=>process.exit(0),e=>{console.log(e.message);process.exit(7)})`], { cwd: root, env: { ...baseEnv, DB_HOST: '', DB_NAME: '', DB_USER: '', DB_PASSWORD: '', REQUIRE_MYSQL: '1', DATA_DIR: fs.mkdtempSync(path.join(tmp, 'rq-')) }, encoding: 'utf8' });
  check(r.status === 7 && /REQUIRE_MYSQL/.test(r.stdout), 'REQUIRE_MYSQL=1 refuses to start on temporary JSON storage');

  // 11. static safety: no destructive SQL on CRM data anywhere in the application
  const src = ['lib/db.js', 'lib/files.js', 'server.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  check(!/\b(DROP\s+(TABLE|DATABASE)|TRUNCATE\s+TABLE|DELETE\s+FROM\s+crm_state\s*(;|'|"|`|$))/i.test(src.replace(/DELETE FROM crm_state_backups[^\n]*/g, '')), 'application code contains no DROP / TRUNCATE / DELETE against crm_state');
})().catch(e => { console.error(e); failed++; }).finally(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? '\n' + failed + ' real-MySQL storage check(s) FAILED' : '\nAll real-MySQL storage checks passed');
  process.exit(failed ? 1 : 0);
});
