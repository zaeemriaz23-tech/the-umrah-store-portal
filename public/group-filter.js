/* Shared robust group-package filtering for the CRM and public website. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TUSGroupFilter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const normalize = value => String(value == null ? '' : value)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const ROOT_KEYS = ['brand','brandName','supplier','supplierName','provider','providerName','supplierLabel','supplierRef','source','src','airline','air','carrier','carrierName','name','title','label','code','ref'];
  const META_KEYS = ['brand','brandName','supplier','supplierName','provider','providerName','name','title','label','src','source','code','ref','oid'];
  const addValue = (target, value) => {
    if (typeof value === 'string' || typeof value === 'number') {
      const s = String(value).trim(); if (s) target.push(s);
    }
  };
  const addObject = (target, object, keys) => {
    if (object && typeof object === 'object') keys.forEach(key => addValue(target, object[key]));
  };
  const uniqueText = values => [...new Set(values.map(v => String(v).trim()).filter(Boolean))].join(' ');

  function aliases(text) {
    const n = normalize(text), out = [String(text || ''), n];
    const compact = n.replace(/\s+/g, '');
    if (/\bmeezab\b|\bmzb\b/.test(n) || compact.includes('meezab')) out.push('Meezab', 'Meezab e Qaba', 'MZB', 'Meezab Group', 'Meezab Group CRM');
    if (/\bairsial\b|\bair sial\b|\bpf\b/.test(n) || compact.includes('airsial')) out.push('AirSial', 'Air Sial', 'PF');
    if (/\bpia\b|\bpk\b|pakistan international/.test(n)) out.push('PIA', 'Pakistan International Airlines', 'PK');
    if (/\bsaudia\b|\bsv\b|saudi arabian/.test(n)) out.push('Saudia', 'Saudi Arabian Airlines', 'SV');
    return out.join(' ');
  }

  function brandText(group) {
    if (!group || typeof group !== 'object') return '';
    const values = [];
    addObject(values, group, ROOT_KEYS);
    const supplier = group.sup || group.supplier || {};
    addObject(values, supplier, META_KEYS);
    addObject(values, group.meezab, META_KEYS);
    const src = normalize([supplier.src, supplier.source, group.source, group.src].join(' '));
    const combined = normalize([group.supplierLabel, group.brand, group.supplier, supplier.name, supplier.label, supplier.code].join(' '));
    if (src.includes('meezab') || combined.includes('meezab') || combined.includes('mzb') || group.meezab) {
      values.push('Meezab', 'Meezab e Qaba', 'MZB', 'Meezab Group', 'Meezab Group CRM');
    }
    (Array.isArray(group.pk) ? group.pk : []).forEach(pkg => {
      addObject(values, pkg, ROOT_KEYS);
      addObject(values, pkg && pkg.sup, META_KEYS);
    });
    return uniqueText(values);
  }

  function searchText(group) {
    if (!group || typeof group !== 'object') return '';
    const values = [brandText(group), group.id, group.code, group.no, group.dep, group.ret,
      group.n, group.seats, group.out && group.out.fn, group.out && group.out.from,
      group.out && group.out.to, group.inb && group.inb.fn,
      group.inb && group.inb.from, group.inb && group.inb.to];
    (Array.isArray(group.pk) ? group.pk : []).forEach(pkg => {
      if (!pkg) return;
      values.push(pkg.mk, pkg.md, pkg.mkd, pkg.mdd, pkg.mkn, pkg.mdn, pkg.id);
      const prices = pkg.p && typeof pkg.p === 'object' ? pkg.p : {};
      Object.values(prices).forEach(v => addValue(values, v));
    });
    return uniqueText(values);
  }

  function splitQueries(value) {
    return String(value == null ? '' : value).split(/[,;|\n\r]+/).map(normalize).filter(Boolean);
  }

  function matchesText(text, query) {
    const haystack = normalize(aliases(text));
    if (!haystack) return false;
    const compactHaystack = haystack.replace(/\s+/g, '');
    return splitQueries(query).some(phrase => {
      const words = phrase.split(/\s+/).filter(Boolean);
      return words.length > 0 && (words.every(word => haystack.includes(word)) || compactHaystack.includes(phrase.replace(/\s+/g, '')));
    });
  }

  function minPrice(group) {
    const values = [];
    (Array.isArray(group && group.pk) ? group.pk : []).forEach(pkg => {
      const prices = pkg && pkg.p && typeof pkg.p === 'object' ? pkg.p : {};
      Object.values(prices).forEach(value => { const n = Number(value); if (Number.isFinite(n) && n > 0) values.push(n); });
    });
    return values.length ? Math.min(...values) : 0;
  }

  function matches(group, filters) {
    if (!group || typeof group !== 'object') return false;
    const f = filters || {}, air = String(group.air || '').trim().toUpperCase(), selectedAir = String(f.air || '').trim();
    if (selectedAir && air !== selectedAir.toUpperCase() && !matchesText([group.airline, group.air, group.carrier, group.carrierName].join(' '), selectedAir)) return false;
    if (f.brand && !matchesText(brandText(group), f.brand)) return false;
    const dep = String(group.dep || '');
    if (f.mon && !dep.startsWith(String(f.mon))) return false;
    if (f.from && dep < String(f.from)) return false;
    if (f.to && dep > String(f.to)) return false;
    if (f.n && String(group.n) !== String(f.n)) return false;
    if (f.avail && !(Number(group.seats) > 0)) return false;
    const price = minPrice(group);
    if (f.minPrice && (!price || price < Number(f.minPrice))) return false;
    if (f.max && (!price || price > Number(f.max))) return false;
    if (f.q && !matchesText(searchText(group), f.q)) return false;
    return true;
  }

  function brandOptions(groups) {
    const values = [];
    (Array.isArray(groups) ? groups : []).forEach(group => {
      if (!group) return;
      addObject(values, group, ROOT_KEYS);
      addObject(values, group.sup || group.supplier, META_KEYS);
      addObject(values, group.meezab, META_KEYS);
      if (normalize([group.supplierLabel, group.sup && group.sup.src, group.source, group.src].join(' ')).includes('meezab') || group.meezab) values.push('Meezab e Qaba', 'MZB');
      (Array.isArray(group.pk) ? group.pk : []).forEach(pkg => { addObject(values, pkg, ROOT_KEYS); addObject(values, pkg && pkg.sup, META_KEYS); });
    });
    return [...new Set(values.map(v => String(v).trim()).filter(v => v.length > 1 && v.length <= 80))].sort((a, b) => a.localeCompare(b));
  }

  return { normalize, aliases, brandText, searchText, matchesText, splitQueries, minPrice, matches, brandOptions };
});
