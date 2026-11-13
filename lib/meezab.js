'use strict';
/**
 * Meezab remaining-seat synchronisation  (READ-ONLY).
 *
 * What it does: signs in to the supplier CRM with OUR authorised agent account (or reuses a session cookie an administrator
 * supplied), reads the group list, and copies the REMAINING SEATS of groups we already have into the portal.
 *
 * What it never does:
 *  - create, delete or modify anything in the supplier CRM (only GET requests, plus the one login POST),
 *  - create portal groups (unknown references are only counted),
 *  - treat a missing group, a missing cell or an unreadable value as zero seats (only an explicit "0" / "Sold out" is zero),
 *  - overwrite stored data when login failed, the page changed shape, rows are malformed, or far fewer groups than usual came back,
 *  - bypass CAPTCHA or MFA: it stops, raises an administrator alert and waits for a human to supply a fresh session.
 *
 * Secrets: username/password come ONLY from environment variables. A pasted session cookie is kept in memory and, when
 * MEEZAB_SECRET_KEY is set, also stored encrypted (AES-256-GCM) so it survives a restart. Neither is ever logged or sent to the browser.
 *
 * You are responsible for confirming that the supplier's terms permit automated read access with your account.
 */
const crypto = require('crypto');
const cheerio = require('cheerio');
const D = require('./db');
const { db } = D;

/* ------------------------------------------------------------------ configuration */
const env = (k, d = '') => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const cfg = () => {
  let map = {}; try { map = JSON.parse(env('MEEZAB_COLUMN_MAP', '{}')) || {}; } catch { map = {}; }
  const base = env('MEEZAB_BASE_URL', '').replace(/\/+$/, '');
  return {
    base, user: env('MEEZAB_USERNAME'), pass: env('MEEZAB_PASSWORD'),
    loginPath: env('MEEZAB_LOGIN_PATH', '/login'), groupsPath: env('MEEZAB_GROUPS_PATH', '/groups'),
    userField: env('MEEZAB_LOGIN_USER_FIELD'), passField: env('MEEZAB_LOGIN_PASS_FIELD'),
    pageParam: env('MEEZAB_PAGE_PARAM', 'page'), maxPages: Math.max(1, Math.min(60, +env('MEEZAB_MAX_PAGES', 12) || 12)),
    map, timeoutMs: Math.max(5000, Math.min(60000, +env('MEEZAB_TIMEOUT_MS', 25000) || 25000)),
    secret: env('MEEZAB_SECRET_KEY'),
    minKeepRatio: Math.min(1, Math.max(0.1, +env('MEEZAB_MIN_ROWS_RATIO', 0.5) || 0.5))
  };
};
const okBase = b => /^https:\/\//i.test(b) || (process.env.CRM_TEST_MODE === '1' && /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(b));
const configured = (c = cfg()) => !!(c.base && okBase(c.base) && c.groupsPath && ((c.user && c.pass) || sessionCookie()));

/* ------------------------------------------------------------------ persistent state (additive, non-secret) */
function st() {
  if (!db.meezab || typeof db.meezab !== 'object') db.meezab = {};
  const m = db.meezab;
  m.enabled = m.enabled === true;
  m.intervalMin = Math.min(5, Math.max(2, Math.round(+m.intervalMin || 3)));
  m.status = m.status || 'idle'; // idle | ok | error | needs_reauth | disabled
  ['lastOkAt', 'lastAttemptAt', 'lastError', 'lastErrorKind', 'alertedKind', 'nextAt'].forEach(k => { m[k] = m[k] || ''; });
  m.fails = +m.fails || 0; m.summary = m.summary || null;
  return m;
}
const log = () => { if (!Array.isArray(db.syncLog)) db.syncLog = []; return db.syncLog; };
const nowISO = () => new Date().toISOString();

/* ------------------------------------------------------------------ session cookie (memory + optional encrypted at rest) */
let memCookie = '';
const key32 = () => { const c = cfg(); return c.secret ? crypto.createHash('sha256').update('meezab:' + c.secret).digest() : null; };
function encrypt(text) {
  const k = key32(); if (!k) return '';
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', k, iv), enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}
function decrypt(blob) {
  const k = key32(); if (!k || !blob) return '';
  try { const [iv, tag, enc] = blob.split('.').map(x => Buffer.from(x, 'base64')); const d = crypto.createDecipheriv('aes-256-gcm', k, iv); d.setAuthTag(tag); return Buffer.concat([d.update(enc), d.final()]).toString('utf8'); } catch { return ''; }
}
function sessionCookie() { if (memCookie) return memCookie; const m = db.meezab; if (m && m.sessionEnc) memCookie = decrypt(m.sessionEnc); return memCookie; }
function storeCookie(cookie) { memCookie = cookie || ''; const m = st(); m.sessionEnc = cookie && key32() ? encrypt(cookie) : ''; m.sessionAt = cookie ? nowISO() : ''; }

const jar = { get: () => sessionCookie(), merge(setCookies) {
  if (!setCookies || !setCookies.length) return;
  const cur = Object.fromEntries(sessionCookie().split(/;\s*/).filter(Boolean).map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
  setCookies.forEach(sc => { const [pair] = sc.split(';'), i = pair.indexOf('='); if (i < 1) return; const n = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim(); if (!v || /expires=Thu, 01 Jan 1970/i.test(sc) || /max-age=0/i.test(sc)) delete cur[n]; else cur[n] = v; });
  storeCookie(Object.entries(cur).map(([n, v]) => n + '=' + v).join('; '));
} };

/* ------------------------------------------------------------------ errors */
class SyncError extends Error { constructor(kind, msg, human) { super(msg); this.kind = kind; this.human = !!human; } }
// kinds: config | network | auth | captcha | mfa | format | partial | busy

/* ------------------------------------------------------------------ HTTP (GET only, plus the single login POST) */
async function http(c, method, urlPath, body) {
  let url = /^https?:\/\//i.test(urlPath) ? urlPath : c.base + urlPath;
  if (!url.startsWith(c.base)) throw new SyncError('config', 'Refusing to leave the configured supplier host');
  for (let hop = 0; hop < 6; hop++) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), c.timeoutMs);
    let res;
    try {
      res = await fetch(url, { method, redirect: 'manual', signal: ctl.signal, body: method === 'POST' ? body : undefined, headers: {
        'User-Agent': 'TheUmrahStorePortal-SeatSync/1.0 (+read-only)', Accept: 'text/html,application/json;q=0.9,*/*;q=0.5',
        ...(jar.get() ? { Cookie: jar.get() } : {}), ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
      } });
    } catch (e) { throw new SyncError('network', e.name === 'AbortError' ? 'The supplier CRM did not answer in time' : 'Could not reach the supplier CRM'); }
    finally { clearTimeout(t); }
    jar.merge(typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url).toString();
      if (!url.startsWith(c.base)) throw new SyncError('config', 'The supplier CRM redirected to another host');
      method = 'GET'; body = undefined; continue;
    }
    const text = await res.text();
    return { status: res.status, url, type: res.headers.get('content-type') || '', text: text.slice(0, 4e6) };
  }
  throw new SyncError('network', 'Too many redirects from the supplier CRM');
}

/* ------------------------------------------------------------------ page classification */
const CAPTCHA = /g-recaptcha|h-captcha|hcaptcha|cf-turnstile|turnstile|captcha/i;
const MFA = /one[- ]time (pass|code)|verification code|two[- ]factor|2fa|authenticator|\botp\b/i;
function isLoginPage(html) { try { return cheerio.load(html)('input[type=password]').length > 0; } catch { return false; } }

async function login(c) {
  if (!c.user || !c.pass) throw new SyncError('auth', 'The session has expired and no supplier credentials are configured. Supply a fresh session in Settings > Seat sync.', true);
  const page = await http(c, 'GET', c.loginPath);
  if (CAPTCHA.test(page.text)) throw new SyncError('captcha', 'The supplier login now requires a CAPTCHA. Sign in once in your own browser and paste the session in Settings > Seat sync.', true);
  const $ = cheerio.load(page.text), pw = $('input[type=password]').first();
  if (!pw.length) throw new SyncError('format', 'The supplier login page has no password field (page layout changed)');
  const form = pw.closest('form'), data = new URLSearchParams();
  form.find('input[type=hidden]').each((_, el) => { const n = $(el).attr('name'); if (n) data.set(n, $(el).attr('value') || ''); });
  const uEl = form.find('input[type=email],input[type=text],input:not([type])').first();
  const uName = c.userField || uEl.attr('name'), pName = c.passField || pw.attr('name');
  if (!uName || !pName) throw new SyncError('format', 'Could not identify the login fields. Set MEEZAB_LOGIN_USER_FIELD and MEEZAB_LOGIN_PASS_FIELD.');
  data.set(uName, c.user); data.set(pName, c.pass);
  const action = form.attr('action') ? new URL(form.attr('action'), page.url).toString() : page.url;
  const res = await http(c, 'POST', action, data.toString());
  if (CAPTCHA.test(res.text)) throw new SyncError('captcha', 'The supplier login asked for a CAPTCHA. Human verification is required.', true);
  if (MFA.test(res.text) && !/groups?/i.test(res.url)) throw new SyncError('mfa', 'The supplier login asked for a verification code. Human verification is required.', true);
  if (isLoginPage(res.text)) throw new SyncError('auth', 'The supplier CRM rejected the stored credentials', true);
}

/* ------------------------------------------------------------------ parsing (pure functions: unit-tested) */
const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const REF_H = /^(group\s*)?(ref(erence)?|code|no\.?|number|id)\b|group\s*(id|code|no\.?|ref)|^ref/i;
const SEATS_H = /remaining|available|avail\.?|seats?\s*(left|avail|remain)|left\s*seats?|balance\s*seats?|^seats?\s*left/i;
const SOLD_TXT = /^(sold\s*out|full|no\s+seats?(\s+left)?|closed)$/i;

/** an explicit number, or an explicit sold-out word. Anything else is UNKNOWN (null) and is never treated as zero. */
function parseSeats(raw) {
  const t = norm(raw).replace(/,/g, '');
  if (/^\d{1,4}$/.test(t)) return +t;
  if (SOLD_TXT.test(t)) return 0;
  const m = /^(\d{1,4})\s*seats?(\s*(left|available|remaining))?$/i.exec(t); if (m) return +m[1];
  return null;
}
const normRef = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');

function parseHtml(html, map = {}) {
  const $ = cheerio.load(html), best = { score: -1, rows: [] };
  $('table').each((_, tbl) => {
    const rows = $(tbl).find('tr').toArray();
    if (rows.length < 2) return;
    let hi = rows.findIndex(r => $(r).find('th').length || $(r).index() === 0); if (hi < 0) hi = 0;
    const heads = $(rows[hi]).children('th,td').toArray().map(x => norm($(x).text()));
    const idx = (want, re) => { if (want) { const i = heads.findIndex(h => h.toLowerCase() === String(want).toLowerCase()); if (i >= 0) return i; } return heads.findIndex(h => re.test(h)); };
    const ri = idx(map.ref, REF_H), si = idx(map.remaining, SEATS_H);
    if (ri < 0 || si < 0 || ri === si) return;
    const out = [];
    rows.slice(hi + 1).forEach(r => {
      const cells = $(r).children('td,th').toArray(); if (cells.length <= Math.max(ri, si)) return;
      out.push({ ref: norm($(cells[ri]).text()), raw: norm($(cells[si]).text()), remaining: parseSeats($(cells[si]).text()) });
    });
    if (out.length > best.score) { best.score = out.length; best.rows = out; }
  });
  return best.rows;
}

function parseJson(text, map = {}) {
  let j; try { j = JSON.parse(text); } catch { return []; }
  const arr = Array.isArray(j) ? j : ['data', 'rows', 'items', 'groups', 'results', 'records'].map(k => j && j[k]).find(Array.isArray) || (j && j.data && Array.isArray(j.data.items) ? j.data.items : []);
  const pick = (o, want, names) => { const k = (want && Object.keys(o).find(x => x.toLowerCase() === String(want).toLowerCase())) || Object.keys(o).find(x => names.includes(x.toLowerCase().replace(/[^a-z]/g, ''))); return k ? o[k] : undefined; };
  return arr.filter(o => o && typeof o === 'object').map(o => {
    const ref = pick(o, map.ref, ['reference', 'ref', 'groupref', 'groupid', 'groupcode', 'code', 'groupno', 'number', 'id']);
    const rem = pick(o, map.remaining, ['remaining', 'remainingseats', 'availableseats', 'available', 'seatsleft', 'seatsavailable', 'balanceseats', 'left']);
    const num = typeof rem === 'number' && Number.isInteger(rem) && rem >= 0 && rem <= 9999 ? rem : typeof rem === 'string' ? parseSeats(rem) : null;
    return { ref: norm(ref), raw: String(rem == null ? '' : rem), remaining: num };
  });
}

function parseAny(res, map) { return /json/i.test(res.type) || /^\s*[[{]/.test(res.text) ? parseJson(res.text, map) : parseHtml(res.text, map); }

/* ------------------------------------------------------------------ extraction */
async function extract(c) {
  const fetchPage = async n => {
    const sep = c.groupsPath.includes('?') ? '&' : '?';
    return http(c, 'GET', n === 1 ? c.groupsPath : c.groupsPath + sep + encodeURIComponent(c.pageParam) + '=' + n);
  };
  let first = await fetchPage(1);
  if (isLoginPage(first.text) || /\/(login|signin|sign-in)\b/i.test(first.url)) {
    await login(c);
    first = await fetchPage(1);
    if (isLoginPage(first.text)) throw new SyncError('auth', 'Signed in, but the supplier CRM still shows its login page', true);
  }
  if (first.status >= 400) throw new SyncError('network', 'The supplier CRM answered with HTTP ' + first.status);
  const seen = new Map(); let pages = 0, malformed = 0;
  const take = rows => { let fresh = 0; rows.forEach(r => { if (!r.ref) { malformed++; return; } const k = normRef(r.ref); if (!k) { malformed++; return; } if (!seen.has(k)) { seen.set(k, r); fresh++; } }); return fresh; };
  let rows = parseAny(first, c.map); pages = 1;
  if (!rows.length) throw new SyncError('format', 'No group table was found on the supplier page (layout changed or wrong MEEZAB_GROUPS_PATH)');
  take(rows);
  for (let n = 2; n <= c.maxPages; n++) {
    const p = await fetchPage(n); if (p.status >= 400 || isLoginPage(p.text)) break;
    const more = parseAny(p, c.map); if (!more.length || !take(more)) break; pages++;
  }
  return { rows: [...seen.values()], pages, malformed };
}

/* ------------------------------------------------------------------ matching + applying (pure given db) */
const idsOf = g => [g.supplierRef, g.id, g.code, g.no != null ? String(g.no) : ''].map(normRef).filter(x => x.length >= 3);

/** Decide what would change. Pure: touches nothing. */
function plan(rows, groups) {
  const index = new Map();
  groups.forEach(g => idsOf(g).forEach(k => { if (!index.has(k)) index.set(k, new Set()); index.get(k).add(g); }));
  const res = { changes: [], same: 0, unmatched: [], ambiguous: [], unknown: [], matched: 0 };
  rows.forEach(r => {
    const k = normRef(r.ref), hit = index.get(k);
    if (!hit) { res.unmatched.push(r.ref); return; }
    if (hit.size > 1) { res.ambiguous.push(r.ref); return; }
    const g = [...hit][0];
    if (r.remaining === null) { res.unknown.push({ ref: r.ref, raw: r.raw }); return; } // unreadable: leave seats alone
    res.matched++;
    const from = g.seats; // eslint-disable-line
    if (from === r.remaining && g.meezab && g.meezab.remaining === r.remaining) res.same++;
    else res.changes.push({ g, ref: r.ref, from, to: r.remaining });
  });
  return res;
}

function apply(p, at) {
  p.changes.forEach(ch => {
    ch.g.seats = Math.min(999, ch.to);
    ch.g.meezab = { ref: ch.ref, remaining: ch.to, at, soldOut: ch.to === 0 }; // soldOut lets every screen show the status without guessing
  });
  // groups that did not change still get a fresh "confirmed at" stamp when the supplier confirmed the same number
}
function stamp(rows, groups, at) {
  const index = new Map(); groups.forEach(g => idsOf(g).forEach(k => { if (!index.has(k)) index.set(k, []); index.get(k).push(g); }));
  rows.forEach(r => { const h = index.get(normRef(r.ref)); if (h && h.length === 1 && r.remaining !== null && h[0].meezab) h[0].meezab.at = at; });
}

/* ------------------------------------------------------------------ run */
let running = false, timer = null;

function alertAdmin(kind, title, body) {
  const m = st(); if (m.alertedKind === kind) return; m.alertedKind = kind;
  try { require('./extras').push({ uid: 'admin' }, title, body, '#/seatsync', 'warn'); } catch { /* notifications are best-effort */ }
}

async function runSync({ by = 'scheduler', manual = false } = {}) {
  const m = st(), t0 = Date.now(), at = nowISO();
  if (running) return { ok: false, busy: true, error: 'A sync is already running' };
  running = true; m.lastAttemptAt = at;
  const entry = { id: 's' + D.nid(), at, by, manual: !!manual, ok: false };
  try {
    const c = cfg();
    if (!configured(c)) throw new SyncError('config', 'Seat sync is not configured. Set MEEZAB_BASE_URL, MEEZAB_GROUPS_PATH, MEEZAB_USERNAME and MEEZAB_PASSWORD on the server.');
    const { rows, pages, malformed } = await extract(c);
    const usable = rows.filter(r => r.remaining !== null);
    if (!usable.length) throw new SyncError('format', 'The supplier page was read but no seat numbers could be understood. Nothing was changed.');
    const p = plan(rows, db.groups);
    const prevMatched = (m.summary && m.summary.matched) || 0;
    if (prevMatched >= 5 && p.matched < Math.ceil(prevMatched * c.minKeepRatio)) throw new SyncError('partial', 'Only ' + p.matched + ' of the ' + prevMatched + ' usual groups came back. The result was ignored and nothing was changed.');
    apply(p, at); stamp(rows, db.groups, at);
    Object.assign(entry, { ok: true, rows: rows.length, pages, matched: p.matched, changed: p.changes.length, same: p.same, unmatched: p.unmatched.length, ambiguous: p.ambiguous.length, unreadable: p.unknown.length, malformed,
      detail: p.changes.slice(0, 40).map(x => ({ id: x.g.id, ref: x.ref, from: x.from, to: x.to })), unmatchedRefs: p.unmatched.slice(0, 30), ambiguousRefs: p.ambiguous.slice(0, 30) });
    m.status = 'ok'; m.lastOkAt = at; m.lastError = ''; m.lastErrorKind = ''; m.fails = 0; m.alertedKind = '';
    m.summary = { matched: p.matched, changed: p.changes.length, unmatched: p.unmatched.length, rows: rows.length, soldOut: db.groups.filter(g => g.meezab && g.meezab.soldOut).length };
    if (p.changes.length) { db.rev = (db.rev || 0); }
  } catch (e) {
    const kind = e.kind || 'network';
    entry.error = String(e.message || e).slice(0, 300); entry.kind = kind;
    m.fails++; m.lastError = entry.error; m.lastErrorKind = kind;
    if (e.human || kind === 'auth' || kind === 'captcha' || kind === 'mfa') {
      m.status = 'needs_reauth'; storeCookie('');
      alertAdmin(kind, 'Seat sync needs you to sign in again', entry.error);
    } else {
      m.status = 'error';
      if (m.fails >= 3) alertAdmin(kind, 'Seat sync is failing', entry.error);
    }
  } finally {
    entry.ms = Date.now() - t0; log().push(entry); if (log().length > 500) log().splice(0, log().length - 500);
    running = false; schedule(); D.save();
  }
  return { ok: entry.ok, entry, status: m.status };
}

/* ------------------------------------------------------------------ admin workflows */
/** Re-authentication without bypassing anything: an administrator signs in in their own browser and pastes the Cookie header value. */
async function setSession(cookieHeader) {
  const c = cfg(); const ck = String(cookieHeader || '').replace(/^cookie:\s*/i, '').trim();
  if (!ck || ck.length > 8000 || /[\r\n]/.test(ck)) D.fail('Paste the cookie value copied from your signed-in browser');
  if (!configured({ ...c, user: c.user || 'x', pass: c.pass || 'x' }) && !c.base) D.fail('Seat sync is not configured on the server yet');
  storeCookie(ck);
  try { const r = await http(c, 'GET', c.groupsPath); if (isLoginPage(r.text) || r.status >= 400) throw new SyncError('auth', 'That session is not signed in (or has already expired)', true); if (!parseAny(r, c.map).length) throw new SyncError('format', 'Signed in, but no group table was found on the supplier page'); }
  catch (e) { storeCookie(''); D.fail(e.message); }
  const m = st(); m.status = 'idle'; m.alertedKind = ''; m.lastError = ''; m.lastErrorKind = '';
  return runSync({ by: 'reauth', manual: true });
}

function saveConfig(p) {
  const m = st();
  if (p.enabled !== undefined) m.enabled = !!p.enabled;
  if (p.intervalMin !== undefined) m.intervalMin = Math.min(5, Math.max(2, Math.round(+p.intervalMin) || 3));
  if (m.enabled && m.status === 'disabled') m.status = 'idle';
  if (!m.enabled) m.status = 'disabled';
  schedule();
}

function publicStatus() {
  const m = st(), c = cfg();
  return { configured: configured(c), enabled: m.enabled, status: m.enabled ? m.status : 'disabled', intervalMin: m.intervalMin, lastOkAt: m.lastOkAt, lastAttemptAt: m.lastAttemptAt,
    lastError: m.lastError, lastErrorKind: m.lastErrorKind, nextAt: m.nextAt, summary: m.summary, hasSession: !!sessionCookie(), canStoreSession: !!c.secret, running, host: c.base ? new URL(c.base).host : '' };
}
const history = (n = 60) => log().slice(-n).reverse();

/* ------------------------------------------------------------------ scheduler (2-5 minutes, with jitter) */
function schedule() {
  if (timer) { clearTimeout(timer); timer = null; }
  const m = st(); if (!m.enabled || m.status === 'needs_reauth' || !configured()) { m.nextAt = ''; return; }
  const wait = m.intervalMin * 60000 + Math.round((Math.random() - 0.5) * 20000);
  m.nextAt = new Date(Date.now() + wait).toISOString();
  timer = setTimeout(() => { runSync({ by: 'scheduler' }).catch(() => {}); }, wait); timer.unref();
}
function start() { st(); setTimeout(() => schedule(), 5000).unref(); }

module.exports = { start, runSync, setSession, saveConfig, publicStatus, history, parseHtml, parseJson, parseSeats, normRef, plan, apply, stamp, idsOf, configured, cfg };
