'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tus-quote-chat-'));
process.env.DATA_DIR = tmp;
process.env.CRM_TEST_MODE = '1';
process.env.NODE_ENV = 'test';
for (const k of Object.keys(process.env)) if (/^(DB_|MYSQL_|DATABASE_URL$)/.test(k)) delete process.env[k];
const D = require('../lib/db');
const { db } = D;
const { OPS } = require('../lib/ops');
const PM = require('../lib/perms');
const Mail = require('../lib/mailer');
const sent = [];
Mail.send = (event, payload) => { sent.push({ event, ...payload }); return true; };
const Chat = require('../lib/chat');
const admin = { id: 'qa-admin', role: 'admin', name: 'QA Administrator' };
db.settings.calc.pkrPerSar = 80;

function makeQuote(overrides = {}) {
  const base = {
    customer: { name: 'Test Customer ' + Date.now(), phone: '+923001234567', email: 'customer@example.test', address: 'Okara, Pakistan', company: 'Test Family' },
    currency: 'PKR', quoteDate: '2026-11-15', validUntil: '2026-11-30', destination: 'Makkah & Madinah', reference: 'QA-REF', paxCount: 2,
    travellers: [
      { name: 'TEST TRAVELLER ONE', type: 'Adult', passport: 'QA1234567', dob: '1990-01-01', nationality: 'Pakistani', gender: 'M' },
      { name: 'TEST TRAVELLER TWO', type: 'Adult', passport: 'QA7654321', dob: '1992-02-02', nationality: 'Pakistani', gender: 'F' }
    ],
    items: [
      { category: 'hotel', title: 'Makkah Hotel', description: '5 nights', qty: 5, unit: 'night', unitPrice: 100, details: {} },
      { category: 'flight', title: 'Saudia return flights', description: 'ISB-JED return', qty: 2, unit: 'traveller', unitPrice: 300, details: {} },
      { category: 'visa', title: 'Umrah visa', description: 'Family visa processing', qty: 2, unit: 'visa', unitPrice: 100, details: {} },
      { category: 'transport', title: 'Airport transfers', description: 'Private transfer', qty: 1, unit: 'vehicle', unitPrice: 100, details: {} }
    ], discount: 100, taxPct: 0, travelDetails: { hotel: 'Makkah Hotel', city: 'Makkah', checkIn: '2026-12-01', checkOut: '2026-12-06', airline: 'Saudia', flightNo: 'SV723', from: 'ISB', to: 'JED', departureDate: '2026-12-01', returnDate: '2026-12-15', visaType: 'Umrah', entry: 'Multiple', pickup: 'Jeddah Airport', dropoff: 'Makkah Hotel', travelDate: '2026-12-01', vehicle: 'Staria', packageName: 'Custom Umrah Package', duration: '14 nights', itinerary: 'Makkah and Madinah stay' },
    included: ['Hotel accommodation', 'Airport transfers'], excluded: ['Personal expenses'], customFields: [{ label: 'Family head', value: 'Test Customer' }], terms: 'Availability is subject to confirmation.', notes: 'Internal note', status: 'Draft'
  };
  return OPS.saveQuotation(admin, { ...base, ...overrides });
}

// A quotation is stored independently and its full data survives editing.
const saved = makeQuote();
const q = db.quotations.find(x => x.id === saved.id);
assert(q && q.no && q.items.length === 4, 'quotation record saved');
assert.strictEqual(q.travelDetails.hotel, 'Makkah Hotel');
assert.strictEqual(q.items[0].qty, 5, 'hotel room-night quantity is calculated from legacy check-in/check-out dates');
assert.strictEqual(q.items[0].unit, 'room-nights', 'hotel service uses an explicit room-night billing unit');
assert.strictEqual(q.items[0].details.nights, 5, 'hotel night count is persisted on the service line');
assert.deepStrictEqual(q.included, ['Hotel accommodation', 'Airport transfers']);
assert.strictEqual(q.total, 1300, 'subtotal 2000 less discount 100');

// Conversion creates exactly one Pending booking, attaches the quote id and keeps all service kinds.
const converted = OPS.convertQuotationToBooking(admin, { id: q.id });
const booking = db.bookings.find(x => x.id === converted.id);
assert(booking, 'booking created from quotation');
assert.strictEqual(booking.status, 'Pending', 'conversion never bypasses booking approval');
assert.strictEqual(booking.sourceQuotationId, q.id);
assert.strictEqual(booking.sourceQuotationNo, q.no);
assert.strictEqual(booking.partyId, q.partyId, 'existing customer link preserved');
assert.deepStrictEqual(booking.services.map(x => x.type), ['hotel', 'flight', 'visa', 'transport']);
assert.strictEqual(booking.services.reduce((a, x) => a + x.sell, 0), 1300, 'discounted quote total is allocated into booking service value');
assert.strictEqual(booking.services[0].d.hotel, 'Makkah Hotel');
assert.strictEqual(booking.services[1].d.fno, 'SV723');
assert.strictEqual(booking.services[2].d.visaType, 'Umrah');
assert.strictEqual(booking.services[3].d.vehicle, 'Staria');
assert.strictEqual(q.status, 'Converted');
assert.strictEqual(q.bookingId, booking.id);
assert.strictEqual(q.bookingNo, booking.no);
const again = OPS.convertQuotationToBooking(admin, { id: q.id });
assert.strictEqual(again.id, booking.id, 'second conversion returns the same booking');
assert.strictEqual(db.bookings.filter(x => x.sourceQuotationId === q.id).length, 1, 'conversion does not duplicate bookings');
assert.throws(() => OPS.saveQuotation(admin, { id: q.id, ...q }), /already been converted/i);
assert.throws(() => OPS.delQuotation(admin, { id: q.id }), /linked to a booking/i);

// A walk-in quote can create a customer account, but unsupported currency and missing passport block conversion.
const walkIn = makeQuote({ customer: { name: 'Walk-in Test ' + Date.now(), phone: '+923009998877', email: 'walkin@example.test', address: '', company: '' }, partyId: '', currency: 'PKR', travellers: [{ name: 'WALK IN', passport: 'WALK12345', type: 'Adult' }], paxCount: 1 });
const walkQ = db.quotations.find(x => x.id === walkIn.id);
const beforeParties = db.parties.length;
const walkBooking = OPS.convertQuotationToBooking(admin, { id: walkQ.id });
assert(db.parties.length === beforeParties + 1, 'customer account created with conversion');
assert.strictEqual(db.bookings.find(x => x.id === walkBooking.id).partyId, walkQ.partyId);
const usd = makeQuote({ currency: 'USD', customer: { name: 'USD quote', phone: '', email: '', address: '', company: '' }, travellers: [{ name: 'USD PAX', passport: 'USD1234567', type: 'Adult' }], paxCount: 1 });
assert.throws(() => OPS.convertQuotationToBooking(admin, { id: usd.id }), /support PKR and SAR/i);
assert.throws(() => makeQuote({ travelDetails: {}, items: [{ category: 'hotel', title: 'Hotel without dates', qty: 2, unitPrice: 100, details: {} }] }), /valid check-in and a check-out after check-in/i, 'server refuses a hotel quotation with invalid stay dates');
const noPassport = makeQuote({ customer: { name: 'Incomplete quote', phone: '', email: '', address: '', company: '' }, travellers: [{ name: 'NO PASSPORT', passport: '', type: 'Adult' }], paxCount: 1 });
assert.throws(() => OPS.convertQuotationToBooking(admin, { id: noPassport.id }), /name and passport/i);

// Visitor/staff messaging now emits an email notification event for the visitor and stores file metadata.
const started = Chat.start({ name: 'Chat Customer', email: 'chat.customer@example.test', phone: '+923001112233', message: 'I need an Umrah package.' }, '127.0.0.1', 'QA');
const chat = Chat.find(started.id);
assert(chat, 'chat conversation created');
const pdf = Buffer.from('%PDF-1.4\n% test pdf\n%%EOF', 'utf8').toString('base64');
Chat.visitorSend(chat, 'Please see the document.', [{ name: 'customer-file.pdf', mime: 'application/pdf', data: 'data:application/pdf;base64,' + pdf }]);
// Attachments larger than the former 1.5 MB ceiling are accepted up to the new per-file limit.
const larger = Buffer.alloc(3 * 1024 * 1024, 65).toString('base64');
Chat.visitorSend(chat, 'Here is the larger supporting document.', [{ name: 'supporting-document.txt', mime: 'text/plain', data: 'data:text/plain;base64,' + larger }]);
assert.throws(() => Chat.visitorSend(chat, 'Too large', [{ name: 'oversized.txt', mime: 'text/plain', data: 'data:text/plain;base64,' + Buffer.alloc(10 * 1024 * 1024 + 1, 65).toString('base64') }]), /10 MB/i, 'server enforces the new 10 MB per-file limit');
const reply = Chat.staffReply(admin, chat, 'We have received your file and will reply shortly.', [{ name: 'staff-guide.txt', mime: 'text/plain', data: 'data:text/plain;base64,' + Buffer.from('Staff reply attachment').toString('base64') }]);
assert(reply.id > 0);
assert(sent.some(x => x.event === 'chat.reply' && x.to === chat.email), 'staff reply triggers customer email notification when email is available');
assert.strictEqual(chat.unreadVisitor, 1, 'visitor unread badge is raised');

// Download=1 forces an attachment response while the unguessable conversation token remains mandatory.
const registered = {};
const app = { get(k, ...fns) { registered['GET ' + k] = fns[fns.length - 1]; }, post(k, ...fns) { registered['POST ' + k] = fns[fns.length - 1]; }, delete(k, ...fns) { registered['DELETE ' + k] = fns[fns.length - 1]; } };
Chat.mount(app, { auth: (req, res, next) => next(), limit: () => true });
const fileMeta = chat.messages.flatMap(m => m.attachments || []).find(a => a.name === 'customer-file.pdf');
const largeMeta = chat.messages.flatMap(m => m.attachments || []).find(a => a.name === 'supporting-document.txt');
assert(largeMeta && largeMeta.size === 3 * 1024 * 1024, 'visitor attachment over 1.5 MB is stored without truncation');
assert(chat.messages.flatMap(m => m.attachments || []).some(a => a.name === 'staff-guide.txt'), 'staff can send downloadable attachments to visitors');
assert(fileMeta, 'chat file metadata saved');
async function getFile(token, download) {
  const state = { headers: {}, code: 200, body: null };
  const res = { set(h) { Object.assign(state.headers, h); return this; }, sendStatus(n) { state.code = n; return this; }, send(b) { state.body = b; return this; } };
  await registered['GET /api/chat-file/:file']({ params: { file: fileMeta.file }, query: { chat: chat.id, token, download: download ? '1' : '' }, u: null }, res);
  return state;
}
(async () => {
const denied = await getFile('wrong-token', true);
assert.strictEqual(denied.code, 404, 'other visitors cannot download this file');
const download = await getFile(started.token, true);
assert.strictEqual(download.headers['Content-Disposition'].split(';')[0], 'attachment', 'download flag forces download for PDF');
assert(download.body && download.body.length > 0);
const inline = await getFile(started.token, false);
assert.strictEqual(inline.headers['Content-Disposition'].split(';')[0], 'inline', 'PDF preview remains inline unless download requested');

// UI assertions ensure both sides expose downloads, recording and notifications.
const visitorUI = fs.readFileSync(path.join(__dirname, '../public/chat.js'), 'utf8');
const staffUI = fs.readFileSync(path.join(__dirname, '../public/v-chat.js'), 'utf8');
const quoteUI = fs.readFileSync(path.join(__dirname, '../public/v-quote.js'), 'utf8');
assert(visitorUI.includes('Notification.requestPermission') && visitorUI.includes('var beep = function'), 'visitor can enable desktop notifications and sound cues');
assert(visitorUI.includes('Voice') && visitorUI.includes('download=1') && visitorUI.includes('10 MB each') && visitorUI.includes('image/*,audio/*,video/*'), 'visitor can send voice, larger attachments and download files');
assert(staffUI.includes('Enable sound & desktop alerts') && staffUI.includes('download=1') && staffUI.includes('Voice') && staffUI.includes('picked.length >= 4') && staffUI.includes('ch-advanced-chat'), 'staff has desktop alerts, downloads, voice, limits and premium chat styling');
assert(quoteUI.includes('VIEWS.quotations') && quoteUI.includes('Convert to booking') && quoteUI.includes('travelDetails.visaType') && quoteUI.includes('nightCount') && quoteUI.includes('hydrateLegacyHotel') && quoteUI.includes('room-nights'), 'quotation UI supports travel details, hotel nights and conversion action');
const bankUI = fs.readFileSync(path.join(__dirname, '../public/v-bank.js'), 'utf8');
const adminUI = fs.readFileSync(path.join(__dirname, '../public/v-adm.js'), 'utf8');
assert(bankUI.includes('configuredPayMethods') && bankUI.includes('methodFor'), 'payment entry uses the configured payment method list');
assert(adminUI.includes('shown directly on payment forms and printed on receipts'), 'admin payment method settings explain where methods appear');
const serverUI = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
assert(serverUI.includes("express.json({ limit: '45mb' })"), 'request parser can accept a 20 MB attachment batch encoded as base64');
console.log('PASS quotation-chat-test: quote data, one-click conversion, no duplicate bookings, traveller validation, visitor email notification, secure attachment download and UI controls');
try { D.flush(); fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
})().catch(e => { console.error(e); process.exitCode = 1; });
