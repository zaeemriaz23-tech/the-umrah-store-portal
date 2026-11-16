'use strict';
const assert = require('assert');
const F = require('../public/group-filter');
const group = {
  id: 'UG-100616', code: 'MZB-616', air: 'PF', airline: 'PF-AirSial Meezab e Kaba',
  supplierLabel: 'Meezab e Qaba', supplierRef: 'MZB-616', sup: { src: 'meezab', code: 'MZB' },
  dep: '2026-11-19', ret: '2026-12-07', n: 18, seats: 9,
  out: { fn: 'PF 718', from: 'ISB', to: 'JED' }, inb: { fn: 'PF 719', from: 'JED', to: 'ISB' },
  pk: [{ id: 'UP-1', mk: 'Arfat Zahbi / Fakhir al Azizia', md: 'Hala Taibah', p: { sh: 262000, qd: 268500, tr: 275500, db: 289000 } }]
};
assert(F.matches(group, { brand: 'AirSial' }), 'matches displayed AirSial brand');
assert(F.matches(group, { brand: 'Air Sial' }), 'matches spacing variation Air Sial');
assert(F.matches(group, { brand: 'Meezab e Qaba' }), 'matches supplier label');
assert(F.matches(group, { brand: 'MZB' }), 'matches supplier alias MZB');
assert(F.matches(group, { brand: 'AirSial Meezab e Kaba' }), 'matches combined carrier and supplier phrase');
assert(F.matches(group, { brand: 'MZB, QR' }), 'comma-separated alternatives behave as OR');
assert(F.matches(group, { q: 'PF 718 Arfat Zahbi' }), 'multiword general search matches flight and hotel');
assert(F.matches(group, { q: 'UG-100616' }), 'general search matches group reference');
assert(F.matches(group, { air: 'PF' }), 'airline code facet matches');
assert(F.matches(group, { air: 'AirSial' }), 'airline name facet matches');
assert(F.matches(group, { max: 300000 }), 'maximum price matches');
assert(!F.matches(group, { max: 250000 }), 'maximum price excludes expensive groups');
assert(F.matches(group, { minPrice: 260000 }), 'minimum price matches');
assert(!F.matches(group, { minPrice: 270000 }), 'minimum price excludes cheaper groups');
assert(F.matches(group, { mon: '2026-11', n: 18, avail: true }), 'month, nights and availability compose');
assert(!F.matches(group, { mon: '2026-12' }), 'month facet excludes different month');
assert(F.brandOptions([group]).some(x => x === 'Meezab e Qaba'), 'brand suggestions include supplier label');
assert(F.brandOptions([group]).some(x => x === 'MZB'), 'brand suggestions include MZB alias');
console.log('Group filter regression tests passed (18 assertions).');
