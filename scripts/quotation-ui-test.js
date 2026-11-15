'use strict';
// Regression-test the real quotation UI module in a small browser-global harness.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const htmlSafe = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
let printedHtml = '';
const c = {
  console, window: { open() { return { document: { open(){}, write(v){ printedHtml = v; }, close(){} } }; } },
  S: { user: { role:'admin' }, company:{ name:'The Umrah Store', tagline:'Premium Islamic Travel' }, quotations:[], parties:[] },
  ACT:{}, INP:{}, CHG:{}, VIEWS:{},
  esc:htmlSafe, fld:(label, inner)=>`<label>${htmlSafe(label)}${inner}</label>`,
  opts:(list, selected, blank)=>`${blank != null ? `<option value="">${htmlSafe(blank)}</option>` : ''}${list.map(o=>{const [v,l]=Array.isArray(o)?o:[o,o];return `<option value="${htmlSafe(v)}" ${String(v)===String(selected)?'selected':''}>${htmlSafe(l)}</option>`;}).join('')}`,
  ic:()=>'', isStaff:()=>true, can:()=>true, todayISO:()=> '2026-11-15',
  badge:s=>`<b>${htmlSafe(s)}</b>`, empty:()=>'<div></div>', fdate:v=>String(v||''),
  go:()=>{}, toast:()=>{}, busy:()=>{}, debounce:fn=>fn,
  $:()=>null, renderView:()=>{ c.lastHtml = c.VIEWS.quotationform.render('new'); },
  rpc:async(op,p)=>{ c.savedPayload={op,...p}; return {id:'qt-new-1',no:'TUS-Q-20261115-00001'}; }, refresh:async()=>{},
  confirmBox:async()=>true
};
vm.createContext(c);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/v-quote.js'),'utf8'), c, { filename:'public/v-quote.js' });

(async () => {
  c.lastHtml = c.VIEWS.quotationform.render('new');
  assert(c.lastHtml.includes('No services added yet'), 'new quote starts without a confusing blank billable line');
  c.INP.qtField('Faheem Test Customer', { dataset:{ k:'customer.name' } });
  c.INP.qtField('+923001234567', { dataset:{ k:'customer.phone' } });

  // First line is added intentionally; service and traveller changes preserve the in-progress quote.
  c.ACT.qtAddItem();
  assert(c.lastHtml.includes('Faheem Test Customer'), 'adding the first service preserves customer details');
  assert.strictEqual((c.lastHtml.match(/class="qt-item"/g)||[]).length, 1);
  c.INP.qtItem('Custom Umrah Package', { dataset:{ i:'0', k:'title' } });
  c.INP.qtItemNum('250', { dataset:{ i:'0', k:'unitPrice' }, closest:()=>({querySelector:()=>null}) });
  c.ACT.qtAddItem();
  assert.strictEqual((c.lastHtml.match(/class="qt-item"/g)||[]).length, 2, 'adding another service preserves the first service');
  c.CHG.qtItem('hotel', { dataset:{ i:'1', k:'category' } });
  assert(c.lastHtml.includes('class="qt-hotel-fields"'), 'hotel category exposes stay details');
  c.INP.qtItem('Makkah Clock Tower Hotel', { dataset:{ i:'1', k:'title' } });

  const nodes = {
    '[data-k=qty]': { value:'' }, '[data-k=unit]': { value:'' },
    '.qt-line-total b': { textContent:'' }, '.qt-hotel-title b': { textContent:'' },
    '.qt-hotel-hint': { textContent:'' }
  };
  const card = { querySelector(selector){ return nodes[selector] || null; } };
  const hotelChange = (key, value) => c.CHG.qtHotel(value, { dataset:{ i:'1', k:key }, closest:()=>card });
  hotelChange('city','Makkah');
  hotelChange('checkIn','2026-12-01');
  hotelChange('checkOut','2026-12-06');
  hotelChange('rooms','2');
  c.INP.qtItemNum('100', { dataset:{ i:'1', k:'unitPrice' }, closest:()=>({ querySelector:selector=>nodes[selector] || null }) });
  c.lastHtml = c.VIEWS.quotationform.render('new');
  assert(c.lastHtml.includes('5 night(s) · 2 room(s)'), 'hotel stay must show five nights and two rooms');
  assert(c.lastHtml.includes('value="10"'), 'hotel quantity must equal nights multiplied by rooms');
  assert(c.lastHtml.includes('PKR 1,000.00'), 'hotel line amount must equal room-nights multiplied by nightly rate');
  assert(nodes['.qt-line-total b'].textContent.includes('1,000.00'), 'hotel line total updates immediately');

  c.ACT.qtAddTraveller();
  assert.strictEqual((c.lastHtml.match(/class="qt-trav"/g)||[]).length, 2, 'adding a traveller preserves existing traveller details');
  c.ACT.qtAddCustom();
  assert(c.lastHtml.includes('Additional custom fields'), 'custom fields section remains available after re-render');

  await c.ACT.qtSave();
  assert(c.savedPayload && c.savedPayload.op === 'saveQuotation', 'save action calls saveQuotation');
  assert.strictEqual(c.savedPayload.customer.name, 'Faheem Test Customer');
  assert.strictEqual(c.savedPayload.items.length, 2, 'blank placeholders are not sent as billable services');
  assert.strictEqual(c.savedPayload.items[1].title, 'Makkah Clock Tower Hotel');
  assert.strictEqual(c.savedPayload.items[1].category, 'hotel');
  assert.strictEqual(c.savedPayload.items[1].qty, 10);
  assert.strictEqual(c.savedPayload.items[1].unit, 'room-nights');
  assert.strictEqual(c.savedPayload.travellers.length, 2);

  // An edited quotation must print the current in-memory values, never a stale server snapshot.
  c.S.quotations = [{ id:'qt-new-1', no:'TUS-Q-OLD', customer:{name:'OLD SAVED CUSTOMER'}, items:[], currency:'PKR', travellers:[] }];
  c.INP.qtField('Current unsaved customer name', { dataset:{ k:'customer.name' } });
  c.ACT.qtPrint();
  assert(printedHtml.includes('Current unsaved customer name'), 'print uses current editor values, including unsaved edits');
  assert(!printedHtml.includes('OLD SAVED CUSTOMER'), 'print does not use stale saved quotation data');
  assert(printedHtml.includes('Check-in') && printedHtml.includes('Check-out') && printedHtml.includes('5'), 'hotel quotation print includes night stay facts');
  console.log('PASS quotation-ui-test: intentional service lines, draft retention, hotel nights and pricing, safe save payload, and current-state print output');
})().catch(e => { console.error(e); process.exitCode = 1; });
