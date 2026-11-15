'use strict';
// Isolated integration test: native SAR inputs, PKR accounting snapshots and legacy PKR safety.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tus-currency-test-'));
process.env.DATA_DIR = tmp;
process.env.CRM_TEST_MODE = '1';
process.env.NODE_ENV = 'test';
for (const k of Object.keys(process.env)) if (/^(DB_|MYSQL_|DATABASE_URL$)/.test(k)) delete process.env[k];
const D = require('../lib/db');
const { OPS } = require('../lib/ops');
const { db } = D;
const admin = { id: 'admin', role: 'admin', name: 'Currency Test Admin' };
db.settings.calc.pkrPerSar = 75;
db.parties.push({ id: 77, kind: 'agent', name: 'Currency Test Agent', active: true, opening: 0, limit: 1000000 });
const pax = [{ n: 'TEST TRAVELLER', pp: 'TEST12345', nat: 'Pakistani', g: 'M', t: 'Adult', beds: true }];
const service = { type: 'hotel', title: 'Test Makkah Stay', qty: 1, sell: 0, cost: 0, sellCurrency: 'SAR', sellAmount: 123.45, costCurrency: 'SAR', costAmount: 80.25, d: { city: 'Makkah', hotel: 'Test Hotel', cin: '2026-12-01', cout: '2026-12-03', room: 'Double' } };
const created = OPS.saveBooking(admin, { partyId: 77, category: 'Accommodation Only', pax, services: [service], notes: '' });
let b = db.bookings.find(x => x.id === created.id), svc = b.services[0];
assert.strictEqual(svc.sell, 9259, 'SAR sell converted to PKR base, rounded once');
assert.strictEqual(svc.cost, 6019, 'SAR cost converted to PKR base');
assert.strictEqual(svc.sellCurrency, 'SAR');
assert.strictEqual(svc.sellAmount, 123.45, 'native SAR decimals retained');
assert.strictEqual(svc.sellFxRate, 75, 'sell FX snapshot retained');
assert.strictEqual(svc.costAmount, 80.25, 'native SAR cost decimals retained');

// A change to booking notes must not revalue the existing SAR service at a newer FX rate.
db.settings.calc.pkrPerSar = 80;
OPS.saveBooking(admin, { id: b.id, partyId: 77, category: b.category, pax, services: JSON.parse(JSON.stringify(b.services)), notes: 'Internal edit without price change' });
b = db.bookings.find(x => x.id === created.id); svc = b.services[0];
assert.strictEqual(svc.sell, 9259, 'unchanged booking price preserves its PKR base');
assert.strictEqual(svc.sellFxRate, 75, 'unchanged booking price preserves its original FX snapshot');

// A genuinely changed native price uses the current office rate and a new snapshot.
const editedServices = JSON.parse(JSON.stringify(b.services));
editedServices[0].sellAmount = 130.12;
OPS.saveBooking(admin, { id: b.id, partyId: 77, category: b.category, pax, services: editedServices, notes: b.notes });
b = db.bookings.find(x => x.id === created.id); svc = b.services[0];
assert.strictEqual(svc.sell, 10410, 'changed SAR price converts at the current office rate');
assert.strictEqual(svc.sellFxRate, 80, 'changed SAR price gets the current FX snapshot');

// Native SAR payment is recorded alongside the canonical PKR accounting amount.
const pay = OPS.addPayment(admin, { partyId: 77, currency: 'SAR', currencyAmount: 50.25, amt: 4020, method: 'Bank transfer' });
const payment = db.payments.find(x => x.id === pay.id);
assert.strictEqual(payment.amt, 4020);
assert.strictEqual(payment.currency, 'SAR');
assert.strictEqual(payment.currencyAmount, 50.25);
assert.strictEqual(payment.currencyFxRate, 80);

// Native SAR query quotes convert to the same PKR ledger base and carry their FX snapshot.
db.queries.push({ id: 'q-currency', no: 'Q-CURRENCY', status: 'Open' });
OPS.respondQuery(admin, { id: 'q-currency', currency: 'SAR', currencyAmount: 10.55, amt: 844, text: 'Hotel quote' });
const quote = db.queries.find(x => x.id === 'q-currency').resp;
assert.strictEqual(quote.amt, 844);
assert.strictEqual(quote.currency, 'SAR');
assert.strictEqual(quote.currencyAmount, 10.55);
assert.strictEqual(quote.currencyFxRate, 80);

// Legacy PKR calls remain PKR and do not need the SAR conversion rate.
const legacy = OPS.addPayment(admin, { partyId: 77, amt: 2500, method: 'Cash' });
const lp = db.payments.find(x => x.id === legacy.id);
assert.strictEqual(lp.amt, 2500);
assert.strictEqual(lp.currency, 'PKR');
assert.strictEqual(lp.currencyAmount, 2500);
// Old clients that only send the historical PKR `sell` or `amt` field keep PKR semantics.
const legacyBooking = OPS.saveBooking(admin, { partyId: 77, category: 'Custom', pax: [{ ...pax[0], pp: 'LEGACY1234' }], services: [{ type: 'other', title: 'Legacy service', qty: 1, sell: 2500, sellCurrency: 'SAR', sellAmount: '', cost: 0, costCurrency: 'SAR', costAmount: '', d: {} }] });
const lb = db.bookings.find(x => x.id === legacyBooking.id).services[0];
assert.strictEqual(lb.sell, 2500, 'legacy amount-only booking remains PKR base');
assert.strictEqual(lb.sellCurrency, 'PKR', 'legacy amount-only booking does not get mislabeled SAR');

const savedFx = db.settings.calc.pkrPerSar; db.settings.calc.pkrPerSar = 0;
assert.throws(() => OPS.addPayment(admin, { partyId: 77, currency: 'SAR', currencyAmount: 10, amt: 0, method: 'Bank transfer' }), /SAR.*rate/i, 'SAR payment is blocked without office FX rather than posting zero');
db.settings.calc.pkrPerSar = savedFx;

const fsRead = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const bankUI = fsRead('public/v-bank.js'), quoteUI = fsRead('public/v-qry.js'), extras = fsRead('public/extras.js'), render = fsRead('lib/render.js'), bookUI = fsRead('public/v-book.js');
assert.match(bankUI, /data-chg="pyCurrency"/, 'payment form has SAR/PKR selector');
assert.match(bankUI, /currencyAmount: val\('py-a'\)/, 'payment form sends original amount');
assert.match(quoteUI, /data-chg="qrCurrency"/, 'quote form has SAR/PKR selector');
assert.match(extras, /tus\.currency-default-v13/, 'SAR is the one-time default display currency');
assert.match(render, /Ledger equivalent:/, 'receipt shows native amount and PKR equivalent');
assert.match(bookUI, /Original sale price:/, 'booking detail preserves and shows the native service price');
console.log('PASS currency-native-test: SAR booking/payment/quote input, PKR base conversion, decimal halala precision, FX snapshots and unchanged historical amounts');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
