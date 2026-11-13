'use strict';
/* End-to-end: white-label output, service switches and bank visibility as seen by a real agent session. Run: node scripts/white-label-test.js */
const { spawn } = require('child_process'); const fs = require('fs'); const os = require('os'); const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-')), PORT = 3900 + Math.floor(Math.random() * 90), B = 'http://127.0.0.1:' + PORT;
let srv, pass = 0, failN = 0; const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { failN++; console.log('  FAIL', m); } };
const start = () => new Promise(r => { srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, DATA_DIR: dir, ADMIN_PASSWORD: 'AdminPass#1', CRM_TEST_MODE: '1', MEEZAB_USERNAME: 'sentinel_user_7Q', MEEZAB_PASSWORD: 'sentinel_pass_9Z' }, stdio: ['ignore', 'pipe', 'inherit'] }); srv.stdout.on('data', d => /running on port/.test(String(d)) && r()); });
const stop = () => new Promise(r => { srv.on('exit', r); srv.kill('SIGTERM'); });
class C { constructor() { this.c = ''; }
  async req(m, u, b) { const r = await fetch(B + u, { method: m, headers: { 'content-type': 'application/json', cookie: this.c }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) this.c = sc.split(';')[0]; const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch { j = { raw: t }; } return { s: r.status, j, t }; }
  login(l, p) { return this.req('POST', '/api/login', { login: l, password: p }); } rpc(op, p) { return this.req('POST', '/api/rpc', { op, ...p }); } get(u) { return this.req('GET', u); } }
const wait = ms => new Promise(r => setTimeout(r, ms)); const disk = () => JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
const iso = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
(async () => {
  await start(); const A = new C(), AG = new C(); await A.login('admin', 'AdminPass#1');
  const grp = (code, note) => ({ air: 'SV', airline: 'Saudia', dep: iso(30), ret: iso(44), seats: 20, code, out: { fn: 'SV 739', from: 'LHE', to: 'JED', dt: '03:15', at: '06:30', bag: 30 }, inb: { fn: 'SV 740', from: 'JED', to: 'LHE', dt: '02:00', at: '09:00', bag: 30 }, pk: [{ mk: note, mkn: 5, md: 'Anwar Madinah', mdn: 5, p: { sh: 250000, qd: 270000, tr: 290000, db: 320000 } }] });
  const g = await A.rpc('saveGroup', { group: { ...grp('MZ-5001', 'Meezab Group Hilton Makkah'), supplierRef: 'MEEZAB-5001' } }); ok(g.s === 200, 'group saved');
  await A.rpc('saveParty', { kind: 'agent', name: 'Test Agent', limit: 1e6, login: 'ag1', password: 'AgentPass#12' }); ok((await AG.login('ag1', 'AgentPass#12')).s === 200, 'agent can log in');
  await A.rpc('saveSettings', { bank: [{ kind: 'bank', bank: 'Meezan', title: 'Pub', account: '1111-1', vis: 'public' }, { kind: 'bank', bank: 'HBL', title: 'AgentsOnly', account: '2222-2', vis: 'agents' }, { kind: 'bank', bank: 'Secret', title: 'StaffOnly', account: '3333-3', vis: 'staff' }] });

  console.log('White-label');
  const as = (await AG.get('/api/state')).t, stf = (await A.get('/api/state')).t;
  ok(!/meezab/i.test(as), 'agent state contains no restricted brand name anywhere');
  ok(/Meezab Group Hilton/.test(stf), 'staff still see the original supplier wording');
  ok(/The Umrah Store Hilton Makkah/.test(as), 'agent sees the neutral replacement in package names');
  const pubJson = (await new C().get('/api/public/inventory')).t; ok(!/meezab/i.test(pubJson), 'public inventory endpoint is clean');
  const page = (await new C().get('/umrah-group-packages')).t; ok(!/meezab/i.test(page), 'public group page (SEO) is clean');
  await wait(1800); const sg = disk().groups.find(x => x.code === 'MZ-5001');
  ok(/Meezab Group Hilton/.test(JSON.stringify(sg)) && sg.supplierRef === 'MEEZAB-5001', 'the stored record and supplier reference are unchanged');
  ok(!/supplierRef|"meezab"/.test(JSON.stringify(JSON.parse(as).groups)), 'supplier reference and sync metadata are never sent to agents');
  const saved = await A.rpc('saveGroup', { group: { ...grp('MZ-5001', 'Meezab Group Hilton Makkah'), id: g.j.id } });
  await wait(1800); ok(disk().groups.find(x => x.code === 'MZ-5001').supplierRef === 'MEEZAB-5001', 'editing a group in the portal keeps its supplier reference (' + saved.s + ')');

  console.log('Bank visibility');
  const ab = JSON.parse(as).bank.map(b => b.bank); ok(ab.includes('Meezan') && ab.includes('HBL') && !ab.includes('Secret'), 'agents see public + agents-only accounts, never staff-only');
  const pb = (await new C().get('/api/public/banks')).j; const pl = JSON.stringify(pb); ok(/Meezan/.test(pl) && !/HBL/.test(pl) && !/Secret/.test(pl), 'public page lists only Public accounts');

  console.log('Service switches');
  const ar = await AG.rpc('saveModules', { modules: { groups: false } }); ok(ar.s >= 400 && JSON.parse((await AG.get('/api/state')).t).modules.groups !== false, 'an agent cannot change services (HTTP ' + ar.s + ') and nothing changed');
  await A.rpc('saveModules', { modules: { groups: false, hotels: false, bank: false } });
  const off = JSON.parse((await AG.get('/api/state')).t); ok(off.modules.groups === false && off.groups.length === 0 && off.bank.length === 0, 'agent snapshot hides disabled groups and bank accounts');
  ok((await new C().get('/umrah-group-packages')).s === 404, 'the public group page is not served while Groups is off');
  ok((await A.rpc('saveGroup', { group: grp('MZ-5002', 'x') })).s === 400, 'creating a group while the service is off is refused with a clear message');
  await wait(1800); ok(disk().groups.some(x => x.code === 'MZ-5001'), 'the data is still stored');
  await A.rpc('saveModules', { modules: { groups: true, hotels: true, bank: true } });
  ok(JSON.parse((await AG.get('/api/state')).t).groups.length === 1, 'switching back on restores everything');

  console.log('Seat sync access');
  ok((await AG.get('/api/seatsync')).s === 403, 'agents cannot read sync status');
  ok((await new C().get('/api/seatsync')).s === 401, 'anonymous users cannot read sync status');
  ok((await AG.req('POST', '/api/seatsync/run', {})).s === 403, 'agents cannot trigger a sync');
  const st = (await A.get('/api/seatsync')).j; ok(st.configured === false && st.status === 'disabled', 'unconfigured sync reports its state honestly');
  const r = (await A.req('POST', '/api/seatsync/run', {})).j; ok(r.ok === false && /not configured/i.test((r.entry || {}).error || ''), 'Sync now on an unconfigured server fails safely and says why');
  const leak = JSON.stringify((await A.get('/api/seatsync')).j) + (await A.get('/api/state')).t + (await AG.get('/api/state')).t; ok(!/sentinel_(user_7Q|pass_9Z)/.test(leak), 'server-side credentials never appear in sync status or any state payload');

  await stop(); console.log(`\n${pass} passed, ${failN} failed`); process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); try { srv.kill(); } catch {} process.exit(1); });
