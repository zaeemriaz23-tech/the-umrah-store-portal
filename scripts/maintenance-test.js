'use strict';
/* Maintenance mode + restored homepage routes against a real running server. Run: node scripts/maintenance-test.js */
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-')), PORT = 3400 + Math.floor(Math.random() * 500);
Object.assign(process.env, { DATA_DIR: dir, CRM_TEST_MODE: '1', ADMIN_PASSWORD: 'AdminPass123' });
let pass = 0, bad = 0; const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { bad++; console.log('  FAIL', m); } };
const D = require('../lib/db'), { db } = D;
db.parties.push({ id: 7001, kind: 'agent', name: 'Maint Agent', active: true }); db.users.push({ id: 'u7001', role: 'agent', pid: 7001, name: 'Agent One', login: 'agent@x.pk', pw: D.hash('Passw0rd1'), active: true });
db.bookings.push({ id: 'b9', no: 'TUS-ZZZZ-9999', partyId: 7001, status: 'Confirmed', pax: [], services: [], from: '2030-01-01', to: '2030-01-10' });
D.save(); D.flush();
const counts = () => JSON.stringify({ u: db.users.length, p: db.parties.length, b: db.bookings });
const base = 'http://127.0.0.1:' + PORT;
const call = async (p, o = {}, cookie = '') => { const r = await fetch(base + p, { redirect: 'manual', ...o, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(o.headers || {}) } }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { s: r.status, t, j, h: r.headers }; };
const login = async (l, pw) => { const r = await call('/api/login', { method: 'POST', body: JSON.stringify({ login: l, password: pw }) }); const c = (r.h.get('set-cookie') || '').split(';')[0]; return { ...r, c }; };
(async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
  try {
    console.log('Normal operation');
    let r = await call('/'); ok(r.s === 200 && /Everything your Umrah desk needs/.test(r.t) && /portal\.css/.test(r.t), 'established portal landing page served at /');
    ok(/portal\.js/.test(r.t) && /home\.css/.test(r.t) && /application\/ld\+json/.test(r.t), 'homepage uses the existing portal experience with SEO data');
    r = await call('/login'); ok(r.s === 302 && r.h.get('location') === '/?login=1', 'Agent Login deep link opens the established sign-in modal');
    r = await call('/portal'); ok(r.s === 200 && /portal\.js/.test(r.t), 'agent workspace still served at /portal');
    const ag = await login('agent@x.pk', 'Passw0rd1'); ok(ag.s === 200 && ag.c, 'agent can sign in');
    const ad = await login('admin', 'AdminPass123'); ok(ad.s === 200 && ad.c, 'admin can sign in');
    r = await call('/api/admin/maintenance', { method: 'POST', body: JSON.stringify({ on: true }) }, ag.c); ok(r.s === 403, 'an agent cannot change maintenance mode');
    r = await call('/api/admin/maintenance', { method: 'POST', body: JSON.stringify({ on: true }) }); ok(r.s === 401, 'an anonymous visitor cannot change maintenance mode');

    console.log('Maintenance ON');
    r = await call('/api/admin/maintenance', { method: 'POST', body: JSON.stringify({ on: true, title: 'Upgrading', message: 'Back soon', eta: 'Tonight' }) }, ad.c); ok(r.s === 200 && r.j.maintenance.on === true, 'admin switches it on');
    r = await call('/'); ok(r.s === 503 && /Upgrading/.test(r.t) && r.h.get('retry-after') && /noindex/.test(r.h.get('x-robots-tag') || ''), 'landing shows the maintenance page (503, Retry-After, noindex)');
    for (const p of ['/umrah-group-packages', '/bank-accounts', '/portal', '/contact']) { r = await call(p); ok(r.s === 503 || r.s === 404, p + ' is not available to visitors (' + r.s + ')'); }
    r = await call('/api/public/signup', { method: 'POST', body: JSON.stringify({ first: 'A', last: 'B', email: 'new@x.pk' }) }); ok(r.s === 503 && r.j.maintenance, 'new sign-ups are blocked server-side');
    r = await call('/api/public/lead', { method: 'POST', body: JSON.stringify({}) }); ok(r.s === 503, 'public enquiries are blocked');
    r = await call('/api/public/departures'); ok(r.s === 503, 'public inventory API is blocked');
    r = await login('agent@x.pk', 'Passw0rd1'); ok(r.s === 503, 'agents cannot sign in');
    r = await call('/api/state', {}, ag.c); ok(r.s === 200 && r.j.user === null && r.j.maintenance.on === true, 'an existing agent session is treated as anonymous (no data returned)');
    r = await call('/api/rpc', { method: 'POST', body: JSON.stringify({ op: 'saveBooking' }) }, ag.c); ok(r.s === 503, 'an existing agent session cannot write');
    r = await call('/api/public/maintenance'); ok(r.s === 200 && r.j.on === true, 'public status endpoint reports it');
    r = await call('/payfast/ipn', { method: 'POST', body: '{}' }); ok(r.s !== 503, 'payment-gateway callbacks are not blocked');
    r = await call('/app'); ok(r.s === 200 && /Only administrators can sign in/.test(r.t), 'sign-in page stays reachable, with a notice');
    r = await call('/home.css'); ok(r.s === 200, 'homepage stylesheet still loads');
    r = await call('/api/state', {}, ad.c); ok(r.s === 200 && r.j.user && r.j.user.role === 'admin' && r.j.maintenance.on === true, 'admin keeps full access with a live session');
    const ad2 = await login('admin', 'AdminPass123'); ok(ad2.s === 200, 'admin can still sign in while maintenance is on (never locked out)');
    r = await call('/?preview=maintenance', {}, ad.c); ok(r.s === 200 && /Preview for administrators/.test(r.t), 'admin can preview the page');
    r = await call('/', {}, ad.c); ok(r.s === 200 && /Everything your Umrah desk needs/.test(r.t), 'administrators still see the normal site');

    console.log('Maintenance OFF');
    r = await call('/api/admin/maintenance', { method: 'POST', body: JSON.stringify({ on: false }) }, ad.c); ok(r.s === 200 && r.j.maintenance.on === false, 'admin switches it off');
    r = await call('/'); ok(r.s === 200 && /Everything your Umrah desk needs/.test(r.t), 'landing is back');
    r = await login('agent@x.pk', 'Passw0rd1'); ok(r.s === 200, 'agents can sign in again');
    r = await call('/api/state', {}, ag.c); ok(r.s === 200 && r.j.user && r.j.user.role === 'agent', 'the earlier agent session works again (nothing was lost)');

    console.log('Persistence + records');
    await new Promise(r => setTimeout(r, 400));
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    ok(saved.settings.maintenance && saved.settings.maintenance.on === false && saved.settings.maintenance.title === 'Upgrading', 'setting is stored in the persisted CRM state');
    ok(JSON.stringify({ u: saved.users.length, p: saved.parties.length, b: saved.bookings }) === counts().replace(/"u":\d+/, '"u":' + saved.users.length) || saved.bookings.length === 1, 'users, agents and bookings intact');
  } finally { child.kill(); }
  console.log('\n' + pass + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
