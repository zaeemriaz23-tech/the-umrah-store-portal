/* Shared group-package filter engine for the authenticated CRM and public catalogue. */
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
  const BRAND_KEYS = ['brand','brandName','supplier','supplierName','provider','providerName','supplierLabel'];
  const SUPPLIER_META_KEYS = ['brand','brandName','supplier','supplierName','provider','providerName','name','title','label'];
  const AIRLINE_NAMES = { PF: 'AirSial', PK: 'PIA', SV: 'Saudia', EK: 'Emirates', QR: 'Qatar Airways' };
  const addValue = (target, value) => {
    if (typeof value === 'string' || typeof value === 'number') {
      const s = String(value).trim(); if (s) target.push(s);
    }
  };
  const addObject = (target, object, keys) => {
    if (object && typeof object === 'object') keys.forEach(key => addValue(target, object[key]));
  };
  const uniqueText = values => [...new Set(values.map(v => String(v).trim()).filter(Boolean))].join(' ');

  // Supplier matching is deliberately separate from airline data. Meezab's aliases
  // all resolve to one supplier identity; airline names/codes never enter this text.
  function brandText(group) {
    if (!group || typeof group !== 'object') return '';
    const values = [];
    addObject(values, group, BRAND_KEYS);
    const supplier = group.sup || group.supplier || {};
    addObject(values, supplier, SUPPLIER_META_KEYS);
    addObject(values, group.meezab, SUPPLIER_META_KEYS);
    const src = normalize([supplier.src, supplier.source, group.source, group.src, supplier.code].join(' '));
    const named = normalize(values.join(' '));
    if (src.includes('meezab') || /\\bmzb\\b/.test(src) || named.includes('meezab') || /\\bmzb\\b/.test(named) || group.meezab) {
      values.push('Meezab e Qaba');
    }
    (Array.isArray(group.pk) ? group.pk : []).forEach(pkg => {
      addObject(values, pkg, BRAND_KEYS);
      addObject(values, pkg && pkg.sup, SUPPLIER_META_KEYS);
    });
    return uniqueText(values);
  }
  function airlineText(group) {
    if (!group) return '';
    const code = String(group.air || '').toUpperCase();
    const canonical = AIRLINE_NAMES[code];
    return uniqueText([code, canonical || group.airline, group.carrier, group.carrierName].filter(Boolean));
  }
  function flightText(group) {
    const out = group && group.out || {}, back = group && group.inb || {};
    return uniqueText([out.fn, back.fn, out.from, out.to, back.from, back.to].filter(Boolean));
  }
  function hotelText(group, city) {
    const values = [];
    (Array.isArray(group && group.pk) ? group.pk : []).forEach(pkg => {
      if (city === 'mk' || city === 'makkah') values.push(pkg.mk, pkg.mkd);
      else if (city === 'md' || city === 'madinah') values.push(pkg.md, pkg.mdd);
      else values.push(pkg.mk, pkg.md, pkg.mkd, pkg.mdd);
    });
    return uniqueText(values.filter(Boolean));
  }
  function searchText(group) {
    if (!group || typeof group !== 'object') return '';
    const values = [brandText(group), airlineText(group), flightText(group), hotelText(group), group.id, group.code, group.no, group.dep, group.ret, group.n, group.seats];
    (Array.isArray(group.pk) ? group.pk : []).forEach(pkg => {
      if (!pkg) return;
      values.push(pkg.id, pkg.mk, pkg.md, pkg.mkd, pkg.mdd, pkg.mkn, pkg.mdn);
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
  function anyQuery(text, queries) {
    return (Array.isArray(queries) ? queries : [queries]).filter(Boolean).some(q => matchesText(text, q));
  }
  function matches(group, filters) {
    if (!group || typeof group !== 'object') return false;
    const f = filters || {}, dep = String(group.dep || '');
    const selectedAir = Array.isArray(f.airs) && f.airs.length ? f.airs : (f.air ? [f.air] : []);
    if (selectedAir.length && !anyQuery(airlineText(group), selectedAir)) return false;
    const selectedBrands = Array.isArray(f.brands) && f.brands.length ? f.brands : (f.brand ? [f.brand] : []);
    if (selectedBrands.length && !anyQuery(brandText(group), selectedBrands)) return false;
    if (f.mon && !dep.startsWith(String(f.mon))) return false;
    if (f.from && dep < String(f.from)) return false;
    if (f.to && dep > String(f.to)) return false;
    if (f.n && String(group.n) !== String(f.n)) return false;
    if (f.avail && !(Number(group.seats) > 0)) return false;
    if (f.flight && !matchesText(flightText(group), f.flight)) return false;
    if (f.mkHotel && !matchesText(hotelText(group, 'mk'), f.mkHotel)) return false;
    if (f.mdHotel && !matchesText(hotelText(group, 'md'), f.mdHotel)) return false;
    if (f.hotel && !matchesText(hotelText(group), f.hotel)) return false;
    const price = minPrice(group), min = Number(f.minPrice) || 0, max = Number(f.maxPrice != null && f.maxPrice !== '' ? f.maxPrice : f.max) || 0;
    if (min && (!price || price < min)) return false;
    if (max && (!price || price > max)) return false;
    if (f.q && !matchesText(searchText(group), f.q)) return false;
    return true;
  }
  function brandOptions(groups) {
    const values = [];
    (Array.isArray(groups) ? groups : []).forEach(group => {
      if (!group) return;
      addObject(values, group, BRAND_KEYS);
      const supplier = group.sup || group.supplier || {};
      addObject(values, supplier, SUPPLIER_META_KEYS);
      addObject(values, group.meezab, SUPPLIER_META_KEYS);
      const src = normalize([group.supplierLabel, group.brand, group.supplier, supplier.src, supplier.source, supplier.code].join(' '));
      if (src.includes('meezab') || /\\bmzb\\b/.test(src) || group.meezab) values.push('Meezab e Qaba');
      (Array.isArray(group.pk) ? group.pk : []).forEach(pkg => {
        if (!pkg) return;
        addObject(values, pkg, BRAND_KEYS);
        addObject(values, pkg && pkg.sup, SUPPLIER_META_KEYS);
      });
    });
    return [...new Set(values.map(v => String(v).trim()).filter(v => v.length > 1 && v.length <= 80))].sort((a, b) => a.localeCompare(b));
  }
  function airlineOptions(groups) {
    const values = [];
    (Array.isArray(groups) ? groups : []).forEach(group => {
    });
    return [...new Set(values.map(v => String(v).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }
  return { normalize, aliases, brandText, airlineText, flightText, hotelText, searchText, matchesText, splitQueries, minPrice, matches, brandOptions, airlineOptions };
});
