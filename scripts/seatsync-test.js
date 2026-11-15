'use strict';
/* Brand filter, service modules and Meezab seat sync, against a mock supplier CRM. Run: node scripts/seatsync-test.js */
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
process.env.DATA_DIR = dir; process.env.CRM_TEST_MODE = '1'; process.env.MEEZAB_USERNAME = 'agent'; process.env.MEEZAB_PASSWORD = 'secret-pass'; process.env.MEEZAB_SECRET_KEY = 'k'.repeat(24);
let pass = 0, bad = 0; const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { bad++; console.log('  FAIL', m); } };

/* ---- mock supplier ---- */
let mode = 'ok', methods = [], logins = 0;
const rows = { 'MZ-1001': '12', 'MZ-1002': 'Sold Out', 'MZ-1003': '7', 'MZ-1004': '??', 'NEW-9999': '30', 'DUP-1': '5' };
const table = r => '<table><tr><th>Group Ref</th><th>Sector</th><th>Available Seats</th></tr>' + Object.entries(r).map(([k, v]) => `<tr><td>${k}</td><td>LHE-JED</td><td>${v}</td></tr>`).join('') + '</table>';
const srv = http.createServer((req, res) => {
  methods.push(req.method); const cookie = req.headers.cookie || '';
  if (req.url.startsWith('/login')) {
    if (req.method === 'POST') { let b = ''; req.on('data', d => b += d); req.on('end', () => { logins++; if (/password=secret-pass/.test(b) && /_csrf=tok/.test(b) && mode !== 'badcreds') { res.writeHead(302, { 'Set-Cookie': 'sess=GOOD; Path=/', Location: '/groups' }); } else { res.writeHead(200); res.write('<form><input type=password name=password></form>'); } res.end(); }); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<form method=post action="/login"><input type=hidden name=_csrf value=tok><input name=email><input type=password name=password>' + (mode === 'captcha' ? '<div class="g-recaptcha"></div>' : '') + '</form>');
  }
  if (req.url.startsWith('/groups')) {
    if (!/sess=GOOD/.test(cookie) || mode === 'expired-forever') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<form action=/login><input type=password name=password></form>'); }
    res.writeHead(200, { 'content-type': 'text/html' });
    if (mode === 'empty') return res.end('<html><body>No data</body></html>');
    if (mode === 'partial') return res.end(table({ 'MZ-1001': '3' }));
    return res.end(table(rows));
  }
  res.writeHead(404); res.end();
});

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); process.env.MEEZAB_BASE_URL = 'http://127.0.0.1:' + srv.address().port;
  const D = require('../lib/db'); const B = require('../lib/brand'); const M = require('../lib/modules'); const Z = require('../lib/meezab'); const { db } = D;

  console.log('Brand filter');
  const t = 'Meezab Group CRM offers a MEEZAB-GROUP package via crm.meezabgroup.com (meezab).';
  const c = B.clean(t); ok(!/meezab/i.test(c), 'all variations and the supplier domain are removed: ' + c);
  ok(B.clean('Meezab Group') === 'The Umrah Store', 'longest term wins, no duplicated replacement');
  ok(B.clean('Meezabx stays') === 'Meezabx stays', 'does not damage longer unrelated words');
  const orig = { code: 'MZ-1', title: 'Meezab Group umrah', id: 'MEEZAB-1', n: 3 }, cl = B.cleanDeep(orig);
  ok(orig.title.includes('Meezab') && !/meezab/i.test(cl.title) && cl.id === 'MEEZAB-1' && cl.n === 3, 'deep clean copies; the stored record is untouched and ids are preserved');
  ok(B.forViewer({ role: 'admin' }, orig) === orig && B.forViewer({ role: 'agent' }, orig).title !== orig.title, 'staff see originals; agents see cleaned copies');
  db.settings.brandFilter = B.normalizeConfig({ terms: 'Acme Travel\nAcme' }, db.settings.brandFilter); ok(B.clean('Acme Travel Ltd') === 'The Umrah Store Ltd', 'terms are administrator-configurable');
  db.settings.brandFilter = B.normalizeConfig({ terms: ['Meezab Group CRM', 'Meezab Group', 'Meezab'] }, db.settings.brandFilter);

  console.log('Service modules');
  ok(M.KEYS.every(k => M.enabled(k)), 'every module is on by default (upgrade changes nothing)');
  db.settings.modules = M.normalize({ hotels: false, reports: false }, db.settings.modules);
  ok(!M.enabled('hotels') && M.enabled('flights') && !M.routeVisible('reports') && M.routeVisible('search'), 'disabling one module leaves the others (search stays while flights are on)');
  let threw = false; try { M.gateOp('saveHotel'); } catch { threw = true; } ok(threw, 'creating in a disabled module is refused');
  threw = false; try { M.gateOp('saveGroup'); } catch { threw = true; } ok(!threw, 'other modules are not blocked');
  db.settings.modules = M.normalize({ hotels: true, reports: true }, db.settings.modules); ok(M.enabled('hotels'), 'switching back on restores access');

  console.log('Seat parsing');
  const P = Z.parseSeats; ok(P('12') === 12 && P('Sold Out') === 0 && P('0') === 0 && P('9 seats left') === 9, 'explicit numbers and sold-out words are understood');
  ok(P('') === null && P('-') === null && P('??') === null && P('12/40') === null && P(null) === null, 'blank, dash, junk and ambiguous values are UNKNOWN, never zero');

  console.log('Sync against a mock supplier');
  const g = (id, seats, extra) => ({ id, code: id, seats, dep: '2099-01-01', ret: '2099-01-15', air: 'SV', airline: 'Saudia', pk: [], ...extra });
  db.groups = [g('MZ-1001', 40), g('MZ-1002', 8), g('MZ-1003', 20), g('MZ-1004', 15), g('LOCAL-1', 9), g('X1', 5, { code: 'DUP-1' }), g('X2', 6, { code: 'DUP-1' })];
  const before = db.groups.length; db.meezab = { enabled: true, intervalMin: 3 };
  let r = await Z.runSync({ by: 'test', manual: true });
  const S = id => db.groups.find(x => x.id === id);
  ok(r.ok, 'first sync succeeds (logs in with the server-side credentials)');
  ok(S('MZ-1001').seats === 12 && S('MZ-1003').seats === 7, 'remaining seats are copied to matching groups');
  ok(S('MZ-1002').seats === 0 && S('MZ-1002').meezab.soldOut === true, 'an explicit "Sold Out" sets seats to 0 and the sold-out flag');
  ok(S('MZ-1004').seats === 15, 'an unreadable cell leaves the stored seats alone');
  ok(S('LOCAL-1').seats === 9, 'a portal group that is not in the extraction is NOT zeroed');
  ok(db.groups.length === before && !db.groups.find(x => x.id === 'NEW-9999'), 'an unknown supplier group never creates a portal group (no duplicates)');
  ok(S('X1').seats === 5 && S('X2').seats === 6, 'an ambiguous reference (two portal groups) is skipped');
  ok(methods.filter(m => m !== 'GET').length === 1 && logins === 1, 'read-only: the only non-GET request is the single login POST');
  ok(db.syncLog.at(-1).ok && db.syncLog.at(-1).changed >= 3 && db.meezab.lastOkAt, 'history entry and last-success timestamp are recorded');
  ok(!JSON.stringify(db.meezab).includes('secret-pass') && !JSON.stringify(db.syncLog).includes('secret-pass'), 'the password is never stored or logged');
  ok(!!db.meezab.sessionEnc && !db.meezab.sessionEnc.includes('GOOD'), 'the session cookie is stored encrypted, not in clear text');

  const snap = JSON.stringify(db.groups); const okAt = db.meezab.lastOkAt;
  for (const m of ['empty', 'partial']) {
    mode = m; if (m === 'partial') { db.meezab.summary = { matched: 10 }; }
    r = await Z.runSync({ by: 'test' });
    ok(!r.ok && JSON.stringify(db.groups) === snap, m + ' extraction fails safely and overwrites nothing');
  }
  ok(db.meezab.lastOkAt === okAt && db.meezab.lastError, 'the last SUCCESSFUL sync time is not advanced by failures');

  mode = 'ok'; db.meezab.summary = { matched: 3 }; rows['MZ-1001'] = '4'; r = await Z.runSync({ by: 'test' });
  ok(r.ok && S('MZ-1001').seats === 4, 'sync recovers on its own after failures');

  mode = 'ok'; Z.cfg(); require('../lib/meezab');
  // expired session -> automatic re-login
  const cookieBefore = logins; db.meezab.sessionEnc = ''; // force a cold start path
  mode = 'ok'; r = await Z.runSync({ by: 'test' }); ok(r.ok, 'works with an existing or refreshed session');

  mode = 'captcha'; db.meezab.status = 'ok'; Z.setSession && 0;
  // wipe the session so the engine has to log in
  const Zc = require('../lib/meezab'); await new Promise(res => { mode = 'expired-forever'; res(); });
  const beforeExpiry = JSON.stringify(db.groups);
  r = await Zc.runSync({ by: 'test' });
  ok(!r.ok && db.meezab.status === 'needs_reauth' && JSON.stringify(db.groups) === beforeExpiry, 'expired login with no way in: status needs_reauth, no data touched');
  ok(db.notifs.some(n => /sign in again/i.test(n.title)), 'an administrator alert is raised');
  const n1 = db.notifs.length; await Zc.runSync({ by: 'test' }); ok(db.notifs.length === n1, 'the alert is not repeated on every retry');

  mode = 'ok'; const cp = await Zc.setSession('sess=GOOD').catch(e => ({ ok: false, error: e.message }));
  ok(cp.ok && db.meezab.status === 'ok', 'reauthentication workflow: pasted session is validated, then sync resumes');
  mode = 'ok'; const badSes = await Zc.setSession('sess=NOPE').then(() => 'accepted').catch(e => e.message); ok(/not signed in|expired/i.test(badSes), 'an invalid pasted session is rejected');


  console.log('Group edits keep sync data');
  const Gr = require('../lib/groups'); const pk = [{ name: 'Std', hotel: 'H', prices: { q: 1000 } }];
  db.groups = [g('KEEP-1', 10)]; db.groups[0].meezab = { ref: 'KEEP-1', remaining: 10, at: 'x', soldOut: false }; db.groups[0].supplierRef = 'SUP-77';
  const e = db.groups[0]; Gr.upsert({ ...e, meezab: undefined, supplierRef: undefined, seats: 99 });
  ok(Gr.find('KEEP-1').meezab && Gr.find('KEEP-1').supplierRef === 'SUP-77', 'upsert preserves sync metadata and supplier reference');

  srv.close(); console.log(`\n${pass} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
