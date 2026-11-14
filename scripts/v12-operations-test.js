'use strict';
const assert = require('assert');
const fs = require('fs');
const read = f => fs.readFileSync(require('path').join(__dirname, '..', f), 'utf8');
const css = read('public/premium.css');
const book = read('public/v-book.js');
const inv = read('public/v-inv.js');
const db = read('lib/ops.js');
const render = read('lib/render.js');
const admin = read('public/v-adm.js');
const acc = read('public/v-acc.js');
for (const token of ['.wide-ledger-page', '.ledger-kpis', '.ledger-tw', '.ledger-skeleton-kpis', '@keyframes tusShimmer', '.hotel-admin-thumb', '.hotel-image-editor', '.hotel-nights-strip', '.voucher-import-facts', '.ac-tools']) {
  assert.ok(css.includes(token), 'operations design includes ' + token);
}
for (const token of ['voucherMeta.iata', 'voucherMeta.saudiCompany', 'voucherMeta.branch', 'bfNights', 'syncHotelUnits', 'data-chg="bHotelPick"', 'pax-bed']) {
  assert.ok(book.includes(token), 'booking workflow includes ' + token);
}
assert.match(inv, /data-chg="heImg"/, 'hotel inventory supports compressed photo uploads');
assert.match(db, /totalPax:\s*Math\.max/, 'voucher total passenger count is retained as booking metadata');
assert.match(render, /Accommodation Details/, 'print voucher includes accommodation section');
assert.match(render, /Total Nights/, 'print voucher totals accommodation nights');
assert.match(render, /hv-hotel-thumb/, 'print voucher can show saved hotel photographs');
assert.match(book, /booking-hotel-image/, 'booking detail shows a saved hotel photograph');
assert.match(book, /CHG\.bchk = \(v, t\) => \{ setPath\(BF, t\.dataset\.p, v\)/, 'nested traveller bed checkbox updates its correct field');
assert.match(render, /Pilgrims Details/, 'print voucher includes traveller section');
assert.match(admin, /Accounts &amp; ledgers/, 'admin centre includes ledger controls');
assert.match(admin, /Hotel &amp; transport inventory/, 'admin centre includes hotel inventory');
assert.match(acc, /Export CSV/, 'ledger supports statement export');
console.log('PASS v12-operations-test: wide ledger, loading skeletons, booking details, hotel imagery, admin access and voucher layout');
