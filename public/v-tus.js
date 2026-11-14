/* The Umrah Store v5: service switches, brand filter, Meezab seat sync console, bank accounts workspace, module-aware navigation.
 * Loaded last. Uses the same state (S), rpc, modal and action helpers as every other view. */
(function () {
'use strict';

/* ---------- which routes belong to which service (mirrors lib/modules.js) ---------- */
const MOD_ROUTES = { groups: ['groups'], search: ['flights', 'hotels'], transport: ['transport'], calculator: ['packages'], bookings: ['bookings'], payments: ['payments'], banking: ['bank'], reports: ['reports'] };
const modOn = k => !S.modules || S.modules[k] !== false;
const routeOn = name => !MOD_ROUTES[name] || MOD_ROUTES[name].some(modOn);
/* a disabled service shows an explanation instead of its screen; stored records are never touched */
['groups', 'search', 'transport', 'calculator', 'banking'].forEach(name => {
  const v = VIEWS[name]; if (!v || v.__gated) return; const orig = v.render; v.__gated = true;
  v.render = function (...a) {
    if (routeOn(name)) return orig.apply(this, a);
    return `<div class="ph"><div><h1>${esc(v.title || 'Service')}</h1></div></div>` + empty('shield', 'This service is switched off', isAdmin() ? 'Nothing was deleted. Turn it back on in Services & sync.' : 'It is not available right now. Please contact us if you need it.');
  };
});

/* ---------- Services & sync (administrator) ---------- */
const SVC = [
  ['groups', 'Group packages', 'layers', 'Group inventory, live seat counts, public group page'],
  ['hotels', 'Hotels', 'bed', 'Hotel search, Makkah and Madinah pages'],
  ['flights', 'Flights', 'plane', 'Live flight search and flight lines'],
  ['transport', 'Transport', 'bus', 'Vehicles, routes and fares'],
  ['visa', 'Umrah visa', 'file', 'Visa pricing and public page'],
  ['packages', 'Packages', 'terminal', 'Umrah package calculator'],
  ['wallet', 'Agent wallet', 'wallet', 'Credit limit and balance widgets'],
  ['bank', 'Bank accounts', 'building', 'Accounts shown to agents and publicly'],
  ['bookings', 'Bookings', 'briefcase', 'Create and manage bookings and vouchers'],
  ['payments', 'Payments', 'receipt', 'Record, approve and pay online'],
  ['reports', 'Reports', 'chart', 'Sales, profit and exports']
];
const SY = { tab: 'services', busy: false, prev: '' };
const ago = iso => { if (!iso) return 'never'; const s = Math.max(0, (Date.now() - new Date(iso)) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : fdate(iso.slice(0, 10)); };
const SYNC_LBL = { ok: ['Healthy', 'green'], error: ['Retrying', 'amber'], needs_reauth: ['Needs sign-in', 'red'], idle: ['Waiting', 'gray'], disabled: ['Off', 'gray'] };

function svcTab() {
  return `<div class="card cp"><div class="ch"><h3>Services</h3><span class="sub">Switch a service off to hide it everywhere. Data is kept and returns when you switch it back on.</span></div>
  <div class="svg-grid">${SVC.map(([k, label, icon, hint]) => `<label class="svc ${modOn(k) ? 'on' : ''}"><span class="svi">${ic(icon)}</span><span class="svt"><b>${label}</b><small>${hint}</small></span><input type="checkbox" class="sw" data-mod="${k}" ${modOn(k) ? 'checked' : ''}><i class="swt"></i></label>`).join('')}</div>
  <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn pri" data-act="saveMods">${ic('check', 'sm')}Save services</button></div></div>`;
}
ACT.saveMods = (a, btn) => { const modules = {}; document.querySelectorAll('[data-mod]').forEach(i => { modules[i.dataset.mod] = i.checked; }); doRpc(btn, 'saveModules', { modules }, 'Services updated').catch(() => {}); };

function brandTab() {
  const b = S.brandFilter || { enabled: true, replacement: 'The Umrah Store', terms: ['Meezab Group CRM', 'Meezab Group', 'Meezab'] };
  return `<div class="card cp"><div class="ch"><h3>Restricted brand names</h3><span class="sub">Replaced in everything agents and the public can see: packages, descriptions, search, notifications, exports, vouchers and page titles. Stored records, supplier references and audit logs keep the original wording.</span></div>
  <div class="grid2"><div class="fld"><label>Restricted names (one per line)</label><textarea id="bfTerms" rows="7">${esc((b.terms || []).join('\n'))}</textarea></div>
  <div><div class="fld"><label>Replace with</label><input id="bfRep" value="${esc(b.replacement || 'The Umrah Store')}"></div>
  <label class="chk" style="margin:10px 0"><input type="checkbox" id="bfOn" ${b.enabled !== false ? 'checked' : ''}> Filter is active</label>
  <div class="fld"><label>Try it</label><textarea id="bfTry" rows="3" placeholder="Paste text to preview the result">Umrah group via Meezab Group CRM</textarea></div>
  <button class="btn sm" data-act="bfPreview">${ic('eye', 'sm')}Preview</button><div id="bfOut" class="okbox" style="margin-top:10px;display:none"></div></div></div>
  <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn pri" data-act="bfSave">${ic('check', 'sm')}Save brand filter</button></div></div>`;
}
const bfBody = () => ({ terms: val('bfTerms'), replacement: val('bfRep'), enabled: $('#bfOn').checked });
ACT.bfPreview = async () => { try { const r = await rpc('previewBrand', { ...bfBody(), text: val('bfTry') }); const o = $('#bfOut'); o.style.display = 'block'; o.textContent = r.text || '(empty)'; } catch (e) { toast(e.message, true); } };
ACT.bfSave = (a, btn) => doRpc(btn, 'saveBrandFilter', bfBody(), 'Brand filter saved').catch(() => {});

function syncTab() {
  const z = S.seatSyncAdmin; if (!z) return empty('shield', 'Not available', 'Only administrators can manage seat sync.');
  const [lbl, col] = SYNC_LBL[z.status] || SYNC_LBL.idle, h = z.history || [], sum = z.summary;
  const reauth = z.status === 'needs_reauth';
  return `${!z.configured ? `<div class="warnbox" style="margin-bottom:14px"><b>Not configured on the server.</b> Set <code>MEEZAB_BASE_URL</code>, <code>MEEZAB_GROUPS_PATH</code>, <code>MEEZAB_USERNAME</code> and <code>MEEZAB_PASSWORD</code> in the hosting environment, then restart. Credentials are never entered or stored here.</div>` : ''}
  ${reauth ? `<div class="warnbox" style="margin-bottom:14px"><b>Sign-in needed.</b> ${esc(z.lastError)}<br>Sign in to the supplier CRM in your own browser, copy the session cookie and paste it below. We never bypass CAPTCHA or verification codes.</div>` : ''}
  <div class="kpis"><div class="kpi"><span>Status</span><b>${badge('x', lbl).replace('gray', col)}</b></div><div class="kpi"><span>Last successful sync</span><b style="font-size:16px">${z.lastOkAt ? ago(z.lastOkAt) : 'never'}</b><small class="sub">${z.lastOkAt ? esc(new Date(z.lastOkAt).toLocaleString()) : ''}</small></div>
  <div class="kpi"><span>Groups matched</span><b>${sum ? sum.matched : '-'}</b><small class="sub">${sum ? sum.changed + ' changed, ' + sum.soldOut + ' sold out' : ''}</small></div><div class="kpi"><span>Next run</span><b style="font-size:16px">${z.nextAt && z.enabled ? new Date(z.nextAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}</b></div></div>
  <div class="gap"></div><div class="card cp"><div class="row sb" style="flex-wrap:wrap;gap:12px"><div class="row" style="gap:16px;flex-wrap:wrap">
  <label class="chk"><input type="checkbox" id="ssOn" ${z.enabled ? 'checked' : ''}> Automatic sync</label>
  <label class="row" style="gap:8px">Every <select id="ssInt" style="width:auto">${[2, 3, 4, 5].map(n => `<option ${z.intervalMin === n ? 'selected' : ''}>${n}</option>`).join('')}</select> minutes</label>
  <button class="btn sm" data-act="ssSave">${ic('check', 'sm')}Save</button></div>
  <button class="btn pri" data-act="ssRun" ${z.running || !z.configured ? 'disabled' : ''}>${ic('activity', 'sm')}Sync now</button></div>
  <div class="hint" style="margin-top:10px">Read-only: the portal only reads remaining seats from <b>${esc(z.host || 'the supplier CRM')}</b>. It never creates groups, never changes supplier bookings or stock, and a missing or unreadable value is never treated as zero.</div></div>
  ${z.configured ? `<div class="gap"></div><div class="card cp"><div class="ch"><h3>Supply a fresh session</h3></div><div class="row" style="gap:10px;flex-wrap:wrap"><input id="ssCookie" type="password" autocomplete="off" placeholder="Paste the Cookie header value from your signed-in browser" style="flex:1;min-width:260px"><button class="btn" data-act="ssSess">${ic('key', 'sm')}Use this session</button></div>${z.canStoreSession ? '' : '<div class="hint">Stored in memory only (set MEEZAB_SECRET_KEY to keep it encrypted across restarts).</div>'}</div>` : ''}
  <div class="gap"></div><div class="card"><div class="ch"><h3>Sync history</h3><span class="sub">Latest 40 runs</span></div>
  ${h.length ? `<div class="tw"><table class="t"><thead><tr><th>When</th><th>By</th><th>Result</th><th class="num">Rows</th><th class="num">Matched</th><th class="num">Changed</th><th class="num">Unmatched</th><th class="num">Time</th></tr></thead><tbody>${h.map(e => `<tr><td>${esc(new Date(e.at).toLocaleString())}</td><td>${esc(e.manual ? 'Manual' : 'Auto')}${e.by && e.by !== 'scheduler' ? ' - ' + esc(e.by) : ''}</td><td>${e.ok ? '<span class="bdg green">OK</span>' : `<span class="bdg red">Failed</span> <small class="sub">${esc(e.error || '')}</small>`}</td><td class="num">${e.rows ?? '-'}</td><td class="num">${e.matched ?? '-'}</td><td class="num">${e.changed ?? '-'}</td><td class="num">${e.unmatched ?? '-'}</td><td class="num">${e.ms != null ? (e.ms / 1000).toFixed(1) + 's' : '-'}</td></tr>`).join('')}</tbody></table></div>` : empty('activity', 'No syncs yet', 'Run one with Sync now once the server is configured.')}</div>`;
}
const ssBusy = (on, btn) => { SY.busy = on; if (btn) btn.disabled = on; };
ACT.ssSave = (a, btn) => doRpc(btn, 'saveSeatSync', { enabled: $('#ssOn').checked, intervalMin: +val('ssInt') }, 'Seat sync settings saved').catch(() => {});
ACT.ssRun = async (a, btn) => { ssBusy(true, btn); try { const r = await api('/api/seatsync/run', { method: 'POST', body: JSON.stringify({}) }); toast(r.ok ? 'Seat sync finished' : (r.error || (r.entry && r.entry.error) || 'Seat sync failed'), !r.ok); await refresh(); } catch (e) { toast(e.message, true); } ssBusy(false, btn); };
ACT.ssSess = async (a, btn) => { ssBusy(true, btn); try { const r = await api('/api/seatsync/session', { method: 'POST', body: JSON.stringify({ cookie: val('ssCookie') }) }); toast(r.ok ? 'Signed in. Seats synced.' : (r.error || 'Session saved'), !r.ok); await refresh(); } catch (e) { toast(e.message, true); } ssBusy(false, btn); };

VIEWS.services = {
  title: 'Services & sync', roles: ['admin'], noLive: false,
  render() {
    const z = S.seatSyncAdmin, bad = z && (z.status === 'needs_reauth'), sz = S.supplierSyncAdmin, sbad = sz && (sz.status === 'needs_reauth' || sz.status === 'error'), mon = S.maintenance && S.maintenance.on;
    const tabs = [['services', 'Services'], ['supplier', 'Supplier sync' + (sbad ? ' !' : '')], ['maint', 'Maintenance' + (mon ? ' (ON)' : '')], ['sync', 'Legacy seat sync' + (bad ? ' !' : '')], ['brand', 'Brand filter']];
    return `<div class="ph"><div><h1>Services & sync</h1><p>Choose what is live, keep supplier seats current, and keep supplier names out of agent view</p></div></div>
    <div class="tabs">${tabs.map(([k, l]) => `<button class="${SY.tab === k ? 'on' : ''}" data-act="syTab" data-a="${k}">${l}</button>`).join('')}</div><div class="gap"></div>
    ${SY.tab === 'supplier' && window.supplierTab ? window.supplierTab() : SY.tab === 'maint' && window.maintTab ? window.maintTab() : SY.tab === 'sync' ? syncTab() : SY.tab === 'brand' ? brandTab() : svcTab()}`;
  }
};
ACT.syTab = k => { SY.tab = k; renderView(); };

/* ---------- Bank accounts workspace ---------- */
const BK = { q: '', kind: '', cur: '', st: '', vis: '', sort: 'order', view: 'grid', page: 1, per: 8 };
const BVIS = { public: 'Public + agents', agents: 'Agents only', staff: 'Staff only' };
function bankFiltered() {
  const staff = isStaff(), q = BK.q.trim().toLowerCase();
  let l = (S.bank || []).filter(b => staff || b.active !== false);
  if (q) l = l.filter(b => [b.bank, b.title, b.branch, b.account, b.iban, b.wallet, b.raast, b.currency].join(' ').toLowerCase().includes(q));
  if (BK.kind) l = l.filter(b => b.kind === BK.kind);
  if (BK.cur) l = l.filter(b => (b.currency || 'PKR') === BK.cur);
  if (BK.st) l = l.filter(b => (BK.st === 'active') === (b.active !== false));
  if (BK.vis) l = l.filter(b => (b.vis || 'public') === BK.vis);
  const by = { order: (a, b) => (a.order || 0) - (b.order || 0), bank: (a, b) => String(a.bank || a.title).localeCompare(b.bank || b.title), cur: (a, b) => String(a.currency).localeCompare(b.currency) };
  return l.slice().sort(by[BK.sort] || by.order);
}
const maskAcc = b => { const v = String(b.iban || b.account || b.wallet || b.raast || '').replace(/\s/g, ''); return v ? '\u2022\u2022\u2022 ' + v.slice(-4) : '-'; };
function bankRow(b) {
  const staff = isStaff(), edit = staff && can('settings.banking');
  return `<div class="bkr ${b.active === false ? 'off' : ''}"><div class="bkr-l">${BankLogo.html(b, 44)}<div class="bkr-t"><b>${esc(b.bank || b.title)} ${b.active === false ? '<span class="bdg gray">Inactive</span>' : ''}</b><span>${esc(b.title)} &middot; ${esc(BKIND[b.kind] || 'Bank')} &middot; ${maskAcc(b)}</span></div></div>
  <div class="bkr-m"><span class="chip">${esc(b.currency || 'PKR')}</span>${staff ? `<span class="chip soft">${esc(BVIS[b.vis || 'public'])}</span>` : ''}</div>
  <div class="bkr-a"><button class="btn sm" data-act="bkOpen" data-a="${esc(b.id)}">${ic('eye', 'sm')}Details</button>${edit ? `<button class="btn sm ghost" data-act="bkEdit" data-a="${esc(b.id)}">${ic('edit', 'sm')}Edit</button>` : ''}</div></div>`;
}
function bankPaint() {
  const all = bankFiltered(), pages = Math.max(1, Math.ceil(all.length / BK.per)); BK.page = Math.min(BK.page, pages);
  const rows = all.slice((BK.page - 1) * BK.per, BK.page * BK.per), act = [BK.q && 'Search: ' + BK.q, BK.kind && BKIND[BK.kind], BK.cur, BK.st && (BK.st === 'active' ? 'Active' : 'Inactive'), BK.vis && BVIS[BK.vis]].filter(Boolean);
  const host = $('#bkList'); if (!host) return;
  host.innerHTML = `${act.length ? `<div class="chips">${act.map(x => `<span class="chip on">${esc(x)}</span>`).join('')}<button class="lnk" data-act="bkClear">Clear all</button></div>` : ''}
  <div class="sub" style="margin:4px 0 10px">${all.length} account${all.length === 1 ? '' : 's'}</div>
  ${!rows.length ? empty('building', 'No accounts match', act.length ? 'Try removing a filter.' : 'No bank accounts have been added yet.') : BK.view === 'grid' ? `<div class="bkg2">${rows.map(b => bankCardHtml(b, `<div class="bka"><button class="btn sm pri" data-act="payAdd" data-a="" data-bank="${esc(b.id)}">${ic('check', 'sm')}I paid this account</button><button class="btn sm" data-act="copyBank" data-a="${esc(b.id)}">${ic('print', 'sm')}Copy</button>${isStaff() && can('settings.banking') ? `<button class="btn sm ghost" data-act="bkEdit" data-a="${esc(b.id)}">${ic('edit', 'sm')}Edit</button>` : ''}</div>`)).join('')}</div>` : `<div class="bkl">${rows.map(bankRow).join('')}</div>`}
  ${pages > 1 ? `<div class="pager"><button class="btn sm" ${BK.page < 2 ? 'disabled' : ''} data-act="bkPage" data-a="${BK.page - 1}">Previous</button><span>${Array.from({ length: pages }, (_, i) => `<button class="pg ${i + 1 === BK.page ? 'on' : ''}" data-act="bkPage" data-a="${i + 1}">${i + 1}</button>`).join('')}</span><button class="btn sm" ${BK.page >= pages ? 'disabled' : ''} data-act="bkPage" data-a="${BK.page + 1}">Next</button></div>` : ''}`;
  $('.vt', document) && document.querySelectorAll('.vt button').forEach(x => x.classList.toggle('on', x.dataset.a === BK.view));
}
ACT.bkPage = n => { BK.page = +n; bankPaint(); };
ACT.bkClear = () => { Object.assign(BK, { q: '', kind: '', cur: '', st: '', vis: '', page: 1 }); renderView(); };
ACT.bkView = v => { BK.view = v; bankPaint(); };
ACT.bkOpen = id => { const b = (S.bank || []).find(x => x.id === id); if (b) openModal({ title: b.bank || b.title, body: bankCardHtml(b, ''), foot: `<button class="btn" data-act="closeModal">Close</button>` }); };

const bkOld = VIEWS.banking.render;
VIEWS.banking.render = function () {
  if (!routeOn('banking')) return bkOld.call(this);
  const staff = isStaff(), banks = (S.bank || []).filter(b => staff || b.active !== false), pr = S.payRules || {}, w = S.wallet;
  const curs = [...new Set(banks.map(b => b.currency || 'PKR'))];
  const online = isAgent() && S.flags && S.flags.payfast, edit = staff && can('settings.banking');
  return `<div class="ph"><div><h1>Bank accounts</h1><p>${staff ? 'Control which accounts agents can pay into, and who can see them' : 'Pay into any account below, then add your payment record'}</p></div><div class="sp">${online ? `<button class="btn gold" data-act="payOnline">${ic('wallet')}Pay online</button>` : ''}${edit ? `<button class="btn pri" data-act="bkEdit" data-a="">${ic('plus')}Add account</button>` : ''}</div></div>
  ${w && modOn('wallet') ? `<div class="kpis"><div class="kpi"><span>Outstanding</span><b>${fmt(w.balance)}</b></div><div class="kpi"><span>Credit available</span><b class="${w.available < 0 ? 'neg' : 'pos'}">${fmtN(w.available)}</b></div><div class="kpi"><span>Awaiting approval</span><b>${fmt(w.pending)}</b></div></div><div class="gap"></div>` : ''}
  ${pr.instructions ? `<div class="okbox" style="margin-bottom:14px">${esc(pr.instructions)}</div>` : ''}
  <div class="toolbar"><div class="sbox">${ic('search', 'sm')}<input id="bkQ" placeholder="Search bank, title, account or IBAN" value="${esc(BK.q)}" autocomplete="off"></div>
  <select id="bkKind"><option value="">All types</option>${Object.entries(BKIND).map(([k, l]) => `<option value="${k}" ${BK.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
  <select id="bkCur"><option value="">All currencies</option>${curs.map(c => `<option ${BK.cur === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
  ${staff ? `<select id="bkSt"><option value="">Any status</option><option value="active" ${BK.st === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${BK.st === 'inactive' ? 'selected' : ''}>Inactive</option></select><select id="bkVis"><option value="">Any visibility</option>${Object.entries(BVIS).map(([k, l]) => `<option value="${k}" ${BK.vis === k ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}
  <select id="bkSort"><option value="order" ${BK.sort === 'order' ? 'selected' : ''}>Sort: Display order</option><option value="bank" ${BK.sort === 'bank' ? 'selected' : ''}>Sort: Bank name</option><option value="cur" ${BK.sort === 'cur' ? 'selected' : ''}>Sort: Currency</option></select>
  <div class="vt"><button data-act="bkView" data-a="grid" class="${BK.view === 'grid' ? 'on' : ''}" aria-label="Card view">${ic('grid', 'sm')}</button><button data-act="bkView" data-a="list" class="${BK.view === 'list' ? 'on' : ''}" aria-label="List view">${ic('list', 'sm')}</button></div></div>
  <div id="bkList"></div>
  ${pr.publicBankPage !== false && staff && banks.length ? `<div class="card cp" style="margin-top:14px"><div class="row sb" style="gap:10px;flex-wrap:wrap"><div><b>Public bank page</b><div class="sub">Shows only accounts marked Public: <span class="mono">${esc(location.origin)}/bank-accounts</span></div></div><button class="btn sm" data-act="copyPubLink">${ic('share', 'sm')}Copy link</button></div></div>` : ''}`;
};
/* live filtering without losing focus: the toolbar is outside #bkList */
document.addEventListener('input', e => { const t = e.target; if (t.id === 'bkQ') { BK.q = t.value; BK.page = 1; bankPaint(); } });
document.addEventListener('change', e => { const m = { bkKind: 'kind', bkCur: 'cur', bkSt: 'st', bkVis: 'vis', bkSort: 'sort' }[e.target.id]; if (m) { BK[m] = e.target.value; BK.page = 1; bankPaint(); } });
const bkRV = window.renderView; window.renderView = function () { bkRV.apply(this, arguments); if ($('#bkList')) bankPaint(); };

/* ---------- add / edit account ---------- */
const BKE = { logo: null };
ACT.bkEdit = id => {
  const b = (id && (S.bank || []).find(x => x.id === id)) || { kind: 'bank', currency: 'PKR', active: true, vis: 'public', theme: 'green', order: (S.bank || []).length + 1 };
  BKE.logo = b.logo || '';
  const f = (k, l, ph = '', extra = '') => `<div class="fld"><label>${l}</label><input data-bk="${k}" value="${esc(b[k] || '')}" placeholder="${ph}" ${extra}></div>`;
  openModal({ wide: true, title: id ? 'Edit account' : 'Add account', body: `<div class="grid2">
  <div class="fld"><label>Type</label><select data-bk="kind">${Object.entries(BKIND).map(([k, l]) => `<option value="${k}" ${b.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>${f('bank', 'Bank or wallet name', 'e.g. Meezan Bank')}
  ${f('title', 'Account title', 'Name on the account')}${f('branch', 'Branch')}${f('account', 'Account number')}${f('iban', 'IBAN', 'PK00 XXXX ...')}${f('swift', 'SWIFT / BIC')}${f('wallet', 'Wallet number')}${f('raast', 'Raast ID')}${f('currency', 'Currency', 'PKR')}
  <div class="fld"><label>Visible to</label><select data-bk="vis">${Object.entries(BVIS).map(([k, l]) => `<option value="${k}" ${(b.vis || 'public') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>${f('order', 'Display order', '1', 'type="number" min="0" max="999"')}
  <div class="fld"><label>Card colour</label><select data-bk="theme">${Object.keys(THEME).map(k => `<option ${b.theme === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div></div>
  <div class="fld"><label>Payment instructions shown to agents</label><textarea data-bk="instructions" rows="3">${esc(b.instructions || '')}</textarea></div>
  <div class="row" style="gap:14px;align-items:center;margin:8px 0"><div id="bkLogoPrev">${BKE.logo ? `<img src="${esc(BKE.logo)}" style="width:44px;height:44px;object-fit:contain;border-radius:10px;border:1px solid var(--line)">` : ''}</div><label class="btn sm">${ic('upload', 'sm')}Upload logo<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" id="bkLogo" hidden></label>${BKE.logo ? `<button class="btn sm ghost" data-act="bkLogoX">Remove logo</button>` : ''}</div>
  <label class="chk"><input type="checkbox" data-bk="active" ${b.active !== false ? 'checked' : ''}> Active (inactive accounts are hidden from agents and the public page)</label>`,
    foot: `${id ? `<button class="btn danger" style="margin-right:auto" data-act="bkDel" data-a="${esc(id)}">${ic('trash', 'sm')}Remove</button>` : ''}<button class="btn" data-act="closeModal">Cancel</button><button class="btn pri" data-act="bkSave" data-a="${esc(id || '')}">${ic('check', 'sm')}Save account</button>`,
    onOpen: m => { $('#bkLogo', m).addEventListener('change', ev => bkLogoRead(ev.target.files[0])); }
  });
};
function bkLogoRead(file) {
  if (!file) return; if (file.size > 600000) return toast('Logo is too large (max 600 KB)', true);
  const img = new Image(), r = new FileReader();
  r.onload = () => { img.onload = () => { const s = Math.min(1, 160 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s)); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); BKE.logo = c.toDataURL('image/png'); $('#bkLogoPrev').innerHTML = `<img src="${BKE.logo}" style="width:44px;height:44px;object-fit:contain;border-radius:10px;border:1px solid var(--line)">`; }; img.onerror = () => toast('That image could not be read', true); img.src = r.result; };
  r.readAsDataURL(file);
}
ACT.bkLogoX = () => { BKE.logo = ''; $('#bkLogoPrev').innerHTML = ''; };
function bkRead(root) { const o = {}; root.querySelectorAll('[data-bk]').forEach(i => { o[i.dataset.bk] = i.type === 'checkbox' ? i.checked : i.value; }); o.logo = BKE.logo || ''; return o; }
ACT.bkSave = (id, btn) => {
  const o = bkRead($('#modal')); if (!String(o.bank || o.title).trim()) return toast('Enter a bank name or account title', true);
  if (!(o.account || o.iban || o.wallet || o.raast)) return toast('Enter an account number, IBAN, wallet number or Raast ID', true);
  const cur = S.bank || [], prev = cur.find(x => x.id === id), item = { ...(prev || {}), ...o, id: id || undefined, public: o.vis === 'public', qr: prev ? prev.qr : '' };
  const list = id ? cur.map(x => (x.id === id ? item : x)) : [...cur, item];
  doRpc(btn, 'saveSettings', { bank: list }, 'Account saved', closeModal).catch(() => {});
};
ACT.bkDel = async (id, btn) => {
  if (!(await confirmBox('Remove this account?', 'It disappears from the portal and the public page. Past payments that used it keep their recorded details. You can set it Inactive instead.', 'Remove', true))) return;
  doRpc(btn, 'saveSettings', { bank: (S.bank || []).filter(x => x.id !== id) }, 'Account removed', closeModal).catch(() => {});
};

/* ---------- navigation: hide switched-off services, add Services & sync ---------- */
(function () {
  if (typeof window.nav !== 'function') return;
  const prune = () => document.querySelectorAll('#nav a.nx[href^="#/"]').forEach(a => { const n = (a.getAttribute('href') || '').slice(2).split('/')[0]; if (!routeOn(n)) a.style.display = 'none'; });
  const inject = () => { if (!isAdmin() || $('#navSvc')) return; const host = $('#nav'); const last = document.querySelector('#nav a[href="#/settings"]'); const a = document.createElement('a'); a.id = 'navSvc'; a.href = '#/services'; a.className = 'nx' + (route().name === 'services' ? ' on' : ''); a.innerHTML = `${ic('activity')}<span>Services & sync</span>${S.seatSyncAdmin && S.seatSyncAdmin.status === 'needs_reauth' ? '<i class="dot"></i>' : ''}`; (last && last.parentNode ? last.parentNode : host).insertBefore(a, last || null); };
  const wrap = fn => function () { const r = fn.apply(this, arguments); try { prune(); inject(); } catch { /* cosmetic only */ } return r; };
  window.nav = wrap(window.nav); if (window.renderShellBits) window.renderShellBits = wrap(window.renderShellBits);
  new MutationObserver(() => { try { prune(); inject(); } catch { /* cosmetic only */ } }).observe(document.body, { childList: true, subtree: true });
/* ---------- Dashboard v5 (staff / administrator): live business data, no placeholders ---------- */
const partyName = id => { const p = (S.parties || []).find(x => x.id == id); return p ? p.name : 'Unknown'; };
function dashV5() {
  const t = todayISO(), ym = t.slice(0, 7), bs = (S.bookings || []), pays = (S.payments || []), grp = (S.groups || []);
  const mo = bs.filter(b => live(b) && (b.created || '').slice(0, 7) === ym), sales = sum(mo, bSell), profit = sum(mo, b => bSell(b) - bCost(b));
  const recv = sum((S.parties || []).filter(p => p.kind !== 'supplier' && p.bal > 0), p => p.bal);
  const pendB = bs.filter(b => b.status === 'Pending'), pendP = pays.filter(p => p.status === 'Pending');
  const collected = sum(pays.filter(p => p.status === 'Approved' && (p.date || '').slice(0, 7) === ym), p => p.amt);
  const up = grp.filter(g => g.dep >= t).sort((a, b) => (a.dep < b.dep ? -1 : 1)), soldOut = up.filter(g => g.soldOut || g.seats <= 0 || (g.meezab && g.meezab.soldOut)), seatsLeft = sum(up.filter(g => !soldOut.includes(g)), g => g.seats);
  const next14 = up.filter(g => g.dep <= addDays(t, 14)).length;
  const by = {}; mo.forEach(b => { const a = by[b.partyId] || (by[b.partyId] = { id: b.partyId, n: 0, sell: 0 }); a.n++; a.sell += bSell(b); });
  const top = Object.values(by).filter(a => (S.parties || []).some(p => p.id == a.id && p.kind === 'agent')).sort((a, b) => b.sell - a.sell).slice(0, 5), topMax = Math.max(1, ...top.map(a => a.sell));
  const recent = bs.slice().sort((a, b) => ((b.created || '') < (a.created || '') ? -1 : 1)).slice(0, 7);
  const tx = pays.slice().sort((a, b) => (((b.created || b.date) || '') < ((a.created || a.date) || '') ? -1 : 1)).slice(0, 6);
  const nots = ((S.notifs || {}).items || []).slice(0, 4), z = S.seatSyncAdmin;
  const qa = [['groups', 'layers', 'Group packages', '#/groups'], ['bookings', 'plus', 'New booking', '#/bookingform/new'], ['payments', 'wallet', 'Record payment', '#/payments'], ['reports', 'chart', 'Reports', '#/reports'], ['bank', 'building', 'Bank accounts', '#/banking']].filter(([m]) => modOn(m));
  const pill = z && z.enabled ? `<a href="#/services" class="sync-pill ${z.status === 'ok' ? 'ok' : z.status === 'needs_reauth' || z.status === 'error' ? 'bad' : ''}" onclick="UI.setTab='sync'"><i></i>Seats ${z.status === 'ok' ? 'synced ' + ago(z.lastOkAt) : z.status === 'needs_reauth' ? 'need sign-in' : z.status === 'error' ? 'sync retrying' : 'waiting'}</a>` : '';
  return `<div class="dh"><div class="dh-hero"><div><h1>${greet()}, ${esc(S.user.name.split(' ')[0])}</h1><p class="sub">${esc(S.company.name)} &middot; ${fdow(t)}, ${fdate(t)}</p></div><div class="row" style="gap:10px;flex-wrap:wrap">${pill}</div></div>
  <div class="dh-qa">${qa.map(([, i, l, h]) => `<a href="${h}"><i>${ic(i)}</i>${l}</a>`).join('')}</div>
  <div class="kpis"><div class="kpi"><span>Bookings this month</span><b>${mo.length}</b><small class="sub">${fmt(sales)} sales &middot; ${fmt(profit)} profit</small></div>
  <div class="kpi"><span>Departures in 14 days</span><b>${next14}</b><small class="sub">${up.length} upcoming in total</small></div>
  <div class="kpi"><span>Seats available</span><b>${seatsLeft}</b><small class="sub">${soldOut.length} sold out</small></div>
  <div class="kpi"><span>Outstanding balance</span><b>${fmt(recv)}</b><small class="sub">${fmt(collected)} collected this month</small></div>
  <div class="kpi"><span>Awaiting approval</span><b>${pendB.length + pendP.length}</b><small class="sub">${pendB.length} booking(s) &middot; ${pendP.length} payment(s)</small></div></div>
  <div class="dh-cols"><div class="dh">
   <div class="card cp"><div class="ch"><h3>Upcoming departures</h3><a class="lnk" href="#/groups">All groups</a></div>${up.length ? up.slice(0, 6).map(g => { const out = soldOut.includes(g); return `<div class="li"><div class="mid"><b>${esc(g.code || g.id)} &middot; ${esc(g.airline || '')}</b><small>${fdate(g.dep)} to ${fdate(g.ret)} &middot; ${g.n || ''} nights</small></div>${out ? '<span class="bdg red">Sold out</span>' : `<span class="bdg ${g.seats <= 5 ? 'amber' : 'green'}">${g.seats} seats left</span>`}</div>`; }).join('') : empty('layers', 'No upcoming departures', 'Groups you add or sync will appear here.')}</div>
   <div class="card cp"><div class="ch"><h3>Recent bookings</h3><a class="lnk" href="#/bookings">View all</a></div>${recent.length ? `<div class="tw"><table class="t"><thead><tr><th>Booking</th><th>Agent</th><th>Traveller</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>${recent.map(b => `<tr style="cursor:pointer" onclick="go('booking','${esc(b.id)}')"><td><b>${esc(b.id)}</b><div class="sub">${fdate((b.created || '').slice(0, 10))}</div></td><td>${esc(partyName(b.partyId))}</td><td>${esc(lead(b))}</td><td>${badge(b.status)}</td><td class="num">${fmt(bSell(b))}</td></tr>`).join('')}</tbody></table></div>` : empty('briefcase', 'No bookings yet', 'New bookings will show up here.')}</div></div>
  <div class="dh">
   <div class="card cp"><div class="ch"><h3>Agent performance</h3><span class="sub">This month</span></div>${top.length ? top.map((a, i) => `<div class="li"><span class="rank">${i + 1}</span><div class="mid"><b>${esc(partyName(a.id))}</b><small>${a.n} booking(s) &middot; ${fmt(a.sell)}</small><div class="bar" style="margin-top:6px"><i style="width:${Math.round(a.sell / topMax * 100)}%"></i></div></div></div>`).join('') : empty('users', 'No agent sales this month', 'Rankings appear after the first booking.')}</div>
   <div class="card cp"><div class="ch"><h3>Recent transactions</h3><a class="lnk" href="#/payments">All</a></div>${tx.length ? tx.map(p => `<div class="li"><div class="mid"><b>${fmt(p.amt)}</b><small>${esc(partyName(p.partyId))} &middot; ${esc(p.method || '')}</small></div>${badge(p.status)}</div>`).join('') : empty('wallet', 'No payments recorded', 'Payments will appear here.')}</div>
   <div class="card cp"><div class="ch"><h3>Announcements & alerts</h3></div>${nots.length ? nots.map(n => `<div class="li"><div class="mid"><b>${esc(n.title)}</b><small>${esc((n.body || '').slice(0, 90))}</small></div></div>`).join('') : '<div class="sub" style="padding:8px 0">Nothing new.</div>'}</div>
  </div></div></div>`;
}
const homeOrig = VIEWS.home.render; VIEWS.home.render = function (...a) { return isStaff() ? dashV5() : homeOrig.apply(this, a); };

})();

/* ---------- group seats: show "sold out" automatically and when seats were confirmed ---------- */
window.seatBadge = g => { const out = g.soldOut || (g.seats != null && g.seats <= 0); return out ? '<span class="bdg red">Sold out</span>' : `<span class="bdg ${g.seats <= 5 ? 'amber' : 'green'}">${g.seats} left</span>`; };

/* ---------- Dashboard v5 (staff / administrator): live business data, no placeholders ---------- */
const partyName = id => { const p = (S.parties || []).find(x => x.id == id); return p ? p.name : 'Unknown'; };
function dashV5() {
  const t = todayISO(), ym = t.slice(0, 7), bs = (S.bookings || []), pays = (S.payments || []), grp = (S.groups || []);
  const mo = bs.filter(b => live(b) && (b.created || '').slice(0, 7) === ym), sales = sum(mo, bSell), profit = sum(mo, b => bSell(b) - bCost(b));
  const recv = sum((S.parties || []).filter(p => p.kind !== 'supplier' && p.bal > 0), p => p.bal);
  const pendB = bs.filter(b => b.status === 'Pending'), pendP = pays.filter(p => p.status === 'Pending');
  const collected = sum(pays.filter(p => p.status === 'Approved' && (p.date || '').slice(0, 7) === ym), p => p.amt);
  const up = grp.filter(g => g.dep >= t).sort((a, b) => (a.dep < b.dep ? -1 : 1)), soldOut = up.filter(g => g.soldOut || g.seats <= 0 || (g.meezab && g.meezab.soldOut)), seatsLeft = sum(up.filter(g => !soldOut.includes(g)), g => g.seats);
  const next14 = up.filter(g => g.dep <= addDays(t, 14)).length;
  const by = {}; mo.forEach(b => { const a = by[b.partyId] || (by[b.partyId] = { id: b.partyId, n: 0, sell: 0 }); a.n++; a.sell += bSell(b); });
  const top = Object.values(by).filter(a => (S.parties || []).some(p => p.id == a.id && p.kind === 'agent')).sort((a, b) => b.sell - a.sell).slice(0, 5), topMax = Math.max(1, ...top.map(a => a.sell));
  const recent = bs.slice().sort((a, b) => ((b.created || '') < (a.created || '') ? -1 : 1)).slice(0, 7);
  const tx = pays.slice().sort((a, b) => (((b.created || b.date) || '') < ((a.created || a.date) || '') ? -1 : 1)).slice(0, 6);
  const nots = ((S.notifs || {}).items || []).slice(0, 4), z = S.seatSyncAdmin;
  const qa = [['groups', 'layers', 'Group packages', '#/groups'], ['bookings', 'plus', 'New booking', '#/bookingform/new'], ['payments', 'wallet', 'Record payment', '#/payments'], ['reports', 'chart', 'Reports', '#/reports'], ['bank', 'building', 'Bank accounts', '#/banking']].filter(([m]) => modOn(m));
  const pill = z && z.enabled ? `<a href="#/services" class="sync-pill ${z.status === 'ok' ? 'ok' : z.status === 'needs_reauth' || z.status === 'error' ? 'bad' : ''}" onclick="UI.setTab='sync'"><i></i>Seats ${z.status === 'ok' ? 'synced ' + ago(z.lastOkAt) : z.status === 'needs_reauth' ? 'need sign-in' : z.status === 'error' ? 'sync retrying' : 'waiting'}</a>` : '';
  return `<div class="dh"><div class="dh-hero"><div><h1>${greet()}, ${esc(S.user.name.split(' ')[0])}</h1><p class="sub">${esc(S.company.name)} &middot; ${fdow(t)}, ${fdate(t)}</p></div><div class="row" style="gap:10px;flex-wrap:wrap">${pill}</div></div>
  <div class="dh-qa">${qa.map(([, i, l, h]) => `<a href="${h}"><i>${ic(i)}</i>${l}</a>`).join('')}</div>
  <div class="kpis"><div class="kpi"><span>Bookings this month</span><b>${mo.length}</b><small class="sub">${fmt(sales)} sales &middot; ${fmt(profit)} profit</small></div>
  <div class="kpi"><span>Departures in 14 days</span><b>${next14}</b><small class="sub">${up.length} upcoming in total</small></div>
  <div class="kpi"><span>Seats available</span><b>${seatsLeft}</b><small class="sub">${soldOut.length} sold out</small></div>
  <div class="kpi"><span>Outstanding balance</span><b>${fmt(recv)}</b><small class="sub">${fmt(collected)} collected this month</small></div>
  <div class="kpi"><span>Awaiting approval</span><b>${pendB.length + pendP.length}</b><small class="sub">${pendB.length} booking(s) &middot; ${pendP.length} payment(s)</small></div></div>
  <div class="dh-cols"><div class="dh">
   <div class="card cp"><div class="ch"><h3>Upcoming departures</h3><a class="lnk" href="#/groups">All groups</a></div>${up.length ? up.slice(0, 6).map(g => { const out = soldOut.includes(g); return `<div class="li"><div class="mid"><b>${esc(g.code || g.id)} &middot; ${esc(g.airline || '')}</b><small>${fdate(g.dep)} to ${fdate(g.ret)} &middot; ${g.n || ''} nights</small></div>${out ? '<span class="bdg red">Sold out</span>' : `<span class="bdg ${g.seats <= 5 ? 'amber' : 'green'}">${g.seats} seats left</span>`}</div>`; }).join('') : empty('layers', 'No upcoming departures', 'Groups you add or sync will appear here.')}</div>
   <div class="card cp"><div class="ch"><h3>Recent bookings</h3><a class="lnk" href="#/bookings">View all</a></div>${recent.length ? `<div class="tw"><table class="t"><thead><tr><th>Booking</th><th>Agent</th><th>Traveller</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>${recent.map(b => `<tr style="cursor:pointer" onclick="go('booking','${esc(b.id)}')"><td><b>${esc(b.id)}</b><div class="sub">${fdate((b.created || '').slice(0, 10))}</div></td><td>${esc(partyName(b.partyId))}</td><td>${esc(lead(b))}</td><td>${badge(b.status)}</td><td class="num">${fmt(bSell(b))}</td></tr>`).join('')}</tbody></table></div>` : empty('briefcase', 'No bookings yet', 'New bookings will show up here.')}</div></div>
  <div class="dh">
   <div class="card cp"><div class="ch"><h3>Agent performance</h3><span class="sub">This month</span></div>${top.length ? top.map((a, i) => `<div class="li"><span class="rank">${i + 1}</span><div class="mid"><b>${esc(partyName(a.id))}</b><small>${a.n} booking(s) &middot; ${fmt(a.sell)}</small><div class="bar" style="margin-top:6px"><i style="width:${Math.round(a.sell / topMax * 100)}%"></i></div></div></div>`).join('') : empty('users', 'No agent sales this month', 'Rankings appear after the first booking.')}</div>
   <div class="card cp"><div class="ch"><h3>Recent transactions</h3><a class="lnk" href="#/payments">All</a></div>${tx.length ? tx.map(p => `<div class="li"><div class="mid"><b>${fmt(p.amt)}</b><small>${esc(partyName(p.partyId))} &middot; ${esc(p.method || '')}</small></div>${badge(p.status)}</div>`).join('') : empty('wallet', 'No payments recorded', 'Payments will appear here.')}</div>
   <div class="card cp"><div class="ch"><h3>Announcements & alerts</h3></div>${nots.length ? nots.map(n => `<div class="li"><div class="mid"><b>${esc(n.title)}</b><small>${esc((n.body || '').slice(0, 90))}</small></div></div>`).join('') : '<div class="sub" style="padding:8px 0">Nothing new.</div>'}</div>
  </div></div></div>`;
}
const homeOrig = VIEWS.home.render; VIEWS.home.render = function (...a) { return isStaff() ? dashV5() : homeOrig.apply(this, a); };

})();
