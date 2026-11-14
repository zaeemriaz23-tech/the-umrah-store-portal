'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PdfParse = require('../public/pdfparse.js');

const lines = [
  'Saday Hassan (Umrah)', 'Hotel Voucher',
  'IATA: The Umrah Store - Pakistan (Towa) Voucher No: UB-100347 Branch: OKR',
  'Saudi Company: Towa Umrah Services Date: 04/11/26',
  'Package: Custom Manual No: 134031 Group #. 480901619235',
  'Family Head: Ali Raza Total PAX: 2 Whatsapp: 923245132042',
  'Pilgrims Details', 'Mutamer Name Gender PPNO PAX Beds Visa Number PNR',
  'Ali Raza Male FD9896433 Adult Yes 7R77FB',
  'Perveen Female KA3991182 Adult Yes',
  'Adults: 2 Childs: 0 Infants: 0 Total PAX: 2 Total BEDS: 2',
  'Accommodation Details:',
  'Hotel Name Confirm No City Room Type Meal Plan Check In Checkout Nights',
  'Areej Al Zahbi Makkah Sharing (Gender) RO 18/11/26 24/11/26 6',
  'Ergwan Al Madinah Medinah Sharing (Gender) RO 24/11/26 29/11/26 5',
  'Areej Al Zahbi Makkah Sharing (Gender) RO 29/11/26 02/12/26 3',
  'Total Nights: 14', 'Transport / Services', 'Name Type BRN',
  'Round Trip (Jed-Mak-Med-Mak-Jed) Economy By Bus',
  'Departure from Pakistan to KSA Departure from KSA to Pakistan',
  'Flight Sector Departure Arrival Flight Sector Departure Arrival',
  'SV-723 ISB-JED 18-NOV 10:30 18-NOV 14:20 SV-728 JED-ISB 02-DEC 09:25 02-DEC 16:05',
  'Note:'
]
const pages = [{ width: 1200, items: lines.map((str, i) => ({ str, x: 0, y: 1000 - i * 10 })) }];
const voucher = PdfParse.parseHotelVoucherFromPages(pages, new Date('2026-11-14T00:00:00Z'));
assert.strictEqual(voucher.voucherNo, 'UB-100347');
assert.strictEqual(voucher.accountName, 'Saday Hassan (Umrah)');
assert.strictEqual(voucher.voucherDate, '2026-11-04');
assert.strictEqual(voucher.iata, 'The Umrah Store - Pakistan (Towa)');
assert.strictEqual(voucher.saudiCompany, 'Towa Umrah Services');
assert.strictEqual(voucher.branch, 'OKR');
assert.strictEqual(voucher.manualNo, '134031');
assert.strictEqual(voucher.groupNo, '480901619235');
assert.strictEqual(voucher.whatsapp, '923245132042');
assert.strictEqual(voucher.familyHead, 'Ali Raza');
assert.strictEqual(voucher.totalPax, 2);
assert.strictEqual(voucher.totalBeds, 2);
assert.strictEqual(voucher.counts.adults, 2);
assert.strictEqual(voucher.pax.length, 2);
assert.strictEqual(voucher.pax[0].pp, 'FD9896433');
assert.strictEqual(voucher.pax[0].pnr, '7R77FB');
assert.strictEqual(voucher.pax[0].visaNo, '');
assert.strictEqual(voucher.pax[1].g, 'F');
assert.strictEqual(voucher.hotels.length, 3);
assert.deepStrictEqual(voucher.hotels.map(h => h.hotel), ['Areej Al Zahbi', 'Ergwan Al Madinah', 'Areej Al Zahbi']);
assert.deepStrictEqual(voucher.hotels.map(h => h.city), ['Makkah', 'Madinah', 'Makkah']);
assert.deepStrictEqual(voucher.hotels.map(h => h.nights), [6, 5, 3]);
assert.deepStrictEqual(voucher.hotels.map(h => h.roomType), ['Sharing (Gender)', 'Sharing (Gender)', 'Sharing (Gender)']);
assert.strictEqual(voucher.hotels.reduce((a,h) => a+h.nights, 0), 14);
assert.deepStrictEqual(voucher.legs.map(x => x.date), ['2026-11-18', '2026-12-02']);
assert.deepStrictEqual(voucher.legs.map(x => x.from + '-' + x.to), ['ISB-JED', 'JED-ISB']);
assert.deepStrictEqual(voucher.legs.map(x => x.fno), ['SV-723', 'SV-728']);
assert.deepStrictEqual(voucher.transport, { name: 'Round Trip (Jed-Mak-Med-Mak-Jed)', type: 'Economy By Bus' });
assert.deepStrictEqual(voucher.warnings, []);

const tus = fs.readFileSync(path.join(__dirname, '../public/v-tus.js'), 'utf8');
const book = fs.readFileSync(path.join(__dirname, '../public/v-book.js'), 'utf8');
const adm = fs.readFileSync(path.join(__dirname, '../public/v-adm.js'), 'utf8');
assert(!/ACT\.bfSave\s*=/.test(tus), 'Brand Filter must not override the booking save action');
assert(/ACT\.brandFilterSave\s*=/.test(tus), 'Brand Filter must have a unique save action');
assert(/ACT\.bfSave\s*=/.test(book), 'Booking form save action must remain registered');
assert(!/ACT\.bkSave\s*=/.test(adm), 'Legacy Settings Banking must not override the new Bank accounts save action');
assert(/ACT\.settingsBkSave\s*=/.test(adm), 'Legacy Settings Banking must use an isolated save action');
assert(/voucherMeta:\s*\{/s.test(book), 'Booking form preserves optional voucher metadata');
assert(/hotelId/.test(book) && /priceBasis/.test(book) && /bfNights/.test(book), 'Hotel booking supports inventory match, price basis and night calculation');
console.log('PASS booking-voucher-test: voucher rows, stay dates, flight legs, transport and booking action collision');
