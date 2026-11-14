'use strict';
const QRCode = require('qrcode');
const D = require('./db');
const { db, party } = D;
const L = require('./ledger');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fd = iso => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); if (!y) return ''; return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${String(d).padStart(2, '0')} ${MON[m - 1]} ${y}`; };
const fdt = iso => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: db.settings.tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); } catch { return iso; } };
const money = n => 'PKR ' + Math.round(+n || 0).toLocaleString('en-US');
const nights = (a, b) => { if (!a || !b) return 0; const t = x => { const [y, m, d] = x.split('-').map(Number); return Date.UTC(y, m - 1, d); }; return Math.max(0, Math.round((t(b) - t(a)) / 864e5)); };
const logoUrl = () => '/brand/logo?v=' + (db.settings.logoV || 0);
const origin = req => db.settings.baseUrl || (req.protocol + '://' + req.get('host'));

const CSS = `
:root{--g9:#073526;--g7:#126047;--g5:#1f9a70;--au:#b8902f;--au2:#e9d9a6;--ink:#13201a;--mute:#66736c;--line:#e3e0d5;--bg:#eceae2;--red:#b42318}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Manrope','Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif;color:var(--ink);background:var(--bg);font-size:12.5px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bar{position:sticky;top:0;z-index:9;background:#fff;border-bottom:1px solid var(--line);padding:10px 16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.bar b{margin-right:auto;font-size:13px}.bar button,.bar a{border:1px solid var(--line);background:#fff;border-radius:9px;padding:8px 14px;font:600 12.5px inherit;cursor:pointer;color:var(--ink);text-decoration:none}
.bar .pri{background:var(--g9);border-color:var(--g9);color:#fff}
.sheet{position:relative;width:210mm;min-height:297mm;margin:18px auto;background:#fff;padding:13mm 14mm 12mm;box-shadow:0 8px 40px rgba(7,53,38,.15);overflow:hidden}
.wm{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%) rotate(-28deg);font:800 118px/1 Georgia,serif;letter-spacing:.06em;color:rgba(180,35,24,.13);border:10px solid rgba(180,35,24,.13);padding:6px 36px;border-radius:18px;pointer-events:none;white-space:nowrap;z-index:5;user-select:none}
.wm.cx{color:rgba(90,90,90,.16);border-color:rgba(90,90,90,.16)}
.hd{display:flex;align-items:center;gap:18px;padding-bottom:12px;border-bottom:3px solid var(--g9);position:relative}
.hd::after{content:"";position:absolute;left:0;bottom:-6px;width:100%;height:2px;background:linear-gradient(90deg,var(--au),var(--au2),var(--au))}
.hd img{height:72px;width:auto;display:block}.hd .co{margin-left:auto;text-align:right;font-size:11px;color:var(--mute);line-height:1.55}.hd .co b{display:block;font:700 17px Georgia,serif;color:var(--g9);margin-bottom:1px}
.ti{display:flex;justify-content:space-between;align-items:flex-end;margin:20px 0 12px;gap:16px}
.ti h1{font:700 25px Georgia,'Times New Roman',serif;color:var(--g9);letter-spacing:.01em}.ti small{display:block;color:var(--mute);font-size:11px;margin-top:2px}
.no{text-align:right}.no .l{font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--mute);font-weight:700}.no .v{font:800 21px ui-monospace,Consolas,monospace;letter-spacing:.04em;color:var(--ink)}
.st{display:inline-block;padding:3px 11px;border-radius:20px;font-weight:800;font-size:10px;letter-spacing:.1em;text-transform:uppercase;margin-top:4px}
.st.ok{background:#e2f4ea;color:#0f7a4f}.st.pe{background:#fdeceb;color:var(--red)}.st.cx{background:#eee;color:#555}
.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid var(--line);border-radius:10px;margin-bottom:14px;overflow:hidden}
.meta div{padding:8px 12px;border-right:1px solid var(--line)}.meta div:last-child{border:0}.meta .l{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--mute);font-weight:700}.meta .v{font-weight:700;margin-top:1px}
h2{font:800 10px inherit;letter-spacing:.2em;text-transform:uppercase;color:var(--au);margin:16px 0 7px;display:flex;align-items:center;gap:10px}h2::after{content:"";flex:1;height:1px;background:var(--line)}
table.t{width:100%;border-collapse:collapse}table.t th{text-align:left;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);padding:6px 8px;background:#f7f5ee;border-bottom:1px solid var(--line)}table.t td{padding:7px 8px;border-bottom:1px solid #efece3;vertical-align:top}
.svc{border:1px solid var(--line);border-left:4px solid var(--g7);border-radius:10px;margin-bottom:10px;overflow:hidden;break-inside:avoid}
.svc .sh{display:flex;align-items:center;gap:10px;padding:9px 13px;background:linear-gradient(90deg,#f4f8f5,#fff)}.svc .sh b{font-size:14px;color:var(--g9)}.svc .sh .ty{font-size:9px;letter-spacing:.16em;text-transform:uppercase;font-weight:800;color:#fff;background:var(--g7);padding:3px 9px;border-radius:5px}
.svc .sh .cf{margin-left:auto;text-align:right;font-size:10px;color:var(--mute)}.svc .sh .cf b{display:block;font:800 13px ui-monospace,Consolas,monospace;color:var(--g9)}
.kv{display:grid;grid-template-columns:repeat(3,1fr);gap:9px 16px;padding:11px 13px}.kv .l{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);font-weight:700}.kv .v{font-weight:600}
.stars{color:var(--au);letter-spacing:2px;font-size:13px}
.leg{display:flex;align-items:center;gap:14px;padding:4px 13px 11px}.leg .c{font:800 20px ui-monospace,Consolas,monospace}.leg .tm{font-size:11px;color:var(--mute)}.leg .ln{flex:1;border-top:2px dotted var(--au);position:relative;height:0}.leg .ln::after{content:"\\2708";position:absolute;left:50%;top:-11px;transform:translateX(-50%);background:#fff;padding:0 6px;color:var(--g7);font-size:15px}
.note{background:#fbf8ee;border:1px solid var(--au2);border-radius:9px;padding:9px 12px;margin-top:6px}
.ft{display:flex;gap:18px;align-items:flex-end;margin-top:18px;padding-top:12px;border-top:1px solid var(--line);break-inside:avoid}.ft .tx{flex:1;font-size:10.5px;color:var(--mute);white-space:pre-line}.ft .qr{text-align:center;font-size:8.5px;color:var(--mute)}.ft .qr svg{width:82px;height:82px;display:block}
.cut{text-align:center;color:var(--mute);font-size:10.5px;margin-top:8px}
@media(max-width:820px){.sheet{width:auto;margin:0;min-height:0;padding:16px}.kv{grid-template-columns:1fr 1fr}.meta{grid-template-columns:1fr 1fr}.wm{font-size:60px}.hd img{height:54px}.ti{flex-direction:column;align-items:flex-start}.no{text-align:left}}
@media print{body{background:#fff}.bar{display:none}.sheet{margin:0;box-shadow:none;width:auto;min-height:0}@page{size:A4;margin:0}}
/* Premium document layout: voucher / receipt screen and A4 print reliability */
.sheet{border-top:5px solid var(--g9);border-radius:3px;box-shadow:0 12px 44px rgba(7,53,38,.13),0 2px 8px rgba(7,53,38,.05)}
.hd{align-items:center;gap:16px;padding-bottom:15px;border-bottom:2px solid var(--g9)}
.hd img{height:66px;max-width:150px;object-fit:contain}
.hd .co{max-width:58%;overflow-wrap:anywhere;font-size:10.5px}
.hd .co b{font-family:Georgia,serif;font-size:18px;letter-spacing:-.02em}
.ti{align-items:center;margin:22px 0 15px;gap:18px}
.ti h1{font-size:27px;letter-spacing:-.025em}
.ti small{font-size:10.5px;line-height:1.5}
.no{min-width:135px;padding:10px 13px;border:1px solid var(--line);border-radius:10px;background:#fbfcfa}
.no .v{font-size:18px;overflow-wrap:anywhere}
.meta{grid-template-columns:repeat(4,minmax(0,1fr));border-color:#e1e8e2;border-radius:11px;background:#fbfcfb}
.meta div{min-width:0;padding:10px 11px;border-color:#e8eee9}
.meta .l{font-size:8.5px;letter-spacing:.12em}
.meta .v{font-size:11.5px;overflow-wrap:anywhere}
.sheet h2{font-size:9.5px;letter-spacing:.17em;color:#9b792b;margin:18px 0 9px}
.sheet table.t{table-layout:auto}
.sheet table.t th{padding:8px 9px;font-size:8.5px;letter-spacing:.095em;background:#f3f7f4;color:#5e7368}
.sheet table.t td{padding:8px 9px;font-size:10.5px;overflow-wrap:anywhere;word-break:normal}
.sheet table.t tr{break-inside:avoid}
.svc{border-color:#e2e9e3;border-left-width:3px;border-radius:11px;box-shadow:0 1px 2px rgba(7,53,38,.03)}
.svc .sh{padding:10px 13px;background:#f5f8f5;flex-wrap:wrap}
.svc .sh b{font-size:13px;overflow-wrap:anywhere}
.kv{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 14px;padding:12px 13px}
.kv>div{min-width:0;overflow-wrap:anywhere}
.kv .l{font-size:8px;letter-spacing:.1em}
.kv .v{font-size:10.5px;line-height:1.45}
.leg{gap:12px;padding:5px 13px 12px;break-inside:avoid}
.leg .c{font-size:18px}
.ft{margin-top:20px;padding-top:13px}
.ft .tx{font-size:9.5px;line-height:1.6}
.ft .qr svg{width:76px;height:76px}
.receipt-sheet .meta>div:last-child{background:#f9f4e7}
.receipt-sheet .meta>div:last-child .v{color:var(--g9);font-size:18px;font-weight:800;letter-spacing:-.025em}
.receipt-sheet table.t{margin-top:12px;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.receipt-sheet table.t td{padding:10px 12px}
.wm{max-width:90%;font-size:clamp(48px,8vw,118px);padding:6px 24px;white-space:nowrap}
@media(max-width:820px){.sheet{border-top-width:4px;border-radius:0;box-shadow:none}.hd{gap:12px;align-items:flex-start}.hd .co{max-width:65%;font-size:10px}.ti{flex-direction:row;align-items:center}.ti h1{font-size:23px}.no{text-align:right;min-width:0}.meta{grid-template-columns:repeat(2,minmax(0,1fr))}.meta div:nth-child(2){border-right:0}.meta div:nth-child(-n+2){border-bottom:1px solid var(--line)}.kv{grid-template-columns:repeat(2,minmax(0,1fr))}.wm{font-size:clamp(36px,9vw,64px);border-width:6px}}
@media(max-width:520px){.hd{flex-direction:column}.hd img{height:54px}.hd .co{max-width:100%;margin-left:0;text-align:left}.ti{align-items:flex-start;flex-direction:column}.no{text-align:left;width:100%}.meta{grid-template-columns:1fr 1fr}.svc .sh .cf{margin-left:0}.leg{flex-wrap:wrap}.leg .ln{min-width:45px}.leg>div:last-child{min-width:110px!important}.ft{align-items:flex-start}.wm{letter-spacing:.02em}}
@media print{.sheet{width:210mm;min-height:297mm;margin:0 auto;padding:13mm 14mm 12mm;border-top-width:4mm;border-radius:0;box-shadow:none;overflow:visible}.hd img{height:64px}.ti{flex-direction:row}.meta{grid-template-columns:repeat(4,minmax(0,1fr))}.kv{grid-template-columns:repeat(3,minmax(0,1fr))}.svc,.sheet table.t tr,.ft,.meta{break-inside:avoid}.wm{font-size:100px}@page{size:A4;margin:0}}
/* V12 hotel-voucher manifest: compact, legible and A4-ready */
.hv-sheet{padding:11mm 11mm 9mm;border-top:5px solid var(--g9);overflow:visible}
.hv-top{position:relative}.hv-top .hd{border-bottom:2px solid var(--g9);padding-bottom:9px}.hv-top .hd img{height:58px;max-width:140px}
.hv-doc-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 0 9px;padding:8px 12px;background:#f2f7f3;border:1px solid #dfe9e2;border-radius:8px}
.hv-doc-title span{font-size:8px;letter-spacing:.18em;font-weight:800;color:#9b792b}.hv-doc-title h1{font:800 21px Georgia,serif;color:var(--g9);margin:0}
.hv-issuer{font-size:9px;color:var(--mute);margin:-3px 0 9px}.hv-refline{font-size:9px;color:var(--mute);text-align:right;margin:-5px 0 8px}
.hv-meta-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:8px 0 11px;background:#fff}
.hv-meta-cell{padding:6px 8px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);min-width:0}.hv-meta-cell:nth-child(4n){border-right:0}.hv-meta-cell small{display:block;font-size:7px;letter-spacing:.12em;text-transform:uppercase;font-weight:800;color:var(--mute)}.hv-meta-cell b{display:block;font-size:9px;line-height:1.35;overflow-wrap:anywhere;color:var(--ink)}
.hv-section{margin-top:10px;break-inside:avoid}.hv-section-title{display:flex;align-items:center;gap:7px;padding:6px 8px;background:#f4f6f2;border-left:3px solid var(--au);border-radius:5px 5px 0 0;font-size:9px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:var(--g9)}.hv-section-title>span{font:800 8px ui-monospace,monospace;color:#a17c2e}.hv-section-title small{margin-left:auto;color:var(--mute);font-size:8px;letter-spacing:0;text-transform:none}
.hv-table-wrap{width:100%;overflow:visible;border:1px solid var(--line);border-top:0}.hv-table{table-layout:auto;width:100%;border-collapse:collapse}.hv-table th{padding:5px 5px!important;font-size:6.5px!important;letter-spacing:.055em!important;white-space:normal}.hv-table td{padding:5px 5px!important;font-size:7.5px!important;line-height:1.35;overflow-wrap:anywhere}.hv-table td b{font-size:7.7px}.hv-table tr{break-inside:avoid}.hv-table tfoot td{background:#f5f5ef;font-weight:900;border-top:1px solid var(--line)}.hv-table .hv-num{text-align:center;font-weight:900;white-space:nowrap}.hv-hotel-cell{display:flex;align-items:center;gap:7px;min-width:0}.hv-hotel-cell b{overflow-wrap:anywhere}.hv-hotel-thumb{width:34px;height:30px;object-fit:cover;border-radius:4px;flex:none;border:1px solid #dce5de}
.hv-accommodation{min-width:0}.hv-summary{display:flex;gap:0;flex-wrap:wrap;border:1px solid var(--line);border-top:0}.hv-summary span{flex:1;min-width:72px;padding:6px 8px;font-size:7.5px;color:var(--mute);border-right:1px solid var(--line)}.hv-summary b{margin-left:4px;color:var(--g9);font-size:9px}
.hv-note{margin-top:9px;padding:7px 9px;border:1px solid #e6d9b4;background:#fffcf4;border-radius:6px;font-size:8px}.hv-note p{margin-top:3px;white-space:pre-wrap}
.hv-footer{display:flex;align-items:flex-end;gap:15px;margin-top:13px;padding-top:9px;border-top:1px solid var(--line);break-inside:avoid}.hv-terms{flex:1;min-width:0;white-space:pre-line;color:var(--mute);font-size:7.5px;line-height:1.5}.hv-qr{width:88px;flex:none;text-align:center;color:var(--mute);font-size:7px}.hv-qr svg{width:65px;height:65px;display:block;margin:0 auto 3px}.hv-qr b{display:block;color:var(--g9);font:800 7px ui-monospace,monospace;overflow-wrap:anywhere}.hv-bottomline{text-align:center;padding-top:6px;margin-top:6px;border-top:1px solid #edf0ea;color:var(--mute);font-size:7px}
@media(max-width:820px){.hv-sheet{padding:16px}.hv-meta-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.hv-meta-cell:nth-child(2n){border-right:0}.hv-meta-cell:nth-child(4n){border-right:0}.hv-table-wrap{overflow-x:auto}.hv-table{min-width:720px}}
@media print{.hv-sheet{width:210mm;min-height:297mm;margin:0 auto;padding:10mm 10mm 8mm;border-top:4mm solid var(--g9);box-shadow:none;border-radius:0}.hv-table-wrap{overflow:visible}.hv-table{min-width:0}.hv-section,.hv-table tr,.hv-meta-grid,.hv-footer{break-inside:avoid}.hv-doc-title{margin:9px 0 7px}.hv-table th{font-size:6.4px!important}.hv-table td{font-size:7.1px!important}.hv-footer{margin-top:10px}.hv-qr svg{width:58px;height:58px}}

`;
let HOST = '';
const rememberHost = h => { HOST = h; };
const ogBase = () => (db.settings.baseUrl || process.env.PUBLIC_URL || HOST || '').replace(/\/+$/, '');
/* Link previews (WhatsApp, Facebook, Telegram, X): title, description and the brand image. Private pages stay noindex. */
const page = (title, body, extraHead = '', desc = '') => {
  const c = db.settings.company || {}, b = ogBase(), name = c.name || 'The Umrah Store', d = desc || (c.tagline || 'Premium Islamic Travel') + ' - Umrah packages, flights, visas and transport.', img = b ? b + '/brand/og-image.jpg' : '/brand/og-image.jpg', full = title.includes(name) ? title : title + ' | ' + name;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(full)}</title>
<meta name="description" content="${esc(d)}"><meta name="theme-color" content="#083d2b"><meta property="og:type" content="website"><meta property="og:site_name" content="${esc(name)}"><meta property="og:title" content="${esc(full)}"><meta property="og:description" content="${esc(d)}"><meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(full)}"><meta name="twitter:description" content="${esc(d)}"><meta name="twitter:image" content="${esc(img)}">
<link rel="icon" href="/brand/favicon.ico" sizes="any"><link rel="apple-touch-icon" href="/brand/icon-180.png"><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet"><style>${CSS}</style>${extraHead}</head><body>${body}</body></html>`;
};

const letterhead = () => {
  const c = db.settings.company;
  return `<div class="hd"><img src="${logoUrl()}" alt="${esc(c.name)}"><div class="co"><b>${esc(c.name)}</b>${c.tagline ? esc(c.tagline) + '<br>' : ''}${[c.address, c.phone, c.email, c.website].filter(Boolean).map(esc).join('<br>')}</div></div>`;
};
const kv = (l, v) => (v || v === 0 ? `<div><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div></div>` : '');
const stars = n => (n ? `<span class="stars">${'&#9733;'.repeat(Math.min(7, +n))}</span>` : '');

function svcBlock(s) {
  const d = s.d || {}, conf = s.conf ? `<div class="cf">Confirmation No.<b>${esc(s.conf)}</b></div>` : '';
  const head = (ty, title, extra = '') => `<div class="sh"><span class="ty">${ty}</span><b>${esc(title)}</b>${extra}${conf}</div>`;
  if (s.type === 'hotel') {
    const n = nights(d.cin || s.from, d.cout || s.to);
    return `<div class="svc">${head('Hotel', d.hotel || s.title, d.stars ? ' ' + stars(d.stars) : '')}<div class="kv">${kv('City', d.city)}${kv('Check-in', fd(d.cin || s.from))}${kv('Check-out', fd(d.cout || s.to))}${kv('Nights', n || '')}${kv('Room type', d.room)}${kv('Rooms', d.rooms)}${kv('Meal plan', d.meal)}${kv('Distance', d.dist)}${kv('Guests', d.guests || '')}</div></div>`;
  }
  if (s.type === 'transport') return `<div class="svc">${head('Transport', s.title)}<div class="kv">${kv('Route', d.route)}${kv('Vehicle', d.vehicle)}${kv('Date', fd(d.date || s.from))}${kv('Pick-up time', d.time)}${kv('Pick-up', d.pickup)}${kv('Drop-off', d.drop)}${kv('Passengers', s.qty)}</div></div>`;
  if (s.type === 'visa') return `<div class="svc">${head('Visa', s.title)}<div class="kv">${kv('Visa type', d.vtype)}${kv('Entry', d.entry)}${kv('Validity', d.duration)}${kv('Applicants', s.qty)}${kv('Reference', d.ref)}</div></div>`;
  if (s.type === 'flight') {
    const leg = (t, f, dt, a, b, dp, ar) => `<div class="leg"><div><div class="c">${esc(a)}</div><div class="tm">${esc(dp)}</div></div><div class="ln"></div><div style="text-align:right"><div class="c">${esc(b)}</div><div class="tm">${esc(ar)}</div></div><div style="min-width:150px;font-size:11px"><b>${esc(t)}</b> ${esc(f)}<br>${esc(fd(dt))}</div></div>`;
    return `<div class="svc">${head('Flight', s.title)}<div class="kv">${kv('Airline', d.airline)}${kv('PNR', d.pnr)}${kv('Class', d.cls)}${kv('Baggage', d.bag)}${kv('Passengers', s.qty)}</div>${d.from ? leg('Outbound', d.fno || '', d.date || s.from, d.from, d.to, d.dep || '', d.arr || '') : ''}${d.rfrom || d.rfno ? leg('Return', d.rfno || '', d.rdate || s.to, d.rfrom || d.to, d.rto || d.from, d.rdep || '', d.rarr || '') : ''}</div>`;
  }
  if (s.type === 'package') {
    const o = d.out, i = d.inb, leg = (t, f) => (f && f.from ? `<div class="leg"><div><div class="c">${esc(f.from)}</div><div class="tm">${esc(f.dt)}</div></div><div class="ln"></div><div style="text-align:right"><div class="c">${esc(f.to)}</div><div class="tm">${esc(f.at)}</div></div><div style="min-width:150px;font-size:11px"><b>${t}</b> ${esc(f.fn)}<br>${esc(fd(f.date))}${f.bag ? '<br>Baggage ' + esc(f.bag) + ' kg' : ''}</div></div>` : '');
    return `<div class="svc">${head('Package', s.title)}<div class="kv">${kv('Airline', d.airline)}${kv('Room type', d.room)}${kv('Group', d.code)}${kv('Makkah', d.makkah ? d.makkah + ' - ' + (d.mkn || '') + ' nights' : '')}${kv('Madinah', d.madinah ? d.madinah + ' - ' + (d.mdn || '') + ' nights' : '')}${kv('Distance', [d.mkd && 'Makkah ' + d.mkd, d.mdd && 'Madinah ' + d.mdd].filter(Boolean).join(' / '))}</div>${leg('Outbound', o)}${leg('Return', i)}</div>`;
  }
  return `<div class="svc">${head('Service', s.title)}<div class="kv">${kv('Details', d.desc)}${kv('Date', fd(s.from))}${kv('Quantity', s.qty)}</div></div>`;
}

const TITLES = { all: 'Booking Voucher', hotel: 'Hotel Voucher', transport: 'Transport Voucher', flight: 'Flight Itinerary', visa: 'Visa Voucher', package: 'Package Voucher', other: 'Service Voucher', custom: '' };

function hotelVoucherBody(v, b, c, pty, qr, wm, st, url) {
  const m = b.voucherMeta || {}, svcs = v.kind === 'hotel' ? b.services.filter(s => s.type === 'hotel' && (!v.sid || s.id === v.sid)) : b.services;
  const hotels = svcs.filter(s => s.type === 'hotel'), flights = svcs.filter(s => s.type === 'flight'), transport = svcs.filter(s => s.type === 'transport'), other = svcs.filter(s => !['hotel','flight','transport'].includes(s.type));
  const pax = b.pax || [], count = k => pax.filter(x => x.t === k).length;
  const adults = m.adults !== undefined && m.adults !== '' ? +m.adults : count('Adult'), children = m.children !== undefined && m.children !== '' ? +m.children : count('Child'), infants = m.infants !== undefined && m.infants !== '' ? +m.infants : count('Infant');
  const totalBeds = m.totalBeds !== undefined && m.totalBeds !== '' ? +m.totalBeds : pax.filter(x => x.beds !== false).length;
  const totalNights = hotels.reduce((a, s) => a + (nights(s.d && s.d.cin || s.from, s.d && s.d.cout || s.to) || +(s.d && s.d.nights) || 0), 0);
  const dateShort = x => { if (!x) return ''; const [y,mo,d] = String(x).slice(0,10).split('-'); return d && mo && y ? `${d}/${mo}/${y.slice(-2)}` : esc(x); };
  const metaCell = (label, value) => value !== undefined && value !== null && String(value).trim() !== '' ? `<div class="hv-meta-cell"><small>${esc(label)}</small><b>${esc(value)}</b></div>` : '';
  const metaGrid = [metaCell('IATA / Issuing agency', m.iata), metaCell('Voucher No.', m.supplierVoucherNo || v.no), metaCell('Branch', m.branch), metaCell('Saudi company', m.saudiCompany), metaCell('Date', dateShort(m.voucherDate || v.createdAt)), metaCell('Package', m.packageName || b.category), metaCell('Manual No.', m.manualNo), metaCell('Group #', m.groupNo), metaCell('Family head', m.familyHead || (pax[0] && pax[0].n)), metaCell('Total PAX', m.totalPax || pax.length), metaCell('WhatsApp', m.whatsapp), metaCell('Portal booking', b.no)].filter(Boolean).join('');
  const hotelRows = hotels.map(s => { const d=s.d||{}, n=nights(d.cin||s.from,d.cout||s.to)||(+d.nights||0), photo=d.img ? `<img class=\"hv-hotel-thumb\" src=\"${esc(d.img)}\" alt=\"${esc(d.hotel || s.title || 'Hotel')}\">` : ''; return `<tr><td><div class=\"hv-hotel-cell\">${photo}<b>${esc(d.hotel || s.title)}</b></div></td><td>${esc(d.confirm || s.conf || '')}</td><td>${esc(d.city || '')}</td><td>${esc(d.room || '')}</td><td>${esc(d.meal || '')}</td><td>${esc(dateShort(d.cin || s.from))}</td><td>${esc(dateShort(d.cout || s.to))}</td><td class="hv-num">${n || ''}</td></tr>`; }).join('');
  const flightRows = flights.map(s => { const d=s.d||{}; const leg=(label,fn,from,to,dt,dep,arr)=>fn||from||to?`<tr><td>${label}</td><td><b>${esc(fn||'')}</b></td><td>${esc((from||'')+' → '+(to||''))}</td><td>${esc(dateShort(dt))}</td><td>${esc(dep||'')}</td><td>${esc(arr||'')}</td></tr>`:''; return leg('Outbound',d.fno,d.from,d.to,d.date||s.from,d.dep,d.arr)+leg('Return',d.rfno,d.rfrom||d.to,d.rto||d.from,d.rdate||s.to,d.rdep,d.rarr); }).join('');
  const transportRows = transport.map(s=>{const d=s.d||{};return `<tr><td>${esc(s.title || d.route || 'Transport')}</td><td>${esc(d.vehicle || '')}</td><td>${esc(d.route || '')}</td><td>${esc(dateShort(d.date || s.from))}</td><td>${esc(d.time || '')}</td><td>${esc(d.pickup || '')}</td><td>${esc(d.drop || '')}</td></tr>`;}).join('');
  const otherRows = other.map(s=>`<tr><td>${esc(s.type)}</td><td>${esc(s.title)}</td><td>${esc((s.d||{}).desc || (s.d||{}).vtype || '')}</td><td>${esc(s.conf || '')}</td></tr>`).join('');
  const issuer = m.issuedBy ? `<div class="hv-issuer">Prepared from supplier / agent voucher: <b>${esc(m.issuedBy)}</b></div>` : '';
  const extraMeta = m.supplierVoucherNo && m.supplierVoucherNo !== v.no ? `<div class="hv-refline">Supplier reference: <b>${esc(m.supplierVoucherNo)}</b> · Portal voucher: <b>${esc(v.no)}</b></div>` : '';
  return `<div class="bar"><b>Hotel Voucher · ${esc(b.no)}</b><button class="pri" onclick="window.print()">Print / Save as PDF</button><button onclick="navigator.clipboard&&navigator.clipboard.writeText('${esc(url)}').then(()=>{this.textContent='Link copied'})">Copy link</button><a target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Hotel Voucher ' + b.no + ' - ' + url)}">Share on WhatsApp</a></div>
  <main class="sheet hv-sheet">${wm}<div class="hv-top">${letterhead()}<div class="hv-doc-title"><span>TRAVEL DOCUMENT</span><h1>Hotel Voucher</h1>${st}</div>${issuer}</div>
  <div class="hv-meta-grid">${metaGrid}</div>${extraMeta}
  <section class="hv-section"><div class="hv-section-title"><span>01</span> Pilgrims Details <small>${pax.length} traveller(s)</small></div><div class="hv-table-wrap"><table class="t hv-table"><thead><tr><th>#</th><th>Mutamer Name</th><th>Gender</th><th>PPNO</th><th>PAX</th><th>Beds</th><th>Visa Number</th><th>PNR</th></tr></thead><tbody>${pax.map((x,i)=>`<tr><td>${i+1}</td><td><b>${esc(x.n)}</b></td><td>${x.g==='F'?'Female':'Male'}</td><td class="mono">${esc(x.pp)}</td><td>${esc(x.t||'Adult')}</td><td>${x.beds===false?'No':'Yes'}</td><td>${esc(x.visaNo||'')}</td><td>${esc(x.pnr||'')}</td></tr>`).join('')}</tbody></table></div><div class="hv-summary"><span>Adults <b>${adults}</b></span><span>Children <b>${children}</b></span><span>Infants <b>${infants}</b></span><span>Total PAX <b>${pax.length}</b></span><span>Total beds <b>${totalBeds}</b></span></div></section>
  <section class="hv-section"><div class="hv-section-title"><span>02</span> Accommodation Details <small>${hotels.length} stay(s)</small></div><div class="hv-table-wrap"><table class="t hv-table hv-accommodation"><thead><tr><th>Hotel Name</th><th>Confirm No.</th><th>City</th><th>Room Type</th><th>Meal Plan</th><th>Check In</th><th>Checkout</th><th>Nights</th></tr></thead><tbody>${hotelRows || '<tr><td colspan="8">No accommodation added</td></tr>'}</tbody><tfoot><tr><td colspan="7">Total Nights</td><td class="hv-num">${totalNights}</td></tr></tfoot></table></div></section>
  ${transport.length ? `<section class="hv-section"><div class="hv-section-title"><span>03</span> Transport / Services</div><div class="hv-table-wrap"><table class="t hv-table"><thead><tr><th>Name</th><th>Type</th><th>Route</th><th>Date</th><th>Time</th><th>Pick-up</th><th>Drop-off</th></tr></thead><tbody>${transportRows}</tbody></table></div></section>` : ''}
  ${flightRows ? `<section class="hv-section"><div class="hv-section-title"><span>04</span> Flight Details</div><div class="hv-table-wrap"><table class="t hv-table"><thead><tr><th>Sector</th><th>Flight</th><th>Route</th><th>Date</th><th>Departure</th><th>Arrival</th></tr></thead><tbody>${flightRows}</tbody></table></div></section>` : ''}
  ${otherRows ? `<section class="hv-section"><div class="hv-section-title"><span>05</span> Additional Services</div><div class="hv-table-wrap"><table class="t hv-table"><thead><tr><th>Type</th><th>Service</th><th>Details</th><th>Reference</th></tr></thead><tbody>${otherRows}</tbody></table></div></section>` : ''}
  ${b.notes ? `<div class="hv-note"><b>Note</b><p>${esc(b.notes)}</p></div>` : ''}
  <footer class="hv-footer"><div class="hv-terms">${esc([c.terms,c.footer].filter(Boolean).join('\n\n'))}${b.status==='Confirmed'?'':'\n\nThis voucher is not valid for travel until approved by '+esc(c.name)+'.'}</div><div class="hv-qr">${qr}<small>Scan to verify voucher</small><b>${esc(v.no)}</b></div></footer>
  <div class="hv-bottomline">${esc(c.name)}${c.phone?' · '+esc(c.phone):''}${c.website?' · '+esc(c.website):''}</div></main>`;
}

async function voucherHtml(v, req) {
  const b = db.bookings.find(x => x.id === v.bookingId); if (!b) return null;
  const c = db.settings.company, pty = party(b.partyId), url = origin(req) + '/v/' + v.token;
  const approved = b.status === 'Confirmed', cancelled = b.status === 'Cancelled';
  let svcs = v.kind === 'all' ? b.services : v.kind === 'custom' ? [] : b.services.filter(s => (v.sid ? s.id === v.sid : s.type === v.kind));
  const title = v.kind === 'custom' ? (v.custom.title || 'Voucher') : ((v.kind === 'all' || v.kind === 'hotel') ? 'Hotel Voucher' : TITLES[v.kind]);
  const qr = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  const wm = cancelled ? '<div class="wm cx">CANCELLED</div>' : approved ? '' : '<div class="wm">PENDING</div>';
  const st = cancelled ? '<span class="st cx">Cancelled</span>' : approved ? '<span class="st ok">Approved</span>' : '<span class="st pe">Pending approval</span>';
  const custom = v.kind === 'custom' ? `<h2>Details</h2><table class="t"><tbody>${v.custom.rows.map(r => `<tr><td style="width:32%;color:var(--mute);font-weight:700">${esc(r.k)}</td><td>${esc(r.v)}</td></tr>`).join('')}</tbody></table>${v.custom.notes ? `<div class="note">${esc(v.custom.notes)}</div>` : ''}` : '';
  if (v.kind === 'all' || v.kind === 'hotel') return page(title + ' ' + b.no, hotelVoucherBody(v, b, c, pty, qr, wm, st, url), '', 'Hotel voucher for booking ' + b.no + '.');
  const body = `<div class="bar"><b>${esc(title)} &middot; ${esc(b.no)}</b><button class="pri" onclick="window.print()">Print / Save as PDF</button><button onclick="navigator.clipboard&&navigator.clipboard.writeText('${esc(url)}').then(()=>{this.textContent='Link copied'})">Copy link</button><a target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(title + ' ' + b.no + ' - ' + url)}">Share on WhatsApp</a></div>
<div class="sheet">${wm}${letterhead()}
<div class="ti"><div><h1>${esc(title)}</h1><small>Issued ${esc(fdt(v.createdAt))} &middot; Voucher ${esc(v.no)}</small>${st}</div><div class="no"><div class="l">Booking number</div><div class="v">${esc(b.no)}</div></div></div>
<div class="meta"><div><div class="l">Booked by</div><div class="v">${esc(pty ? pty.name : '')}</div></div><div><div class="l">Category</div><div class="v">${esc(b.category)}</div></div><div><div class="l">Travel from</div><div class="v">${esc(fd(b.from) || '-')}</div></div><div><div class="l">Travel to</div><div class="v">${esc(fd(b.to) || '-')}</div></div></div>
<h2>Travellers (${b.pax.length})</h2><table class="t"><thead><tr><th style="width:28px">#</th><th>Name</th><th>Passport no.</th><th>Type</th><th>Nationality</th></tr></thead><tbody>${b.pax.map((x, i) => `<tr><td>${i + 1}</td><td><b>${esc(x.n)}</b></td><td style="font-family:ui-monospace,Consolas,monospace">${esc(x.pp)}</td><td>${esc(x.t)}</td><td>${esc(x.nat)}</td></tr>`).join('')}</tbody></table>
${svcs.length ? '<h2>Services</h2>' + svcs.map(svcBlock).join('') : ''}${custom}
${b.notes ? `<h2>Notes</h2><div class="note">${esc(b.notes)}</div>` : ''}
<div class="ft"><div class="tx">${esc([c.terms, c.footer].filter(Boolean).join('\n\n'))}${approved ? '' : '\n\nThis voucher is not valid for travel until it is approved by ' + esc(c.name) + '.'}</div><div class="qr">${qr}<div>Scan to verify</div></div></div></div>`;
  return page(title + ' ' + b.no, body, '', 'Your travel voucher from ' + (db.settings.company.name || 'The Umrah Store') + '. Open the link to view, print or share it.');
}

async function receiptHtml(p, req) {
  const pty = party(p.partyId), c = db.settings.company, sup = p.dir === 'out', ok = p.status === 'Approved';
  const url = origin(req) + '/api/receipt/' + p.id;
  const body = `<div class="bar"><b>${sup ? 'Payment voucher' : 'Receipt'} ${esc(p.id)}</b><button class="pri" onclick="window.print()">Print / Save as PDF</button></div>
<div class="sheet receipt-sheet" style="min-height:0">${ok ? '' : `<div class="wm">${esc(p.status.toUpperCase())}</div>`}${letterhead()}
<div class="ti"><div><h1>${sup ? 'Payment Voucher' : 'Payment Receipt'}</h1><small>${esc(fdt(p.created || p.date))}</small><span class="st ${ok ? 'ok' : 'pe'}">${esc(p.status)}</span></div><div class="no"><div class="l">Reference</div><div class="v">${esc(p.id)}</div></div></div>
<div class="meta"><div><div class="l">${sup ? 'Paid to' : 'Received from'}</div><div class="v">${esc(pty ? pty.name : '')}</div></div><div><div class="l">Method</div><div class="v">${esc(p.method)}</div></div><div><div class="l">Date</div><div class="v">${esc(fd(p.date))}</div></div><div><div class="l">Amount</div><div class="v" style="font-size:16px">${p.currency === 'SAR' && p.currencyAmount != null ? 'SAR ' + (+p.currencyAmount).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : money(p.amt)}${p.currency === 'SAR' ? `<small style="display:block;margin-top:5px;font-size:10px;line-height:1.45;color:var(--mute)">Ledger equivalent: ${money(p.amt)} · FX snapshot: 1 SAR = PKR ${(+p.currencyFxRate||0).toLocaleString('en-US',{maximumFractionDigits:3})}</small>` : ''}</div></div></div>
<table class="t"><tbody>${p.ref ? `<tr><td style="width:30%;color:var(--mute);font-weight:700">Transaction / ref</td><td>${esc(p.ref)}</td></tr>` : ''}${p.bookingId ? `<tr><td style="color:var(--mute);font-weight:700">Booking</td><td>${esc((db.bookings.find(b => b.id === p.bookingId) || {}).no || '')}</td></tr>` : ''}${p.note ? `<tr><td style="color:var(--mute);font-weight:700">Note</td><td>${esc(p.note)}</td></tr>` : ''}<tr><td style="color:var(--mute);font-weight:700">Recorded by</td><td>${esc(p.by)}</td></tr></tbody></table>
<div class="ft"><div class="tx">${esc(c.footer || 'Thank you for your business.')}</div></div></div>`;
  return page('Receipt ' + p.id, body, '', 'Payment receipt from ' + (db.settings.company.name || 'The Umrah Store') + '.');
}

/* ---------- public payment link page ---------- */

/* ---------- bank accounts: shared card renderer (public page + payment links) ---------- */
const THEMES = { green: ['#073526', '#1f9a70'], gold: ['#6b4f12', '#c9a23f'], navy: ['#0b2447', '#3b6fc4'], maroon: ['#561323', '#b5314f'], slate: ['#1f2937', '#64748b'], teal: ['#0b3b3c', '#19a3a0'] };
const KIND = { bank: 'Bank account', wallet: 'Mobile wallet', raast: 'Raast ID' };
const liveBanks = () => (db.settings.bank || []).filter(b => b.active !== false);
const publicBanks = () => (db.settings.payments.publicBankPage ? (require('./modules').enabled('bank') ? liveBanks() : []).filter(b => b.public !== false && (b.vis || 'public') === 'public') : []).map(b => ({ id: b.id, kind: b.kind, title: b.title, bank: b.bank, branch: b.branch, account: b.account, iban: b.iban, swift: b.swift, wallet: b.wallet, raast: b.raast, currency: b.currency, instructions: b.instructions, theme: b.theme, qr: b.qr || '', logo: b.logo || '' }));
const BL = require('../public/banklogo.js');
const BANK_CSS = `<style>${BL.css}.bkc .lg2{display:flex;gap:12px;align-items:center;position:relative;z-index:1}.bkc{border-radius:18px;color:#fff;padding:20px 20px 16px;margin:12px 0;position:relative;overflow:hidden;box-shadow:0 10px 30px rgba(7,53,38,.2)}.bkc::after{content:"";position:absolute;right:-50px;top:-50px;width:170px;height:170px;border-radius:50%;background:rgba(255,255,255,.09)}
.bkc .tp{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.bkc .kd{font:800 10px inherit;letter-spacing:.16em;text-transform:uppercase;opacity:.75}.bkc .bn{font:700 20px Georgia,serif;margin-top:2px}.bkc .tt{opacity:.9;margin-top:2px;font-size:13px}.bkc img.qr{width:84px;height:84px;background:#fff;border-radius:10px;padding:4px;object-fit:contain;position:relative;z-index:1}
.bkc .fl{margin-top:12px;display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.13);border-radius:11px;padding:8px 10px;position:relative;z-index:1}.bkc .fl span{font:700 9.5px inherit;letter-spacing:.12em;text-transform:uppercase;opacity:.75;min-width:62px}.bkc .fl code{flex:1;font:700 14px ui-monospace,Consolas,monospace;letter-spacing:.04em;word-break:break-all;background:none;color:#fff;padding:0}
.bkc .cp{border:0;background:rgba(255,255,255,.2);color:#fff;border-radius:8px;padding:6px 10px;font:700 11px inherit;cursor:pointer}.bkc .cp.ok{background:#fff;color:#073526}.bkc .in{margin-top:10px;font-size:11.5px;opacity:.85;position:relative;z-index:1}</style>`;
const BANK_JS = `<script>document.addEventListener('click',function(e){var b=e.target.closest('.cp');if(!b)return;var t=b.dataset.v;(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).catch(function(){var a=document.createElement('textarea');a.value=t;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove()});var o=b.textContent;b.textContent='Copied';b.classList.add('ok');setTimeout(function(){b.textContent=o;b.classList.remove('ok')},1400)})</script>`;
async function bankCard(b) {
  const [c1, c2] = THEMES[b.theme] || THEMES.green, f = (l, v) => (v ? `<div class="fl"><span>${l}</span><code>${esc(v)}</code><button class="cp" data-v="${esc(v)}">Copy</button></div>` : '');
  let qr = b.qr; if (!qr) { const x = b.iban || b.account || b.wallet || b.raast; if (x) qr = 'data:image/svg+xml;utf8,' + encodeURIComponent(await QRCode.toString(x, { type: 'svg', margin: 1 })); }
  return `<div class="bkc" style="background:linear-gradient(135deg,${c1},${c2})"><div class="tp"><div class="lg2">${BL.html(b, 46)}<div><div class="kd">${esc(KIND[b.kind] || 'Bank account')}${b.currency && b.currency !== 'PKR' ? ' &middot; ' + esc(b.currency) : ''}</div><div class="bn">${esc(b.bank || b.title)}</div><div class="tt">${esc(b.title)}${b.branch ? ' &middot; ' + esc(b.branch) : ''}</div></div></div>${qr ? `<img class="qr" src="${qr}" alt="QR">` : ''}</div>${f('Account no.', b.account)}${f('IBAN', b.iban)}${f('Wallet no.', b.wallet)}${f('Raast ID', b.raast)}${f('SWIFT', b.swift)}${b.instructions ? `<div class="in">${esc(b.instructions)}</div>` : ''}</div>`;
}
async function bankPageHtml(req) {
  const c = db.settings.company, list = publicBanks(), cards = (await Promise.all(list.map(bankCard))).join(''), pi = db.settings.payments.instructions;
  const wa = String(c.whatsapp || c.phone || '').replace(/\D/g, '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Bank accounts - ${esc(c.name)}</title><meta name="description" content="Official bank accounts, JazzCash, Easypaisa and Raast details of ${esc(c.name)}."><meta name="theme-color" content="#083d2b"><meta property="og:type" content="website"><meta property="og:title" content="Bank accounts - ${esc(c.name)}"><meta property="og:description" content="Official bank accounts and wallets for payments to ${esc(c.name)}."><meta property="og:image" content="${esc(ogBase() || origin(req))}/brand/og-image.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/favicon.ico"><style>${CSS}</style>${BANK_CSS}<style>.w{max-width:560px;margin:0 auto;padding:18px}.hd2{text-align:center;padding:14px 0 6px}.hd2 img{height:60px}.hd2 h1{font:700 24px Georgia,serif;color:var(--g9);margin-top:8px}.hd2 p{color:var(--mute);margin-top:4px}.note{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px;margin-top:12px;color:var(--ink)}.ft{text-align:center;color:var(--mute);font-size:11px;margin:20px 0}.act{display:flex;gap:8px;margin-top:12px}.act a{flex:1;text-align:center;padding:13px;border-radius:12px;font:700 14px inherit;text-decoration:none;background:var(--g9);color:#fff}.act a.alt{background:#fff;color:var(--g9);border:1px solid var(--g9)}</style></head><body><div class="w"><div class="hd2"><img src="${logoUrl()}" alt=""><h1>Our bank accounts</h1><p>${esc(c.name)} &middot; pay by bank transfer, Raast or mobile wallet</p></div>
${cards || '<div class="note">No bank accounts are published right now. Please contact us for payment details.</div>'}
${pi ? `<div class="note">${esc(pi)}</div>` : ''}<div class="note"><b>After you pay</b><br>Send us the receipt and your name / booking number so we can credit your account quickly. Agents can add a payment record from their portal in one tap.</div>
<div class="act"><a href="/">Agent login</a>${wa ? `<a class="alt" href="https://wa.me/${wa}?text=${encodeURIComponent('Hello, I have made a payment. Receipt attached.')}">Send receipt on WhatsApp</a>` : ''}</div>
<div class="ft">${esc(c.name)} ${esc([c.phone, c.email].filter(Boolean).join(' · '))}</div></div>${BANK_JS}</body></html>`;
}

async function payPageHtml(l, req, msg) {
  const c = db.settings.company, pty = party(l.partyId), pf = require('./integrations').pfConfigured();
  const banks = await Promise.all(liveBanks().map(bankCard));
  const open = l.status === 'Open';
  const css = BANK_CSS + `<style>.pay{max-width:520px;margin:0 auto;padding:18px}.card{background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(7,53,38,.12);padding:22px;margin-bottom:14px}.card img.lg{height:64px;display:block;margin:0 auto 10px}.amt{font:800 34px Georgia,serif;color:var(--g9);text-align:center}.sub{text-align:center;color:var(--mute);margin:2px 0 14px}.m{color:var(--mute)}
.btn{display:block;width:100%;border:0;border-radius:12px;padding:14px;font:700 15px inherit;cursor:pointer;background:var(--g9);color:#fff;margin-top:8px}.btn.alt{background:#fff;color:var(--g9);border:1px solid var(--g9)}.bk{display:flex;gap:12px;justify-content:space-between;align-items:center;border:1px solid var(--line);border-radius:12px;padding:12px;margin:8px 0}.bk img{width:96px;height:96px;object-fit:contain}code{background:#f4f1e8;padding:1px 6px;border-radius:5px;font-size:12px}
input{width:100%;padding:11px;border:1px solid var(--line);border-radius:10px;font:inherit;margin-top:6px}.ok{background:#e2f4ea;color:#0f7a4f;padding:12px;border-radius:10px;font-weight:700;text-align:center}.er{background:#fdeceb;color:var(--red);padding:12px;border-radius:10px;font-weight:700;text-align:center;margin-bottom:10px}h3{font:800 11px inherit;letter-spacing:.16em;text-transform:uppercase;color:var(--au);margin-bottom:6px}</style>`;
  const body = `<div class="pay"><div class="card"><img class="lg" src="${logoUrl()}" alt=""><div class="amt">${money(l.amt)}</div><div class="sub">${esc(l.purpose)}<br>For ${esc(pty ? pty.name : '')} &middot; ${esc(c.name)}</div>
${msg ? `<div class="${msg.ok ? 'ok' : 'er'}">${esc(msg.t)}</div>` : ''}${l.status === 'Paid' ? '<div class="ok">Paid - thank you.</div>' : !open ? `<div class="er">This payment link is ${esc(l.status.toLowerCase())}.</div>` : ''}
${open ? `${pf ? '<h3>Pay online</h3><button class="btn" id="pf">Pay with card / wallet / bank (PayFast)</button>' : ''}
${banks.length ? '<h3 style="margin-top:18px">Bank transfer</h3>' + banks.join('') + `<h3 style="margin-top:14px">Upload your transfer receipt</h3><input id="ref" placeholder="Transaction reference (optional)"><input id="fl" type="file" accept="image/*,.pdf"><button class="btn alt" id="sub">Submit receipt for approval</button>` : (pf ? '' : '<div class="er">No payment method is available yet. Please contact ' + esc(c.name) + '.</div>')}` : ''}</div>
<div class="m" style="text-align:center;font-size:11px">${esc(c.name)} ${esc([c.phone, c.email].filter(Boolean).join(' &middot; '))}</div></div>
${BANK_JS}<script>
const T=${JSON.stringify(l.token)},j=(u,b)=>fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})}).then(r=>r.json());
const pf=document.getElementById('pf');if(pf)pf.onclick=async()=>{pf.disabled=true;pf.textContent='Redirecting...';const r=await j('/pay/'+T+'/start');if(r.error){alert(r.error);pf.disabled=false;pf.textContent='Pay with card / wallet / bank (PayFast)';return}
const f=document.createElement('form');f.method='POST';f.action=r.action;Object.entries(r.fields).forEach(([k,v])=>{const i=document.createElement('input');i.type='hidden';i.name=k;i.value=v;f.appendChild(i)});document.body.appendChild(f);f.submit()};
const sub=document.getElementById('sub');if(sub)sub.onclick=async()=>{const fl=document.getElementById('fl').files[0];if(!fl){alert('Choose your receipt image or PDF');return}
if(fl.size>6e6){alert('File too large (max 6 MB)');return}const d=await new Promise(r=>{const x=new FileReader();x.onload=()=>r(x.result);x.readAsDataURL(fl)});
sub.disabled=true;const r=await j('/pay/'+T+'/proof',{ref:document.getElementById('ref').value,file:{name:fl.name,data:d}});if(r.error){alert(r.error);sub.disabled=false}else location.href='/pay/'+T+'?sent=1'};
</script>`;
  return page('Pay ' + money(l.amt) + ' - ' + c.name, body, css, 'Secure payment request of ' + money(l.amt) + (l.purpose ? ' for ' + l.purpose : '') + '. Pay by card, wallet or bank transfer.');
}

const infoPage = (title, msg, ok, back = '/') => page(title, `<div style="max-width:460px;margin:12vh auto;padding:18px"><div style="background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(7,53,38,.12);padding:28px;text-align:center"><img src="${logoUrl()}" style="height:70px;margin-bottom:14px" alt=""><h1 style="font:700 22px Georgia,serif;color:${ok ? '#0f7a4f' : '#b42318'}">${esc(title)}</h1><p style="margin:10px 0 18px;color:#66736c">${esc(msg)}</p><a href="${back}" style="display:inline-block;background:#073526;color:#fff;border-radius:10px;padding:11px 22px;font-weight:700;text-decoration:none">Back to ${esc(db.settings.company.name)}</a></div></div>`);

module.exports = { rememberHost, voucherHtml, receiptHtml, payPageHtml, infoPage, esc, bankPageHtml, publicBanks };
