'use strict';
// Verify generated voucher documents keep the brand lines separate and the pending mark print-visible.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) { if (request === 'qrcode') return { toString: async () => '<svg aria-label=\"test qr\"></svg>' }; return originalLoad.call(this, request, parent, isMain); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tus-voucher-brand-'));
process.env.DATA_DIR = tmp;
process.env.CRM_TEST_MODE = '1';
process.env.NODE_ENV = 'test';
for (const k of Object.keys(process.env)) if (/^(DB_|MYSQL_|DATABASE_URL$)/.test(k)) delete process.env[k];
const D = require('../lib/db');
const R = require('../lib/render');
const { db } = D;
db.settings.company = {
  ...db.settings.company,
  name: 'The Umrah Store',
  tagline: 'Premium Islamic Travel',
  address: 'Branches: Lahore · Okara · Islamabad',
  phone: '+92 313 693 5568',
  email: 'info@theumrahstore.com',
  website: 'www.theumrahstore.com'
};
db.bookings = [{
  id:'brand-test-booking', no:'TUS-BRAND-001', partyId:null, category:'Umrah', status:'Pending',
  pax:[{n:'TEST PILGRIM',pp:'TEST12345',g:'M',t:'Adult',nat:'Pakistani',beds:true}],
  services:[{id:'h1',type:'hotel',title:'Makkah Hotel',qty:1,sell:100,from:'2026-12-01',to:'2026-12-06',cs:'Requested',d:{hotel:'Makkah Hotel',city:'Makkah',cin:'2026-12-01',cout:'2026-12-06',rooms:1,room:'Quad'}}],
  notes:'', createdAt:'2026-11-15T10:00:00.000Z', from:'2026-12-01', to:'2026-12-15', voucherMeta:{}
}];
(async () => {
  const html = await R.voucherHtml({ token:'brand-test-token', bookingId:'brand-test-booking', kind:'all', no:'VOUCHER-001', createdAt:'2026-11-15T10:00:00.000Z' }, { protocol:'https', get:()=> 'example.test' });
  assert(html.includes('<div class="brand-name">The Umrah Store</div><div class="brand-tagline">Premium Islamic Travel</div>'), 'brand name and tagline are separate block elements');
  assert(html.includes('.hd .brandline{display:block!important'), 'brand line is force-stacked vertically');
  assert(html.includes('margin:0 0 7px!important'), 'visible spacing separates brand name from tagline');
  assert(!html.includes('Branches: Lahore'), 'branch list is not injected into voucher letterhead');
  assert(html.includes('PENDING · NOT FOR TRAVEL'), 'pending voucher carries the correct travel restriction');
  assert(html.includes('rgba(143,27,39,.43)'), 'pending watermark has strong visible screen and print contrast');
  assert(html.includes('print-color-adjust:exact'), 'watermark appearance is retained in print output');
  assert(html.includes('Pending approval'), 'pending approval status remains visible');
  assert(html.includes('Payment Pending') && html.includes('Hotel Pending'), 'voucher shows short payment and service status notes');
  db.bookings[0].status = 'Confirmed'; db.bookings[0].approvedBy = 'Admin'; db.bookings[0].approvedAt = '2026-11-15T11:00:00.000Z';
  const approved = await R.voucherHtml({ token:'brand-test-token', bookingId:'brand-test-booking', kind:'all', no:'VOUCHER-001', createdAt:'2026-11-15T10:00:00.000Z' }, { protocol:'https', get:()=> 'example.test' });
  assert(approved.includes('class="wm ok">APPROVED</div>'), 'approved voucher also carries visible APPROVED watermark');
  assert(approved.includes('class="st ok">Approved</span>'), 'approved voucher carries approved status pill');
  console.log('PASS voucher-branding-test: vertically separated brand, no branch clutter, pending notes, and pending/approved watermark states');
})().catch(e => { console.error(e); process.exitCode = 1; });
