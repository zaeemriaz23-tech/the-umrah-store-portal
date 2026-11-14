'use strict';
/**
 * The Umrah Store CRM v3 - B2B / B2C travel operations platform
 * Express + JSON store. Roles: admin, staff, agent, supplier.
 */
require('./lib/env');
const express = require('express');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const D = require('./lib/db');
const { db, DATA, check, save, today, str } = D;
const L = require('./lib/ledger');
const { OPS, sweep, isStaff } = require('./lib/ops');
const I = require('./lib/integrations');
const Search = require('./lib/search');
const AI = require('./lib/assistant');
const R = require('./lib/render');
const { snapshot } = require('./lib/state');
const SEO = require('./lib/seo');
const Inv = require('./lib/inventory');
const PM = require('./lib/perms');
const X = require('./lib/extras');
const SU = require('./lib/signup');
const Chat = require('./lib/chat');
const Mail = require('./lib/mailer');
const Mod = require('./lib/modules');
const Brand = require('./lib/brand');
const Seat = require('./lib/meezab');
const Sup = require('./lib/supplier');
const Maint = require('./lib/maintenance');
const F = require('./lib/files');
const E = require('./public/engine.js');

const PORT = process.env.PORT || 3000;
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(compression({ filter: (req, res) => !/\/stream$/.test(req.path) && compression.filter(req, res) }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy': "frame-ancestors 'self'; base-uri 'self'; object-src 'none'", 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});

/* ---------- auth ---------- */
const cookie = (req, k) => (req.headers.cookie || '').split(';').map(s => s.trim().split('=')).find(x => x[0] === k)?.[1];
app.use((req, res, next) => {
  const s = db.sessions[cookie(req, 'sid')];
  if (s && s.exp > Date.now()) { const u = db.users.find(x => x.id === s.uid); if (u && u.active !== false && !u.suspended) req.u = u; }
  next();
});
app.use(Maint.guard); // maintenance mode is enforced here, on the server, for every request
const auth = (req, res, next) => (req.u ? next() : res.status(401).json({ error: 'Login required' }));
const perm = (...ks) => (req, res, next) => (req.u && PM.canAny(req.u, ks) ? next() : res.status(req.u ? 403 : 401).json({ error: req.u ? 'You do not have permission to do this' : 'Login required' }));
const bucket = new Map();
const limit = (key, max, ms) => { const t = (bucket.get(key) || []).filter(x => Date.now() - x < ms); if (t.length >= max) return false; t.push(Date.now()); bucket.set(key, t); return true; };
setInterval(() => { for (const [k, v] of bucket) if (!v.some(x => Date.now() - x < 36e5)) bucket.delete(k); }, 6e5).unref();

/* ---------- request watchdog: never leave a browser hanging, and log what was slow ---------- */
const WD = { inflight: 0, slow: 0, aborted: 0, lastSlow: '', lagMs: 0 };
{ let last = Date.now(); setInterval(() => { const now = Date.now(); WD.lagMs = Math.max(0, now - last - 500); last = now; }, 500).unref(); }
app.use((req, res, next) => {
  if (/\/stream$/.test(req.path)) return next(); // long-lived Server-Sent Events
  const t0 = Date.now(); WD.inflight++;
  const timer = setTimeout(() => {
    if (res.headersSent) return;
    WD.aborted++; WD.lastSlow = req.method + ' ' + req.path + ' > 25s';
    console.error('REQUEST TIMEOUT (25s, no response yet): ' + req.method + ' ' + req.originalUrl + ' event-loop lag ' + WD.lagMs + 'ms');
    if (req.path.startsWith('/api/')) res.status(503).json({ error: 'The server is busy. Please try again.' });
    else res.status(503).set({ 'Retry-After': '5', 'Cache-Control': 'no-store' }).send(R.infoPage('Please try again', 'The server took too long to respond. Reload the page in a few seconds.', false));
  }, 25000);
  let done = false; const fin = () => { if (done) return; done = true; clearTimeout(timer); WD.inflight--; const ms = Date.now() - t0; if (ms > 3000) { WD.slow++; WD.lastSlow = req.method + ' ' + req.path + ' ' + ms + 'ms'; console.warn('SLOW REQUEST ' + ms + 'ms: ' + req.method + ' ' + req.originalUrl); } };
  res.on('finish', fin); res.on('close', fin);
  next();
});
app.use((req, res, next) => { if (req.method === 'GET' && !req.path.startsWith('/api/')) { try { R.rememberHost(SEO.baseUrl(req)); } catch (e) { console.error('rememberHost failed:', e.message); } } next(); });
app.get('/healthz', async (req, res) => {
  try {
    const storage = await D.health();
    const storageOk = !storage.configured || storage.healthy;
    res.status(storageOk ? 200 : 503).json({ ok: true, version: require('./package.json').version, storage, runtime: { uptimeSec: Math.round(process.uptime()), inflight: WD.inflight, slowRequests: WD.slow, timedOut: WD.aborted, lastSlow: WD.lastSlow, eventLoopLagMs: WD.lagMs, rssMb: Math.round(process.memoryUsage().rss / 1048576) } });
  } catch (e) { res.status(503).json({ ok: false, version: require('./package.json').version, storage: { driver: 'mysql', healthy: false, error: e.message } }); }
});

app.post('/api/login', (req, res) => {
  if (!limit('login:' + req.ip, Math.max(3, +db.settings.security.loginMax || 10), 9e5)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const u = db.users.find(x => x.login === String(req.body.login || '').toLowerCase().trim());
  if (!u || u.active === false || u.suspended || !check(String(req.body.password || ''), u.pw)) { const h = !u && SU.loginHint(req.body.login, req.body.password); return res.status(h ? 403 : 401).json({ error: h || 'Incorrect username or password', pendingApproval: !!h }); }
  if (Maint.isOn() && !Maint.allows(u)) return res.status(503).json({ error: Maint.publicInfo().title + '. Only administrators can sign in right now. Please try again later.', maintenance: true });
  const sid = crypto.randomBytes(24).toString('hex');
  const sd = Math.max(1, +db.settings.security.sessionDays || 7); db.sessions[sid] = { uid: u.id, exp: Date.now() + 864e5 * sd };
  u.lastLogin = new Date().toISOString(); D.logAct(u, 'login', ''); save();
  res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 864e5 * sd });
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { delete db.sessions[cookie(req, 'sid')]; save(); res.clearCookie('sid'); res.json({ ok: true }); });

/* ---------- data ---------- */
app.get('/api/rev', auth, (req, res) => res.json({ rev: db.rev }));
app.get('/api/state', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(snapshot(req.u)); });

app.get('/api/ledger/:pid', auth, (req, res) => {
  const pid = +req.params.pid, p = db.parties.find(x => x.id === pid);
  if (!p) return res.status(404).json({ error: 'Account not found' });
  if (!isStaff(req.u) && req.u.pid !== pid) return res.sendStatus(403);
  if (isStaff(req.u) && !PM.can(req.u, p.kind === 'supplier' ? 'ledgers.supplier.view' : 'ledgers.agent.view')) return res.status(403).json({ error: 'You do not have permission to view this ledger' });
  res.json({ party: { id: p.id, kind: p.kind, name: p.name, phone: p.phone, city: p.city, limit: p.limit }, rows: L.ledger(pid), wallet: p.kind === 'agent' ? L.wallet(pid) : null });
});

const AUDITED = { setStatus: 'booking.status', delBooking: 'booking.deleted', saveBooking: 'booking.saved', addPayment: 'payment.recorded', approvePayment: 'payment.approved', rejectPayment: 'payment.rejected', delPayment: 'payment.deleted', createPaylink: 'paylink.created',
  addEntry: 'ledger.entry_posted', delEntry: 'ledger.entry_deleted', delExpense: 'expense.deleted', addExpense: 'expense.added', saveParty: 'party.saved', delParty: 'party.deleted', importData: 'data.imported', saveUser: 'staff.legacy_user_saved', delUser: 'staff.legacy_user_deleted', delVoucher: 'voucher.deleted', delQuery: 'query.deleted', setLogo: 'branding.logo_changed', resetLogo: 'branding.logo_reset' };
app.post('/api/rpc', auth, (req, res) => {
  try {
    const op = String(req.body.op || ''), f = OPS[op]; if (!f || op.startsWith('_') || !Object.prototype.hasOwnProperty.call(OPS, op)) throw new Error('Unknown operation');
    PM.gate(req.u, op, req.body);
    Mod.gateOp(op);
    const out = f(req.u, req.body) || {};
    if (AUDITED[op] && isStaff(req.u)) PM.audit(req.u, AUDITED[op], String(req.body.id || req.body.partyId || req.body.login || out.no || out.id || ''), { op, status: req.body.status, amt: req.body.amt, kind: req.body.kind });
    save(); res.json({ ok: true, ...out });
  } catch (e) { res.status(e.status || 400).json({ error: e.message, limit: e.limit, seats: e.seats, dup: e.dup, dupNo: e.dupNo, needForce: e.needForce }); }
});
app.get('/api/audit', auth, perm('audit.view'), (req, res) => {
  const q = req.query, from = q.from || '', to = q.to ? q.to + 'T23:59:59.999Z' : '', act = String(q.action || '').toLowerCase(), who = String(q.user || '').toLowerCase(), text = String(q.q || '').toLowerCase();
  let rows = db.audit.filter(r => (!from || r.t >= from) && (!to || r.t <= to) && (!act || r.a.toLowerCase().includes(act)) && (!who || (r.u + ' ' + r.uid).toLowerCase().includes(who)) && (!text || (r.r + ' ' + JSON.stringify(r.m)).toLowerCase().includes(text)));
  const total = rows.length, off = Math.max(0, +q.offset || 0);
  res.json({ total, rows: rows.slice().reverse().slice(off, off + 100), actions: [...new Set(db.audit.map(r => r.a))].sort() });
});

SU.mount(app, { auth, limit });
Chat.mount(app, { auth, limit });
app.get('/api/portal/me', (req, res) => {
  const c = db.settings.company || {}, u = req.u;
  res.set('Cache-Control', 'no-store').json({ user: u ? { name: u.name, role: u.role, pid: u.pid || null } : null, company: { name: c.name, tagline: c.tagline, phone: c.phone, whatsapp: c.whatsapp, email: c.email, address: c.address }, logoV: db.settings.logoV || 0, search: !!I.serpKey(), pending: u && SU.canReview(u) ? SU.pendingCount() : 0 });
});

/* ---------- live currency rates (SerpApi Google Finance, cached 6h) ---------- */
app.get('/api/fx', auth, async (req, res) => { try { await X.fxRefresh(false); } catch { /* snapshot carries the error */ } res.set('Cache-Control', 'no-store').json(X.fxSnapshot()); });
app.post('/api/fx/refresh', auth, async (req, res) => {
  if (!limit('fx:' + req.u.id, 4, 36e5)) return res.status(429).json({ error: 'Rates were refreshed a few times already. Try again in an hour.' });
  await X.fxRefresh(true).catch(() => {}); res.json(X.fxSnapshot());
});

/* ---------- branding, files ---------- */
const FILE_OK = f => fs.existsSync(f) && fs.statSync(f).isFile();
const PUB = path.join(__dirname, 'public');
/* Logo: a custom upload wins; otherwise the optimised set (WebP for modern browsers, PNG fallback). ?s=lg serves the 2x asset. */
app.get('/brand/logo', (req, res) => {
  const f = fs.readdirSync(path.join(DATA, 'brand')).find(x => x.startsWith('logo.'));
  res.set({ 'Cache-Control': 'public, max-age=86400', Vary: 'Accept' });
  if (f) return res.sendFile(path.join(DATA, 'brand', f));
  const webp = /image\/webp/.test(req.headers.accept || '');
  res.sendFile(path.join(PUB, 'brand', webp ? (req.query.s === 'lg' ? 'logo-640.webp' : 'logo-320.webp') : 'logo-320.png'));
});
/* Airline logos: fetched once from a public logo CDN, cached on the persistent disk, then served locally. Unknown codes -> 404 and the UI shows a coloured code badge. */
const AIRDIR = path.join(DATA, 'brand', 'airlines'); fs.mkdirSync(AIRDIR, { recursive: true });
const airPending = new Map(), airMiss = new Map();
async function airlineLogo(code) {
  const f = path.join(AIRDIR, code + '.png'); if (FILE_OK(f)) return f;
  if ((airMiss.get(code) || 0) > Date.now()) return null;
  if (!airPending.has(code)) airPending.set(code, (async () => {
    try {
      for (const u of ['https://pics.avs.io/200/200/' + code + '.png', 'https://images.kiwi.com/airlines/128x128/' + code + '.png']) {
        try {
          const r = await fetch(u, { signal: AbortSignal.timeout(6000) }); if (!r.ok || !/image\//.test(r.headers.get('content-type') || '')) continue;
          const b = Buffer.from(await r.arrayBuffer()); if (b.length < 200 || b.length > 300000) continue;
          fs.writeFileSync(f, b); return f;
        } catch { /* try next source */ }
      }
      airMiss.set(code, Date.now() + 36e5); return null;
    } finally { airPending.delete(code); }
  })());
  return airPending.get(code);
}
app.get('/brand/airline/:code.png', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase(); if (!/^[A-Z0-9]{2}$/.test(code)) return res.sendStatus(404);
  const f = await airlineLogo(code);
  if (!f) { const col = String(E.airColor(code)).replace(/[^#0-9a-fA-F]/g, '') || '#126047'; return res.set({ 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }).send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="${code}"><rect width="96" height="96" rx="22" fill="${col}"/><path d="M14 66c18-3 34-14 52-34 3-3 8-4 12-2-2 5-6 11-14 18 4 8 6 14 4 18-6-2-12-8-17-15-9 7-21 12-37 15z" fill="#fff" opacity=".16"/><text x="48" y="59" font-family="Arial,Helvetica,sans-serif" font-weight="800" font-size="34" text-anchor="middle" fill="#fff">${code}</text></svg>`); }
  res.set('Cache-Control', 'public, max-age=2592000, immutable').sendFile(f);
});
/* ---------- promotions (public) ---------- */
app.get('/api/public/promos', (req, res) => res.set('Cache-Control', 'public, max-age=60').json({ items: require('./lib/promos').publicList() }));
app.get('/promo-img/:f', (req, res) => { const f = path.basename(String(req.params.f)), full = path.join(require('./lib/promos').DIR, f); if (!/^[\w.-]+\.(jpg|png|webp)$/.test(f) || !FILE_OK(full)) return res.sendStatus(404); res.set('Cache-Control', 'public, max-age=2592000, immutable').sendFile(full); });
app.post('/api/mail/test', auth, perm('integrations.manage'), async (req, res) => { if (!limit('mt:' + req.u.id, 10, 6e4)) return res.status(429).json({ error: 'Too many tests. Wait a minute.' }); try { res.json(await Mail.test(String(req.body.id || ''), String(req.body.to || ''))); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/mail/verify', auth, perm('integrations.manage'), async (req, res) => { try { res.json(await Mail.verify(req.body)); } catch (e) { res.status(400).json({ error: e.message }); } });
const payView = (req, res, next) => (!isStaff(req.u) || PM.can(req.u, 'payments.view') ? next() : res.sendStatus(403));
app.get('/receipts/:f', auth, payView, (req, res) => {
  const f = path.basename(req.params.f), pay = db.payments.find(p => p.id === f.replace(/\.[^.]+$/, ''));
  if (!pay || (!isStaff(req.u) && pay.partyId != req.u.pid)) return res.sendStatus(404);
  res.sendFile(path.join(DATA, 'receipts', f));
});
app.get('/receipt/:id', auth, payView, async (req, res) => {
  const p = db.payments.find(x => x.id === req.params.id);
  if (!p || (!isStaff(req.u) && p.partyId != req.u.pid)) return res.status(404).send('Not found');
  res.send(await R.receiptHtml(p, req));
});
app.get('/api/backup', auth, perm('data.backup'), (req, res) => {
  PM.audit(req.u, 'export.backup', 'full database', {}); save();
  res.set({ 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="umrah-store-backup-' + today() + '.json"' });
  res.send(JSON.stringify({ ...db, sessions: {} }));
});

/* ---------- data safety: restore points stored in MySQL (crm_state_backups) ---------- */
const adminOnly = (req, res, next) => (req.u && req.u.role === 'admin' ? next() : res.status(req.u ? 403 : 401).json({ error: req.u ? 'Only the administrator can do this' : 'Login required' }));
app.get('/api/storage/status', auth, perm('data.backup'), async (req, res) => {
  try { const st = await D.storageStatus(); st.uploadedFiles = await F.status().catch(e => ({ error: e.message })); res.set('Cache-Control', 'no-store').json(st); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/backups', auth, perm('data.backup'), async (req, res) => {
  try { res.set('Cache-Control', 'no-store').json({ items: await D.listBackups() }); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/backups', auth, perm('data.backup'), async (req, res) => {
  if (!limit('bk:' + req.u.id, 10, 36e5)) return res.status(429).json({ error: 'Too many backups requested. Try again later.' });
  try { const r = await D.createBackup(str(req.body.note, 120) || 'manual backup by ' + req.u.name, 'manual'); PM.audit(req.u, 'export.backup', 'restore point #' + r.id, {}); save(); res.json({ ok: true, ...r }); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/backups/:id/download', auth, perm('data.backup'), async (req, res) => {
  try {
    const b = await D.getBackup(req.params.id), o = JSON.parse(b.payload); o.sessions = {};
    PM.audit(req.u, 'export.backup', 'restore point #' + b.id, {}); save();
    res.set({ 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="umrah-store-restore-point-' + b.id + '.json"' }).send(JSON.stringify(o));
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
app.post('/api/backups/:id/restore', auth, adminOnly, async (req, res) => {
  if (req.body.confirm !== 'RESTORE') return res.status(400).json({ error: 'Type RESTORE to confirm.' });
  if (!limit('rs:' + req.u.id, 3, 36e5)) return res.status(429).json({ error: 'Too many restores. Try again later.' });
  try { const r = await D.restoreBackup(req.params.id); PM.audit(req.u, 'data.restored', 'restore point #' + req.params.id, {}); save(); res.json({ ok: true, ...r }); } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

app.get('/api/qr', auth, async (req, res) => { res.type('image/svg+xml').send(await QRCode.toString(String(req.query.text || '').slice(0, 400) || ' ', { type: 'svg', margin: 1 })); });

/* ---------- vouchers (public, unguessable link) ---------- */
app.get('/v/:token', async (req, res) => {
  const v = db.vouchers.find(x => x.token === req.params.token);
  const h = v && await R.voucherHtml(v, req);
  if (!h) return res.status(404).send(R.infoPage('Voucher not found', 'This voucher link is not valid.', false));
  res.set('Cache-Control', 'no-store').send(Brand.cleanDoc(h));
});

/* ---------- live search (SerpApi) ---------- */
app.get('/api/airports', (req, res) => limit('apt:' + req.ip, 240, 6e4) ? res.json(require('./lib/airports').find(req.query.q)) : res.status(429).json({ error: 'Too many requests' }));
const dayISO = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
const searchGate = kind => (req, res, next) => {
  if (!Mod.enabled(kind === 'hotels' ? 'hotels' : 'flights')) return res.status(403).json({ error: 'This service is currently switched off' });
  if (req.u.role === 'supplier') return res.sendStatus(403);
  if (isStaff(req.u) && !PM.can(req.u, kind === 'hotels' ? 'search.hotels' : 'search.flights')) return res.status(403).json({ error: 'You do not have permission to use this search' });
  if (!limit('search:' + req.u.id, 40, 6e4)) return res.status(429).json({ error: 'Too many searches in a short time. Please wait a minute.' });
  next();
};
const searchRun = (kind, fn, check) => async (req, res) => {
  const q = { ...req.query }; if (q.from) q.from = String(q.from).toUpperCase(); if (q.to) q.to = String(q.to).toUpperCase();
  try { check(q); res.set('Cache-Control', 'no-store').json(Search.forUser(await Search[fn](q, req.u), req.u)); } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
};
const bad = m => { throw Object.assign(new Error(m), { status: 400 }); };
const flightCheck = q => {
  if (!/^[A-Z]{3}$/.test(q.from || '') || !/^[A-Z]{3}$/.test(q.to || '')) bad('Choose From and To airports (3-letter codes)');
  if (q.from === q.to) bad('From and To must be different airports');
  if (!dayISO(q.date)) bad('Choose a departure date'); if (dayISO(q.date) < today()) bad('The departure date is in the past');
  if (q.ret && (!dayISO(q.ret) || q.ret < q.date)) bad('The return date must be on or after the departure date');
};
const hotelCheck = q => {
  if (!String(q.city || '').trim()) bad('Enter a destination');
  if (!dayISO(q.cin) || !dayISO(q.cout)) bad('Choose check-in and check-out dates');
  if (q.cin < today()) bad('Check-in is in the past'); if (q.cout <= q.cin) bad('Check-out must be after check-in');
  if ((Date.parse(q.cout) - Date.parse(q.cin)) / 864e5 > 30) bad('Stays are limited to 30 nights per search');
};
const multiFlightCheck = (q, needsToken = false) => {
  let legs; try { legs = JSON.parse(q.legs || '[]'); } catch { bad('The multi-city itinerary is invalid. Please review the flight segments.'); }
  if (!Array.isArray(legs) || legs.length < 2 || legs.length > 6) bad('A multi-city itinerary must contain between 2 and 6 flight segments');
  let prior = '';
  const clean = legs.map((l, i) => {
    const from = String(l && l.from || '').toUpperCase(), to = String(l && l.to || '').toUpperCase(), date = dayISO(l && l.date);
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) bad('Choose valid From and To airports for Flight ' + (i + 1));
    if (from === to) bad('From and To must be different airports on Flight ' + (i + 1));
    if (!date || Number.isNaN(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) bad('Choose a valid date for Flight ' + (i + 1));
    if (date < today()) bad('The date for Flight ' + (i + 1) + ' is in the past');
    if (prior && date < prior) bad('Multi-city flight dates must be in chronological order');
    prior = date; return { from, to, date };
  });
  q.legs = clean;
  if (needsToken && !String(q.token || '').trim()) bad('Choose a flight before continuing to the next city');
  if (needsToken && String(q.token).length > 4000) bad('The selected flight token is invalid. Please restart the multi-city search.');
};
const multiFlightRun = needsToken => async (req, res) => {
  const q = { ...req.query };
  try {
    multiFlightCheck(q, needsToken);
    const fn = needsToken ? 'multiFlightNext' : 'multiFlights';
    res.set('Cache-Control', 'no-store').json(Search.forUser(await Search[fn](q, req.u), req.u));
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
};
app.get('/api/search/flights/multi/next', auth, searchGate('flights'), multiFlightRun(true));
app.get('/api/search/flights/multi', auth, searchGate('flights'), multiFlightRun(false));
app.get('/api/search/flights/return', auth, searchGate('flights'), searchRun('flights', 'flightReturn', q => { flightCheck(q); if (!q.token) bad('Choose an outbound flight first'); if (!q.ret) bad('A return date is needed'); }));
app.get('/api/search/hotels/detail', auth, searchGate('hotels'), searchRun('hotels', 'hotelDetail', q => { hotelCheck(q); if (!q.token) bad('Choose a hotel first'); }));
app.get('/api/search/flights', auth, searchGate('flights'), searchRun('flights', 'flights', flightCheck));
app.get('/api/search/hotels', auth, searchGate('hotels'), searchRun('hotels', 'hotels', hotelCheck));

/* ---------- payments: PayFast + one-link ---------- */
app.post('/api/payfast/start', auth, async (req, res) => {
  try {
    const u = req.u; if (u.role !== 'agent') throw new Error('Only agents pay online from their own account. Staff can create a payment link instead.');
    const amt = Math.round(+req.body.amt); if (!(amt >= 100)) throw new Error('Enter an amount of at least PKR 100');
    const pty = D.party(u.pid), bk = req.body.bookingId && db.bookings.find(b => b.id === req.body.bookingId && b.partyId == u.pid);
    res.json(await I.payfastStart(req, { partyId: u.pid, amt, note: str(req.body.note, 200) || (bk ? 'Booking ' + bk.no : 'Account top-up'), bookingId: bk ? bk.id : '', userName: u.name, email: pty && pty.email, phone: pty && pty.phone }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/payfast/test', auth, perm('integrations.manage'), async (req, res) => {
  if (!limit('pftest:' + req.u.id, 10, 36e5)) return res.status(429).json({ error: 'Too many tests. Try again later.' });
  try { PM.audit(req.u, 'integrations.payfast_test', 'payfast', {}); res.json(await I.payfastTest({ merchantId: str(req.body.merchantId, 60), securedKey: str(req.body.securedKey, 120), env: req.body.env === 'live' ? 'live' : 'sandbox' })); } catch (e) { res.status(400).json({ error: e.message }); }
});
const pfDone = (req, res) => {
  const q = { ...req.query, ...(req.body && typeof req.body === 'object' ? req.body : {}) };
  const p = I.payfastResult(q);
  if (req.method === 'POST' && req.path === '/payfast/ipn') return res.sendStatus(200);
  if (!p) return res.send(R.infoPage('Payment not found', 'We could not match this payment. If money was deducted, contact the office with your bank reference.', false));
  const ok = p.status === 'Approved', lk = p.linkId && db.paylinks.find(x => x.id === p.linkId), back = lk ? '/pay/' + lk.token : '/app';
  res.set('Cache-Control', 'no-store').send(R.infoPage(ok ? 'Payment received' : p.status === 'Pending' ? 'Payment under review' : 'Payment not completed', ok ? 'PKR ' + p.amt.toLocaleString('en-US') + ' has been added to your account.' : p.status === 'Pending' ? 'Your payment was received and is awaiting verification by the office.' : (p.pfMsg || 'The payment was not completed. You have not been charged.'), ok || p.status === 'Pending', back));
};
app.get('/payfast/return', pfDone);
app.post('/payfast/return', pfDone);
app.post('/payfast/ipn', pfDone);
app.get('/payfast/ipn', pfDone);

const link = (req, res) => {
  const l = db.paylinks.find(x => x.token === req.params.token);
  if (!l) { res.status(404).send(R.infoPage('Link not found', 'This payment link is not valid.', false)); return null; }
  return l;
};
app.get('/pay/:token', async (req, res) => {
  const l = link(req, res); if (!l) return;
  res.send(await R.payPageHtml(l, req, req.query.sent ? { ok: true, t: 'Receipt submitted. It will be credited once the office approves it.' } : null));
});
app.post('/pay/:token/start', async (req, res) => {
  const l = db.paylinks.find(x => x.token === req.params.token);
  if (!l || l.status !== 'Open' || !limit('pay:' + req.ip, 20, 36e5)) return res.status(400).json({ error: 'This link cannot be paid right now' });
  try { const pty = D.party(l.partyId); res.json(await I.payfastStart(req, { partyId: l.partyId, amt: l.amt, note: l.purpose, bookingId: l.bookingId, linkId: l.id, userName: pty && pty.name, email: pty && pty.email, phone: pty && pty.phone })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/pay/:token/proof', (req, res) => {
  const l = db.paylinks.find(x => x.token === req.params.token);
  if (!l || l.status !== 'Open' || !limit('proof:' + req.ip, 8, 36e5)) return res.status(400).json({ error: 'This link cannot accept a receipt right now' });
  try {
    const sys = { id: 'system', role: 'agent', pid: l.partyId, name: (D.party(l.partyId) || {}).name || 'Payment link' };
    OPS.addPayment(sys, { amt: l.amt, method: 'Bank transfer', ref: req.body.ref, note: 'Via payment link ' + l.id + ' - ' + l.purpose, bookingId: l.bookingId, file: req.body.file });
    const p = db.payments[db.payments.length - 1]; p.via = 'link'; p.linkId = l.id; save(); res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---------- WhatsApp (admin) ---------- */
app.get('/api/wa', auth, perm('integrations.view', 'integrations.manage'), async (req, res) => {
  const w = I.wa; let qr = ''; if (w.qr) qr = await QRCode.toDataURL(w.qr, { margin: 1, width: 280 });
  res.json({ status: w.status, number: w.number, error: w.error, qr });
});
app.post('/api/wa/start', auth, perm('integrations.manage'), async (req, res) => { PM.audit(req.u, 'integrations.whatsapp_start', 'whatsapp', {}); I.waStart(); res.json({ ok: true }); });
app.post('/api/wa/stop', auth, perm('integrations.manage'), async (req, res) => { PM.audit(req.u, 'integrations.whatsapp_' + (req.body.logout ? 'unlinked' : 'paused'), 'whatsapp', {}); await I.waStop(!!req.body.logout); res.json({ ok: true }); });

/* ---------- AI assistant: administrator (everything) or staff with "assistant.groups" (group packages, within their own group permissions) ---------- */
const aiGate = (req, res, next) => (AI.aiAccess(req.u) ? next() : res.status(403).json({ error: 'The AI assistant is not enabled for your account.' }));
app.post('/api/ai', auth, aiGate, async (req, res) => {
  if (!limit('ai:' + req.u.id, 30, 6e4)) return res.status(429).json({ error: 'Slow down a little - too many requests.' });
  try { res.json(await AI.aiAsk(req.u, str(req.body.q, 800), req.body.history)); } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});
app.post('/api/ai/run', auth, aiGate, (req, res) => {
  try { PM.audit(req.u, 'assistant.run', 'ai', { n: (req.body.actions || []).length }); const r = AI.aiRun(req.u, req.body.actions); save(); res.json({ results: r }); } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
app.post('/api/ai/test', auth, perm('integrations.manage'), async (req, res) => {
  try { const k = String(req.body.key || ''); res.json(await AI.groqTest(/^\*+$/.test(k) ? '' : k)); } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---------- bank accounts (public page + open API for the public list) ---------- */

/* live departures for the public landing: seats come from the synchronised inventory; sold-out is automatic; supplier names are filtered */
app.get('/api/public/departures', (req, res) => {
  if (!Mod.enabled('groups')) return res.json({ items: [], at: '' });
  const t = new Date().toISOString().slice(0, 10), sync = Sup.takesOver() ? { enabled: true, lastOkAt: Sup.publicStatus().lastOkAt } : Seat.publicStatus();
  const items = db.groups.map(g => require('./lib/groups').view(g, false)).filter(Boolean).filter(g => g.dep >= t).sort((a, b) => (a.dep < b.dep ? -1 : 1)).slice(0, 6).map(g => ({ code: g.code || g.id, airline: g.airline, dep: g.dep, ret: g.ret, n: g.n, seats: Math.max(0, g.seats | 0), soldOut: !!(g.meezab && g.meezab.soldOut) || g.seats <= 0 }));
  res.set('Cache-Control', 'public, max-age=30').json(Brand.cleanDeep({ items, at: sync.enabled ? sync.lastOkAt : '' }));
});
app.get('/api/public/banks', (req, res) => res.set('Cache-Control', 'public, max-age=30').json(R.publicBanks()));
app.get('/bank-accounts', async (req, res) => res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex' }).send(Brand.cleanDoc(await R.bankPageHtml(req))));


/* ---------- Meezab seat sync (administrator) ---------- */
const adminOnlyEarly = (req, res, next) => (req.u && req.u.role === 'admin' ? next() : res.status(req.u ? 403 : 401).json({ error: req.u ? 'Only the administrator can use seat sync' : 'Login required' }));
app.get('/api/seatsync', auth, adminOnlyEarly, (req, res) => res.set('Cache-Control', 'no-store').json({ ...Seat.publicStatus(), history: Seat.history(80) }));
app.post('/api/seatsync/run', auth, adminOnlyEarly, async (req, res) => {
  if (!limit('ssrun:' + req.u.id, 6, 6e4)) return res.status(429).json({ error: 'Please wait a minute before syncing again' });
  PM.audit(req.u, 'integrations.changed', 'seatsync', { action: 'manual_run' });
  const r = await Seat.runSync({ by: req.u.login || req.u.id, manual: true }); res.json({ ...r, status: Seat.publicStatus() });
});
app.post('/api/seatsync/session', auth, adminOnlyEarly, async (req, res) => {
  if (!limit('sssess:' + req.u.id, 6, 6e4)) return res.status(429).json({ error: 'Too many attempts' });
  try { PM.audit(req.u, 'integrations.changed', 'seatsync', { action: 'session_supplied' }); const r = await Seat.setSession(req.body.cookie); res.json({ ok: r.ok, error: r.error, status: Seat.publicStatus() }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---------- Meezab group inventory sync (administrator): fully automatic, these endpoints only monitor and control it ---------- */
app.get('/api/supplier/sync', auth, adminOnlyEarly, (req, res) => res.set('Cache-Control', 'no-store').json({ ...Sup.publicStatus(), history: Sup.history(80) }));
app.get('/api/supplier/inventory', auth, adminOnlyEarly, (req, res) => res.set('Cache-Control', 'no-store').json({ items: Sup.inventory({ state: ['active', 'inactive'].includes(req.query.state) ? req.query.state : 'all', q: String(req.query.q || '').slice(0, 60) }) }));
app.post('/api/supplier/sync/run', auth, adminOnlyEarly, async (req, res) => {
  if (!limit('suprun:' + req.u.id, 6, 6e4)) return res.status(429).json({ error: 'Please wait a minute before syncing again' });
  PM.audit(req.u, 'integrations.changed', 'supplier-sync', { action: 'manual_run' });
  const r = await Sup.runSync({ by: req.u.login || req.u.id, manual: true }); res.json({ ...r, status: Sup.publicStatus() });
});
app.post('/api/supplier/sync/config', auth, adminOnlyEarly, (req, res) => {
  try { Sup.saveConfig(req.body || {}); PM.audit(req.u, 'integrations.changed', 'supplier-sync', { action: 'config', enabled: req.body.enabled, intervalMin: req.body.intervalMin }); save(); res.json({ ok: true, status: Sup.publicStatus() }); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/supplier/sync/session', auth, adminOnlyEarly, async (req, res) => {
  if (!limit('supsess:' + req.u.id, 6, 6e4)) return res.status(429).json({ error: 'Too many attempts' });
  try { PM.audit(req.u, 'integrations.changed', 'supplier-sync', { action: 'session_supplied' }); const r = await Sup.setSession(req.body.cookie); res.json({ ok: r.ok, error: r.error || (r.entry && r.entry.error), status: Sup.publicStatus() }); } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---------- maintenance mode (administrator only; enforced by the guard above) ---------- */
app.get('/api/public/maintenance', (req, res) => res.set('Cache-Control', 'no-store').json(Maint.publicInfo()));
app.get('/api/admin/maintenance', auth, adminOnlyEarly, (req, res) => res.set('Cache-Control', 'no-store').json({ maintenance: Maint.get() }));
app.post('/api/admin/maintenance', auth, adminOnlyEarly, async (req, res) => {
  try { const m = Maint.set(req.u, req.body || {}); save(); await D.flushAsync(); res.json({ ok: true, maintenance: m }); } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---------- SEO + public pages (no login) ---------- */
const html = (res, h, ttl = 300) => res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=' + ttl }).send(Brand.cleanDoc(h));
const pub = (key, fn) => (req, res) => (Mod.pageEnabled(key) ? html(res, fn(req)) : res.status(404).send(R.infoPage('Not available', 'This page is not available right now.', false)));
app.get(SEO.PAGES.offers.path, (req, res) => html(res, SEO.offersPage(req)));
app.get(SEO.PAGES.groups.path, pub('groups', SEO.groupsPage));
app.get(SEO.PAGES.calc.path, pub('calc', SEO.calcPage));
app.get(SEO.PAGES.transport.path, pub('transport', SEO.transportPage));
app.get(SEO.PAGES.flights.path, pub('flights', SEO.flightsPage));
app.get(SEO.PAGES.hotels.path, pub('hotels', SEO.hotelsPage));
app.get(SEO.PAGES.makkah.path, pub('makkah', SEO.makkahPage));
app.get(SEO.PAGES.madinah.path, pub('madinah', SEO.madinahPage));
app.get(SEO.PAGES.visa.path, pub('visa', SEO.visaPage));
app.get(SEO.PAGES.contact.path, (req, res) => html(res, SEO.contactPage(req)));
app.get(SEO.PAGES.faq.path, (req, res) => html(res, SEO.faqPage(req)));
app.get('/sitemap.xml', (req, res) => res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(SEO.sitemap(req)));
app.get('/robots.txt', (req, res) => res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(SEO.robots(req)));
app.get('/manifest.webmanifest', (req, res) => res.type('application/manifest+json').set('Cache-Control', 'public, max-age=3600').json(SEO.manifest(req)));
app.get('/favicon.ico', (req, res) => res.set('Cache-Control', 'public, max-age=604800').sendFile(path.join(PUB, 'brand', 'favicon.ico')));
app.get('/api/public/inventory', (req, res) => res.set('Cache-Control', 'public, max-age=60').json(Brand.cleanDeep(Inv.publicSnapshot())));
app.post('/api/public/lead', (req, res) => {
  if (!limit('lead:' + req.ip, 6, 36e5)) return res.status(429).json({ error: 'Too many requests. Please call us instead.' });
  if (req.body.website) return res.json({ ok: true }); // honeypot
  try { const r = Inv.publicLead(req.body || {}); save(); res.json({ ok: true, ...r }); } catch (e) { res.status(400).json({ error: e.message }); }
});
/* The landing page and the CRM shell: pages are read once at start, rendered with a safe fallback, never cached by proxies (login state differs per visitor). */
const readPage = f => { try { return fs.readFileSync(path.join(PUB, f), 'utf8'); } catch (e) { console.error('Cannot read public/' + f + ':', e.message); return ''; } };
let INDEX_RAW = readPage('index.html'), PORTAL_RAW = readPage('portal.html');
const shellPage = (render, rawName) => (req, res) => {
  let raw = rawName === 'portal' ? PORTAL_RAW : INDEX_RAW;
  if (!raw) { raw = readPage(rawName === 'portal' ? 'portal.html' : 'index.html'); if (rawName === 'portal') PORTAL_RAW = raw; else INDEX_RAW = raw; }
  let out;
  try { out = render(req, raw); } catch (e) { console.error('Page render failed, serving the plain page:', e && e.stack || e); out = raw.replace(/__BASE__/g, ''); }
  if (!out) return res.status(503).set('Cache-Control', 'no-store').send(R.infoPage('Please try again', 'The page is not available right now.', false));
  res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' }).send(out);
};
/* Public home and sign-in: keep the established portal experience and its existing login modal. */
app.get(['/', '/index.html'], shellPage(SEO.portalHtml, 'portal'));
app.get(['/login', '/login/'], (req, res) => res.redirect(302, '/?login=1'));
app.get(['/portal', '/portal/'], shellPage((req, raw) => SEO.portalHtml(req, raw).replace(/<meta name="robots"[^>]*>/, '<meta name="robots" content="noindex,follow">'), 'portal'));
app.get(['/app', '/app/'], shellPage((req, raw) => { const h = SEO.indexHtml(req, raw), b = Maint.bannerHtml(); return b ? h.replace(/<body[^>]*>/, m => m + b) : h; }, 'app'));

/* ---------- app shell ---------- */
app.use(express.static(PUB, { index: false, maxAge: '7d', setHeaders: (res, f) => { if (/\.(js|css|html)$/.test(f) && !/vendor/.test(f)) res.set('Cache-Control', 'no-cache'); } }));

/* friendly 404 for pages, JSON for the API */
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).send(SEO.notFoundPage(req));
});
app.use((err, req, res, next) => { console.error(err); if (res.headersSent) return next(err); if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Something went wrong' }); res.status(500).send(R.infoPage('Something went wrong', 'Please try again in a moment.', false)); });

let server = null;
async function startServer() {
  // Do not accept traffic until the selected storage backend is initialized.
  await D.init();
  // Bring back any uploaded file that exists in MySQL but is missing on disk (e.g. after a redeploy), then migrate existing files once.
  try { await F.restoreMissing(); } catch (e) { console.error('File restore warning:', e.message); }
  F.backfill().catch(e => console.error('File migration warning:', e.message));
  AI.init(); X.init(); sweep(); Seat.start(); Sup.start();
  setInterval(() => { sweep(); Chat.sweep(); const n = db.notifs.length; X.detect(); if (db.notifs.length !== n) D.save(); }, 60000).unref();
  setInterval(() => X.fxRefresh(false).catch(() => {}), 36e5).unref();
  setTimeout(() => X.fxRefresh(false).catch(() => {}), 5000).unref();
  server = app.listen(PORT, () => {
    console.log('The Umrah Store CRM v' + require('./package.json').version + ' running on port ' + PORT);
    console.log('Data folder: ' + DATA + (/node_modules|public_html|\/app\/?$/.test(DATA) ? '  (WARNING: keep DATA_DIR outside the deployed folder or a redeploy can erase it)' : ''));
    if (!process.env.ADMIN_PASSWORD && check(D.DEFAULT_ADMIN_PASSWORD, (db.users.find(u => u.id === 'admin') || {}).pw)) console.warn('WARNING: the administrator still uses the default password. Set ADMIN_PASSWORD or change it after signing in.');
    I.waAutoStart();
  });
  server.keepAliveTimeout = 65000; server.headersTimeout = 70000;
  return server;
}
startServer().catch(e => { console.error('FATAL STARTUP ERROR:', e && e.stack || e); process.exit(1); });
process.on('unhandledRejection', e => console.error('Unhandled rejection:', e && e.stack || e));
process.on('uncaughtException', e => { console.error('Uncaught exception:', e && e.stack || e); D.flushAsync().finally(() => process.exit(1)); });
process.once('SIGTERM', () => { if (server) server.close(); D.flushAsync().finally(() => process.exit(0)); });
process.once('SIGINT', () => { if (server) server.close(); D.flushAsync().finally(() => process.exit(0)); });
