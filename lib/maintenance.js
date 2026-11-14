'use strict';
/**
 * Maintenance mode. ON/OFF is stored in the CRM state (db.settings.maintenance), which is what MySQL persists, so it survives restarts.
 * Enforced on the SERVER for every request, so hiding buttons in the browser is never the protection:
 *   - public pages (landing, SEO pages, bank page, payment links)      -> 503 maintenance page (Retry-After, noindex)
 *   - public API (sign-up, enquiries, departures, inventory ...)       -> 503 JSON
 *   - agent / supplier sessions and API calls                          -> 503 JSON, and /api/state looks anonymous to them
 *   - administrators (and staff when "allow staff" is ticked)          -> everything works as normal
 * Always allowed so nothing is lost or locked: static assets, /healthz, the sign-in page at /app (administrators must be able to sign in),
 * payment-gateway callbacks (a PayFast notification must never be dropped), and read-only voucher links already sent to customers.
 * Turning it ON or OFF changes one setting. It never touches users, bookings, payments, ledgers or any other record.
 */
const D = require('./db');
const { db, str } = D;

const DEFAULT = { on: false, title: '', message: '', eta: '', allowStaff: false, since: '', by: '', updatedAt: '' };
function get() { const s = db.settings; s.maintenance = { ...DEFAULT, ...(s.maintenance && typeof s.maintenance === 'object' ? s.maintenance : {}) }; s.maintenance.on = s.maintenance.on === true; return s.maintenance; }
const isOn = () => get().on;
const allows = u => !!u && (u.role === 'admin' || (u.role === 'staff' && get().allowStaff === true));
const company = () => (db.settings && db.settings.company) || {};
const DEF_TITLE = 'We are upgrading the platform';
const DEF_MSG = 'The portal is briefly offline while we make improvements. Your accounts, bookings and balances are safe and nothing has been changed. We will be back shortly.';
const publicInfo = () => { const m = get(); return { on: m.on, title: m.title || DEF_TITLE, message: m.message || DEF_MSG, eta: m.eta || '', since: m.since || '' }; };

function set(u, p) {
  if (!u || u.role !== 'admin') D.fail('Only an administrator can change maintenance mode');
  p = p || {}; const m = get(), was = m.on;
  if (p.on !== undefined) m.on = p.on === true || p.on === 'true' || p.on === 1 || p.on === '1';
  if (p.title !== undefined) m.title = str(p.title, 90);
  if (p.message !== undefined) m.message = str(p.message, 500);
  if (p.eta !== undefined) m.eta = str(p.eta, 60);
  if (p.allowStaff !== undefined) m.allowStaff = p.allowStaff === true || p.allowStaff === 'true' || p.allowStaff === 1 || p.allowStaff === '1';
  if (m.on && !was) m.since = new Date().toISOString();
  if (!m.on) m.since = '';
  m.by = u.name || u.login || u.id; m.updatedAt = new Date().toISOString();
  D.logAct(u, 'Maintenance mode', (m.on ? 'ON' : 'OFF') + (m.allowStaff ? ' (staff allowed)' : ''));
  try { require('./perms').audit(u, 'settings.maintenance', m.on ? 'on' : 'off', { allowStaff: m.allowStaff }); } catch { /* audit is best-effort */ }
  return m;
}

/* paths that stay reachable for everybody while maintenance is on */
const OPEN = [
  /^\/healthz$/, /^\/api\/logout$/, /^\/api\/public\/maintenance$/, /^\/api\/state$/, /^\/api\/portal\/me$/, /^\/api\/login$/,
  /^\/payfast\/(return|ipn)$/, /^\/brand\//, /^\/robots\.txt$/, /^\/manifest\.webmanifest$/, /^\/favicon\.ico$/,
  /\.(js|css|png|jpe?g|webp|svg|ico|woff2?|map)$/i
];
const VOUCHER = /^\/v\/[\w-]+$/;

function guard(req, res, next) {
  const p = req.path;
  if (p === '/' && req.query.preview === 'maintenance' && req.u && req.u.role === 'admin') return res.set('Cache-Control', 'no-store').send(page(req, true));
  const m = get(); if (!m.on || allows(req.u)) return next();
  if (OPEN.some(r => r.test(p)) || (req.method === 'GET' && (VOUCHER.test(p) || /^\/app\/?$/.test(p)))) {
    if (req.u && !allows(req.u)) { req.maintBlocked = true; req.u = undefined; } // open endpoints see a blocked user as anonymous
    return next();
  }
  res.set({ 'Retry-After': '3600', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  if (p.startsWith('/api/') || req.method !== 'GET') return res.status(503).json({ error: publicInfo().title + '. ' + publicInfo().message, maintenance: true });
  return res.status(503).type('html').send(page(req));
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(req, preview) {
  const i = publicInfo(), c = company(), name = c.name || 'The Umrah Store';
  const wa = c.whatsapp ? 'https://wa.me/' + String(c.whatsapp).replace(/\D/g, '') : '', mail = c.email ? 'mailto:' + c.email : '';
  const contact = [wa && `<a class="ct" href="${esc(wa)}" rel="noopener">WhatsApp</a>`, mail && `<a class="ct" href="${esc(mail)}">${esc(c.email)}</a>`, c.phone && `<a class="ct" href="tel:${esc(String(c.phone).replace(/[^+\d]/g, ''))}">${esc(c.phone)}</a>`].filter(Boolean).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(i.title)} · ${esc(name)}</title><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#070b18">
<link rel="icon" href="/brand/favicon.ico"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0}html,body{height:100%}
body{font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;background:#070b18;color:#e8ecf8;display:grid;place-items:center;padding:24px;overflow:hidden;position:relative}
.orb{position:absolute;border-radius:50%;filter:blur(90px);opacity:.55;animation:float 14s ease-in-out infinite}
.o1{width:520px;height:520px;background:#3b5bff;top:-160px;left:-120px}.o2{width:460px;height:460px;background:#14d3b0;bottom:-180px;right:-100px;animation-delay:-5s;opacity:.4}.o3{width:300px;height:300px;background:#ffb43b;top:40%;left:55%;animation-delay:-9s;opacity:.22}
@keyframes float{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(40px,-30px) scale(1.08)}}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:56px 56px;mask-image:radial-gradient(circle at 50% 40%,#000 0,transparent 70%)}
.card{position:relative;z-index:1;width:min(640px,100%);padding:clamp(28px,5vw,52px);border-radius:28px;background:linear-gradient(160deg,rgba(255,255,255,.09),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);box-shadow:0 40px 120px rgba(0,0,0,.55);animation:rise .9s cubic-bezier(.2,.8,.2,1) both}
@keyframes rise{from{opacity:0;transform:translateY(24px) scale(.98)}to{opacity:1;transform:none}}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:34px;font-weight:600;letter-spacing:.2px}.brand img{width:38px;height:38px;border-radius:11px;background:#fff;padding:3px;object-fit:contain}
.pill{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:#ffd48a;background:rgba(255,180,59,.12);border:1px solid rgba(255,180,59,.3);padding:7px 13px;border-radius:99px;margin-bottom:20px}
.pill i{width:8px;height:8px;border-radius:50%;background:#ffb43b;box-shadow:0 0 0 0 rgba(255,180,59,.7);animation:pulse 1.8s infinite}@keyframes pulse{70%{box-shadow:0 0 0 10px rgba(255,180,59,0)}100%{box-shadow:0 0 0 0 rgba(255,180,59,0)}}
h1{font-family:'Bricolage Grotesque',Inter,sans-serif;font-weight:800;font-size:clamp(30px,6vw,46px);line-height:1.05;letter-spacing:-1.2px;margin-bottom:16px;background:linear-gradient(120deg,#fff 30%,#a9bcff);-webkit-background-clip:text;background-clip:text;color:transparent}
p.m{color:#b6bfd9;font-size:clamp(15px,2.4vw,17px);line-height:1.65;max-width:52ch}
.eta{margin-top:26px;display:flex;gap:14px;flex-wrap:wrap}.eta div{padding:13px 18px;border-radius:16px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);min-width:150px}.eta small{display:block;color:#8590b0;font-size:11.5px;text-transform:uppercase;letter-spacing:.8px;margin-bottom:3px}.eta b{font-size:15.5px;font-weight:600}
.bar{height:5px;border-radius:9px;background:rgba(255,255,255,.08);margin:30px 0 24px;overflow:hidden}.bar i{display:block;height:100%;width:38%;border-radius:9px;background:linear-gradient(90deg,#3b5bff,#14d3b0);animation:slide 2.2s ease-in-out infinite}@keyframes slide{0%{margin-left:-40%}100%{margin-left:105%}}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.ct{color:#dfe6ff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 15px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);transition:.2s}.ct:hover{background:rgba(255,255,255,.12);transform:translateY(-1px)}
.foot{margin-top:26px;font-size:12.5px;color:#7480a3;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.foot a{color:#9db0ff;text-decoration:none}
${preview ? '.pv{position:fixed;top:0;left:0;right:0;z-index:5;background:#ffb43b;color:#2b1d00;text-align:center;font-weight:600;font-size:13px;padding:8px}' : ''}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style></head><body>
${preview ? '<div class="pv">Preview for administrators. Visitors see this page only while maintenance mode is ON.</div>' : ''}
<div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div><div class="grid"></div>
<main class="card" role="main"><div class="brand"><img src="/brand/logo" alt="" width="38" height="38"><span>${esc(name)}</span></div>
<span class="pill"><i></i>Scheduled maintenance</span><h1>${esc(i.title)}</h1><p class="m">${esc(i.message)}</p>
<div class="eta">${i.eta ? `<div><small>Expected back</small><b>${esc(i.eta)}</b></div>` : ''}<div><small>Your data</small><b>Safe &amp; unchanged</b></div></div>
<div class="bar" aria-hidden="true"><i></i></div>
${contact ? `<div class="row">${contact}</div>` : ''}
<div class="foot"><span>This page refreshes automatically.</span><a href="/app">Administrator sign in</a></div></main>
<script>${preview ? '' : "setInterval(function(){fetch('/api/public/maintenance',{cache:'no-store'}).then(function(r){return r.json()}).then(function(j){if(j&&j.on===false)location.reload()}).catch(function(){})},30000);"}</script>
</body></html>`;
}

const bannerHtml = () => { const i = publicInfo(); return i.on ? `<div style="position:fixed;z-index:99999;left:0;right:0;top:0;background:#ffb43b;color:#2b1d00;font:600 13px/1.4 system-ui,sans-serif;text-align:center;padding:8px 12px">${esc(i.title)}. Only administrators can sign in right now.</div>` : ''; };

module.exports = { get, isOn, allows, set, publicInfo, guard, page, bannerHtml, DEFAULT };
