'use strict';
/**
 * Restricted-brand filter (white-label).
 *
 * Rules:
 *  - Applies ONLY to what leaves the server towards agents, the public site, exports, vouchers, notifications and SEO.
 *  - Never mutates stored records. Internal data, supplier references, ledgers and audit logs keep the original wording,
 *    so package matching and seat synchronisation always see the untouched source values.
 *  - Staff/admin screens that manage suppliers receive the original data (see `forViewer`).
 *  - Terms are administrator-configurable (settings.brandFilter.terms). Longest terms are applied first so
 *    "Meezab Group CRM" is replaced as a whole before "Meezab" is considered.
 */
const D = require('./db');

const DEFAULTS = ['Meezab Group CRM', 'Meezab Group', 'Meezab'];
const MAX_TERMS = 60;

const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function config() {
  const s = (D.db.settings && D.db.settings.brandFilter) || {};
  const terms = Array.isArray(s.terms) && s.terms.length ? s.terms : DEFAULTS;
  return {
    enabled: s.enabled !== false,
    replacement: typeof s.replacement === 'string' && s.replacement.trim() ? s.replacement.trim().slice(0, 60) : 'The Umrah Store',
    terms: [...new Set(terms.map(t => String(t).trim()).filter(Boolean))].slice(0, MAX_TERMS)
  };
}

let cache = { key: '', re: null };
function matcher(terms) {
  const key = terms.join('\u0001');
  if (cache.key === key) return cache.re;
  // sort longest first; tolerate flexible spacing/hyphens/underscores between words and case differences
  const parts = [...terms].sort((a, b) => b.length - a.length).map(t => t.split(/[\s_-]+/).filter(Boolean).map(esc).join('[\\s_\\-]*'));
  const re = parts.length ? new RegExp('(?<![A-Za-z0-9])(?:' + parts.join('|') + ')(?![A-Za-z0-9])', 'gi') : null;
  cache = { key, re };
  return re;
}

/** the brand's own domain names (crm.meezabgroup.com etc.) are removed from text too */
function domainRe(terms) {
  const roots = [...new Set(terms.map(t => t.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(t => t.length >= 4))];
  return roots.length ? new RegExp('(?:https?:\\/\\/)?(?:[a-z0-9-]+\\.)*(?:' + roots.map(esc).join('|') + ')[a-z0-9-]*\\.[a-z]{2,}(?:\\/\\S*)?', 'gi') : null;
}

/** clean one string */
function clean(text, cfg) {
  if (typeof text !== 'string' || !text) return text;
  cfg = cfg || config();
  if (!cfg.enabled || !cfg.terms.length) return text;
  let out = text;
  const dre = domainRe(cfg.terms);
  if (dre) out = out.replace(dre, '');
  const re = matcher(cfg.terms);
  if (re) out = out.replace(re, cfg.replacement);
  // tidy leftovers: duplicated replacement ("The Umrah Store The Umrah Store"), empty brackets, double spaces
  const rep = esc(cfg.replacement);
  out = out.replace(new RegExp('(' + rep + ')(?:[\\s\\-:|/]+' + rep + ')+', 'gi'), '$1').replace(/\(\s*\)|\[\s*\]/g, '').replace(/[ \t]{2,}/g, ' ');
  return out.trim() === text.trim() ? out : out.replace(/\s+([,.;:!?])/g, '$1');
}

/** deep-clean any JSON-able value. Returns a new value; the input is never modified. Keys listed in `skip` are copied untouched. */
const SKIP_KEYS = new Set(['id', 'gid', 'pid', 'token', 'sid', 'pw', 'hash', 'iban', 'account', 'swift', 'qr', 'logo', 'data', 'ref', 'srcRef']);
function cleanDeep(v, cfg, depth = 0) {
  cfg = cfg || config();
  if (!cfg.enabled || depth > 12) return v;
  if (typeof v === 'string') return clean(v, cfg);
  if (Array.isArray(v)) return v.map(x => cleanDeep(x, cfg, depth + 1));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = SKIP_KEYS.has(k) ? v[k] : cleanDeep(v[k], cfg, depth + 1);
    return o;
  }
  return v;
}

/** does a string contain a restricted term? (used by the settings preview and the tests) */
function contains(text, cfg) {
  cfg = cfg || config();
  if (!cfg.enabled || typeof text !== 'string') return false;
  const re = matcher(cfg.terms); if (!re) return false;
  re.lastIndex = 0; const hit = re.test(text); re.lastIndex = 0;
  const dre = domainRe(cfg.terms);
  return hit || !!(dre && dre.test(text));
}

/** Staff/admin keep the original wording; agents, customers, suppliers and the public get the cleaned copy */
const seesOriginal = u => !!u && (u.role === 'admin' || u.role === 'staff');
const forViewer = (u, v) => (seesOriginal(u) ? v : cleanDeep(v));

/** apply to a full HTML/text document (public pages, vouchers, SEO metadata, CSV exports) */
const cleanDoc = html => clean(String(html == null ? '' : html));

function normalizeConfig(p, prev) {
  const cur = prev || {};
  const terms = Array.isArray(p.terms) ? p.terms : String(p.terms == null ? (cur.terms || DEFAULTS).join('\n') : p.terms).split(/[\n,]+/);
  const list = [...new Set(terms.map(t => D.str(t, 80)).filter(Boolean))].slice(0, MAX_TERMS);
  return {
    enabled: p.enabled === undefined ? cur.enabled !== false : !!p.enabled,
    replacement: D.str(p.replacement == null ? cur.replacement : p.replacement, 60) || 'The Umrah Store',
    terms: list.length ? list : DEFAULTS.slice()
  };
}

module.exports = { DEFAULTS, config, clean, cleanDeep, cleanDoc, contains, forViewer, seesOriginal, normalizeConfig };
