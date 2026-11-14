'use strict';
/**
 * Meezab Group inventory synchronisation  (READ-ONLY toward the supplier).
 *
 * Source:  GET https://crm.meezabgroup.com/UMR/GetUmrGroupViewData   (override with MEEZAB_API_URL)
 * Auth:    cookie session. Signs in with OUR authorised account (MEEZAB_USERNAME / MEEZAB_PASSWORD) or reuses a session cookie an
 *          administrator pasted. Cookies and credentials live only on the server; agents never receive them.
 *
 * What it does every run (default every 2 minutes):
 *   - fetches ALL groups/packages (follows pagination when the API reports more pages),
 *   - links each supplier group to a local group by GroupOid (stable id) and each package by PackageCode, never by position,
 *   - creates local groups/packages that are new, updates changed ones (dates, flights, seats, supplier cost),
 *   - deactivates (never deletes) packages/groups the supplier stopped returning, and reactivates them if they come back.
 *
 * What it never does:
 *   - create, change or cancel anything at the supplier (only GET, plus the one sign-in POST when a cookie has expired),
 *   - delete bookings, agents, ledgers, payments, vouchers or history,
 *   - overwrite a selling price an administrator set (auto-priced packages follow supplier cost + markup until someone edits them),
 *   - treat a missing / unreadable seat value as zero,
 *   - apply a response that is empty, malformed or far smaller than normal (it keeps the last good inventory instead).
 */
const crypto = require('crypto');
const cheerio = require('cheerio');
const D = require('./db');
const { db } = D;

/* ------------------------------------------------------------------ configuration (secrets: environment only) */
const env = (k, d = '') => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const DEFAULT_API = 'https://crm.meezabgroup.com/UMR/GetUmrGroupViewData';
function cfg() {
  let map = {}; try { map = JSON.parse(env('MEEZAB_FIELD_MAP', '{}')) || {}; } catch { map = {}; }
  const api = env('MEEZAB_API_URL', DEFAULT_API);
  let origin = ''; try { origin = new URL(api).origin; } catch { origin = ''; }
  const base = (env('MEEZAB_BASE_URL', '') || origin).replace(/\/+$/, '');
  return {
    api, base, origin, user: env('MEEZAB_USERNAME'), pass: env('MEEZAB_PASSWORD'), loginPath: env('MEEZAB_LOGIN_PATH', '/login'),
    userField: env('MEEZAB_LOGIN_USER_FIELD'), passField: env('MEEZAB_LOGIN_PASS_FIELD'), secret: env('MEEZAB_SECRET_KEY'),
    pageParam: env('MEEZAB_PAGE_PARAM', 'page'), sizeParam: env('MEEZAB_PAGE_SIZE_PARAM', ''), pageSize: Math.max(10, Math.min(1000, +env('MEEZAB_PAGE_SIZE', 200) || 200)),
    maxPages: Math.max(1, Math.min(200, +env('MEEZAB_MAX_PAGES', 50) || 50)), map,
    timeoutMs: Math.max(5000, Math.min(90000, +env('MEEZAB_TIMEOUT_MS', 30000) || 30000)),
    retries: Math.max(1, Math.min(5, +env('MEEZAB_RETRIES', 3) || 3)), retryBaseMs: Math.max(5, +env('MEEZAB_RETRY_BASE_MS', 1500) || 1500),
    minKeepRatio: Math.min(1, Math.max(0.1, +env('MEEZAB_MIN_ROWS_RATIO', 0.5) || 0.5))
  };
}
const okUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' || (process.env.CRM_TEST_MODE === '1' && x.protocol === 'http:' && x.hostname === '127.0.0.1'); } catch { return false; } };

/* ------------------------------------------------------------------ persistent, non-secret state (additive) */
function st() {
  if (!db.supplierSync || typeof db.supplierSync !== 'object') db.supplierSync = {};
  const m = db.supplierSync;
  m.enabled = m.enabled !== false;                                         // on by default; it only runs once the server is configured
  m.intervalMin = Math.min(60, Math.max(1, Math.round(+m.intervalMin || 2)));
  m.missThreshold = Math.min(10, Math.max(1, Math.round(+m.missThreshold || 2)));
  m.priceFollow = m.priceFollow !== false;
  m.status = m.status || 'idle';                                           // idle | ok | error | needs_reauth | disabled
  ['lastOkAt', 'lastAttemptAt', 'lastError', 'lastErrorKind', 'alertedKind', 'nextAt'].forEach(k => { m[k] = m[k] || ''; });
  m.fails = +m.fails || 0; m.summary = m.summary || null; m.shape = m.shape || null;
  return m;
}
const log = () => { if (!Array.isArray(db.supSyncLog)) db.supSyncLog = []; return db.supSyncLog; };
const nowISO = () => new Date().toISOString();

/* ------------------------------------------------------------------ session cookie (memory + optional AES-256-GCM at rest) */
let memCookie = '';
const key32 = () => { const c = cfg(); return c.secret ? crypto.createHash('sha256').update('meezab:' + c.secret).digest() : null; };
function encrypt(text) { const k = key32(); if (!k) return ''; const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', k, iv), e = Buffer.concat([c.update(text, 'utf8'), c.final()]); return [iv, c.getAuthTag(), e].map(b => b.toString('base64')).join('.'); }
function decrypt(blob) { const k = key32(); if (!k || !blob) return ''; try { const [iv, tag, e] = blob.split('.').map(x => Buffer.from(x, 'base64')); const d = crypto.createDecipheriv('aes-256-gcm', k, iv); d.setAuthTag(tag); return Buffer.concat([d.update(e), d.final()]).toString('utf8'); } catch { return ''; } }
function sessionCookie() {
  if (memCookie) return memCookie;
  const m = db.supplierSync, old = db.meezab; // a session already supplied to the older seat-sync module is reused after the upgrade
  const blob = (m && m.sessionEnc) || (old && old.sessionEnc);
  if (blob) memCookie = decrypt(blob);
  return memCookie;
}
function storeCookie(cookie) { memCookie = cookie || ''; const m = st(); m.sessionEnc = cookie && key32() ? encrypt(cookie) : ''; m.sessionAt = cookie ? nowISO() : ''; }
const jar = { get: () => sessionCookie(), merge(setCookies) {
  if (!setCookies || !setCookies.length) return;
  const cur = Object.fromEntries(sessionCookie().split(/;\s*/).filter(Boolean).map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
  setCookies.forEach(sc => { const [pair] = sc.split(';'), i = pair.indexOf('='); if (i < 1) return; const n = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim(); if (!v || /expires=Thu, 01 Jan 1970/i.test(sc) || /max-age=0/i.test(sc)) delete cur[n]; else cur[n] = v; });
  storeCookie(Object.entries(cur).map(([n, v]) => n + '=' + v).join('; '));
} };

const configured = (c = cfg()) => !!(c.api && okUrl(c.api) && c.base && okUrl(c.base) && ((c.user && c.pass) || sessionCookie()));

/* ------------------------------------------------------------------ errors + HTTP (GET only; one sign-in POST) */
class SyncError extends Error { constructor(kind, msg, human) { super(msg); this.kind = kind; this.human = !!human; } }
// kinds: config | network | server | auth | captcha | mfa | format | partial | busy
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function http(c, method, url, body) {
  if (!/^https?:\/\//i.test(url)) url = c.base + url;
  const hostOf = u => new URL(u).host;
  for (let hop = 0; hop < 6; hop++) {
    if (hostOf(url) !== hostOf(c.base)) throw new SyncError('config', 'Refusing to leave the configured supplier host');
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), c.timeoutMs);
    let res;
    try {
      res = await fetch(url, { method, redirect: 'manual', signal: ctl.signal, body: method === 'POST' ? body : undefined, headers: {
        'User-Agent': 'TheUmrahStorePortal-InventorySync/2.0 (+read-only)', Accept: 'application/json, text/html;q=0.8, */*;q=0.5', 'X-Requested-With': 'XMLHttpRequest',
        ...(jar.get() ? { Cookie: jar.get() } : {}), ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) } });
    } catch (e) { throw new SyncError('network', e.name === 'AbortError' ? 'The supplier CRM did not answer in time' : 'Could not reach the supplier CRM'); }
    finally { clearTimeout(t); }
    jar.merge(typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location'), url).toString(); method = 'GET'; body = undefined; continue; }
    const text = await res.text();
    return { status: res.status, url, type: res.headers.get('content-type') || '', text: text.slice(0, 25e6) };
  }
  throw new SyncError('network', 'Too many redirects from the supplier CRM');
}
const CAPTCHA = /g-recaptcha|h-captcha|hcaptcha|cf-turnstile|turnstile|captcha/i;
const MFA = /one[- ]time (pass|code)|verification code|two[- ]factor|2fa|authenticator|\botp\b/i;
const isLoginHtml = text => { if (!/^\s*</.test(text)) return false; try { return cheerio.load(text)('input[type=password]').length > 0; } catch { return false; } };
const looksLoginUrl = u => /\/(login|signin|sign-in|account\/login|auth)\b/i.test(u);

async function login(c) {
  if (!c.user || !c.pass) throw new SyncError('auth', 'The session has expired and no supplier credentials are configured. Paste a fresh session in Admin > Supplier sync.', true);
  const page = await http(c, 'GET', c.loginPath);
  if (CAPTCHA.test(page.text)) throw new SyncError('captcha', 'The supplier login now requires a CAPTCHA. Sign in once in your own browser and paste the session in Admin > Supplier sync.', true);
  const $ = cheerio.load(page.text), pw = $('input[type=password]').first();
  if (!pw.length) throw new SyncError('format', 'The supplier login page has no password field (layout changed)');
  const form = pw.closest('form'), data = new URLSearchParams();
  form.find('input[type=hidden]').each((_, el) => { const n = $(el).attr('name'); if (n) data.set(n, $(el).attr('value') || ''); });
  const uEl = form.find('input[type=email],input[type=text],input:not([type])').first();
  const uName = c.userField || uEl.attr('name'), pName = c.passField || pw.attr('name');
  if (!uName || !pName) throw new SyncError('format', 'Could not identify the login fields. Set MEEZAB_LOGIN_USER_FIELD and MEEZAB_LOGIN_PASS_FIELD.');
  data.set(uName, c.user); data.set(pName, c.pass);
  const action = form.attr('action') ? new URL(form.attr('action'), page.url).toString() : page.url;
  const res = await http(c, 'POST', action, data.toString());
  if (CAPTCHA.test(res.text)) throw new SyncError('captcha', 'The supplier login asked for a CAPTCHA. Human verification is required.', true);
  if (MFA.test(res.text) && isLoginHtml(res.text) === false && !/^\s*[[{]/.test(res.text) && looksLoginUrl(res.url)) throw new SyncError('mfa', 'The supplier login asked for a verification code. Human verification is required.', true);
  if (isLoginHtml(res.text)) throw new SyncError('auth', 'The supplier CRM rejected the stored credentials', true);
}

/* ------------------------------------------------------------------ fetching: retries, session renewal, pagination */
function pageUrl(c, n) {
  const u = new URL(c.api);
  if (n > 1 || c.sizeParam) { if (n > 1) u.searchParams.set(c.pageParam, String(n)); if (c.sizeParam) u.searchParams.set(c.sizeParam, String(c.pageSize)); }
  return u.toString();
}
/** one logical GET: retries network/5xx/429 with back-off, signs in again once when the session is rejected */
async function getJson(c, n) {
  let relogged = false, lastErr;
  for (let attempt = 1; attempt <= c.retries; attempt++) {
    try {
      let r = await http(c, 'GET', pageUrl(c, n));
      const authFail = x => x.status === 401 || x.status === 403 || looksLoginUrl(x.url) || isLoginHtml(x.text);
      if (authFail(r) && !relogged) { relogged = true; storeCookie(''); await login(c); r = await http(c, 'GET', pageUrl(c, n)); }
      if (authFail(r)) throw new SyncError('auth', 'Signed in, but the supplier CRM still rejects the session', true);
      if (r.status === 429 || r.status >= 500) throw new SyncError('server', 'The supplier CRM answered with HTTP ' + r.status);
      if (r.status >= 400) throw new SyncError('format', 'The supplier CRM answered with HTTP ' + r.status);
      let j; try { j = JSON.parse(r.text); } catch { throw new SyncError('format', 'The supplier answered with something that is not JSON'); }
      if (typeof j === 'string') { try { j = JSON.parse(j); } catch { /* keep the string; the normaliser reports it */ } }
      return j;
    } catch (e) {
      lastErr = e;
      if (!(e instanceof SyncError) || !['network', 'server'].includes(e.kind) || attempt === c.retries) break;
      await sleep(c.retryBaseMs * Math.pow(3, attempt - 1) + Math.round(Math.random() * 100));
    }
  }
  throw lastErr;
}

const kn = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
/** the array of records inside any common wrapper ({d:..}, {data:..}, {Data:{Items:..}}) */
function rowsOf(j, depth = 0) {
  if (Array.isArray(j)) return j.every(x => isObj(x)) || !j.length ? j : j.filter(isObj);
  if (!isObj(j) || depth > 3) return null;
  const ks = Object.keys(j), pref = ['d', 'data', 'result', 'results', 'groups', 'items', 'rows', 'records', 'list', 'value', 'umrgroups', 'grouplist'];
  const ordered = [...pref.map(p => ks.find(k => kn(k) === p)).filter(Boolean), ...ks];
  for (const k of ordered) { const v = j[k]; if (Array.isArray(v) && v.some(isObj)) return v.filter(isObj); }
  for (const k of ordered) { const v = j[k]; if (isObj(v)) { const r = rowsOf(v, depth + 1); if (r && r.length) return r; } }
  return null;
}
/** pagination hints from the response envelope; nothing found = a single response */
function pagingOf(j) {
  if (!isObj(j)) return {};
  const flat = {}; const walk = (o, d) => { if (!isObj(o) || d > 2) return; Object.entries(o).forEach(([k, v]) => { if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') flat[kn(k)] = v; else if (isObj(v)) walk(v, d + 1); }); }; walk(j, 0);
  const num = (...n) => { for (const k of n) if (flat[k] !== undefined && Number.isFinite(+flat[k])) return +flat[k]; return null; };
  const bool = (...n) => { for (const k of n) if (flat[k] !== undefined) return flat[k] === true || /^(true|1|yes)$/i.test(String(flat[k])); return null; };
  return { totalPages: num('totalpages', 'pagecount', 'pages', 'lastpage'), total: num('totalcount', 'totalrecords', 'recordstotal', 'totalitems', 'total', 'count'), hasMore: bool('hasmore', 'hasnext', 'hasnextpage', 'more'), page: num('page', 'pageno', 'pagenumber', 'currentpage') };
}
async function fetchAll(c) {
  const first = await getJson(c, 1);
  let rows = rowsOf(first);
  if (!rows) throw new SyncError('format', 'No list of groups was found in the supplier response (the API shape changed or the session is not authorised)');
  const pg = pagingOf(first); let pages = 1; const all = rows.slice();
  const more = () => (pg.totalPages && pages < pg.totalPages) || (pg.hasMore === true) || (pg.total && all.length < pg.total && rows.length > 0);
  while (pages < c.maxPages && more()) {
    const next = pages + 1, j = await getJson(c, next), r = rowsOf(j) || [];
    if (!r.length) break;
    const before = all.length; r.forEach(x => all.push(x)); rows = r; pages = next;
    if (!pagingOf(j).totalPages && all.length === before) break;
  }
  return { rows: all, pages, first };
}

/* ------------------------------------------------------------------ normalisation (pure functions: unit-tested) */
const ALIAS = {
  oid: ['groupoid', 'grpoid', 'groupid', 'oid'], gcode: ['groupcode', 'grpcode', 'groupno', 'groupnumber', 'groupname'],
  pcode: ['packagecode', 'pkgcode', 'packageno', 'packagenumber', 'packageid', 'packagename'],
  seats: ['availableseats', 'availseats', 'remainingseats', 'seatsavailable', 'seatsleft', 'balanceseats', 'availableseat', 'seats'],
  dep: ['traveldate', 'departuredate', 'depdate', 'departdate', 'traveldt', 'flightdate', 'startdate', 'outbounddate', 'departure'],
  ret: ['returndate', 'retdate', 'returndt', 'enddate', 'inbounddate', 'return'],
  dur: ['duration', 'nights', 'noofnights', 'totalnights', 'numberofnights', 'noofdays', 'days'],
  airline: ['airline', 'airlinename', 'carrier', 'airlines'], aircode: ['airlinecode', 'carriercode', 'aircode'],
  outfn: ['outboundflight', 'outboundflightno', 'outflightno', 'departureflight', 'departureflightno', 'depflightno', 'depflight', 'onwardflight', 'onwardflightno', 'flightno', 'flightnumber', 'flight'],
  infn: ['returnflight', 'returnflightno', 'retflightno', 'inboundflight', 'inboundflightno', 'returnflightnumber'],
  from: ['origin', 'departurecity', 'fromcity', 'departureairport', 'from'], to: ['destination', 'arrivalcity', 'tocity', 'arrivalairport', 'to'],
  sector: ['sector', 'outboundsector', 'route'], insector: ['returnsector', 'inboundsector'],
  outdt: ['departuretime', 'deptime', 'outboundtime', 'onwardtime'], outat: ['arrivaltime', 'arrtime'], indt: ['returndeparturetime', 'retdeptime'], inat: ['returnarrivaltime', 'retarrtime'],
  mk: ['makkahhotel', 'makkahhotelname', 'hotelmakkah', 'makkah', 'mkhotel', 'makkahaccommodation', 'makkahhotels'],
  md: ['madinahhotel', 'madinahhotelname', 'hotelmadinah', 'madinah', 'madinahaccommodation', 'medinahhotel', 'medinah', 'madinahhotels'],
  mkn: ['makkahnights', 'nightsmakkah', 'makkahstay', 'mknights'], mdn: ['madinahnights', 'nightsmadinah', 'madinahstay', 'mdnights', 'medinahnights'],
  sh: ['sharingprice', 'sharing', 'pricesharing', 'sharingrate'], qd: ['quadprice', 'quad', 'quadrate', 'pricequad'], tr: ['tripleprice', 'triple', 'triplerate'], db: ['doubleprice', 'double', 'doublerate', 'twinprice'],
  price: ['price', 'packageprice', 'totalprice', 'adultprice', 'rate', 'sellingprice']
};
function picker(o, map) {
  const idx = new Map(); Object.keys(o).forEach(k => { const n = kn(k); if (!idx.has(n)) idx.set(n, k); });
  return name => {
    if (map && map[name]) { const k = idx.get(kn(map[name])); if (k !== undefined) return o[k]; }
    for (const a of ALIAS[name] || []) if (idx.has(a)) return o[idx.get(a)];
    return undefined;
  };
}
const text = (v, n = 120) => (v == null || typeof v === 'object' ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n));
const SOLD = /^(sold\s*out|full|no\s+seats?(\s+left)?|closed)$/i;
/** an explicit number or sold-out word. blank, null, junk, negative = UNKNOWN (null) and never zero */
function parseSeats(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 9999 ? v : null;
  if (v == null || typeof v === 'object') return null;
  const t = String(v).trim().replace(/,/g, '');
  if (/^\d{1,4}$/.test(t)) return +t;
  if (/^\d{1,4}\.0+$/.test(t)) return Math.round(+t);
  if (SOLD.test(t)) return 0;
  const m = /^(\d{1,4})\s*seats?(\s*(left|available|remaining))?$/i.exec(t); return m ? +m[1] : null;
}
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const validYmd = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0') : ''; };
function toISODate(v) {
  if (v == null || v === '') return '';
  const fromMs = ms => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: db.settings.tz || 'Asia/Karachi' }).format(new Date(ms)); } catch { return new Date(ms).toISOString().slice(0, 10); } };
  if (typeof v === 'number') return v > 1e10 ? fromMs(v) : '';
  const s = String(v).trim(); let m;
  if ((m = /\/Date\((-?\d+)/.exec(s))) return fromMs(+m[1]);
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return validYmd(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{4})/.exec(s))) return validYmd(+m[3], +m[2], +m[1]);          // day first
  if ((m = /^(\d{1,2})[/\-. ]([A-Za-z]{3})[a-z]*[/\-. ,]*(\d{4})/.exec(s))) return MON[m[2].toLowerCase()] ? validYmd(+m[3], MON[m[2].toLowerCase()], +m[1]) : '';
  return '';
}
const hhmm = v => { const m = /(\d{1,2}):(\d{2})/.exec(String(v == null ? '' : v)); return m && +m[1] < 24 ? m[1].padStart(2, '0') + ':' + m[2] : ''; };
const iata = v => { const t = text(v, 40).toUpperCase(); return /^[A-Z]{3}$/.test(t) ? t : (/\(([A-Z]{3})\)/.exec(t) || [])[1] || ''; };
const flightNo = v => { const t = text(v, 20).toUpperCase().replace(/\s+/g, ''); const m = /^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/.exec(t); return m ? m[1] + ' ' + m[2] : ''; };
const sectorOf = v => { const m = /([A-Za-z]{3})\s*[-\u2013>/ ]+\s*([A-Za-z]{3})/.exec(text(v, 30)); return m ? [m[1].toUpperCase(), m[2].toUpperCase()] : null; };
const money = v => { const n = Math.round(+String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 && n < 1e8 ? n : 0; };
const posInt = (v, max) => { const n = Math.round(+String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 && n <= max ? n : 0; };
const infoOf = o => { const out = {}; let n = 0; for (const [k, v] of Object.entries(o)) { if (n >= 25) break; if (v == null || typeof v === 'object') continue; out[k.slice(0, 40)] = text(v, 80); n++; } return out; };

/** any supplier payload -> { groups:[{oid, code, dep, ret, ..., packages:[...]}], rows, invalid, duplicates, sampleKeys } */
function normalize(json, map = {}) {
  const rows = rowsOf(json); if (!rows) return null;
  const flat = [];
  rows.forEach(o => {
    const nestedKey = Object.keys(o).find(k => Array.isArray(o[k]) && o[k].some(isObj) && (/pack|pkg/i.test(k) || o[k].some(p => isObj(p) && picker(p, map)('pcode') !== undefined)));
    if (nestedKey) { const { [nestedKey]: kids, ...head } = o; const ks = kids.filter(isObj); if (ks.length) ks.forEach(p => flat.push({ ...head, ...p })); else flat.push(head); } else flat.push(o);
  });
  const groups = new Map(); let invalid = 0, duplicates = 0;
  flat.forEach(o => {
    const P = picker(o, map), oidRaw = text(P('oid'), 80), gcodeRaw = text(P('gcode'), 80), oid = oidRaw || gcodeRaw;
    if (!oid) { invalid++; return; }
    let g = groups.get(oid);
    if (!g) { g = { oid, code: gcodeRaw || oidRaw, dep: '', ret: '', nights: 0, airline: '', air: '', out: {}, inb: {}, seatsList: [], packages: new Map() }; groups.set(oid, g); }
    if (gcodeRaw && !g.code) g.code = gcodeRaw;
    const setOnce = (k, v) => { if (v && !g[k]) g[k] = v; };
    setOnce('dep', toISODate(P('dep'))); setOnce('ret', toISODate(P('ret'))); setOnce('nights', posInt(P('dur'), 120));
    setOnce('airline', text(P('airline'), 60)); setOnce('air', /^[A-Z0-9]{2}$/.test(text(P('aircode'), 3).toUpperCase()) ? text(P('aircode'), 3).toUpperCase() : '');
    const ofn = flightNo(P('outfn')), ifn = flightNo(P('infn')), sec = sectorOf(P('sector')) || [iata(P('from')), iata(P('to'))], isec = sectorOf(P('insector')) || (sec[0] && sec[1] ? [sec[1], sec[0]] : ['', '']);
    const leg = (dst, fn, f, t, dt, at) => { if (fn && !dst.fn) dst.fn = fn; if (f && !dst.from) dst.from = f; if (t && !dst.to) dst.to = t; if (dt && !dst.dt) dst.dt = dt; if (at && !dst.at) dst.at = at; };
    leg(g.out, ofn, sec[0], sec[1], hhmm(P('outdt')), hhmm(P('outat'))); leg(g.inb, ifn, isec[0], isec[1], hhmm(P('indt')), hhmm(P('inat')));
    const sRaw = P('seats'); if (sRaw !== undefined) g.seatsList.push(parseSeats(sRaw));
    const pcode = text(P('pcode'), 80);
    if (pcode) {
      if (g.packages.has(pcode)) { duplicates++; return; }
      const cost = { sh: money(P('sh')), qd: money(P('qd')), tr: money(P('tr')), db: money(P('db')) };
      if (!cost.sh && !cost.qd && !cost.tr && !cost.db) cost.sh = money(P('price'));
      g.packages.set(pcode, { code: pcode, mk: text(P('mk'), 80), md: text(P('md'), 80), mkn: posInt(P('mkn'), 60), mdn: posInt(P('mdn'), 60), cost, seats: sRaw === undefined ? null : parseSeats(sRaw), info: infoOf(o) });
    }
  });
  const out = [...groups.values()].map(g => {
    const known = g.seatsList.filter(x => x !== null);
    return { ...g, seatsList: undefined, seats: known.length ? Math.min(...known) : null, unreadableSeatRows: g.seatsList.length - known.length, packages: [...g.packages.values()] };
  });
  return { groups: out, rows: flat.length, invalid, duplicates, sampleKeys: flat[0] ? Object.keys(flat[0]).slice(0, 60) : [] };
}

/* ------------------------------------------------------------------ applying to the local inventory */
const ROOMS = ['sh', 'qd', 'tr', 'db'];
const cleanId = (s, n) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, n);
const nightsBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const markupOf = price => Math.round(price * (1 + Math.max(0, +db.settings.markupPct || 0) / 100));
const sellFrom = cost => { const p = { sh: 0, qd: 0, tr: 0, db: 0 }; ROOMS.forEach(k => { p[k] = cost[k] > 0 ? markupOf(cost[k]) : 0; }); return p; };
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function newGroupId(oid) {
  const base = 'MZ' + cleanId(oid, 20).replace(/-/g, ''); let id = base || 'MZ' + D.nid();
  while (db.groups.some(g => g.id === id)) id += 'X';
  return id;
}
function newPkId(g, code) {
  const base = cleanId(code, 18) || 'PK'; let id = base, i = 2;
  while (g.pk.some(k => k.id === id)) id = base.slice(0, 16) + '-' + i++;
  return id;
}
const legOf = (cur, patch, date) => { const o = { fn: '', from: '', to: '', dt: '', at: '', bag: 0, ...(cur || {}), date }; ['fn', 'from', 'to', 'dt', 'at'].forEach(k => { if (patch[k]) o[k] = patch[k]; }); return o; };

/**
 * Applies a normalised supplier snapshot to db.groups. Pure with respect to the network. Never deletes anything.
 * `opts`: { at, today, priceFollow, missThreshold }
 */
function applyInventory(parsed, opts = {}) {
  const at = opts.at || nowISO(), t = opts.today || D.today(), follow = opts.priceFollow !== false, thr = Math.max(1, +opts.missThreshold || 2);
  const R = { newGroups: 0, updatedGroups: 0, newPackages: 0, updatedPackages: 0, removedGroups: 0, removedPackages: 0, reactivatedGroups: 0, reactivatedPackages: 0, adopted: 0, skippedPast: 0, skippedInvalid: 0, unknownSeats: 0, soldOut: 0, awaitingSeats: 0, detail: [] };
  const note = (kind, g, extra) => { if (R.detail.length < 60) R.detail.push({ kind, id: g.id, code: g.code, ...(extra || {}) }); };
  const byOid = new Map(); db.groups.forEach(g => { if (g.sup && g.sup.oid != null) byOid.set(String(g.sup.oid), g); });
  const legacyKey = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const seen = new Set();

  for (const sg of parsed.groups) {
    seen.add(sg.oid);
    let g = byOid.get(sg.oid), isNew = false;
    if (!g) { // adopt an existing hand-entered group only when ONE local group carries exactly this supplier group code
      const k = legacyKey(sg.code), hits = k.length >= 3 ? db.groups.filter(x => !x.sup && [x.supplierRef, x.code, x.id].some(v => legacyKey(v) === k)) : [];
      if (hits.length === 1) { g = hits[0]; g.sup = { src: 'meezab', oid: sg.oid, code: sg.code, miss: 0, firstSeenAt: at, adopted: true }; g.supplierRef = g.supplierRef || sg.code; byOid.set(sg.oid, g); R.adopted++; }
    }
    if (!g) {
      if (!sg.dep || !sg.ret || sg.ret <= sg.dep) { R.skippedInvalid++; continue; }
      if (sg.dep < t) { R.skippedPast++; continue; }
      const nights = sg.nights || nightsBetween(sg.dep, sg.ret), fn = sg.out.fn || '', air = (/^[A-Z0-9]{2}$/.test(sg.air) && sg.air) || fn.slice(0, 2) || (sg.airline.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()) || 'ZZ';
      g = { id: newGroupId(sg.oid), code: sg.code || sg.oid, air, airline: sg.airline || air, dep: sg.dep, ret: sg.ret, supplierRef: sg.code || sg.oid, n: Math.min(120, Math.max(1, nights)), seats: 0,
        out: legOf(null, sg.out, sg.dep), inb: legOf(null, sg.inb, sg.ret), pk: [], active: true,
        sup: { src: 'meezab', oid: sg.oid, code: sg.code || sg.oid, miss: 0, firstSeenAt: at, adopted: false, seatsKnown: false } };
      db.groups.push(g); byOid.set(sg.oid, g); isNew = true; R.newGroups++; note('new-group', g);
    }
    const before = JSON.stringify([g.code, g.dep, g.ret, g.n, g.air, g.airline, g.seats, g.out, g.inb, g.active !== false]);
    const sup = g.sup; sup.miss = 0; sup.lastSeenAt = at; sup.code = sg.code || sup.code;
    if (g.active === false) { g.active = true; sup.reactivatedAt = at; sup.removedAt = ''; R.reactivatedGroups++; note('reactivated-group', g); }
    if (!isNew) {
      if (sg.code) g.code = sg.code;
      if (sg.dep && sg.ret && sg.ret > sg.dep) { g.dep = sg.dep; g.ret = sg.ret; g.n = Math.min(120, Math.max(1, sg.nights || nightsBetween(sg.dep, sg.ret))); g.out = legOf(g.out, sg.out, sg.dep); g.inb = legOf(g.inb, sg.inb, sg.ret); }
      else { g.out = legOf(g.out, sg.out, g.out && g.out.date || g.dep); g.inb = legOf(g.inb, sg.inb, g.inb && g.inb.date || g.ret); }
      if (/^[A-Z0-9]{2}$/.test(sg.air)) g.air = sg.air; if (sg.airline) g.airline = sg.airline;
    }
    // seats: only a readable value is applied. unreadable = keep what we had (never zero)
    if (sg.seats !== null) { g.seats = Math.min(999, sg.seats); sup.seats = sg.seats; sup.seatsKnown = true; sup.seatsAt = at; sup.soldOut = sg.seats === 0; if (sg.seats === 0) R.soldOut++; }
    else { R.unknownSeats++; if (sup.seatsKnown === false) R.awaitingSeats++; }
    if (sup.seatsKnown && g.meezab === undefined) g.meezab = { ref: sg.code, remaining: g.seats, at, soldOut: g.seats === 0 };
    else if (g.meezab && sg.seats !== null) g.meezab = { ref: sg.code, remaining: sg.seats, at, soldOut: sg.seats === 0 };

    // packages: matched by PackageCode only (adopted hand-entered groups keep their own packages untouched)
    const seenPk = new Set();
    if (!sup.adopted) for (const sp of sg.packages) {
      seenPk.add(sp.code);
      let k = g.pk.find(x => x.sup && x.sup.code === sp.code), pNew = false;
      if (!k) {
        const hotelFallback = !sp.mk && !sp.md ? 'Package ' + sp.code : '';
        k = { id: newPkId(g, sp.code), mk: sp.mk || hotelFallback, md: sp.md, mkn: sp.mkn, mdn: sp.mdn, mkd: '', mdd: '', p: sellFrom(sp.cost), auto: true, active: true,
          sup: { code: sp.code, miss: 0, firstSeenAt: at } };
        g.pk.push(k); pNew = true; R.newPackages++; note('new-package', g, { pkg: sp.code });
      }
      const pb = JSON.stringify([k.mk, k.md, k.mkn, k.mdn, k.sup && k.sup.cost, k.p, k.active !== false, k.sup && k.sup.seats]);
      k.sup.miss = 0; k.sup.lastSeenAt = at; k.sup.cost = sp.cost; k.sup.seats = sp.seats; k.sup.info = sp.info;
      if (k.active === false) { k.active = true; k.sup.removedAt = ''; k.sup.reactivatedAt = at; R.reactivatedPackages++; note('reactivated-package', g, { pkg: sp.code }); }
      if (!pNew) { // supplier facts follow the supplier; hand-written hotel text is kept when the supplier sends nothing
        if (sp.mk) k.mk = sp.mk; if (sp.md) k.md = sp.md; if (sp.mkn) k.mkn = sp.mkn; if (sp.mdn) k.mdn = sp.mdn;
        if (follow && k.auto === true && !k.lock && ROOMS.some(r => sp.cost[r] > 0)) k.p = sellFrom(sp.cost);        // never touches a price an administrator set
      }
      if (!pNew && pb !== JSON.stringify([k.mk, k.md, k.mkn, k.mdn, k.sup.cost, k.p, k.active !== false, k.sup.seats])) { R.updatedPackages++; note('updated-package', g, { pkg: sp.code }); }
    }
    if (!sup.adopted) g.pk.forEach(k => {
      if (!k.sup || seenPk.has(k.sup.code) || k.active === false) return;
      k.sup.miss = (k.sup.miss || 0) + 1;
      if (k.sup.miss >= thr) { k.active = false; k.sup.removedAt = at; R.removedPackages++; note('removed-package', g, { pkg: k.sup.code }); }
    });
    if (!isNew && before !== JSON.stringify([g.code, g.dep, g.ret, g.n, g.air, g.airline, g.seats, g.out, g.inb, g.active !== false])) { R.updatedGroups++; note('updated-group', g); }
  }

  // groups the supplier stopped returning: deactivate after `thr` consecutive complete syncs. Bookings, vouchers and ledgers are untouched.
  db.groups.forEach(g => {
    if (!g.sup || g.sup.oid == null || seen.has(String(g.sup.oid)) || g.active === false) return;
    g.sup.miss = (g.sup.miss || 0) + 1;
    if (g.sup.miss >= thr) { g.active = false; g.sup.removedAt = at; R.removedGroups++; note('removed-group', g); }
  });
  return R;
}

/* ------------------------------------------------------------------ reporting */
function totals() {
  const gs = db.groups.filter(g => g.sup && g.sup.src === 'meezab'), pk = gs.flatMap(g => (g.sup.adopted ? [] : g.pk).map(k => ({ g, k })));
  const live = g => g.active !== false;
  return { groups: gs.length, activeGroups: gs.filter(live).length, inactiveGroups: gs.filter(g => !live(g)).length, packages: pk.length, activePackages: pk.filter(x => live(x.g) && x.k.active !== false).length, inactivePackages: pk.filter(x => !live(x.g) || x.k.active === false).length,
    soldOut: gs.filter(g => live(g) && g.seats === 0 && g.sup.seatsKnown).length, awaitingSeats: gs.filter(g => live(g) && g.sup.seatsKnown === false).length, adopted: gs.filter(g => g.sup.adopted).length,
    needPrice: pk.filter(x => live(x.g) && x.k.active !== false && !ROOMS.some(r => x.k.p && x.k.p[r] > 0)).length };
}
function publicStatus() {
  const m = st(), c = cfg();
  return { configured: configured(c), enabled: m.enabled, status: m.enabled ? m.status : 'disabled', intervalMin: m.intervalMin, missThreshold: m.missThreshold, priceFollow: m.priceFollow, lastOkAt: m.lastOkAt, lastAttemptAt: m.lastAttemptAt, lastError: m.lastError, lastErrorKind: m.lastErrorKind,
    nextAt: m.nextAt, summary: m.summary, totals: totals(), hasSession: !!sessionCookie(), canStoreSession: !!c.secret, running, host: c.origin ? new URL(c.origin).host : '', endpoint: (() => { try { return new URL(c.api).pathname; } catch { return ''; } })(), shape: m.shape };
}
const history = (n = 60) => log().slice(-n).reverse();
function inventory({ state = 'all', q = '' } = {}) {
  const text = String(q || '').toLowerCase().trim();
  return db.groups.filter(g => g.sup && g.sup.src === 'meezab').filter(g => state === 'all' || (state === 'active') === (g.active !== false)).filter(g => !text || [g.id, g.code, g.airline, g.sup.oid, ...g.pk.map(k => k.sup && k.sup.code)].join(' ').toLowerCase().includes(text))
    .map(g => ({ id: g.id, code: g.code, oid: g.sup.oid, airline: g.airline, dep: g.dep, ret: g.ret, n: g.n, seats: g.seats, seatsKnown: g.sup.seatsKnown !== false, active: g.active !== false, adopted: !!g.sup.adopted, firstSeenAt: g.sup.firstSeenAt, lastSeenAt: g.sup.lastSeenAt, removedAt: g.sup.removedAt || '',
      packages: g.pk.map(k => ({ id: k.id, code: k.sup ? k.sup.code : '', active: k.active !== false, auto: !!k.auto && !k.lock, locked: !!k.lock, mk: k.mk, md: k.md, cost: k.sup && k.sup.cost || null, sell: k.p, seats: k.sup ? k.sup.seats : null, removedAt: k.sup && k.sup.removedAt || '' })) }))
    .sort((a, b) => (a.dep < b.dep ? -1 : 1)).slice(0, 600);
}

/* ------------------------------------------------------------------ run */
let running = false, timer = null;
function alertAdmin(kind, title, body) {
  const m = st(); if (m.alertedKind === kind) return; m.alertedKind = kind;
  try { require('./extras').push({ uid: 'admin' }, title, body, '#/services', 'warn'); } catch { /* notifications are best-effort */ }
}
function pushLog(entry) {
  const L = log(), last = L[L.length - 1];
  const quiet = e => e.ok && !(e.newGroups || e.updatedGroups || e.removedGroups || e.newPackages || e.updatedPackages || e.removedPackages || e.reactivatedGroups || e.reactivatedPackages);
  if (last && quiet(last) && quiet(entry) && last.groups === entry.groups && last.packages === entry.packages) { last.at = entry.at; last.ms = entry.ms; last.repeat = (last.repeat || 1) + 1; return false; }
  L.push(entry); if (L.length > 1000) L.splice(0, L.length - 1000); return true;
}

async function runSync({ by = 'scheduler', manual = false } = {}) {
  const m = st(), t0 = Date.now(), at = nowISO();
  if (running) return { ok: false, busy: true, error: 'A sync is already running' };
  running = true; m.lastAttemptAt = at;
  const entry = { id: 'y' + D.nid(), at, by, manual: !!manual, ok: false };
  let mutated = false;
  try {
    const c = cfg();
    if (!configured(c)) throw new SyncError('config', 'Supplier sync is not configured. Set MEEZAB_USERNAME and MEEZAB_PASSWORD (and optionally MEEZAB_API_URL) on the server, or paste a session in Admin > Supplier sync.');
    const { rows, pages } = await fetchAll(c);
    const parsed = normalize(rows, c.map);
    if (!parsed) throw new SyncError('format', 'The supplier response could not be understood. Nothing was changed.');
    m.shape = { keys: parsed.sampleKeys, rows: parsed.rows, at };
    if (!parsed.groups.length) throw new SyncError('format', 'The supplier returned no usable groups (' + parsed.invalid + ' rows had no GroupOid / GroupCode). Nothing was changed.');
    if (parsed.invalid > parsed.rows * 0.5) throw new SyncError('format', 'More than half of the supplier rows had no group identifier (the API shape changed). Nothing was changed.');
    const live = db.groups.filter(g => g.sup && g.sup.src === 'meezab' && g.active !== false && g.dep >= D.today()).length;
    if (live >= 10 && parsed.groups.length < Math.ceil(live * c.minKeepRatio)) throw new SyncError('partial', 'Only ' + parsed.groups.length + ' groups came back but about ' + live + ' are active. The result was ignored and nothing was changed.');
    const res = applyInventory(parsed, { at, priceFollow: m.priceFollow, missThreshold: m.missThreshold });
    const changed = res.newGroups + res.updatedGroups + res.removedGroups + res.newPackages + res.updatedPackages + res.removedPackages + res.reactivatedGroups + res.reactivatedPackages + res.adopted;
    const tt = totals();
    Object.assign(entry, { ok: true, pages, rows: parsed.rows, groups: parsed.groups.length, packages: parsed.groups.reduce((a, g) => a + g.packages.length, 0), invalid: parsed.invalid, duplicates: parsed.duplicates, ...res, detail: res.detail });
    m.status = 'ok'; m.lastOkAt = at; m.lastError = ''; m.lastErrorKind = ''; m.fails = 0; m.alertedKind = '';
    m.summary = { at, groups: entry.groups, packages: entry.packages, newGroups: res.newGroups, newPackages: res.newPackages, updatedGroups: res.updatedGroups, updatedPackages: res.updatedPackages, removedGroups: res.removedGroups, removedPackages: res.removedPackages, unknownSeats: res.unknownSeats, invalid: parsed.invalid, skippedPast: res.skippedPast };
    mutated = changed > 0; entry.totals = tt;
  } catch (e) {
    const kind = e.kind || 'network';
    entry.error = String(e.message || e).slice(0, 300); entry.kind = kind;
    m.fails++; m.lastError = entry.error; m.lastErrorKind = kind; mutated = true;
    if (e.human || ['auth', 'captcha', 'mfa'].includes(kind)) { m.status = 'needs_reauth'; storeCookie(''); alertAdmin(kind, 'Supplier sync needs you to sign in again', entry.error); }
    else { m.status = 'error'; if (m.fails >= 3) alertAdmin(kind, 'Supplier sync is failing', entry.error); }
  } finally {
    entry.ms = Date.now() - t0; if (pushLog(entry)) mutated = true;
    running = false; schedule(); if (mutated) D.save();
  }
  return { ok: entry.ok, entry, status: m.status };
}

/* ------------------------------------------------------------------ admin workflows */
async function setSession(cookieHeader) {
  const c = cfg(), ck = String(cookieHeader || '').replace(/^cookie:\s*/i, '').trim();
  if (!ck || ck.length > 8000 || /[\r\n]/.test(ck)) D.fail('Paste the cookie value copied from your signed-in browser');
  if (!c.api || !okUrl(c.api)) D.fail('The supplier API address is not valid on the server');
  storeCookie(ck);
  try { const j = await getJson({ ...c, retries: 1 }, 1); if (!rowsOf(j)) throw new SyncError('format', 'Signed in, but no group list was found in the supplier response'); }
  catch (e) { storeCookie(''); D.fail(e.message); }
  const m = st(); m.status = 'idle'; m.alertedKind = ''; m.lastError = ''; m.lastErrorKind = ''; D.save();
  return runSync({ by: 'reauth', manual: true });
}
function saveConfig(p) {
  const m = st();
  if (p.enabled !== undefined) m.enabled = !!p.enabled && p.enabled !== 'false';
  if (p.intervalMin !== undefined) m.intervalMin = Math.min(60, Math.max(1, Math.round(+p.intervalMin) || 2));
  if (p.missThreshold !== undefined) m.missThreshold = Math.min(10, Math.max(1, Math.round(+p.missThreshold) || 2));
  if (p.priceFollow !== undefined) m.priceFollow = !!p.priceFollow && p.priceFollow !== 'false';
  if (!m.enabled) m.status = 'disabled'; else if (m.status === 'disabled') m.status = 'idle';
  schedule(); D.save();
}

/* ------------------------------------------------------------------ scheduler */
function schedule() {
  if (timer) { clearTimeout(timer); timer = null; }
  const m = st();
  if (!m.enabled || m.status === 'needs_reauth' || !configured()) { m.nextAt = ''; return; }
  const base = m.intervalMin * 60000, wait = Math.max(5000, base + Math.round((Math.random() - 0.5) * Math.min(10000, base * 0.1)));
  m.nextAt = new Date(Date.now() + wait).toISOString();
  timer = setTimeout(() => { runSync({ by: 'scheduler' }).catch(() => {}); }, wait); if (timer.unref) timer.unref();
}
/** true when this module owns seat updates, so the older table-scraping seat sync stays idle and cannot fight it */
const takesOver = () => { const m = st(); return m.enabled && configured(); };
function start() { st(); setTimeout(() => { if (takesOver()) runSync({ by: 'startup' }).catch(() => {}); else schedule(); }, +env('MEEZAB_START_DELAY_MS', 4000)).unref(); }

module.exports = { start, runSync, setSession, saveConfig, publicStatus, history, inventory, totals, takesOver, configured, cfg,
  normalize, applyInventory, parseSeats, toISODate, rowsOf, pagingOf, fetchAll };
