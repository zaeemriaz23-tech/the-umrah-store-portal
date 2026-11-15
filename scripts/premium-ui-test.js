'use strict';
const assert = require('assert');
const fs = require('fs');
const read = f => fs.readFileSync(f, 'utf8');
const index = read('public/index.html');
const css = read('public/premium.css');
const adm = read('public/v-adm.js');
const render = read('lib/render.js');
assert.match(index, /href="\/premium\.css\?v=328"/, 'premium UI layer loads after the existing CRM design system');
for (const token of ['--p-green-strong', '.side .nx.on', '.page{', '.tw{', '@media(max-width:600px)', '.ac-hero', '.ac-metrics', '.ac-panel']) {
  assert.ok(css.includes(token), 'premium UI includes ' + token);
}
assert.match(css, /overscroll-behavior-x:contain/, 'tables contain horizontal scrolling');
assert.match(css, /prefers-reduced-motion/, 'reduced motion preference is respected');
assert.match(render, /class="sheet receipt-sheet"/, 'receipts receive a dedicated polished document style');
for (const token of ['.receipt-sheet .meta>div:last-child', '.sheet table.t', '@media print', 'break-inside:avoid', 'overflow-wrap:anywhere']) {
  assert.ok(render.includes(token), 'voucher/receipt layout includes ' + token);
}
assert.match(adm, /VIEWS\.admin/, 'existing Admin Centre implementation remains present');
console.log('PASS premium-ui-test: loaded theme, responsive controls, tables, Admin Centre and voucher/receipt print refinements');
