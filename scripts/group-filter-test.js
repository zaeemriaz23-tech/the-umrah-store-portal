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
assert(F.matches(group, { brands: ['Meezab e Kaba', 'AirSial'] }), 'multiple selected brands act as OR alternatives');
assert(F.matches(group, { airs: ['SV', 'PF'] }), 'multiple airline chips act as OR alternatives');
assert(!F.matches(group, { airs: ['SV', 'QR'] }), 'airline multi-select excludes unrelated airlines');
assert(F.matches(group, { flight: 'PF 718' }), 'flight number filter searches outbound flight');
assert(F.matches(group, { flight: 'ISB JED' }), 'flight route filter searches airport codes');
assert(F.matches(group, { hotel: 'Hala Taibah' }), 'any-hotel filter searches hotel inventory');
assert(F.matches(group, { mkHotel: 'Arfat Zahbi' }), 'Makkah hotel filter searches Makkah hotel only');
assert(F.matches(group, { mdHotel: 'Hala Taibah' }), 'Madinah hotel filter searches Madinah hotel only');
assert(!F.matches(group, { mkHotel: 'Hala Taibah' }), 'Madinah hotel does not incorrectly match Makkah-only filter');
assert(F.matches(group, { from: '2026-11-19', to: '2026-11-19' }), 'inclusive departure date range matches boundary');
assert(!F.matches(group, { from: '2026-11-20' }), 'departure from date excludes earlier departures');
assert(F.matches(group, { minPrice: 262000, maxPrice: 262000 }), 'minimum and maximum price accept exact boundary');
assert(!F.matches(group, { minPrice: 262001 }), 'minimum price excludes lower-priced group');
assert(!F.matches(group, { maxPrice: 261999 }), 'maximum price excludes higher-priced group');
assert(F.brandOptions([group]).some(x => x === 'AirSial'), 'airline brand suggestion is separately selectable');
assert(F.brandOptions([group]).some(x => x === 'Meezab e Kaba'), 'displayed Meezab e Kaba alias is suggested');
console.log('Group filter regression tests passed (34 assertions).');
