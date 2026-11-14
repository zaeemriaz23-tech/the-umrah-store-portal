'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PdfParse = require('../public/pdfparse.js');

const lines = [
  'LAT- Example Travel Group', 'Hotel Voucher',
  'IATA: Self Visa By Cux Voucher No: UB-100361 Branch: OKR',
  'Saudi Company: Self Visa Date: 09/11/26',
  'Saudi Company: Self Visa Date: 09/11/26',
  'Package: Custom Manual No: Group #. 0',
  'Family Head: TEST FAMILY HEAD Total PAX: 2 Whatsapp:',
  'Pilgrims Details', 'Mutamer Name Gender PPNO PAX Beds Visa Number PNR',
  'TEST TRAVELLER ONE Male AB1234567 Adult Yes',
  'TEST TRAVELLER TWO Female CD7654321 Adult Yes',
  'Adults: 2 Childs: 0 Infants: 0 Total PAX: 2 Total BEDS: 2',
  'Accommodation Details:',
  'Hotel Name Confirm No City Room Type Meal Plan Check In Checkout Nights',
  'Example Hotel Medinah Sharing (Gender) RO 22/11/26 26/11/26 4',
  'Makkah Makkah Sharing (Gender) RO 26/11/26 06/12/26 10',
  'Example Hotel Medinah Sharing (Gender) RO 06/12/26 12/12/26 6',
  'Total Nights: 20', 'Transport / Services', 'Name Type BRN', 'Self By Moatamar',
  'Departure from Pakistan to KSA Departure from KSA to Pakistan',
  'Flight Sector Departure Arrival Flight Sector Departure Arrival',
  'SV-000 AUH-MED 22-NOV 00:00 22-NOV 00:00 SV-000 MED-AUH 12-DEC 00:00 12-DEC 00:00',
  'Note: 2 PX SHR MED ACC ONLY'
];
const pages = [{ width: 1200, items: lines.map((str, i) => ({ str, x: 0, y: 1000 - i * 10 })) }];
const voucher = PdfParse.parseHotelVoucherFromPages(pages, new Date('2026-11-14T00:00:00Z'));
assert.strictEqual(voucher.voucherNo, 'UB-100361');
assert.strictEqual(voucher.accountName, 'Example Travel Group');
assert.strictEqual(voucher.voucherDate, '2026-11-09');
assert.strictEqual(voucher.iata, 'Self Visa By Cux');
assert.strictEqual(voucher.saudiCompany, 'Self Visa');
assert.strictEqual(voucher.totalBeds, 2);
assert.strictEqual(voucher.pax.length, 2);
assert.strictEqual(voucher.pax[0].pp, 'AB1234567');
assert.strictEqual(voucher.pax[1].g, 'F');
assert.strictEqual(voucher.hotels.length, 3);
assert.deepStrictEqual(voucher.hotels.map(h => h.nights), [4, 10, 6]);
assert.strictEqual(voucher.hotels[1].roomType, 'Sharing (Gender)');
assert.strictEqual(voucher.hotels[1].hotel, '');
assert.strictEqual(voucher.hotels[1].city, 'Makkah');
assert.deepStrictEqual(voucher.legs.map(x => x.date), ['2026-11-22', '2026-12-12']);
assert.deepStrictEqual(voucher.legs.map(x => x.from + '-' + x.to), ['AUH-MED', 'MED-AUH']);
assert.deepStrictEqual(voucher.transport, { name: 'Self', type: 'By Moatamar' });
assert.deepStrictEqual(voucher.warnings, []);

const tus = fs.readFileSync(path.join(__dirname, '../public/v-tus.js'), 'utf8');
const book = fs.readFileSync(path.join(__dirname, '../public/v-book.js'), 'utf8');
const adm = fs.readFileSync(path.join(__dirname, '../public/v-adm.js'), 'utf8');
assert(!/ACT\.bfSave\s*=/.test(tus), 'Brand Filter must not override the booking save action');
assert(/ACT\.brandFilterSave\s*=/.test(tus), 'Brand Filter must have a unique save action');
assert(/ACT\.bfSave\s*=/.test(book), 'Booking form save action must remain registered');
assert(!/ACT\.bkSave\s*=/.test(adm), 'Legacy Settings Banking must not override the new Bank accounts save action');
assert(/ACT\.settingsBkSave\s*=/.test(adm), 'Legacy Settings Banking must use an isolated save action');
console.log('PASS booking-voucher-test: voucher rows, stay dates, flight legs, transport and booking action collision');
