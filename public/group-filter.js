/* Shared group-package filtering. Airline names/codes are kept separate from supplier metadata. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TUSGroupFilter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const AIRLINES = {
    PF: 'AirSial', SV: 'Saudia', PK: 'PIA', EK: 'Emirates', QR: 'Qatar Airways',
    EY: 'Etihad Airways', TK: 'Turkish Airlines', WY: 'Oman Air', GF: 'Gulf Air',
    KU: 'Kuwait Airways', SQ: 'Singapore Airlines', ER: 'SereneAir', PA: 'AirBlue',
    '9P': 'Fly Jinnah', XY: 'flynas', F3: 'flyadeal', FZ: 'flydubai',
    G9: 'Air Arabia', J9: 'Jazeera Airways', MS: 'EgyptAir', AI: 'Air India',
    MH: 'Malaysia Airlines', TG: 'Thai Airways', BG: 'Biman', UL: 'SriLankan',
    RJ: 'Royal Jordanian', ET: 'Ethiopian'
  };
  const normalize = value => String(value == null ? '' : value)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const uniqueText = values => [...new Set(values.map(v => String(v).trim()).filter(Boolean))].join(' ');
  function airlineText(group) {
    if (!group) return '';
    const code = String(group.air || '').trim().toUpperCase();
    // Prefer the canonical carrier name derived from its IATA code; never use supplier suffixes.
    return uniqueText([code, AIRLINES[code] || code].filter(Boolean));
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
    const values = [airlineText(group), flightText(group), hotelText(group),
      group.id, group.code, group.no, group.dep, group.ret, group.n, group.seats];
    (Array.isArray(group.pk) ? group.pk : []).forEach(pkg => {
      if (!pkg) return;
      values.push(pkg.id, pkg.mk, pkg.md, pkg.mkd, pkg.mdd, pkg.mkn, pkg.mdn);
      const prices = pkg.p && typeof pkg.p === 'object' ? pkg.p : {};
      Object.values(prices).forEach(v => values.push(v));
    });
    return uniqueText(values);
  }
  function splitQueries(value) {
    return String(value == null ? '' : value).split(/[,;|\n\r]+/).map(normalize).filter(Boolean);
  }
  function matchesText(text, query) {
    const haystack = normalize(text);
    if (!haystack) return false;
    return splitQueries(query).some(phrase => {
      const words = phrase.split(/\s+/).filter(Boolean);
      return words.length > 0 && words.every(word => haystack.includes(word));
    });
  }
  function minPrice(group) {
    const values = [];
    (Array.isArray(group && group.pk) ? group.pk : []).forEach(pkg => {
      const prices = pkg && pkg.p && typeof pkg.p === 'object' ? pkg.p : {};
      Object.values(prices).forEach(value => {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) values.push(n);
      });
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
    if (f.mon && !dep.startsWith(String(f.mon))) return false;
    if (f.from && dep < String(f.from)) return false;
    if (f.to && dep > String(f.to)) return false;
    if (f.n && String(group.n) !== String(f.n)) return false;
    if (f.avail && !(Number(group.seats) > 0)) return false;
    if (f.flight && !matchesText(flightText(group), f.flight)) return false;
    if (f.mkHotel && !matchesText(hotelText(group, 'mk'), f.mkHotel)) return false;
    if (f.mdHotel && !matchesText(hotelText(group, 'md'), f.mdHotel)) return false;
    if (f.hotel && !matchesText(hotelText(group), f.hotel)) return false;
    const price = minPrice(group), min = Number(f.minPrice) || 0;
    const max = Number(f.maxPrice != null && f.maxPrice !== '' ? f.maxPrice : f.max) || 0;
    if (min && (!price || price < min)) return false;
    if (max && (!price || price > max)) return false;
    if (f.q && !matchesText(searchText(group), f.q)) return false;
    return true;
  }
  function airlineOptions(groups) {
    const values = [];
    (Array.isArray(groups) ? groups : []).forEach(group => {
      if (group && group.air) values.push(String(group.air).trim().toUpperCase());
    });
    return [...new Set(values.filter(Boolean))].sort((a, b) =>
      (AIRLINES[a] || a).localeCompare(AIRLINES[b] || b));
  }
  return { AIRLINES, normalize, airlineText, flightText, hotelText, searchText,
    splitQueries, matchesText, minPrice, matches, airlineOptions };
});
