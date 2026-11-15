/* Reports & expenses, settings, assistant */
'use strict';
/* ======================= REPORTS ======================= */
const RF = () => UI.rep || (UI.rep = { from: todayISO().slice(0, 8) + '01', to: todayISO(), tab: 'overview' });
function repData() {
  const f = RF(), bs = (S.bookings || []).filter(b => live(b) && b.created >= f.from && b.created <= f.to), ex = (S.expenses || []).filter(e => e.date >= f.from && e.date <= f.to);
  const pay = (S.payments || []).filter(p => p.status === 'Approved' && p.date >= f.from && p.date <= f.to);
  const sales = sum(bs, bSell), cost = sum(bs, bCost), exp = sum(ex, e => e.amt);
  const grp = (keyf, label) => { const m = {}; bs.forEach(b => { const k = keyf(b); (m[k] = m[k] || { k, n: 0, sell: 0, cost: 0 }); m[k].n++; m[k].sell += bSell(b); m[k].cost += bCost(b); }); return Object.values(m).sort((a, b) => b.sell - a.sell); };
  const byType = {}; bs.forEach(b => b.services.forEach(s => { const m = (byType[s.type] = byType[s.type] || { k: s.type, n: 0, sell: 0, cost: 0 }); m.n++; m.sell += lineSell(s); m.cost += lineCost(s); }));
  const bySup = {}; bs.forEach(b => b.services.forEach(s => { if (s.supId) { const m = (bySup[s.supId] = bySup[s.supId] || { k: s.supId, n: 0, cost: 0 }); m.n++; m.cost += lineCost(s); } }));
  return { bs, ex, pay, sales, cost, exp, gross: sales - cost, net: sales - cost - exp, cat: grp(b => b.category), agent: grp(b => b.partyId), type: Object.values(byType).sort((a, b) => b.sell - a.sell), sup: Object.values(bySup).sort((a, b) => b.cost - a.cost) };
}
const mg = (s, c) => (s ? Math.round((s - c) / s * 1000) / 10 + '%' : '-');
const brow = (r, name) => `<tr><td><b>${esc(name)}</b></td><td class="r num">${r.n}</td><td class="r num">${fnum(r.sell)}</td><td class="r num">${fnum(r.cost)}</td><td class="r num ${r.sell - r.cost < 0 ? 'neg' : 'pos'}">${fnum(r.sell - r.cost)}</td><td class="r num">${mg(r.sell, r.cost)}</td></tr>`;
const rtable = (rows, nameF, first) => rows.length ? `<div class="card tw"><table class="t"><thead><tr><th>${first}</th><th class="r">Bookings / lines</th><th class="r">Sales</th><th class="r">Cost</th><th class="r">Profit</th><th class="r">Margin</th></tr></thead><tbody>${rows.map(r => brow(r, nameF(r))).join('')}</tbody></table></div>` : `<div class="card">${empty('chart', 'No data in this period', 'Change the date range.')}</div>`;
VIEWS.reports = {
  roles: ['admin', 'staff'], title: 'Profit & reports',
  render() {
    const f = RF(), d = repData(), t = f.tab, ym = todayISO();
    const preset = (l, a, b) => `<button class="chip ${f.from === a && f.to === b ? 'on' : ''}" data-act="repPre" data-a="${a}|${b}">${l}</button>`;
    const mStart = ym.slice(0, 8) + '01', yStart = ym.slice(0, 4) + '-01-01', lm = (() => { let y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1; if (!m) { m = 12; y--; } return [y + '-' + p2(m) + '-01', y + '-' + p2(m) + '-' + p2(new Date(y, m, 0).getDate())]; })();
    return `<div class="ph"><div><h1>Profit & reports</h1><p>${fdate(f.from)} – ${fdate(f.to)} · ${d.bs.length} booking(s)</p></div><div class="sp">${can('reports.export') ? `<button class="btn" data-act="repCsv">${ic('download')}Export</button>` : ''}<button class="btn" data-act="ledPrint">${ic('print')}Print</button></div></div>
    <div class="fb no-print"><div class="fld"><span>From</span><input type="date" value="${f.from}" data-chg="repF" data-k="from"></div><div class="fld"><span>To</span><input type="date" value="${f.to}" data-chg="repF" data-k="to"></div><div class="qk">${preset('This month', mStart, ym)}${preset('Last month', lm[0], lm[1])}${preset('This year', yStart, ym)}${preset('Last 30 days', addDays(ym, -30), ym)}</div></div>
    <div class="stats"><div class="card stat hot"><div class="l">Net profit</div><div class="v">${fmt(d.net)}</div><div class="s">after ${fmt(d.exp)} expenses</div></div><div class="card stat"><div class="l">Sales</div><div class="v">${fmt(d.sales)}</div><div class="s">${d.bs.length} bookings</div></div><div class="card stat"><div class="l">Supplier cost</div><div class="v">${fmt(d.cost)}</div></div><div class="card stat"><div class="l">Gross profit</div><div class="v">${fmt(d.gross)}</div><div class="s">margin ${mg(d.sales, d.cost)}</div></div><div class="card stat"><div class="l">Collected</div><div class="v">${fmt(sum(d.pay.filter(p => p.dir === 'in'), p => p.amt))}</div><div class="s">approved receipts</div></div></div>
    <div class="tabs no-print" style="margin-bottom:14px">${[['overview', 'Overview'], ['category', 'By category'], ['agent', 'By agent'], ['type', 'By service'], ['supplier', 'Suppliers'], ['expenses', 'Expenses']].map(x => `<button class="${t === x[0] ? 'on' : ''}" data-act="repTab" data-a="${x[0]}">${x[1]}</button>`).join('')}</div>
    ${t === 'overview' ? `<div class="gm"><div class="card"><div class="ch"><h3>Sales - last 6 months</h3></div><div class="cp">${chart(monthSeries())}</div></div><div class="card"><div class="ch"><h3>Top agents</h3></div>${d.agent.slice(0, 6).map(r => `<div class="item"><div class="mid"><b>${esc(P(r.k).name)}</b><div class="sub">${r.n} booking(s)</div></div><b class="num">${fshortM(r.sell)}</b></div>`).join('') || '<div class="cp mute">No sales in this period.</div>'}</div></div>`
      : t === 'category' ? rtable(d.cat, r => r.k, 'Category') : t === 'agent' ? rtable(d.agent, r => P(r.k).name, 'Agent / customer') : t === 'type' ? rtable(d.type, r => SVC[r.k].label, 'Service')
      : t === 'supplier' ? `<div class="card tw"><table class="t"><thead><tr><th>Supplier</th><th class="r">Service lines</th><th class="r">Cost in period</th><th class="r">Paid in period</th><th class="r">Payable balance</th></tr></thead><tbody>${(S.parties || []).filter(p => p.kind === 'supplier').map(p => { const r = d.sup.find(x => x.k == p.id) || { n: 0, cost: 0 }; return `<tr class="click" data-act="goAcc" data-a="${p.id}"><td><b>${esc(p.name)}</b></td><td class="r num">${r.n}</td><td class="r num">${fnum(r.cost)}</td><td class="r num">${fnum(sum(d.pay.filter(x => x.partyId == p.id && x.dir === 'out'), x => x.amt))}</td><td class="r num"><b>${fnum(p.bal)}</b></td></tr>`; }).join('')}</tbody></table></div>`
      : expensesTab(d)}`;
  }
};
function expensesTab(d) {
  const byCat = {}; d.ex.forEach(e => { byCat[e.cat] = (byCat[e.cat] || 0) + e.amt; }), mx = Math.max(1, ...Object.values(byCat));
  return `<div class="row sb" style="margin-bottom:12px"><b>${fmt(d.exp)} in ${d.ex.length} expense(s)</b>${can('expenses.create') ? `<button class="btn pri" data-act="exNew">${ic('plus')}Add expense</button>` : ''}</div><div class="gm"><div class="card">${d.ex.length ? `<div class="tw"><table class="t"><thead><tr><th>Date</th><th>Category</th><th>Note</th><th class="r">Amount</th><th></th></tr></thead><tbody>${[...d.ex].sort((a, b) => b.date < a.date ? -1 : 1).map(e => `<tr><td class="num">${fdate(e.date)}</td><td><span class="tag">${esc(e.cat)}</span></td><td>${esc(e.note)}<div class="sub">${esc(e.id)} · ${esc(e.by)}</div></td><td class="r num"><b>${fnum(e.amt)}</b></td><td class="r">${can('expenses.delete') ? `<button class="btn sm ghost" data-act="exDel" data-a="${esc(e.id)}">${ic('trash', 'sm')}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('receipt', 'No expenses in this period', 'Record rent, salaries, marketing and other costs to see true net profit.', `<button class="btn pri" data-act="exNew">Add expense</button>`)}</div>
  <div class="card"><div class="ch"><h3>By category</h3></div><div class="cp g1">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div><div class="row sb sm"><span>${esc(k)}</span><b>${fnum(v)}</b></div><div class="bar"><i style="width:${v / mx * 100}%"></i></div></div>`).join('') || '<span class="mute">-</span>'}</div></div></div>`;
}
CHG.repF = (v, t) => { RF()[t.dataset.k] = v; renderView(); };
ACT.repTab = t => { RF().tab = t; renderView(); };
ACT.repPre = a => { const [f, t] = a.split('|'); Object.assign(RF(), { from: f, to: t }); renderView(); };
ACT.repCsv = async () => { if (isStaff()) { try { await rpc('logExport', { kind: 'report', what: RF().from + '..' + RF().to, rows: repData().bs.length }); } catch (e) { return toast(e.message, true); } } const d = repData(); downloadCSV('report-' + RF().from + '_' + RF().to + '.csv', [['Booking', 'Created', 'Category', 'Account', 'Sales', 'Cost', 'Profit'], ...d.bs.map(b => [b.no, b.created, b.category, P(b.partyId).name, bSell(b), bCost(b), bSell(b) - bCost(b)]), [], ['Expenses'], ...d.ex.map(e => [e.date, e.cat, e.note, e.amt])]); };
ACT.exNew = () => openModal({ title: 'Add expense', body: `<div class="g1"><div class="g2">${fld('Amount (PKR) *', '<input id="ex-a" type="number" min="1">')}${fld('Date', `<input id="ex-d" type="date" value="${todayISO()}">`)}</div>${fld('Category', `<select id="ex-c">${opts(S.expenseCats)}</select>`)}${fld('Note', '<input id="ex-n" placeholder="What was it for?">')}</div>`, foot: '<button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn pri" data-act="exSave">Save expense</button>' });
ACT.exSave = async (a, b) => { await doRpc(b, 'addExpense', { amt: val('ex-a'), date: val('ex-d'), cat: val('ex-c'), note: val('ex-n') }, 'Expense added', closeModal); };
ACT.exDel = async id => { if (await confirmBox('Delete expense', 'Remove this expense?', 'Delete', true)) await doRpc(null, 'delExpense', { id }, 'Expense deleted'); };

/* ======================= SETTINGS ======================= */
let BANK = null, waTimer = null;
const STABS = () => [['company', 'Company & logo', canAny('settings.company', 'settings.branding')], ['airlines', 'Airline logos', can('settings.airlines')], ['bank', 'Banking & QR', can('settings.banking')], ['pay', 'Payments', can('settings.payments')], ['rules', 'Bookings & pricing', canAny('settings.bookings', 'settings.pricing')], ['ai', 'AI assistant', canAny('integrations.view', 'integrations.manage')], ['email', 'Email & notifications', canAny('integrations.view', 'integrations.manage')], ['integrations', 'Integrations', canAny('integrations.view', 'integrations.manage')], ['cloud', 'Cloud Backup', isAdmin()], ['general', 'General & security', canAny('settings.general', 'settings.security')], ['team', 'Team', isAdmin()], ['data', 'Data & activity', canAny('data.import', 'data.backup', 'audit.view')]].filter(x => x[2]);
const st = () => { const t = STABS(); return t.some(x => x[0] === UI.setTab) ? UI.setTab : (t[0] ? t[0][0] : 'company'); };
const lock = (ids, perm) => { if (can(perm)) return; ids.forEach(i => { $$('#' + i + ',[data-act="' + i + '"]').forEach(e => { e.disabled = true; }); }); };
const lockPane = (id, perm) => { if (can(perm)) return; $$('#' + id + ' input,#' + id + ' select,#' + id + ' textarea,#' + id + ' button').forEach(e => { e.disabled = true; }); };
const tog = (id, on, title, sub, extra = '') => `<div class="sw"><div><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div><label class="tog"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${extra}><i></i></label></div>`;
const chk = id => { const e = $('#' + id); return !!(e && e.checked); };
VIEWS.settings = {
  roles: ['admin', 'staff'], title: 'Settings', noLive: true,
  render() {
    const t = st(), s = S.settings, c = s.company; clearInterval(waTimer);
    if (!BANK) BANK = JSON.parse(JSON.stringify(s.bank || []));
    const tabs = STABS();
    if (!tabs.length) return empty('shield', 'No settings available', 'Ask an administrator for access.');
    return `<div class="ph"><div><h1>Settings</h1><p>Company, airline logos, banking, payments, AI, integrations and security</p></div></div><div class="tabs stabs" style="margin-bottom:16px">${tabs.map(x => `<button class="${t === x[0] ? 'on' : ''}" data-act="setTab" data-a="${x[0]}">${x[1]}</button>`).join('')}</div><div id="pane">${({ company: tCompany, airlines: tAirlineLogos, bank: tBank, pay: tPay, rules: tRules, ai: tAi, email: tMail, integrations: tInt, cloud: tCloudBackup, general: tGen, team: tTeam, data: tData })[t](s, c)}</div>`;
  },
  mount() {
    const t = st(); if (t === 'integrations') waPoll(); if (t === 'data' && can('data.backup')) dsLoad(); if (t === 'cloud' && isAdmin()) cloudLoad();
    if (t === 'company') { lock(['c-n', 'c-t', 'c-p', 'c-wa', 'c-e', 'c-w', 'c-a', 'c-ntn', 'c-lic', 'c-tm', 'c-f', 'saveCompany'], 'settings.company'); lock(['logoPick', 'logoReset'], 'settings.branding'); }
    if (t === 'airlines') lockPane('pane', 'settings.airlines');
    if (t === 'bank') lockPane('pane', 'settings.banking');
    if (t === 'pay') lockPane('pane', 'settings.payments');
    if (t === 'rules') { lock(['r-c', 'r-e', 'r-p', 'sla-flight', 'sla-hotel', 'sla-visa', 'sla-transport', 'sla-package', 'sla-other'], 'settings.bookings'); lock(['r-m', 'r-g'], 'settings.pricing'); if (!canAny('settings.bookings', 'settings.pricing')) lock(['saveRules'], 'x'); }
    if (t === 'ai' || t === 'email' || t === 'integrations') { lockPane('pane', 'integrations.manage'); if (t === 'integrations') lock(['g-u'], 'settings.general'); }
    if (t === 'general') { lock(['g-u', 'g-tz', 'saveGen'], 'settings.general'); lock(['sec-d', 'sec-p', 'sec-l', 'saveSec'], 'settings.security'); }
  }
};
ACT.setTab = t => { UI.setTab = t; renderView(); };
const saveS = async (btn, p, msg = 'Settings saved') => { await doRpc(btn, 'saveSettings', p, msg); BANK = null; };
function tCompany(s, c) {
  return `<div class="gm"><div class="card cp"><div class="sec">Company details (appear on vouchers, receipts and statements)</div><div class="g2">${fld('Company name', `<input id="c-n" value="${esc(c.name)}">`)}${fld('Tagline', `<input id="c-t" value="${esc(c.tagline)}">`)}${fld('Phone', `<input id="c-p" value="${esc(c.phone)}">`)}${fld('WhatsApp number', `<input id="c-wa" value="${esc(c.whatsapp || '')}" placeholder="92300...">`)}${fld('Email', `<input id="c-e" value="${esc(c.email)}">`)}${fld('Website', `<input id="c-w" value="${esc(c.website)}">`)}${fld('Address', `<input id="c-a" value="${esc(c.address)}">`)}${fld('NTN / tax number', `<input id="c-ntn" value="${esc(c.ntn || '')}">`)}${fld('Travel licence no.', `<input id="c-lic" value="${esc(c.licence || '')}">`)}</div><div class="gap"></div>${fld('Voucher terms & conditions', `<textarea id="c-tm" rows="5">${esc(c.terms)}</textarea>`)}<div class="gap"></div>${fld('Footer line (vouchers & receipts)', `<input id="c-f" value="${esc(c.footer)}">`)}<div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn pri" data-act="saveCompany">Save company details</button></div></div>
  <div class="card cp"><div class="sec">Logo</div><div style="background:var(--bg);border-radius:14px;padding:18px;text-align:center"><img src="${logoUrl()}" style="max-width:190px;max-height:190px" alt=""></div><p class="hint" style="margin:10px 0">Used on the sign-in page, sidebar, vouchers, receipts and payment pages. A transparent PNG or SVG works best.</p><div class="row"><button class="btn pri" data-act="logoPick">${ic('upload', 'sm')}Upload logo</button><button class="btn" data-act="logoReset">Reset to default</button></div><input type="file" id="logo-f" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="hide" data-chg="logoUp"></div></div>`;
}
ACT.saveCompany = (a, b) => saveS(b, { company: { name: val('c-n'), tagline: val('c-t'), phone: val('c-p'), whatsapp: val('c-wa'), ntn: val('c-ntn'), licence: val('c-lic'), email: val('c-e'), website: val('c-w'), address: val('c-a'), terms: val('c-tm'), footer: val('c-f') } });
ACT.logoPick = () => $('#logo-f').click();
CHG.logoUp = async (v, t) => { const f = t.files[0]; if (!f) return; try { await rpc('setLogo', { data: await readFile(f) }); toast('Logo updated'); await refresh(); renderRoot(); } catch (e) { toast(e.message, true); } };
ACT.logoReset = async () => { await rpc('resetLogo'); toast('Logo reset'); await refresh(); renderRoot(); };
function tAirlineLogos(s) {
  const rows = Array.isArray(s.airlineLogos) ? s.airlineLogos : [];
  return `<div class="card cp"><div class="sec">Custom airline logos</div><p class="hint" style="margin:4px 0 14px">Upload a PNG, JPG or WebP logo once against its two-letter IATA code (for example SV, PK, EK). The same logo is used automatically on every group package, departure list, public package card and airline filter for that code. A custom upload takes priority over the default airline logo.</p><div class="g2" style="align-items:end"><div>${fld('IATA airline code', '<input id="al-code" maxlength="2" autocomplete="off" placeholder="SV" style="text-transform:uppercase">')}</div><div>${fld('Logo file', '<input id="al-file" type="file" accept="image/png,image/jpeg,image/webp" class="hide" data-chg="alLogoUp"><button class="btn" type="button" data-act="alLogoPick">' + ic('upload','sm') + 'Choose and upload logo</button>')}</div></div><p class="hint">Recommended: square transparent PNG, under 1.5 MB. The airline code must match the group flight code.</p></div><div class="card cp"><div class="row sb"><div><div class="sec" style="margin:0">Uploaded logos</div><p class="hint" style="margin:3px 0 0">${rows.length} custom airline logo(s) · version ${Number(S.airlineLogoV || 0)}</p></div><button class="btn sm" data-act="alLogoRefresh">Refresh</button></div>${rows.length ? `<div class="tw"><table class="t"><thead><tr><th>Preview</th><th>IATA code</th><th>File</th><th>Updated</th><th></th></tr></thead><tbody>${rows.map(x => `<tr><td><img src="${Engine.airLogo(x.code)}" alt="${esc(x.code)} logo" style="width:46px;height:46px;object-fit:contain;background:#fff;border:1px solid var(--line);border-radius:10px;padding:4px"></td><td><b>${esc(x.code)}</b></td><td>${esc(x.file)}</td><td class="num">${esc(x.updatedAt || '')}</td><td class="r"><button class="btn sm danger" data-act="alLogoDel" data-a="${esc(x.code)}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty" style="padding:28px">' + ic('plane','lg') + '<h3>No custom logos uploaded</h3><p>Default airline logos will continue to show until you upload your own.</p></div>'}</div>`;
}
ACT.alLogoPick = () => $('#al-file').click();
CHG.alLogoUp = async (v, t) => { const f = t.files && t.files[0], code = val('al-code').trim().toUpperCase(); if (!f) return; if (!/^[A-Z0-9]{2}$/.test(code)) return toast('Enter a valid two-character IATA airline code first.', true); if (!['image/png','image/jpeg','image/webp'].includes(f.type)) return toast('Use a PNG, JPG or WebP image.', true); if (f.size > 1.5 * 1024 * 1024) return toast('Logo must be 1.5 MB or smaller.', true); try { await rpc('setAirlineLogo', { code, data: await readFile(f) }); toast('Airline logo saved. All matching group packages are updated.'); await refresh(); } catch (e) { toast(e.message, true); } finally { t.value = ''; } };
ACT.alLogoDel = async code => { if (!await confirmBox('Remove custom airline logo', 'Remove the uploaded logo for ' + esc(code) + '? Matching packages will use the default airline logo.', 'Remove logo', true)) return; try { await rpc('deleteAirlineLogo', { code }); await refresh(); toast('Custom airline logo removed'); } catch (e) { toast(e.message, true); } };
ACT.alLogoRefresh = async () => { await refresh(); toast('Airline logo list refreshed'); };
const SW = { green: '#1f9a70', gold: '#c9a23f', navy: '#3b6fc4', maroon: '#b5314f', slate: '#64748b', teal: '#19a3a0' };
function tBank() {
  return `<div class="card cp"><div class="sec">Bank accounts, wallets and Raast IDs - shown to agents as cards, on payment links and (if enabled) on the public page</div>
  ${BANK.map((b, i) => `<div class="card cp" style="margin-bottom:14px;background:#faf9f4"><div class="row sb" style="margin-bottom:10px"><b>${ic('card', 'sm')} ${esc(b.bank || b.title || 'New account')}</b><div class="row"><button class="btn sm ghost" data-act="bkUp" data-a="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button><button class="btn sm ghost" data-act="bkDn" data-a="${i}" ${i === BANK.length - 1 ? 'disabled' : ''} title="Move down">↓</button></div></div>
  <div class="g2">${fld('Type', `<select data-chg="bk" data-i="${i}" data-f="kind">${opts([['bank', 'Bank account'], ['wallet', 'Mobile wallet (JazzCash / Easypaisa)'], ['raast', 'Raast ID']], b.kind || 'bank')}</select>`)}${fld('Card colour', `<select data-chg="bk" data-i="${i}" data-f="theme">${opts(Object.keys(SW).map(k => [k, k[0].toUpperCase() + k.slice(1)]), b.theme || 'green')}</select>`)}
  ${fld('Bank / wallet name', `<input value="${esc(b.bank)}" data-inp="bk" data-i="${i}" data-f="bank" placeholder="e.g. Meezan Bank">`)}${fld('Account title', `<input value="${esc(b.title)}" data-inp="bk" data-i="${i}" data-f="title" placeholder="Account holder name">`)}
  ${fld('Branch', `<input value="${esc(b.branch || '')}" data-inp="bk" data-i="${i}" data-f="branch">`)}${fld('Account number', `<input value="${esc(b.account)}" data-inp="bk" data-i="${i}" data-f="account">`)}
  ${fld('IBAN', `<input value="${esc(b.iban)}" data-inp="bk" data-i="${i}" data-f="iban" placeholder="PK00 XXXX ...">`)}${fld('SWIFT / BIC', `<input value="${esc(b.swift || '')}" data-inp="bk" data-i="${i}" data-f="swift">`)}
  ${fld('Wallet number', `<input value="${esc(b.wallet || '')}" data-inp="bk" data-i="${i}" data-f="wallet" placeholder="03xx xxxxxxx">`)}${fld('Raast ID', `<input value="${esc(b.raast || '')}" data-inp="bk" data-i="${i}" data-f="raast">`)}
  ${fld('Currency', `<input value="${esc(b.currency || 'PKR')}" data-inp="bk" data-i="${i}" data-f="currency" maxlength="6">`)}${fld('Instruction shown on the card', `<input value="${esc(b.instructions || '')}" data-inp="bk" data-i="${i}" data-f="instructions" placeholder="e.g. Write your agency name in the transfer note">`)}</div>
  ${tog('bk-a' + i, b.active !== false, 'Active', 'Inactive accounts are hidden from agents and payment links', `data-chg="bk" data-i="${i}" data-f="active"`)}${tog('bk-p' + i, b.public !== false, 'Show on the public bank page', 'Anyone with the link can see it (no login)', `data-chg="bk" data-i="${i}" data-f="public"`)}
  <div class="row" style="margin-top:10px">${b.qr ? `<img src="${esc(b.qr)}" style="width:70px;height:70px;object-fit:contain;border:1px solid var(--line);border-radius:8px;background:#fff">` : '<span class="hint">No QR uploaded - one is generated from the IBAN / account / wallet number.</span>'}<span style="display:inline-flex;align-items:center;gap:8px">${BankLogo.html(b, 40)}<button class="btn sm" data-act="bkLogo" data-a="${i}">${ic('upload', 'sm')}${b.logo ? 'Change logo' : 'Upload bank logo'}</button>${b.logo ? `<button class="btn sm ghost" data-act="settingsBkLogoX" data-a="${i}">Reset logo</button>` : ''}</span><input type="file" id="bkl-${i}" accept="image/*" class="hide" data-chg="bkLogoUp" data-i="${i}"><button class="btn sm" data-act="bkQr" data-a="${i}">${ic('qr', 'sm')}Upload bank QR</button>${b.qr ? `<button class="btn sm ghost" data-act="bkQrX" data-a="${i}">Remove QR</button>` : ''}<input type="file" id="bkq-${i}" accept="image/*" class="hide" data-chg="bkQrUp" data-i="${i}"><button class="btn sm ghost" style="margin-left:auto;color:var(--red)" data-act="settingsBkDel" data-a="${i}">${ic('trash', 'sm')}Remove</button></div>
  <details class="more" style="margin-top:12px"><summary>Preview as agents see it</summary><div style="margin-top:10px;max-width:380px">${bankCardHtml(b)}</div></details></div>`).join('') || '<div class="hint">No accounts yet. Add your first one below.</div>'}
  <div class="row" style="margin-top:12px"><button class="btn" data-act="bkAdd">${ic('plus', 'sm')}Add account</button><button class="btn pri" data-act="settingsBkSave">Save banking</button></div></div>`;
}
INP.bk = (v, t) => { BANK[t.dataset.i][t.dataset.f] = v; };
CHG.bk = (v, t) => { BANK[t.dataset.i][t.dataset.f] = v; if (['kind', 'theme'].includes(t.dataset.f)) renderView(); };
ACT.bkAdd = () => { BANK.push({ id: '', kind: 'bank', theme: 'green', title: '', bank: '', branch: '', account: '', iban: '', swift: '', wallet: '', raast: '', currency: 'PKR', instructions: '', active: true, public: true, qr: '' }); renderView(); };
ACT.settingsBkDel = async i => { if (await confirmBox('Remove account', 'Remove this account from the list? Past payment records keep their bank name.', 'Remove', true)) { BANK.splice(+i, 1); renderView(); } };
ACT.bkUp = i => { i = +i; if (i > 0) { [BANK[i - 1], BANK[i]] = [BANK[i], BANK[i - 1]]; renderView(); } };
ACT.bkDn = i => { i = +i; if (i < BANK.length - 1) { [BANK[i + 1], BANK[i]] = [BANK[i], BANK[i + 1]]; renderView(); } };
ACT.bkQr = i => $('#bkq-' + i).click();
ACT.bkLogo = i => $('#bkl-' + i).click();
ACT.settingsBkLogoX = i => { BANK[i].logo = ''; renderView(); };
CHG.bkLogoUp = async (v, t) => { const f = t.files[0]; if (f) { if (f.size > 150000) return toast('Logo must be under 150 KB', true); BANK[t.dataset.i].logo = await readFile(f); renderView(); } };
ACT.bkQrX = i => { BANK[+i].qr = ''; renderView(); };
CHG.bkQrUp = async (v, t) => { const f = t.files[0]; if (f) { if (f.size > 300000) return toast('QR image must be under 300 KB', true); BANK[t.dataset.i].qr = await readFile(f); renderView(); } };
ACT.settingsBkSave = (a, b) => saveS(b, { bank: BANK }, 'Banking saved');

/* ---- Payments ---- */
function tPay(s) {
  const p = s.payments;
  return `<div class="g2" style="align-items:start"><div class="card cp"><div class="sec">Agent payment rules</div>
  <div class="g2">${fld('Minimum payment record (PKR)', `<input id="pp-min" type="number" min="1" value="${p.minAmount}">`)}${fld('Auto-approve agent receipts up to (PKR, 0 = never)', `<input id="pp-auto" type="number" min="0" value="${p.autoApproveUnder}">`)}</div>
  ${tog('pp-agent', p.agentCanRecord, 'Agents can add payment records', 'Switch off to take this away from every agent')}${tog('pp-rc', p.requireReceipt, 'Receipt is required', 'Agents must attach a photo / PDF')}${tog('pp-ref', p.requireRef, 'Reference number is required', 'Agents must type the transaction ID')}${tog('pp-pub', p.publicBankPage, 'Public bank page', 'Lets anyone open /bank-accounts without logging in (accounts must also be marked public)')}
  <p class="hint" style="margin-top:8px">Auto-approve only applies when the agent attached a receipt. Staff with approval rights always post immediately.</p></div>
  <div class="g1"><div class="card cp"><div class="sec">Payment methods</div>${fld('One per line (shown directly on payment forms and printed on receipts)', `<textarea id="pp-methods" rows="6">${esc(p.methods.join('\n'))}</textarea>`)}</div>
  <div class="card cp"><div class="sec">Quick amounts</div>${fld('Buttons agents can tap (comma separated)', `<input id="pp-quick" value="${esc(p.quickAmounts.join(', '))}">`)}<div class="gap"></div>${fld('Note shown on the Bank accounts page and public page', `<textarea id="pp-ins" rows="3" placeholder="e.g. Payments are credited within 2 working hours.">${esc(p.instructions)}</textarea>`)}</div>
  <div class="row" style="justify-content:flex-end"><button class="btn pri" data-act="savePay">Save payment rules</button></div></div></div>`;
}
ACT.savePay = (a, b) => saveS(b, { payments: { minAmount: val('pp-min'), autoApproveUnder: val('pp-auto'), agentCanRecord: chk('pp-agent'), requireReceipt: chk('pp-rc'), requireRef: chk('pp-ref'), publicBankPage: chk('pp-pub'), methods: [...new Set(val('pp-methods').split(/\r?\n/).map(x => x.trim()).filter(Boolean))], quickAmounts: val('pp-quick').split(/[,\s]+/).filter(Boolean), instructions: val('pp-ins') } }, 'Payment rules saved');

/* ---- TUS Operations Copilot · OpenRouter ---- */
function tAi(s){
 const o=s.openrouter||{},keys=Array.isArray(o.keys)?o.keys:[];
 return `<div class="g2" style="align-items:start"><div class="card cp">
 <div class="row sb"><div><div class="sec" style="margin:0">OpenRouter · connection & key pool</div><p class="hint">Multiple keys, one OpenRouter endpoint. Keys are write-only.</p></div>${S.flags.ai?'<span class="bdg green">Ready</span>':'<span class="bdg gray">Not connected</span>'}</div>
 <p class="hint">${Number(o.keyCount||0)} saved key(s)${o.envKey?' · environment key detected':''}. Separate OpenRouter accounts have separate account limits; keys on one account share its quota.</p>
 ${fld('Add API keys (one per line)','<textarea id="ai-keys" rows="4" placeholder="Paste OpenRouter API keys here, one per line" autocomplete="off"></textarea>')}
 <div class="row"><button class="btn" data-act="aiTest">${ic('refresh','sm')}Test key & load models</button><a class="hint" href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener">Manage OpenRouter keys ↗</a></div><div id="ai-models" class="mdl"></div>
 ${fld('Chat model','<input id="ai-m" list="ai-ml" value="'+esc(o.model||'openai/gpt-oss-120b')+'"><datalist id="ai-ml"></datalist>')}
 ${fld('Image / vision model','<input id="ai-vm" list="ai-vml" value="'+esc(o.visionModel||'google/gemini-2.5-flash')+'"><datalist id="ai-vml"></datalist>')}
 <p class="hint">Image questions automatically use the selected vision model.</p>
 ${keys.length?`<div class="sec">Saved keys</div><table class="t"><tbody>${keys.map(k=>`<tr><td><code>${esc(k.masked||'OpenRouter key')}</code></td><td>${esc(k.source||'Saved')}</td><td><button class="btn sm danger" data-act="aiKeyDel" data-a="${esc(k.id)}">Remove</button></td></tr>`).join('')}</tbody></table>`:'<p class="hint">No saved keys yet.</p>'}
 </div><div class="card cp"><div class="sec">Assistant behaviour</div>
 ${tog('ai-on',o.enabled!==false,'Enable Operations Copilot','Turn off AI without deleting keys')}
 ${tog('ai-w',o.allowWrites!==false,'Allow permission-checked operations','Every proposed change requires confirmation and server revalidation.')}
 ${fld('Creativity (0 = precise)','<input id="ai-t" type="number" min="0" max="1" step="0.1" value="'+(o.temperature??.2)+'">')}
 ${fld('Maximum proposed changes','<input id="ai-x" type="number" min="1" max="20" value="'+(o.maxActions||10)+'">')}
 ${fld('Administrator instructions',`<textarea id="ai-i" rows="5" placeholder="Policies, response style, support instructions...">${esc(o.instructions||'')}</textarea>`)}
 <p class="hint">Admins: authorised CRM tools. Staff: group-package tools only, within their existing group permissions. Agents and suppliers cannot access this assistant.</p>
 <div class="row" style="justify-content:flex-end"><button class="btn pri" data-act="saveAi">Save Copilot settings</button></div></div></div>`;
}
ACT.saveAi=(a,b)=>saveS(b,{openrouter:{addKeys:val('ai-keys').split(/[\r\n,;]+/).map(x=>x.trim()).filter(Boolean),model:val('ai-m'),visionModel:val('ai-vm'),temperature:val('ai-t'),maxActions:val('ai-x'),enabled:chk('ai-on'),allowWrites:chk('ai-w'),instructions:val('ai-i')}},'Operations Copilot settings saved');
ACT.aiTest=async(a,b)=>{busy(b,true);const box=$('#ai-models');try{const keys=val('ai-keys').split(/[\r\n,;]+/).map(x=>x.trim()).filter(Boolean),r=await api('/api/ai/test',{method:'POST',body:JSON.stringify({key:keys[0]||''})});const fill=(id,arr)=>{const el=$('#'+id);if(el)el.innerHTML=arr.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name||m.id)+'</option>').join('');};fill('ai-ml',r.models||[]);fill('ai-vml',r.visionModels||[]);box.innerHTML='<div class="okbox">'+esc(r.message)+'</div><p class="hint">Chat: '+esc(r.recommended||'none')+' · vision: '+esc(r.visionRecommended||'none')+'</p>'+(r.models||[]).slice(0,8).map(m=>'<button class="chip" data-act="aiPick" data-a="'+esc(m.id)+'" data-b="chat">'+esc(m.id)+'</button>').join('')+(r.visionModels||[]).slice(0,8).map(m=>'<button class="chip" data-act="aiPick" data-a="'+esc(m.id)+'" data-b="vision">Vision · '+esc(m.id)+'</button>').join('');}catch(e){box.innerHTML='<div class="errbox">'+esc(e.message)+'</div>';}busy(b,false);};
ACT.aiPick=(m,k)=>{const el=$('#'+(k==='vision'?'ai-vm':'ai-m'));if(el)el.value=m;toast('Model selected. Save to apply.');};
ACT.aiKeyDel=async id=>{if(!await confirmBox('Remove OpenRouter key','Remove this saved key?','Remove key',true))return;try{await api('/api/ai/key/remove',{method:'POST',body:JSON.stringify({id})});await refresh();toast('Key removed');}catch(e){toast(e.message,true);}};
/* ---- General & security ---- */
function tGen(s) {
  const o = location.origin, sec = s.security || { sessionDays: 7, minPassword: 8, loginMax: 10 };
  return `<div class="g2" style="align-items:start"><div class="card cp"><div class="sec">General</div><div class="g1">${fld('Public address (used in payment links, vouchers and QR codes)', `<input id="g-u" value="${esc(s.baseUrl || '')}" placeholder="${o}">`)}${fld('Time zone', `<input id="g-tz" value="${esc(s.tz || 'Asia/Karachi')}" placeholder="Asia/Karachi">`)}</div><p class="hint" style="margin:8px 0">Public bank page: <span class="mono">${o}/bank-accounts</span></p><button class="btn pri" data-act="saveGen">Save general</button></div>
  <div class="card cp"><div class="sec">Security</div><div class="g3">${fld('Stay signed in (days)', `<input id="sec-d" type="number" min="1" max="60" value="${sec.sessionDays}">`)}${fld('Minimum password length', `<input id="sec-p" type="number" min="6" max="32" value="${sec.minPassword}">`)}${fld('Login attempts / 15 min', `<input id="sec-l" type="number" min="3" max="50" value="${sec.loginMax}">`)}</div><p class="hint" style="margin:8px 0">Session length applies to new sign-ins. Who may approve bookings and payments, or see supplier costs, is set per employee under <a href="#/staff">Staff & access</a>.</p><button class="btn pri" data-act="saveSec">Save security</button></div></div>`;
}
ACT.saveGen = (a, b) => saveS(b, { baseUrl: val('g-u'), tz: val('g-tz') }, 'General settings saved');
ACT.saveSec = (a, b) => saveS(b, { security: { sessionDays: val('sec-d'), minPassword: val('sec-p'), loginMax: val('sec-l') } }, 'Security settings saved');

/* ---- Cloudflare R2 encrypted database backups (administrator only) ---- */
let CLOUD = null;
const cloudWhen = v => { if (!v) return 'Not yet'; try { return new Intl.DateTimeFormat('en-PK', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(v)) + ' PKT'; } catch { return ftime(v) + ' (local time)'; } };
const cloudSize = n => Number(n) >= 1048576 ? (Number(n) / 1048576).toFixed(2) + ' MB' : Math.max(1, Math.round(Number(n || 0) / 1024)) + ' KB';
function tCloudBackup() {
  const c = CLOUD || {}, cfg = c.config || {};
  const state = !c.storageReady ? 'MySQL required' : c.configured ? 'Credentials saved' : 'Not configured';
  const badge = !c.storageReady ? 'red' : c.configured ? 'green' : 'amber';
  return `<div class="g1" id="cloud-backup-pane">
    <div class="card cp">
      <div class="row sb" style="align-items:flex-start;gap:12px"><div><div class="sec">Cloudflare R2 · encrypted database backups</div><p class="hint" style="margin:5px 0 0">Daily at 02:00 Pakistan time · latest 30 daily backups · MySQL records only</p></div><span class="bdg ${badge}">${esc(state)}</span></div>
      ${!c.storageReady ? `<div class="errbox" style="margin:12px 0">Cloud backups require the existing MySQL storage. No local-only backup will be created or reported as successful.</div>` : ''}
      ${c.error ? `<div class="errbox" style="margin:12px 0">Cloud Backup status error: ${esc(c.error)}</div>` : ''}
      ${!c.encryptionReady ? `<div class="errbox" style="margin:12px 0">A dedicated server-side encryption key is not configured. Add a stable <code>CLOUD_BACKUP_ENCRYPTION_KEY</code> (at least 32 characters) in Hostinger environment variables before saving R2 credentials.</div>` : `<div class="okbox" style="margin:12px 0">R2 credentials are encrypted at rest with AES-256-GCM. The Secret Access Key is never returned to this screen or any browser API.</div>`}
      <div class="g2">
        ${fld('Cloudflare Account ID', `<input id="cb-account" autocomplete="off" value="${esc(cfg.accountId || '')}" placeholder="32-character account ID">`)}
        ${fld('R2 Bucket Name', `<input id="cb-bucket" autocomplete="off" value="${esc(cfg.bucket || '')}" placeholder="the-umrah-store-backups">`)}
        ${fld('S3 API Endpoint', `<input id="cb-endpoint" autocomplete="url" value="${esc(cfg.endpoint || '')}" placeholder="https://ACCOUNT_ID.r2.cloudflarestorage.com">`)}
        ${fld('Access Key ID', `<input id="cb-access" autocomplete="off" value="${esc(cfg.accessKeyId || '')}" placeholder="R2 access key ID">`)}
        <div class="fld" style="grid-column:1/-1"><span>Secret Access Key</span><input id="cb-secret" type="password" autocomplete="new-password" placeholder="${c.configured ? 'Saved securely — leave blank to keep the current secret' : 'Paste the R2 secret access key'}"><small class="hint">The secret is encrypted on the server before it is saved. It is never displayed again.</small></div>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:12px;flex-wrap:wrap"><button class="btn" data-act="cloudReload">Refresh status</button><button class="btn pri" data-act="cloudSave" ${!c.storageReady || !c.encryptionReady ? 'disabled' : ''}>Save encrypted credentials</button></div>
    </div>
    <div class="g2" style="align-items:start">
      <div class="card cp">
        <div class="sec">Backup operations</div>
        <div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr));margin:10px 0">
          <div class="stat"><div class="l">Last successful backup</div><div class="v" style="font-size:14px">${esc(cloudWhen(c.lastSuccessAt))}</div></div>
          <div class="stat"><div class="l">Schedule</div><div class="v" style="font-size:14px">02:00 PKT</div></div>
        </div>
        <p class="hint">A backup is compressed and encrypted before upload. Each upload is checked by object size, SHA-256 metadata, full read-back SHA-256 and authenticated decryption.</p>
        <div class="row" style="margin-top:12px;flex-wrap:wrap"><button class="btn" data-act="cloudTest" ${!c.configured ? 'disabled' : ''}>Test R2 connection</button><button class="btn pri" data-act="cloudRun" ${!c.configured ? 'disabled' : ''}>${ic('cloud-upload','sm')}Backup Now</button></div>
        ${c.schedulerError ? `<div class="errbox" style="margin-top:12px">Scheduler: ${esc(c.schedulerError)}</div>` : ''}
        ${c.configError ? `<div class="errbox" style="margin-top:12px">${esc(c.configError)}</div>` : ''}
      </div>
      <div class="card cp">
        <div class="sec">What is included</div>
        <div class="item"><span class="bdg green">Included</span><div class="mid"><b>CRM database records</b><div class="sub">Bookings, vouchers, quotations, passengers, accounts, payments, ledgers, settings, users, permissions and audit records.</div></div></div>
        <div class="item"><span class="bdg gray">Excluded</span><div class="mid"><b>Uploads and documents</b><div class="sub">The separate MySQL <code>crm_files</code> table, receipts, KYC, chat attachments, logos and QR images are not copied to R2.</div></div></div>
        <div class="item"><span class="bdg gray">Protected</span><div class="mid"><b>Sessions</b><div class="sub">Login sessions are never included. Restores keep the currently signed-in sessions and current administrator password.</div></div></div>
        <p class="hint">A restore first creates a local MySQL pre-restore restore point. Uploaded files remain on the current server and are not restored from R2.</p>
      </div>
    </div>
    <div class="card cp">
      <div class="row sb" style="margin-bottom:12px"><div><div class="sec">Cloud backup history</div><p class="hint" style="margin:3px 0 0">${(c.history || []).length} recent run(s) · Daily retention: ${Number(c.retentionDaily || 30)} backups</p></div><button class="btn sm" data-act="cloudReload">Refresh</button></div>
      <div class="tw"><table class="t"><thead><tr><th>When</th><th>Type</th><th>Status</th><th>Size</th><th>Object / details</th><th></th></tr></thead><tbody>
      ${(c.history || []).map(x => `<tr><td class="num">${esc(cloudWhen(x.completedAt || x.lastAttemptAt || x.createdAt))}<div class="sub">${esc(x.triggeredBy || '')}</div></td><td>${esc(x.kind === 'daily' ? 'Daily' : 'Manual')}</td><td><span class="bdg ${x.status === 'success' ? 'green' : x.status === 'failed' ? 'red' : x.status === 'expired' ? 'gray' : 'amber'}">${esc(x.status)}</span>${x.attempts > 1 ? `<div class="sub">${x.attempts} attempts</div>` : ''}</td><td class="r num">${esc(cloudSize(x.size))}</td><td style="min-width:190px"><code style="overflow-wrap:anywhere">${esc(x.objectKey || x.error || 'Not uploaded')}</code>${x.sha256 ? `<div class="sub">SHA-256 ${esc(x.sha256.slice(0, 16))}…</div>` : ''}${x.error ? `<div class="sub err">${esc(x.error)}</div>` : ''}</td><td class="r">${x.status === 'success' ? `<button class="btn sm danger" data-act="cloudRestore" data-a="${esc(x.id)}">Restore</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="mute">No cloud backup attempts yet.</td></tr>'}
      </tbody></table></div>
    </div>
  </div>`;
}
async function cloudLoad() {
  const root = $('#pane');
  if (root && st() === 'cloud') root.innerHTML = '<div class="card cp"><p class="hint">Loading secure R2 status…</p></div>';
  try { CLOUD = await api('/api/cloud-backup/status'); }
  catch (e) { CLOUD = { storageReady: false, encryptionReady: false, error: e.message, history: [] }; }
  // Update this pane directly; do not re-run the settings mount hook (which would start another request).
  if (root && st() === 'cloud') root.innerHTML = tCloudBackup();
}
ACT.cloudReload = async () => { await cloudLoad(); };
ACT.cloudSave = async (a, b) => {
  const payload = { accountId: val('cb-account'), bucket: val('cb-bucket'), endpoint: val('cb-endpoint'), accessKeyId: val('cb-access'), secretAccessKey: val('cb-secret') };
  busy(b, true);
  try { await api('/api/cloud-backup/config', { method: 'POST', body: JSON.stringify(payload) }); toast('R2 credentials encrypted and saved'); await cloudLoad(); }
  catch (e) { toast(e.message, true); }
  finally { if (b) busy(b, false); }
};
ACT.cloudTest = async (a, b) => { busy(b, true); try { const r = await api('/api/cloud-backup/test', { method: 'POST', body: '{}' }); toast(r.message || 'R2 connection verified'); } catch (e) { toast(e.message, true); } finally { if (b) busy(b, false); } };
ACT.cloudRun = async (a, b) => { if (!await confirmBox('Start cloud backup now', 'The CRM database records will be compressed, encrypted and uploaded to Cloudflare R2. Uploaded documents and files are excluded.', 'Backup now')) return; busy(b, true); try { const r = await api('/api/cloud-backup/run', { method: 'POST', body: '{}' }); toast('Cloud backup uploaded and verified · revision ' + r.revision); await cloudLoad(); } catch (e) { toast(e.message, true); await cloudLoad(); } finally { if (b) busy(b, false); } };
ACT.cloudRestore = id => openModal({ title: 'Restore Cloudflare R2 backup', body: `<div class="g1"><div class="errbox"><b>This replaces the CRM database records with the selected cloud backup.</b><p>Before restoring, the server creates a MySQL pre-restore backup. Current sessions, administrator password, Cloud Backup configuration and current uploaded files are preserved. Files uploaded after the selected backup are not deleted.</p></div>${fld('Type RESTORE R2 to confirm', '<input id="cloud-restore-confirm" autocomplete="off" placeholder="RESTORE R2">')}</div>`, foot: `<button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn danger" data-act="cloudRestoreGo" data-a="${esc(id)}">Restore database</button>` });
ACT.cloudRestoreGo = async (id, b) => { if (val('cloud-restore-confirm') !== 'RESTORE R2') return toast('Type RESTORE R2 exactly to confirm.', true); busy(b, true); try { await api('/api/cloud-backup/' + encodeURIComponent(id) + '/restore', { method: 'POST', body: JSON.stringify({ confirm: 'RESTORE R2' }) }); closeModal(); toast('Cloud backup restored. Reloading CRM…'); setTimeout(() => location.reload(), 900); } catch (e) { toast(e.message, true); busy(b, false); } };
function tRules(s) {
  return `<div class="g2" style="align-items:start"><div class="card cp"><div class="sec">Booking rules</div><div class="g1">${fld('Booking categories (one per line)', `<textarea id="r-c" rows="8">${esc(s.categories.join('\n'))}</textarea>`)}${fld('Expense categories (one per line)', `<textarea id="r-e" rows="6">${esc(s.expenseCats.join('\n'))}</textarea>`)}${fld('Booking number prefix', `<input id="r-p" value="${esc(s.prefix)}" maxlength="6">`)}<p class="hint">Who may approve bookings, payments and see supplier costs is now set per employee under <a href="#/staff">Staff & access</a>.</p></div></div>
  <div class="g1"><div class="card cp"><div class="sec">Query response time (hours) - unanswered queries are auto-rejected</div><div class="g3">${Object.entries(s.sla).map(([k, v]) => fld(k[0].toUpperCase() + k.slice(1), `<input type="number" min="1" id="sla-${k}" value="${v}">`)).join('')}</div></div>
  <div class="card cp"><div class="sec">Pricing</div><div class="g2">${fld('Markup on live search results (%)', `<input id="r-m" type="number" step="0.5" value="${s.markupPct}">`)}${fld('Group package cost (% of sell)', `<input id="r-g" type="number" value="${s.groupCostPct}">`)}</div><p class="hint" style="margin-top:8px">Group cost % pre-fills the supplier cost when staff book a group package.</p></div>
  <div class="row" style="justify-content:flex-end"><button class="btn pri" data-act="saveRules">Save rules</button></div></div></div>`;
}
ACT.saveRules = (a, b) => {
  const p = {}, on = id => { const e = $('#' + id); return e && !e.disabled; };
  if (on('r-c')) Object.assign(p, { categories: val('r-c').split('\n'), expenseCats: val('r-e').split('\n'), prefix: val('r-p'), sla: Object.fromEntries(['flight', 'hotel', 'visa', 'transport', 'package', 'other'].map(k => [k, val('sla-' + k)])) });
  if (on('r-m')) Object.assign(p, { markupPct: val('r-m'), groupCostPct: val('r-g') });
  return saveS(b, p);
};
function tInt(s) {
  const pf = s.payfast, tp = s.travelport || {}, o = location.origin;
  return `<div class="g2" style="align-items:start"><div class="g1"><div class="card cp"><div class="row sb"><div class="sec" style="margin:0">PayFast checkout</div>${S.flags.payfast ? '<span class="bdg green">Configured</span>' : '<span class="bdg gray">Not configured</span>'}</div><div class="g2" style="margin-top:12px">${fld('Merchant ID', `<input id="pf-m" value="${esc(pf.merchantId)}">`)}${fld('Merchant name', `<input id="pf-n" value="${esc(pf.merchantName)}">`)}${fld('Secured key', `<input id="pf-k" type="password" value="${esc(pf.securedKey)}" autocomplete="off">`)}${fld('Store ID (optional)', `<input id="pf-s" value="${esc(pf.storeId)}">`)}${fld('Environment', `<select id="pf-e">${opts([['sandbox', 'Sandbox / test'], ['live', 'Live']], pf.env)}</select>`)}</div><p class="hint" style="margin:10px 0">Give PayFast these URLs: success/failure → <span class="mono">${o}/payfast/return</span> · IPN/checkout → <span class="mono">${o}/payfast/ipn</span>. Online payments post to the agent's ledger automatically once PayFast confirms them.</p><div class="row" style="gap:8px"><button class="btn pri" data-act="savePf">Save PayFast</button><button class="btn" data-act="testPf">Test connection</button></div><p class="hint" id="pf-res" style="margin-top:8px"></p></div>
  <div class="card cp"><div class="row sb"><div class="sec" style="margin:0">Travelport TripServices</div>${tp.configured ? '<span class="bdg green">Credentials configured</span>' : '<span class="bdg gray">Credentials required</span>'}</div><p class="hint" style="margin:8px 0">Live flight search, fare revalidation and reservation hold use Travelport. Production access and Air / Stays entitlements must be approved by Travelport separately.</p><div class="g2"><div><small>Environment</small><b>${esc(tp.environment || 'preproduction')}</b></div><div><small>OAuth token</small><b>${tp.tokenReady ? 'Available' : 'Not requested'}</b></div></div><p class="hint">${tp.configured ? 'All required server variables are present.' : 'Missing variables: ' + esc((tp.missing || []).join(', '))}</p><p class="hint">Add credentials in Hostinger → Advanced → Environment variables. Never paste API passwords or client secrets into this CRM form or a chat.</p><div class="row" style="gap:8px;margin:8px 0"><button class="btn" data-act="testTravelport">Test Travelport OAuth</button><span class="hint" id="tp-res"></span></div><div class="hint mono">TRAVELPORT_USERNAME<br>TRAVELPORT_PASSWORD<br>TRAVELPORT_CLIENT_ID<br>TRAVELPORT_CLIENT_SECRET<br>TRAVELPORT_ACCESS_GROUP<br>TRAVELPORT_ENV=preproduction</div><p class="hint">Access group / PCC values are assigned by Travelport. Hotel search also requires Stays API provisioning. Ticket issuance requires your agency's approved airline form of payment.</p></div>
  </div></div>
  <div class="card cp"><div class="row sb"><div class="sec" style="margin:0">Travelport reservation queue</div><span class="bdg ${((S.travelportOrders || []).length ? 'amber' : 'gray')}">${(S.travelportOrders || []).length} reservations</span></div>${(S.travelportOrders || []).length ? `<div style="overflow:auto"><table class="tbl"><thead><tr><th>PNR</th><th>Route</th><th>Agent</th><th>Amount (PKR)</th><th>Payment</th><th>Ticket</th><th>Created</th></tr></thead><tbody>${(S.travelportOrders || []).slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,30).map(x=>`<tr><td><b>${esc(x.locator || '-')}</b><div class="sub">${esc(x.id)}</div></td><td>${esc(x.from || '')} → ${esc(x.to || '')}<div class="sub">${esc(x.departure || '')}${x.returnDate ? ' / '+esc(x.returnDate) : ''}</div></td><td>${esc((S.parties || []).find(p=>p.id==x.partyId)?.name || 'Agent')}</td><td>${Number(x.paymentPkr || 0).toLocaleString('en-PK')}</td><td>${esc(x.paymentStatus || 'Not paid')}</td><td>${esc(x.ticketStatus || 'Not ticketed')}</td><td>${esc((x.createdAt || '').slice(0,16).replace('T',' '))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint" style="margin:8px 0 0">No Travelport reservations have been created yet. Agent flight holds and payment status will appear here.</p>'}</div>
  <div class="card cp" id="wa"><div class="row sb"><div class="sec" style="margin:0">WhatsApp queries</div><span id="wa-st"></span></div><p class="hint" style="margin:8px 0 12px">Link a WhatsApp number by QR. Every message sent to it creates a query automatically (messages from the same number within 30 minutes are merged).</p><div id="wa-body"><span class="spin dk"></span></div></div></div>`;
}
ACT.testTravelport = async (a, b) => { const o = document.getElementById('tp-res'); if (b) b.disabled = true; if (o) o.textContent = 'Testing OAuth credentials…'; try { const r = await api('/api/travelport/test', { method: 'POST', body: '{}' }); if (o) { o.textContent = r.message; o.style.color = r.ok ? 'var(--green,#067647)' : 'var(--red,#d92d20)'; } } catch (e) { if (o) { o.textContent = e.message; o.style.color = 'var(--red,#d92d20)'; } } if (b) b.disabled = false; };
ACT.testPf = async (a, b) => { const o = document.getElementById('pf-res'); if (b) b.disabled = true; o.textContent = 'Contacting PayFast...'; try { const r = await api('/api/payfast/test', { method: 'POST', body: JSON.stringify({ merchantId: val('pf-m'), securedKey: val('pf-k'), env: val('pf-e') }) }); o.textContent = r.message; o.style.color = r.ok ? 'var(--green,#067647)' : 'var(--red,#d92d20)'; } catch (e) { o.textContent = e.message; o.style.color = 'var(--red,#d92d20)'; } if (b) b.disabled = false; };
ACT.savePf = (a, b) => saveS(b, { payfast: { merchantId: val('pf-m'), merchantName: val('pf-n'), securedKey: val('pf-k'), storeId: val('pf-s'), env: val('pf-e') } }, 'PayFast saved');
async function waPoll() {
  const body = $('#wa-body'); if (!body) return clearInterval(waTimer);
  try {
    const w = await api('/api/wa'), L = { off: 'Not linked', starting: 'Starting...', qr: 'Waiting for scan', open: 'Connected', unavailable: 'Unavailable' };
    $('#wa-st').innerHTML = `<span class="bdg ${w.status === 'open' ? 'green' : w.status === 'qr' ? 'amber' : 'gray'}">${L[w.status] || w.status}</span>`;
    body.innerHTML = w.status === 'open' ? `<div class="okbox">Linked to +${esc(w.number)}. Incoming messages become queries.</div><div class="row" style="margin-top:12px"><button class="btn" data-act="waStop">Pause</button><button class="btn danger" data-act="waLogout">Unlink number</button></div>`
      : w.status === 'qr' ? `<div class="qrbox"><img src="${w.qr}" alt="QR"><p class="hint" style="margin-top:8px;text-align:center">WhatsApp → Linked devices → Link a device → scan this code</p></div>`
      : w.status === 'unavailable' ? `<div class="warnbox">${ic('alert')}${esc(w.error)}</div>` : `${w.error ? `<div class="errbox">${esc(w.error)}</div>` : ''}<button class="btn pri" data-act="waStart">${ic('qr', 'sm')}${w.status === 'starting' ? 'Starting...' : 'Link WhatsApp'}</button>`;
    clearInterval(waTimer); if (['qr', 'starting'].includes(w.status) || document.activeElement) waTimer = setTimeout(waPoll, w.status === 'open' ? 15000 : 3000);
  } catch { /* ignore */ }
}
ACT.waStart = async () => { await api('/api/wa/start', { method: 'POST', body: '{}' }); setTimeout(waPoll, 800); };
ACT.waStop = async () => { await api('/api/wa/stop', { method: 'POST', body: '{}' }); waPoll(); };
ACT.waLogout = async () => { if (await confirmBox('Unlink WhatsApp', 'Stop receiving queries from this number?', 'Unlink', true)) { await api('/api/wa/stop', { method: 'POST', body: JSON.stringify({ logout: true }) }); waPoll(); } };
function tTeam() {
  const pu = (S.users || []).filter(u => u.role === 'agent' || u.role === 'supplier');
  return `<div class="g2" style="align-items:start"><div class="card cp"><div class="sec">Office staff</div><p class="hint" style="margin:6px 0 12px">Staff accounts, roles, departments and individual permissions are managed in one place.</p><a class="btn pri" href="#/staff">${ic('shield', 'sm')}Open Staff & access</a></div>
  <div class="card"><div class="ch"><h3>Agent & supplier logins</h3></div>${pu.map(u => `<div class="item"><div class="mid"><b>${esc(u.name)}</b><div class="sub">${esc(u.login)} · ${esc(u.role)}</div></div><a class="btn sm" href="#/account/${u.pid}">Manage</a></div>`).join('') || '<div class="cp mute">Create logins when adding an agent or supplier under Accounts.</div>'}</div></div>`;
}
ACT.userNew = () => openModal({ title: 'Add staff user', body: `<div class="g1">${fld('Name', '<input id="u-n">')}${fld('Username', '<input id="u-l" autocomplete="off">')}${fld('Password (8+ characters)', '<input id="u-p" type="text" autocomplete="off">')}<p class="hint">Staff manage bookings, payments, groups and queries. They cannot edit settings, journals or users.</p></div>`, foot: '<button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn pri" data-act="userSave">Create user</button>' });
ACT.userSave = async (a, b) => { await doRpc(b, 'saveUser', { name: val('u-n'), login: val('u-l'), password: val('u-p'), role: 'staff' }, 'User saved', closeModal); };
ACT.userReset = l => openModal({ title: 'Reset password - ' + l, body: fld('New password (8+ characters)', '<input id="u-p" type="text" autocomplete="off">'), foot: `<button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn pri" data-act="userSave2" data-a="${esc(l)}">Reset</button>` });
ACT.userSave2 = async (l, b) => { await doRpc(b, 'saveUser', { login: l, password: val('u-p') }, 'Password reset', closeModal); };
ACT.userDel = async id => { if (await confirmBox('Remove user', 'Remove this staff login?', 'Remove', true)) await doRpc(null, 'delUser', { id }, 'User removed'); };
const IMPORTS = { agents: 'Agents (name, limit, login, password, phone, city, opening)', suppliers: 'Suppliers (name, phone, city, opening)', customers: 'B2C customers (name, phone, city)', ledger: 'Ledger entries (account, date, description, debit, credit)', payments: 'Payments (party, date, amount, method, ref)' };
function parseCSV(t) { const rows = []; let r = [], c = '', q = false; for (let i = 0; i < t.length; i++) { const ch = t[i]; if (q) { if (ch === '"' && t[i + 1] === '"') { c += '"'; i++; } else if (ch === '"') q = false; else c += ch; } else if (ch === '"') q = true; else if (ch === ',') { r.push(c); c = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; r.push(c); c = ''; if (r.some(x => x.trim())) rows.push(r); r = []; } else c += ch; } r.push(c); if (r.some(x => x.trim())) rows.push(r); const h = (rows.shift() || []).map(x => x.trim().toLowerCase()); return rows.map(x => Object.fromEntries(h.map((k, i) => [k, (x[i] || '').trim()]))); }
function tData() {
  return `<div class="g2" style="align-items:start"><div class="g1">${can('data.backup') ? `<div class="card cp" id="ds-card">${dsHtml()}</div>` : ''}
  ${can('data.import') ? `<div class="card cp"><div class="sec">Import from CSV</div><div class="g1">${fld('What are you importing?', `<select id="im-k">${opts(Object.entries(IMPORTS))}</select>`)}<input type="file" id="im-f" accept=".csv"><button class="btn pri" data-act="imGo">Import</button><div id="im-r"></div></div></div>` : ''}</div>
  ${can('audit.view') ? `<div class="card"><div class="ch"><h3>Activity log</h3></div><div style="max-height:520px;overflow:auto">${(S.log || []).slice(0, 150).map(l => `<div class="item"><div class="mid"><b style="font-size:13px">${esc(l.a)}</b><div class="sub">${esc(l.d)}</div></div><span class="sub">${esc(l.u)}<br>${ftime(l.t)}</span></div>`).join('')}</div></div>` : ''}</div>`;
}
/* ---- data safety: storage health, restore points, restore ---- */
let DS = null;
const dsSize = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' KB');
const DSKIND = { auto: 'Scheduled', daily: 'Daily', 'pre-migration': 'Before upgrade', 'pre-restore': 'Before restore', manual: 'Manual', initial: 'First save' };
function dsHtml() {
  if (!DS) return `<div class="sec">Data safety &amp; backups</div><p class="hint">Checking storage…</p>`;
  if (DS.error) return `<div class="sec">Data safety &amp; backups</div><div class="errbox">${esc(DS.error)}</div>`;
  const st = DS.status, my = st.driver === 'mysql', ok = my && st.healthy, rec = st.records || {}, up = st.uploadedFiles || {};
  const items = DS.items || [];
  return `<div class="sec">Data safety &amp; backups</div>
  <div class="row" style="gap:8px;margin-bottom:10px"><span class="bdg ${ok ? 'green' : 'red'}">${ok ? 'MySQL · saving normally' : my ? 'MySQL problem' : 'Temporary storage'}</span>${my ? `<span class="pill">Saved revision ${esc(st.persistedRevision)}</span>` : ''}${st.lastWriteAt ? `<span class="pill">Last save ${esc(ftime(st.lastWriteAt))}</span>` : ''}</div>
  ${my ? '' : `<div class="errbox" style="margin-bottom:10px"><b>Your data is NOT on MySQL.</b> It lives in a folder that a redeploy can erase. Set DB_HOST, DB_NAME, DB_USER and DB_PASSWORD in the Node.js app's environment variables, then restart. Existing data is imported automatically.</div>`}
  ${my && !ok ? `<div class="errbox" style="margin-bottom:10px">${esc(st.error || 'The last save could not be written to MySQL.')} The CRM keeps retrying automatically.</div>` : ''}
  <p class="hint" style="margin-bottom:8px">Everything is stored permanently in MySQL (${esc(rec.bookings || 0)} bookings, ${esc(rec.parties || 0)} agents/suppliers/customers, ${esc(rec.payments || 0)} payments, ${esc(rec.vouchers || 0)} vouchers, ${esc(rec.users || 0)} users). ${st.files && st.files.count ? `${esc(st.files.count)} uploaded file(s) (${esc(dsSize(st.files.bytes))}) are mirrored in MySQL too${up.notInMysql ? ` — ${esc(up.notInMysql)} more are being copied` : ''}.` : ''} A restore point is created automatically about every ${Math.round(6)} hours, once a day, and before every upgrade or restore; nothing is deleted by a redeploy.</p>
  ${my ? `<div class="row" style="margin-bottom:12px"><button class="btn pri" data-act="dsBackup">${ic('download', 'sm')}Create restore point now</button><a class="btn" href="/api/backup">${ic('download', 'sm')}Download full JSON backup</a></div>
  <div class="tw"><table class="t"><thead><tr><th>#</th><th>Type</th><th>When</th><th class="r">Size</th><th></th></tr></thead><tbody>${items.slice(0, 15).map(b => `<tr><td class="num">${esc(b.id)}</td><td><span class="pill">${esc(DSKIND[b.kind] || b.kind)}</span>${b.note ? `<div class="sub">${esc(b.note)}</div>` : ''}</td><td class="num">${esc(ftime(b.at))}</td><td class="r num">${esc(dsSize(b.size))}</td><td class="r"><a class="btn sm ghost" href="/api/backups/${esc(b.id)}/download">${ic('download', 'sm')}</a>${isAdmin() ? `<button class="btn sm" data-act="dsRestore" data-a="${esc(b.id)}">Restore</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="mute">No restore points yet.</td></tr>'}</tbody></table></div>
  ${items.length > 15 ? `<p class="hint">Showing the latest 15 of ${items.length}.</p>` : ''}` : `<a class="btn pri" href="/api/backup">${ic('download', 'sm')}Download backup</a>`}`;
}
async function dsLoad() {
  const paint = () => { const c = $('#ds-card'); if (c) c.innerHTML = dsHtml(); };
  paint();
  try {
    const status = await api('/api/storage/status'); let items = [];
    if (status.driver === 'mysql') items = (await api('/api/backups')).items || [];
    DS = { status, items };
  } catch (e) { DS = { error: e.message }; }
  paint();
}
ACT.dsBackup = async (a, b) => { busy(b, true); try { const r = await api('/api/backups', { method: 'POST', body: JSON.stringify({}) }); toast('Restore point #' + r.id + ' created'); await dsLoad(); } catch (e) { toast(e.message, true); } busy(b, false); };
ACT.dsRestore = id => openModal({ title: 'Restore restore point #' + id, body: `<div class="g1"><div class="errbox"><b>This replaces the live CRM data</b> (bookings, accounts, payments, settings, staff) with the data stored in this restore point. A copy of the current data is saved first, so the restore can itself be undone. Your current administrator password is kept.</div>${fld('Type RESTORE to confirm', '<input id="ds-cf" autocomplete="off" placeholder="RESTORE">')}</div>`,
  foot: `<button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn danger" data-act="dsRestoreGo" data-a="${esc(id)}">Restore now</button>` });
ACT.dsRestoreGo = async (id, b) => { if (val('ds-cf') !== 'RESTORE') return toast('Type RESTORE exactly to confirm', true); busy(b, true); try { await api('/api/backups/' + encodeURIComponent(id) + '/restore', { method: 'POST', body: JSON.stringify({ confirm: 'RESTORE' }) }); closeModal(); toast('Restored. Reloading…'); setTimeout(() => location.reload(), 900); } catch (e) { toast(e.message, true); busy(b, false); } };
ACT.imGo = async (a, b) => { const f = $('#im-f').files[0]; if (!f) return toast('Choose a CSV file', true); busy(b, true); try { const rows = parseCSV(await f.text()), r = await rpc('importData', { kind: val('im-k'), rows }); await load(); $('#im-r').innerHTML = `<div class="okbox" style="margin-top:10px">${r.added} imported${r.skipped.length ? ', ' + r.skipped.length + ' skipped' : ''}</div>${r.skipped.slice(0, 8).map(x => `<div class="sub err">${esc(x)}</div>`).join('')}`; } catch (e) { toast(e.message, true); } busy(b, false); };

/* ======================= TUS OPERATIONS COPILOT ======================= */
const CH=()=>UI.chat||(UI.chat=[]),AIIMG={files:[]};
const readAIImage=f=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve({name:f.name,mime:f.type,data:r.result});r.onerror=reject;r.readAsDataURL(f);});
const imageHtml=fs=>(fs||[]).map(f=>`<div class="ai-img"><img src="${esc(f.data)}" alt="${esc(f.name)}"><small>${esc(f.name)}</small></div>`).join('');
const clearAIImages=()=>{AIIMG.files=[];const p=$('#ai-image-preview');if(p)p.innerHTML='';const f=$('#ai-images');if(f)f.value='';};
if(!document.getElementById('tus-copilot-css')){const st=document.createElement('style');st.id='tus-copilot-css';st.textContent='.ai-composer{padding:13px 16px;border-top:1px solid var(--line2);background:#f7faf8}.ai-entry{display:flex;gap:9px;align-items:center}.ai-entry input{flex:1;min-width:0}.ai-attach{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:9px}.ai-attach input{display:none}.ai-images{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.ai-img{display:grid;gap:3px;max-width:160px}.ai-img img{max-width:160px;max-height:130px;object-fit:contain;border:1px solid var(--line);border-radius:10px}.ai-img small{font-size:10px;color:var(--mute)}';document.head.appendChild(st);}
const chatHtml=()=>CH().map((m,i)=>`<div class="msg ${m.r}">${esc(m.t)}${m.notice?`<div class="act">${ic('info','sm')}${esc(m.notice)}</div>`:''}${m.images&&m.images.length?'<div class="ai-images">'+imageHtml(m.images)+'</div>':''}${m.actions&&m.actions.length?m.actions.map(a=>`<div class="act">${ic('spark','sm')}<span style="flex:1"><b>${esc(a.label)}</b>${a.detail&&a.detail.length?`<small class="adet">${a.detail.map(esc).join('<br>')}</small>`:''}</span></div>`).join('')+(m.pending?`<div class="row" style="margin-top:10px"><button class="btn sm pri" data-act="aiOk" data-a="${i}">Confirm ${m.actions.length} change(s)</button><button class="btn sm" data-act="aiNo" data-a="${i}">Dismiss</button></div>`:''):''}${m.results?m.results.map(r=>`<div class="act">${ic(r.ok?'check':'alert','sm')}${esc(r.m)}</div>`).join(''):''}</div>`).join('')||`<div class="empty">${ic('spark','lg')}<h3>Your operations copilot</h3><p>Ask questions, troubleshoot portal issues, attach screenshots or request CRM changes.</p></div>`;
VIEWS.assistant={roles:['admin','staff'],title:'Operations Copilot',noLive:true,render(){if(!isAdmin()&&!can('assistant.groups'))return empty('shield','Not available','Ask an administrator to enable this internal assistant.');const or=(S.settings||{}).openrouter||{},scope=isAdmin()?'Admin access · authorised CRM operations':'Staff access · group packages only, within assigned permissions';return `<div class="ph"><div><h1>Operations Copilot</h1><p>${S.flags.ai?'OpenRouter · '+esc(or.model||'model selected'):'OpenRouter is not connected. Add a key in Settings → AI assistant.'} · ${scope}. All changes require confirmation.</p></div><button class="btn" data-act="aiClear">Clear chat</button></div><div class="card"><div class="chat" id="chat">${chatHtml()}</div><div class="ai-composer"><div id="ai-image-preview" class="ai-images">${imageHtml(AIIMG.files)}</div><div class="ai-entry"><input id="ai-q" type="text" placeholder="Ask a question or explain what you need…" data-enter="aiSend"><button class="btn pri" data-act="aiSend">${ic('send','sm')}Send</button></div><div class="ai-attach"><label class="btn sm ghost" for="ai-images">${ic('upload','sm')}Attach images</label><input id="ai-images" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple><span class="hint">4 images max · 5 MB each</span></div></div></div><div class="chips" style="margin-top:12px">${[...(isAdmin()?[['Business overview','Summarise business performance and urgent issues'],['Pending work','List pending bookings, payments and customer queries'],['Diagnose issue','Diagnose this portal issue and give exact fix steps']]:[]),...(can('groups.view')?[['Upcoming groups','Show upcoming groups with seats left']]:[]),...(can('groups.create')?[['Create group','Help me create an Umrah group package']]:[]),...(can('groups.edit')?[['Update group','Help me update a group package']]:[])].map(x=>`<button class="chip" data-act="aiQuick" data-a="${esc(x[1])}">${esc(x[0])}</button>`).join('')}</div>`;},mount(){const f=$('#ai-images');if(f)f.addEventListener('change',async()=>{for(const file of Array.from(f.files||[])){if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)){toast('Use JPEG, PNG, WebP or GIF.',true);continue;}if(file.size>5*1024*1024){toast('Each image must be 5 MB or less.',true);continue;}if(AIIMG.files.length>=4){toast('Up to 4 images per message.',true);break;}AIIMG.files.push(await readAIImage(file));}f.value='';const p=$('#ai-image-preview');if(p)p.innerHTML=imageHtml(AIIMG.files);});}};
ACT.aiQuick=q=>{$('#ai-q').value=q;ACT.aiSend();};ACT.aiClear=()=>{UI.chat=[];clearAIImages();renderView();};
ACT.aiSend=async()=>{const i=$('#ai-q'),q=i.value.trim(),images=AIIMG.files.slice();if(!q&&!images.length)return;i.value='';const history=CH().filter(m=>m.t&&m.t!=='Thinking...').slice(-8).map(m=>({role:m.r==='u'?'user':'assistant',content:m.t}));CH().push({r:'u',t:q||'Please inspect these images.',images});CH().push({r:'a',t:'Analysing…'});clearAIImages();renderView();try{const r=await api('/api/ai',{method:'POST',body:JSON.stringify({q,history,attachments:images})});CH().pop();CH().push({r:'a',t:r.reply,actions:r.actions||[],pending:(r.actions||[]).length>0,notice:r.notice});}catch(e){CH().pop();CH().push({r:'a',t:e.message});}renderView();const c=$('#chat');if(c)c.scrollTop=c.scrollHeight;};
ACT.aiOk=async i=>{const m=CH()[i];m.pending=false;try{const r=await api('/api/ai/run',{method:'POST',body:JSON.stringify({actions:m.actions.map(a=>({op:a.op,args:a.args}))})});m.results=r.results;m.actions=[];await load();}catch(e){m.t+='\n'+e.message;}renderView();};ACT.aiNo=i=>{const m=CH()[i];m.pending=false;m.actions=[];m.t+='\n(dismissed)';renderView();};
/* ======================= ADMIN CENTRE =======================
 * Central command view. Reads existing role-scoped state and existing health/backup APIs;
 * no record writes occur except when an administrator explicitly creates a restore point.
 */
const AC = { health: null, loading: false, loadedAt: '' };
const acCount = v => Number(v || 0).toLocaleString('en-US');
const acTime = v => v ? new Date(v).toLocaleString() : 'Not recorded';
const acStatus = (label, tone) => `<span class="ac-status ${tone || 'neutral'}"><i></i>${esc(label)}</span>`;
function acHealthHtml() {
  const h = AC.health;
  if (AC.loading && !h) return `<div class="ac-health-skeleton"><div class="ac-skel-line wide"></div><div class="ac-skel-grid">${Array.from({length:4},()=>'<i></i>').join('')}</div><div class="ac-skel-line"></div></div>`;
  if (!h) return `<div class="ac-health-empty"><b>System health has not been checked yet.</b><p>Refresh to read the current storage and backup status.</p></div>`;
  const mysql = h.driver === 'mysql', health = h.driver === 'unknown' ? false : mysql ? !!h.healthy : true;
  const rec = h.records || {}, bk = h.backups || {};
  return `<div class="ac-health-grid">
    <div class="ac-health-cell"><span>Storage</span><b>${esc(mysql ? 'MySQL' : (h.driver || 'Local storage'))}</b><small>${mysql ? (h.connected ? 'Database connection established' : 'Database not connected') : 'Local JSON persistence'}</small></div>
    <div class="ac-health-cell"><span>Persistence health</span><b>${acStatus(h.driver === 'unknown' ? 'Unavailable' : mysql ? (health ? 'Healthy' : 'Needs attention') : 'Available', health ? 'good' : 'bad')}</b><small>${esc(h.error || h.note || (health ? 'No storage fault reported' : 'Check hosting database settings'))}</small></div>
    <div class="ac-health-cell"><span>Application version</span><b>${esc(h.appVersion || '-')}</b><small>Last check ${esc(new Date().toLocaleTimeString())}</small></div>
    <div class="ac-health-cell"><span>Restore points</span><b>${mysql ? acCount(bk.count) : '—'}</b><small>${mysql ? 'Most recent: ' + esc(acTime(bk.last)) : 'Restore points depend on storage configuration'}</small></div>
  </div>
  <div class="ac-records"><span><b>${acCount(rec.bookings)}</b> bookings</span><span><b>${acCount(rec.users)}</b> users</span><span><b>${acCount(rec.parties)}</b> accounts</span><span><b>${acCount(rec.payments)}</b> payments</span><span><b>${acCount(rec.ledgerEntries)}</b> ledger entries</span><span><b>${acCount(rec.vouchers)}</b> vouchers</span></div>
  ${h.detailError ? `<div class="warnbox" style="margin-top:12px">Backup detail unavailable: ${esc(h.detailError)}</div>` : ''}${h.error && mysql ? `<div class="warnbox" style="margin-top:12px">${esc(h.error)}</div>` : ''}`;
}
async function acLoad(showToast) {
  AC.loading = true; const box = $('#ac-health'); if (box) box.innerHTML = acHealthHtml();
  try { AC.health = await api('/api/storage/status'); AC.loadedAt = new Date().toISOString(); }
  catch (e) { AC.health = { error: e.message, driver: 'unknown', healthy: false }; if (showToast) toast('Health check failed: ' + e.message, true); }
  AC.loading = false; const target = $('#ac-health'); if (target) target.innerHTML = acHealthHtml();
  const stamp = $('#ac-checked'); if (stamp) stamp.textContent = AC.loadedAt ? 'Checked ' + new Date(AC.loadedAt).toLocaleTimeString() : '';
}
VIEWS.admin = {
  roles: ['admin'], title: 'Admin centre',
  render() {
    const bookings = S.bookings || [], pays = S.payments || [], parties = S.parties || [], users = S.users || [], tickets = S.tickets || [], queries = S.queries || [];
    const staff = users.filter(x => x.role === 'staff' || x.role === 'admin'), agents = users.filter(x => x.role === 'agent'), suppliers = users.filter(x => x.role === 'supplier');
    const pendingBookings = bookings.filter(x => x.status === 'Pending').length, pendingPayments = pays.filter(x => x.status === 'Pending').length, pendingApps = Number(S.appsPending || 0);
    const openTickets = tickets.filter(x => x.status === 'Open').length, openQueries = queries.filter(x => x.status === 'Open').length;
    const activeAgents = parties.filter(x => x.kind === 'agent' && x.active !== false).length;
    const maint = !!(S.maintenance && S.maintenance.on), sup = S.supplierSyncAdmin || {}, seat = S.seatSyncAdmin || {};
    const syncLabel = x => !x || !x.configured ? 'Not configured' : x.status === 'ok' ? 'Healthy' : x.status === 'error' ? 'Error / retrying' : x.status === 'needs_reauth' ? 'Sign-in required' : (x.status || 'Waiting');
    const syncTone = x => !x || !x.configured ? 'neutral' : x.status === 'ok' ? 'good' : ['error','needs_reauth'].includes(x.status) ? 'bad' : 'neutral';
    const log = (S.log || []).slice(0, 7);
    return `<div class="ac-page">
      <section class="ac-hero"><div class="ac-hero-copy"><div class="ac-eyebrow">THE UMRAH STORE · CONTROL ROOM</div><h1>Admin centre</h1><p>One place to monitor operations, access, integrations and data protection.</p><div class="ac-hero-tags">${acStatus(maint ? 'Maintenance ON' : 'Portal live', maint ? 'warn' : 'good')}${acStatus(staff.length + ' internal accounts', 'neutral')}${acStatus((S.company && S.company.name) || 'The Umrah Store', 'neutral')}</div></div><div class="ac-hero-actions"><button class="btn" data-act="acRefresh">${ic('refresh','sm')}Refresh health</button><button class="btn gold" data-act="acBackup">${ic('shield','sm')}Create restore point</button></div></section>
      <section class="ac-metrics">
        <a class="ac-metric" href="#/bookings"><span>Bookings</span><b>${acCount(bookings.length)}</b><small>${acCount(pendingBookings)} awaiting action</small><i>${ic('briefcase')}</i></a>
        <a class="ac-metric" href="#/payments"><span>Payments</span><b>${acCount(pays.length)}</b><small>${acCount(pendingPayments)} pending review</small><i>${ic('wallet')}</i></a>
        <a class="ac-metric" href="#/staff"><span>Internal team</span><b>${acCount(staff.length)}</b><small>Employees and administrators</small><i>${ic('users')}</i></a>
        <a class="ac-metric" href="#/accounts"><span>Active agents</span><b>${acCount(activeAgents)}</b><small>${acCount(agents.length)} agent logins · ${acCount(suppliers.length)} suppliers</small><i>${ic('briefcase')}</i></a>
        <a class="ac-metric" href="#/queries"><span>Open queries</span><b>${acCount(openQueries)}</b><small>${acCount(openTickets)} open support tickets</small><i>${ic('chat')}</i></a>
        <a class="ac-metric" href="#/applications"><span>Agent applications</span><b>${acCount(pendingApps)}</b><small>Awaiting review and approval</small><i>${ic('users')}</i></a>
      </section>
      <section class="ac-main-grid">
        <div class="ac-panel"><div class="ac-panel-head"><div><span class="ac-eyebrow">LIVE OPERATIONS</span><h2>Platform status</h2></div><a href="#/services" class="lnk">Services &amp; sync</a></div>
          <div class="ac-status-list"><div class="ac-status-row"><span class="ac-status-icon">${ic('shield')}</span><div class="ac-status-text"><b>Maintenance mode</b><small>${maint ? 'Public and agent access paused. Internal team access remains available.' : 'Public portal and agent access are enabled.'}</small></div>${acStatus(maint ? 'ON' : 'OFF', maint ? 'warn' : 'good')}<a href="#/services" data-act="acMaint" class="ac-mini-link">Manage</a></div>
          <div class="ac-status-row"><span class="ac-status-icon">${ic('refresh')}</span><div class="ac-status-text"><b>Supplier inventory sync</b><small>Last successful: ${esc(sup.lastOkAt ? acTime(sup.lastOkAt) : 'Never')} · next run: ${esc(sup.nextAt ? acTime(sup.nextAt) : 'Not scheduled')}</small></div>${acStatus(syncLabel(sup), syncTone(sup))}<a href="#/services" data-act="acSupplier" class="ac-mini-link">Manage</a></div>
          <div class="ac-status-row"><span class="ac-status-icon">${ic('activity')}</span><div class="ac-status-text"><b>Legacy seat sync</b><small>Last successful: ${esc(seat.lastOkAt ? acTime(seat.lastOkAt) : 'Never')}</small></div>${acStatus(syncLabel(seat), syncTone(seat))}<a href="#/services" data-act="acSeat" class="ac-mini-link">Manage</a></div></div>
        </div>
        <div class="ac-panel"><div class="ac-panel-head"><div><span class="ac-eyebrow">ADMIN TOOLS</span><h2>Quick access</h2></div></div>
          <div class="ac-tools"><a href="#/staff"><i>${ic('users')}</i><span><b>Staff &amp; permissions</b><small>Roles, employee access and audit</small></span>${ic('chev')}</a><a href="#/accounts"><i>${ic('wallet')}</i><span><b>Accounts &amp; ledgers</b><small>Agent, supplier and customer statements</small></span>${ic('chev')}</a><a href="#/payments"><i>${ic('receipt')}</i><span><b>Payments &amp; receipts</b><small>Approvals, proof and payment links</small></span>${ic('chev')}</a><a href="#/rates"><i>${ic('hotel')}</i><span><b>Hotel &amp; transport inventory</b><small>Hotel photos, room rates, routes and fares</small></span>${ic('chev')}</a><a href="#/reports"><i>${ic('chart')}</i><span><b>Business reports</b><small>Profit, sales, supplier cost and expenses</small></span>${ic('chev')}</a><a href="#/settings"><i>${ic('settings')}</i><span><b>Company &amp; settings</b><small>Brand, banking and integrations</small></span>${ic('chev')}</a><a href="#/services"><i>${ic('activity')}</i><span><b>Services &amp; sync</b><small>Modules, maintenance and supplier inventory</small></span>${ic('chev')}</a><a href="#/bookings"><i>${ic('briefcase')}</i><span><b>Booking operations</b><small>Manage bookings, vouchers and status</small></span>${ic('chev')}</a><a href="#/queries"><i>${ic('chat')}</i><span><b>Queries &amp; support</b><small>Open requests and service issues</small></span>${ic('chev')}</a><a href="#/promos"><i>${ic('spark')}</i><span><b>Offers &amp; promotions</b><small>Campaigns and package promotions</small></span>${ic('chev')}</a></div>
        </div>
      </section>
      <section class="ac-panel"><div class="ac-panel-head"><div><span class="ac-eyebrow">DATA PROTECTION</span><h2>Storage &amp; restore points</h2><p>Read-only health checks. Creating a restore point is an explicit action; restoring data remains a separate protected workflow.</p></div><div class="ac-head-actions"><span id="ac-checked" class="ac-muted"></span><button class="btn sm" data-act="acRefresh">${ic('refresh','sm')}Check again</button><button class="btn sm gold" data-act="acBackup">${ic('shield','sm')}Create restore point</button></div></div><div id="ac-health" class="ac-health">${acHealthHtml()}</div></section>
      <section class="ac-panel"><div class="ac-panel-head"><div><span class="ac-eyebrow">ACCOUNTABILITY</span><h2>Recent admin activity</h2><p>Latest recorded actions from the CRM audit trail.</p></div><a href="#/staff" data-act="acAudit" class="lnk">Open audit log</a></div>
        <div class="ac-audit">${log.length ? log.map(x => `<div class="ac-audit-row"><span class="ac-audit-dot"></span><div><b>${esc(x.a || 'Activity')}</b><small>${esc(x.u || 'System')} · ${esc(x.d || '')}</small></div><time>${esc(x.t ? new Date(x.t).toLocaleString() : '')}</time></div>`).join('') : '<div class="ac-health-empty">No recorded activity yet.</div>'}</div>
      </section>
    </div>`;
  },
  mount() { if (!AC.health || !AC.loadedAt) acLoad(false); }
};
ACT.acRefresh = async (a, btn) => { if (btn) btn.disabled = true; await acLoad(true); if (btn) btn.disabled = false; };
ACT.acBackup = async (a, btn) => {
  if (!(await confirmBox('Create restore point', 'Create a new protected restore point of the current CRM state? This does not restore, overwrite or delete any data.', 'Create restore point'))) return;
  if (btn) btn.disabled = true;
  try { const r = await api('/api/backups', { method: 'POST', body: JSON.stringify({ note: 'Admin centre restore point' }) }); toast('Restore point #' + r.id + ' created successfully'); await acLoad(false); }
  catch (e) { toast('Could not create restore point: ' + e.message, true); }
  if (btn) btn.disabled = false;
};
ACT.acMaint = (a, b, e) => { if (e && e.preventDefault) e.preventDefault(); ACT.syTab && ACT.syTab('maint'); go('services'); };
ACT.acSupplier = (a, b, e) => { if (e && e.preventDefault) e.preventDefault(); ACT.syTab && ACT.syTab('supplier'); go('services'); };
ACT.acSeat = (a, b, e) => { if (e && e.preventDefault) e.preventDefault(); ACT.syTab && ACT.syTab('sync'); go('services'); };
ACT.acAudit = (a, b, e) => { if (e && e.preventDefault) e.preventDefault(); if (typeof SF === 'function') SF().tab = 'audit'; go('staff'); };

