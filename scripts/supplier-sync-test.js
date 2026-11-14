'use strict';
/* Automatic Meezab inventory sync against a local mock supplier (login, session expiry, retries, pagination, both response shapes). Run: node scripts/supplier-sync-test.js */
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-'));
Object.assign(process.env, { DATA_DIR: dir, CRM_TEST_MODE: '1', MEEZAB_USERNAME: 'agent', MEEZAB_PASSWORD: 'secret-pass', MEEZAB_SECRET_KEY: 'k'.repeat(24), MEEZAB_RETRY_BASE_MS: '5', MEEZAB_START_DELAY_MS: '600000' });
let pass = 0, bad = 0; const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { bad++; console.log('  FAIL', m); } };
const future = n => { const d = new Date(Date.now() + n * 864e5); return d.toISOString().slice(0, 10); };

/* ---- mock supplier ---- */
let mode = 'nested', fail500 = 0, validSession = 'GOOD1', logins = 0; const methods = [];
let SEATS = {}, GROUPS = [];
const mkGroups = () => Array.from({ length: 12 }, (_, i) => ({ GroupOid: 1000 + i, GroupCode: 'UMR-' + (100 + i), TravelDate: future(30 + i), ReturnDate: future(44 + i), Duration: 14, AirlineName: 'Saudia', FlightNo: 'SV 70' + i, ReturnFlightNo: 'SV 71' + i, Sector: 'LHE-JED', DepartureTime: '08:30', ArrivalTime: '12:10', AvailableSeats: 20 + i,
  Packages: [{ PackageCode: 'P-A' + i, MakkahHotel: 'Hilton', MadinahHotel: 'Anwar', MakkahNights: 7, MadinahNights: 7, QuadPrice: 300000 + i, SharingPrice: 320000 }, { PackageCode: 'P-B' + i, MakkahHotel: 'Swissotel', MadinahHotel: 'Pullman', MakkahNights: 7, MadinahNights: 7, QuadPrice: 400000 }] }));
const flat = gs => gs.flatMap(g => g.Packages.map(p => ({ ...g, Packages: undefined, ...p })));
const body = () => { const gs = GROUPS.map(g => ({ ...g, AvailableSeats: SEATS[g.GroupOid] !== undefined ? SEATS[g.GroupOid] : g.AvailableSeats })); return mode === 'flat' || mode === 'paged' ? flat(gs) : gs; };
const srv = http.createServer((req, res) => {
  methods.push(req.method); const cookie = req.headers.cookie || '', url = new URL(req.url, 'http://x');
  if (url.pathname === '/login') {
    if (req.method === 'POST') { let b = ''; req.on('data', d => b += d); req.on('end', () => { logins++; if (/password=secret-pass/.test(b) && /_csrf=tok/.test(b)) { res.writeHead(302, { 'Set-Cookie': 'sess=' + validSession + '; Path=/', Location: '/UMR/Home' }); } else res.writeHead(200); res.end(); }); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<form method=post action="/login"><input type=hidden name=_csrf value=tok><input name=email><input type=password name=password></form>');
  }
  if (url.pathname === '/UMR/GetUmrGroupViewData') {
    if (!cookie.includes('sess=' + validSession)) { res.writeHead(302, { Location: '/login?ReturnUrl=x' }); return res.end(); }
    if (fail500 > 0) { fail500--; res.writeHead(500); return res.end('oops'); }
    if (mode === 'empty') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"d":[]}'); }
    let rows = body();
    if (mode === 'paged') { const pg = +(url.searchParams.get('page') || 1), size = 10, tp = Math.ceil(rows.length / size); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ Data: rows.slice((pg - 1) * size, pg * size), TotalPages: tp, Page: pg })); }
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ d: rows }));
  }
  res.writeHead(404); res.end();
});

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port; process.env.MEEZAB_API_URL = base + '/UMR/GetUmrGroupViewData';
  const D = require('../lib/db'), { db } = D; require('../lib/ops'); require('../lib/integrations'); const Z = require('../lib/supplier'), G = require('../lib/groups'), St = require('../lib/state');
  GROUPS = mkGroups();
  // existing CRM records that the sync must never touch
  db.parties.push({ id: 5001, kind: 'agent', name: 'Test Agent', active: true }); db.users.push({ id: 'u5001', role: 'agent', pid: 5001, name: 'Ag', login: 'ag@x.pk', pw: D.hash('Passw0rd1'), active: true });
  db.bookings.push({ id: 'b1', no: 'TUS-AAAA-1111', partyId: 5001, status: 'Confirmed', pax: [{ n: 'A' }], services: [{ id: 's1', type: 'package', qty: 1, sell: 350000, cost: 300000 }], groupRef: { gid: 'MZ1003', seats: 1 }, from: future(33), to: future(47) });
  db.payments.push({ id: 'p1', partyId: 5001, amt: 100000, status: 'Approved' }); db.entries.push({ id: 'e1', partyId: 5001, dr: 10, cr: 0 }); db.vouchers.push({ id: 'v1', bookingId: 'b1', token: 'tok1' });
  db.groups.push({ id: 'MANUAL-1', code: 'MANUAL-1', air: 'PK', airline: 'PIA', dep: future(60), ret: future(74), n: 14, seats: 9, out: {}, inb: {}, pk: [] });
  const protectedSnap = () => JSON.stringify({ u: db.users, p: db.parties, b: db.bookings, pay: db.payments, e: db.entries, v: db.vouchers });
  const before = protectedSnap(); db.supplierSync = { enabled: true, intervalMin: 2, missThreshold: 2 };
  const S = id => db.groups.find(x => x.id === id), byOid = o => db.groups.find(g => g.sup && String(g.sup.oid) === String(o));

  console.log('Parsing');
  ok(Z.parseSeats(12) === 12 && Z.parseSeats('Sold Out') === 0 && Z.parseSeats(0) === 0, 'explicit numbers, 0 and sold-out words are understood');
  ok(Z.parseSeats(null) === null && Z.parseSeats('') === null && Z.parseSeats('??') === null && Z.parseSeats(-3) === null && Z.parseSeats(undefined) === null, 'missing / blank / junk / negative seats are UNKNOWN, never zero');
  ok(Z.toISODate('15/03/2027') === '2027-03-15' && Z.toISODate('2027-03-15T00:00:00') === '2027-03-15' && Z.toISODate('15-Mar-2027') === '2027-03-15' && Z.toISODate('31/02/2027') === '', 'date formats are parsed and impossible dates rejected');

  console.log('Automatic discovery (nested response, cookie login)');
  let r = await Z.runSync({ by: 'test', manual: true });
  ok(r.ok, 'first sync succeeds (signs in with server-side credentials)');
  const sup = db.groups.filter(g => g.sup);
  ok(sup.length === 12 && sup.every(g => g.pk.length === 2), '12 groups and 24 packages created automatically');
  ok(new Set(db.groups.map(g => g.id)).size === db.groups.length, 'no duplicate local ids');
  ok(byOid(1003).id === 'MZ1003' && byOid(1003).seats === 23 && byOid(1003).code === 'UMR-103' && byOid(1003).out.fn === 'SV 703' && byOid(1003).out.from === 'LHE', 'fields mapped: seats, code, flight, sector');
  ok(byOid(1003).pk[0].p.qd === 300003 && byOid(1003).pk[0].sup.cost.qd === 300003, 'selling price initialised from supplier cost (markup 0)');
  ok(methods.filter(m => m !== 'GET').length === 1 && logins === 1, 'read-only: only non-GET request is the single login POST');
  ok(!JSON.stringify(db.supplierSync).includes('secret-pass') && !!db.supplierSync.sessionEnc && !db.supplierSync.sessionEnc.includes('GOOD1'), 'password never stored; session cookie encrypted');
  ok(S('MANUAL-1') && S('MANUAL-1').seats === 9 && !S('MANUAL-1').sup, 'hand-entered group untouched');
  let t = Z.totals(); ok(t.groups === 12 && t.packages === 24 && t.activeGroups === 12, 'totals: groups / packages / active');

  console.log('Repeat sync = no duplicates, no churn');
  r = await Z.runSync({}); ok(r.ok && r.entry.newGroups === 0 && r.entry.updatedGroups === 0 && db.groups.length === 13, 'second run creates and updates nothing');
  const revBefore = db.rev, logN = db.supSyncLog.length; await Z.runSync({}); await Z.runSync({});
  ok(db.rev === revBefore && db.supSyncLog.length === logN, 'further identical runs write nothing and merge into one history row');

  console.log('New group + new package + seat change');
  GROUPS.push({ GroupOid: 2000, GroupCode: 'UMR-NEW', TravelDate: future(90), ReturnDate: future(104), Duration: 14, AirlineName: 'Emirates', FlightNo: 'EK 622', AvailableSeats: 30, Packages: [{ PackageCode: 'P-N1', MakkahHotel: 'Fairmont', MadinahHotel: 'Dar', QuadPrice: 500000 }] });
  GROUPS[0].Packages.push({ PackageCode: 'P-A0-EXTRA', MakkahHotel: 'Movenpick', MadinahHotel: 'Oberoi', QuadPrice: 350000 });
  SEATS[1001] = 3; SEATS[1002] = 0; SEATS[1004] = null;
  r = await Z.runSync({});
  ok(r.entry.newGroups === 1 && r.entry.newPackages === 2, 'new group and new package detected');
  ok(byOid(2000).seats === 30 && byOid(1000).pk.length === 3, 'they appear in local inventory');
  ok(byOid(1001).seats === 3 && byOid(1002).seats === 0 && byOid(1002).sup.soldOut === true, 'seat changes synchronised; explicit 0 = sold out');
  ok(byOid(1004).seats === 24, 'unreadable (null) seats leave stored seats unchanged');
  ok(r.entry.unknownSeats >= 1, 'unreadable seats are counted');

  console.log('Removal = deactivation (after 2 complete syncs), reactivation, history intact');
  const removedPk = GROUPS[5].Packages.pop(); const removedGroup = GROUPS.splice(7, 1)[0];
  r = await Z.runSync({}); ok(byOid(removedGroup.GroupOid).active !== false && byOid(1005).pk.every(k => k.active !== false), 'first miss: still active (guards against a one-off glitch)');
  r = await Z.runSync({}); ok(byOid(removedGroup.GroupOid).active === false && r.entry.removedGroups === 1 && r.entry.removedPackages === 1, 'second miss: group and package deactivated');
  ok(byOid(1005).pk.find(k => k.sup.code === removedPk.PackageCode).active === false && byOid(1005).pk.filter(k => k.active !== false).length === 1, 'only the removed package is inactive');
  ok(db.groups.some(g => g.sup && g.sup.oid == removedGroup.GroupOid), 'deactivated group record is kept (not deleted)');
  const ag = { id: 'u5001', role: 'agent', pid: 5001, name: 'Ag' }, snapAg = St.snapshot(ag);
  ok(!snapAg.groups.some(g => g.id === byOid(removedGroup.GroupOid).id) && snapAg.groups.find(g => g.id === byOid(1005).id).pk.length === 1, 'agent-facing inventory hides inactive group and package');
  ok(JSON.stringify(snapAg.groups).indexOf('"sup"') < 0 && JSON.stringify(snapAg.groups).indexOf('cost') < 0, 'agents never receive supplier ids or supplier cost');
  let threw = false; try { require('../lib/ops').OPS.saveBooking(ag, { partyId: 5001, category: 'Group Package', pax: [{ n: 'Zed', g: 'M', t: 'adult' }], services: [], groupRef: { gid: byOid(removedGroup.GroupOid).id, room: 'qd' } }); } catch { threw = true; } ok(threw, 'a NEW booking on a deactivated group is refused');
  GROUPS.splice(7, 0, removedGroup); GROUPS[5].Packages.push(removedPk);
  r = await Z.runSync({}); ok(byOid(removedGroup.GroupOid).active === true && byOid(1005).pk.every(k => k.active !== false) && r.entry.reactivatedGroups === 1, 'returning group and package are reactivated automatically');

  console.log('Prices: admin-set selling prices are never overwritten');
  const pkAuto = byOid(1006).pk[0], pkHand = byOid(1007).pk[0];
  const edited = JSON.parse(JSON.stringify(byOid(1007))); edited.pk[0].p.qd = 999999;      // an administrator edits the price through the normal save path
  G.upsert({ ...edited, pk: edited.pk.map(k => ({ id: k.id, mk: k.mk, md: k.md, mkn: k.mkn, mdn: k.mdn, mkd: '', mdd: '', p: k.p })) });
  GROUPS[6].Packages[0].QuadPrice = 310000; GROUPS[7].Packages[0].QuadPrice = 410000;
  r = await Z.runSync({});
  ok(byOid(1006).pk[0].p.qd === 310000 && byOid(1006).pk[0].sup.cost.qd === 310000, 'auto-priced package follows the supplier change');
  ok(byOid(1007).pk[0].p.qd === 999999 && byOid(1007).pk[0].lock === true && byOid(1007).pk[0].sup.cost.qd === 410000 && byOid(1007).pk[0].sup, 'hand-edited price kept; supplier cost still recorded; supplier link survives the edit');

  console.log('Flat rows + pagination');
  mode = 'paged'; r = await Z.runSync({}); ok(r.ok && r.entry.pages >= 3 && r.entry.groups === 13, 'every page fetched (' + (r.entry && r.entry.pages) + ' pages), groups merged from flat rows');
  ok(db.groups.filter(g => g.sup).length === 13 && new Set(db.groups.map(g => g.id)).size === db.groups.length, 'no duplicates after the shape change');

  console.log('Failures never damage inventory');
  mode = 'nested'; const snap = JSON.stringify(db.groups);
  mode = 'empty'; r = await Z.runSync({}); ok(!r.ok && JSON.stringify(db.groups) === snap, 'empty response is rejected, inventory untouched');
  mode = 'nested'; const keep = GROUPS.slice(); GROUPS = GROUPS.slice(0, 3); r = await Z.runSync({}); ok(!r.ok && r.entry.kind === 'partial' && JSON.stringify(db.groups) === snap, 'a far smaller response is rejected as partial');
  GROUPS = keep;
  fail500 = 2; r = await Z.runSync({}); ok(r.ok, 'HTTP 500 is retried with back-off and then succeeds');
  const lo = logins; validSession = 'GOOD2'; r = await Z.runSync({}); ok(r.ok && logins === lo + 1, 'expired session: signs in again automatically and retries');
  ok(db.supplierSync.fails === 0 && db.supplierSync.lastOkAt, 'last successful sync recorded');
  const snap2 = JSON.stringify(db.groups); validSession = 'GOOD3'; process.env.MEEZAB_PASSWORD = ''; process.env.MEEZAB_USERNAME = '';
  r = await Z.runSync({}); ok(!r.ok && db.supplierSync.status === 'needs_reauth' && JSON.stringify(db.groups) === snap2, 'expired session without credentials -> needs sign-in alert, nothing changed');
  ok(db.supSyncLog.length > 5 && db.supSyncLog.some(e => !e.ok && e.error), 'history and error log are kept');

  console.log('Existing records');
  ok(protectedSnap() === before, 'users, agents, bookings, payments, ledger entries and vouchers are byte-for-byte unchanged by every sync');
  ok(db.bookings[0].groupRef.gid === 'MZ1003', 'existing booking still points at its group');
  srv.close(); console.log('\n' + pass + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
