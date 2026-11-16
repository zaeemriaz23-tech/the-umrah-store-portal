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
assert.strictEqual(F.airlineText(group), 'PF AirSial', 'AirSial canonical airline label ignores supplier suffixes');
assert(F.matches(group, { air: 'PF' }), 'airline code facet matches');
assert(F.matches(group, { air: 'AirSial' }), 'canonical AirSial name matches airline facet');
assert(F.matches(group, { airs: ['SV', 'PF'] }), 'multiple airline selections act as OR');
assert(!F.matches(group, { airs: ['SV', 'QR'] }), 'unselected airlines are excluded');
assert(F.airlineOptions([group]).includes('PF'), 'airline options use airline code PF');
assert.strictEqual(F.AIRLINES.PF, 'AirSial', 'PF airline code is labelled AirSial');
assert(!F.matches(group, { air: 'Meezab' }), 'supplier name cannot match airline facet');
assert(!F.matches(group, { air: 'MZB' }), 'supplier code cannot match airline facet');
assert(F.matches(group, { q: 'PF 718 Arfat Zahbi' }), 'general search matches route and hotel');
assert(F.matches(group, { q: 'UG-100616' }), 'general search matches group reference');
assert(!F.matches(group, { q: 'Meezab e Qaba' }), 'hidden supplier metadata is not part of general search text');
assert(F.matches(group, { max: 300000 }), 'maximum price matches');
assert(!F.matches(group, { max: 250000 }), 'maximum price excludes expensive groups');
assert(F.matches(group, { minPrice: 260000 }), 'minimum price matches');
assert(!F.matches(group, { minPrice: 270000 }), 'minimum price excludes cheaper groups');
assert(F.matches(group, { mon: '2026-11', n: 18, avail: true }), 'month, nights and availability compose');
assert(!F.matches(group, { mon: '2026-12' }), 'month excludes other month');
assert(F.matches(group, { flight: 'PF 718' }), 'flight number filter searches outbound flight');
assert(F.matches(group, { flight: 'ISB JED' }), 'flight route filter searches airport codes');
assert(F.matches(group, { hotel: 'Hala Taibah' }), 'any-hotel filter searches hotel inventory');
assert(F.matches(group, { mkHotel: 'Arfat Zahbi' }), 'Makkah hotel filter searches Makkah only');
assert(F.matches(group, { mdHotel: 'Hala Taibah' }), 'Madinah hotel filter searches Madinah only');
assert(!F.matches(group, { mkHotel: 'Hala Taibah' }), 'Madinah hotel does not match Makkah-only filter');
assert(F.matches(group, { from: '2026-11-19', to: '2026-11-19' }), 'inclusive date boundary matches');
assert(!F.matches(group, { from: '2026-11-20' }), 'date lower bound excludes earlier departures');
assert(F.matches(group, { minPrice: 262000, maxPrice: 262000 }), 'price boundaries are inclusive');
assert(!F.matches(group, { minPrice: 262001 }), 'minimum price excludes lower result');
assert(!F.matches(group, { maxPrice: 261999 }), 'maximum price excludes higher result');
console.log('Group airline/filter regression tests passed (29 assertions).');
