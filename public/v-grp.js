/* Group packages: catalogue with real airline logos, filters, quick quote, share, PDF import */
'use strict';
const ROOMS = [['sh', 'Sharing', 'Sharing'], ['qd', 'Quad', 'Quad'], ['tr', 'Triple', 'Triple'], ['db', 'Double', 'Double']];
const gf = () => UI.f.grp || (UI.f.grp = {});
const seatCls = n => (n <= 0 ? 'out' : n < 10 ? 'low' : 'ok');
const gFrom = g => { const v = g.pk.flatMap(k => Object.values(k.p)).filter(x => x > 0); return v.length ? Math.min(...v) : 0; };
/* Airline identity comes from the real flight number prefix (SV 739 -> SV); the stored code is only the fallback. */
const gCode = g => Engine.airOfFn(g.out && g.out.fn) || (/^[A-Z0-9]{2}$/i.test(g.air || '') ? String(g.air).toUpperCase() : '');
const gAirName = g => { const c = gCode(g), known = Engine.AIR[c]; return known ? known[0] : (c && c !== String(g.air || '').toUpperCase() ? c : (g.airline || g.air || c)); };
const lStops = l => (l && Array.isArray(l.segs) && l.segs.length > 1 ? l.segs.length - 1 : 0);
const lVia = l => (lStops(l) ? l.segs.slice(0, -1).map(x => x.to) : []);
const gSector = g => (g.out ? g.out.from + '-' + g.out.to : '');
const gConn = g => lStops(g.out) + lStops(g.inb) > 0;
const stopTag = l => (lStops(l) ? `<span class="bdg amber" title="Connecting flight">${lStops(l)} stop${lStops(l) > 1 ? 's' : ''} · via ${esc(lVia(l).join(', '))}</span>` : '<span class="bdg green">Direct</span>');
const legTxt = l => `${l.fn} ${l.from}-${l.to} ${l.dt}${lStops(l) ? ' (' + lStops(l) + ' stop via ' + lVia(l).join(', ') + ')' : ''}`;
const segList = l => (lStops(l) ? `<div class="gd-segs">${l.segs.map((x, i) => `${i ? `<div class="gd-lay">Connection at ${esc(x.from)}</div>` : ''}<div class="gd-sg"><span class="gd-sgl">${airBadge(Engine.airOfFn(x.fn), '', 22)}<b>${esc(x.fn)}</b></span><span>${esc(x.from)} <em>${esc(x.dt)}</em> → ${esc(x.to)} <em>${esc(x.at)}</em>${x.date ? ' · ' + fdate(x.date) : ''}</span></div>`).join('')}</div>` : '');
/* multi-select (staff with the "remove groups" permission only) */
const GSEL = new Set();
const canBulk = () => isStaff() && can('groups.delete');
const selBox = g => (canBulk() ? `<span class="gd-sel" data-act="gNoop"><input type="checkbox" data-act="gSel" data-a="${esc(g.id)}" ${GSEL.has(g.id) ? 'checked' : ''} aria-label="Select ${esc(g.id)}"></span>` : '');
const kFrom = k => { const v = Object.values(k.p).filter(x => x > 0); return v.length ? Math.min(...v) : 0; };
function matchG(g, f) {
  if (f.air && gCode(g) !== f.air) return false;
  if (f.sec && gSector(g) !== f.sec) return false;
  if (f.ft === 'direct' && gConn(g)) return false; if (f.ft === 'conn' && !gConn(g)) return false;
  if (f.mon && !g.dep.startsWith(f.mon)) return false;
  if (f.from && g.dep < f.from) return false; if (f.to && g.dep > f.to) return false;
  if (f.n && g.n != f.n) return false;
  if (f.avail && g.seats <= 0) return false;
  if (f.max && gFrom(g) > +f.max) return false;
  if (f.q) { const q = f.q.toLowerCase(); if (![g.id, g.code, g.airline, g.air, g.out.fn, g.inb.fn, ...g.pk.flatMap(k => [k.mk, k.md, k.id])].join(' ').toLowerCase().includes(q)) return false; }
  return true;
}
const legHtml = (t, l) => `<div class="leg"><div class="lt"><div class="ap">${esc(l.from)}</div><div class="t">${esc(l.dt)}</div></div><div class="ln"></div><div class="lt"><div class="ap">${esc(l.to)}</div><div class="t">${esc(l.at)}</div></div><div class="meta"><b>${t} ${esc(l.fn)}</b><br>${fdow(l.date)}, ${fdate(l.date)}${l.bag ? ' · ' + l.bag + ' kg baggage' : ''}</div></div>`;
function groupText(g) {
  return `*Umrah group ${gAirName(g)}*\nDeparts ${fdow(g.dep)} ${fdate(g.dep)} · returns ${fdate(g.ret)} · ${g.n} nights\n${legTxt(g.out)}\n${legTxt(g.inb)}\n\n` + g.pk.map(k => `${k.mk} (${k.mkn}N) + ${k.md} (${k.mdn}N)\n` + ROOMS.filter(r => k.p[r[0]]).map(r => `${r[1]}: PKR ${fnum(k.p[r[0]])}`).join(' · ')).join('\n\n') + `\n\nSeats left: ${g.seats}`;
}
/* ---------- departure management (v4): KPI strip, three views, departure workspace (overview / pricing / bookings / passengers) ---------- */
const gView = () => gf().view || 'cards';
const heldBy = g => (S.bookings || []).filter(b => b.status !== 'Cancelled' && b.groupRef && b.groupRef.gid === g.id);
const soldSeats = g => sum(heldBy(g), b => (b.groupRef.seats || 0));
const daysTo = d => Math.round((DT(d) - DT(todayISO())) / 864e5);
const gStatus = g => (g.seats <= 0 ? ['red', 'Sold out'] : g.seats < 10 ? ['amber', 'Last seats'] : ['green', 'Open']);
const roomCols = ROOMS.map(r => r[0]);
function gMeter(g) {
  const sold = soldSeats(g), cap = g.seats + sold, pct = cap ? Math.round(sold / cap * 100) : 0, st = gStatus(g);
  if (!isStaff()) return `<div class="gd-seat ${seatCls(g.seats)}"><b>${g.seats <= 0 ? 0 : g.seats}</b><small>${g.seats <= 0 ? 'sold out' : 'seats left'}</small></div>`;
  return `<div class="gd-inv"><div class="gd-inv-top"><b>${g.seats <= 0 ? 'Sold out' : g.seats + ' left'}</b><small>${sold} sold of ${cap}</small></div><div class="gd-meter ${st[0]}"><i style="width:${pct}%"></i></div></div>`;
}
const gLegLine = (t, l) => `<div class="gd-leg"><span class="gd-lt">${t}</span><b>${esc(l.fn)}</b><span>${esc(l.from)} <em>${esc(l.dt)}</em></span><span class="gd-arw">${ic('arrow', 'sm')}</span><span>${esc(l.to)} <em>${esc(l.at)}</em></span><small>${fdow(l.date)} ${fdate(l.date)}${l.bag ? ' · ' + l.bag + ' kg' : ''}</small>${lStops(l) ? stopTag(l) : ''}${segList(l)}</div>`;
function gStatusBadges(g) {
  const st = gStatus(g), dt = daysTo(g.dep);
  return `<span class="bdg ${st[0]}">${st[1]}</span>${dt >= 0 && dt <= 14 ? `<span class="bdg blue">${dt === 0 ? 'Departs today' : 'In ' + dt + ' day' + (dt === 1 ? '' : 's')}</span>` : ''}<span class="bdg gray">${g.n} nights</span>`;
}
function groupCard(g) {
  const d = DT(g.dep), out = g.seats <= 0, from = gFrom(g), staff = isStaff();
  const best = {}; ROOMS.forEach(r => { const v = g.pk.map(k => k.p[r[0]]).filter(x => x > 0); best[r[0]] = v.length ? Math.min(...v) : 0; });
  return `<article class="card gd-card ${GSEL.has(g.id) ? 'sel' : ''}" id="g-${esc(g.id)}">
  <div class="gd-date"><span>${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}</span><b>${p2(d.getUTCDate())}</b><span>${fdow(g.dep)}</span></div>
  <div class="gd-body">
    <div class="gd-head"><div class="gd-air">${selBox(g)}${airBadge(gCode(g), gAirName(g), 44)}<div><b>${esc(gAirName(g))}</b><small>${esc(g.id)}${staff && g.code && g.code !== g.id ? ' · ' + esc(g.code) : ''}</small></div></div><div class="gd-badges">${gStatusBadges(g)}</div>
      ${from ? `<div class="gd-from"><small>from</small><b>${fnum(from)}</b><small>PKR / person</small></div>` : ''}</div>
    <div class="gd-legs">${gLegLine('Out', g.out)}${gLegLine('Return', g.inb)}</div>
    <div class="gd-pk"><div class="gd-pkh"><span>Makkah</span><span>Madinah</span>${ROOMS.map(r => `<span class="c">${r[1]}</span>`).join('')}</div>
    ${g.pk.map(k => `<div class="gd-pkr"><div class="gd-h"><b>${esc(k.mk || '-')}</b><small>${k.mkn} nights${k.mkd ? ' · ' + esc(k.mkd) : ''}</small></div><div class="gd-h"><b>${esc(k.md || '-')}</b><small>${k.mdn} nights${k.mdd ? ' · ' + esc(k.mdd) : ''}</small></div>${ROOMS.map(r => `<button class="gd-pc ${out || !k.p[r[0]] ? 'na' : ''} ${k.p[r[0]] && k.p[r[0]] === best[r[0]] && g.pk.length > 1 ? 'best' : ''}" data-act="gBook" data-a="${esc(g.id)}|${esc(k.id)}|${r[2]}" aria-label="Book ${r[1]}"><small>${r[1]}</small>${k.p[r[0]] ? fnum(k.p[r[0]]) : '-'}</button>`).join('')}</div>`).join('')}</div>
    <div class="gd-foot">${gMeter(g)}<div class="gd-acts"><button class="btn sm pri" data-act="gDetail" data-a="${esc(g.id)}">${ic('eye', 'sm')}Departure details</button><button class="btn sm" data-act="gQuote" data-a="${esc(g.id)}">${ic('terminal', 'sm')}Quote</button><a class="btn sm" target="_blank" rel="noopener" href="${waLinkTo(groupText(g))}">${ic('wa', 'sm')}Share</a><button class="btn sm ghost" data-act="gCopy" data-a="${esc(g.id)}" title="Copy details">${ic('copy', 'sm')}</button>${staff && can('groups.edit') ? `<button class="btn sm ghost" data-act="gEdit" data-a="${esc(g.id)}" title="Edit departure">${ic('edit', 'sm')}</button><button class="btn sm ghost" data-act="gSeats" data-a="${esc(g.id)}" title="Update seats">${ic('users', 'sm')}</button>` : ''}${staff && can('groups.delete') ? `<button class="btn sm ghost" data-act="gDel" data-a="${esc(g.id)}" title="Remove departure">${ic('trash', 'sm')}</button>` : ''}</div></div>
  </div></article>`;
}
function gTable(rows) {
  return `<div class="tw"><table class="t gd-table"><thead><tr>${canBulk() ? `<th class="gd-selc"><input type="checkbox" data-act="gSelAll" ${rows.length && rows.every(g => GSEL.has(g.id)) ? 'checked' : ''} aria-label="Select all shown"></th>` : ''}<th>Departure</th><th>Group</th><th>Route</th><th>Hotels</th><th class="r">From (PKR)</th><th>Inventory</th><th></th></tr></thead><tbody>${rows.map(g => {
    const k = g.pk[0] || {}, from = gFrom(g);
    return `<tr class="click ${GSEL.has(g.id) ? 'sel' : ''}" data-act="gDetail" data-a="${esc(g.id)}">${canBulk() ? `<td class="gd-selc">${selBox(g)}</td>` : ''}<td><b>${fdate(g.dep)}</b><div class="sub">${fdow(g.dep)} · ${g.n} nights · back ${fdate(g.ret)}</div></td><td><div class="gd-air sm">${airBadge(gCode(g), gAirName(g), 30)}<div><b>${esc(gAirName(g))}</b><small>${esc(g.id)}</small></div></div></td><td>${esc(g.out.from)} → ${esc(g.out.to)}${gConn(g) ? ` <span class="bdg amber">${lStops(g.out) || lStops(g.inb)} stop</span>` : ''}<div class="sub">${esc(g.out.fn)} · ${esc(g.inb.fn)}</div></td><td>${esc(k.mk || '-')}<div class="sub">${esc(k.md || '-')}${g.pk.length > 1 ? ' · +' + (g.pk.length - 1) + ' more package' + (g.pk.length > 2 ? 's' : '') : ''}</div></td><td class="r num"><b>${from ? fnum(from) : '-'}</b></td><td>${gMeter(g)}<div style="margin-top:6px">${gStatusBadges(g).split('</span>')[0]}</span></div></td><td class="r"><button class="btn sm" data-act="gDetail" data-a="${esc(g.id)}">Open</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function gMonths(rows) {
  const by = {}; rows.forEach(g => (by[g.dep.slice(0, 7)] = by[g.dep.slice(0, 7)] || []).push(g));
  return Object.keys(by).sort().map(m => { const list = by[m]; return `<section class="gd-month"><header><h3>${MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)}</h3><span>${list.length} departure${list.length === 1 ? '' : 's'} · ${sum(list, g => g.seats)} seats available</span></header><div class="card">${list.map(g => { const from = gFrom(g); return `<div class="gd-mrow click ${GSEL.has(g.id) ? 'sel' : ''}" data-act="gDetail" data-a="${esc(g.id)}"><div class="gd-md"><b>${p2(DT(g.dep).getUTCDate())}</b><small>${fdow(g.dep)}</small>${selBox(g)}</div><div class="gd-air sm">${airBadge(gCode(g), gAirName(g), 30)}<div><b>${esc(gAirName(g))}</b><small>${esc(g.id)} · ${g.n} nights</small></div></div><div class="gd-mhot">${esc((g.pk[0] || {}).mk || '-')}<small>${esc((g.pk[0] || {}).md || '-')}</small></div><div class="gd-mfrom">${from ? '<small>from</small><b>' + fnum(from) + '</b>' : ''}</div>${gMeter(g)}<span class="bdg ${gStatus(g)[0]}">${gStatus(g)[1]}</span></div>`; }).join('')}</div></section>`; }).join('');
}
const gRows = () => {
  const f = gf();
  return (S.groups || []).filter(g => matchG(g, f)).sort((a, b) => (f.sort === 'seats' ? b.seats - a.seats : f.sort === 'price' ? (gFrom(a) || 9e9) - (gFrom(b) || 9e9) : a.dep < b.dep ? -1 : 1));
};
const gSelIds = () => { const vis = new Set(gRows().map(g => g.id)); return [...GSEL].filter(id => vis.has(id)); };
function gSelBar() {
  if (!canBulk() || !(S.groups || []).length) return '';
  const rows = gRows(), n = gSelIds().length;
  return `<div class="gd-bulk ${n ? 'on' : ''}"><label class="chk"><input type="checkbox" data-act="gSelAll" ${rows.length && n === rows.length ? 'checked' : ''}>${n ? '<b>' + n + ' selected</b>' : 'Select all ' + rows.length + ' shown'}</label>${n ? `<button class="btn sm ghost" data-act="gSelClear">Clear selection</button><span class="sp"></span><button class="btn sm danger" data-act="gBulkDel">${ic('trash', 'sm')}Delete ${n} selected</button>` : ''}</div>`;
}
const gList = () => {
  const rows = gRows(), v = gView();
  if (!rows.length) return `<div class="card">${(S.groups || []).length ? empty('search', 'No departures match your filters', 'Widen the month, nights or price filters.', '<button class="btn" data-act="gClear">Clear filters</button>') : empty('layers', 'No group departures published', isStaff() ? 'Import the latest supplier "Umrah Groups" PDF or add a departure manually.' : 'The office has not published any departures yet.', isStaff() ? `<button class="btn pri" data-act="gImport">${ic('upload', 'sm')}Import groups PDF</button>` : '')}</div>`;
  return v === 'table' ? gTable(rows) : v === 'month' ? gMonths(rows) : `<div class="gd-list">${rows.map(groupCard).join('')}</div>`;
};
function gKpis(gs) {
  const staff = isStaff(), t = todayISO(), soon = gs.filter(g => daysTo(g.dep) <= 30), low = gs.filter(g => g.seats > 0 && g.seats < 10), out = gs.filter(g => g.seats <= 0);
  const seats = sum(gs, g => g.seats), sold = staff ? sum(gs, soldSeats) : 0, next = [...gs].sort((a, b) => (a.dep < b.dep ? -1 : 1))[0];
  const lowest = Math.min(...gs.map(gFrom).filter(x => x > 0), Infinity);
  return `<div class="stats gd-kpis">
  <div class="card stat hot"><div class="l">${ic('layers', 'sm')}Departures</div><div class="v">${gs.length}</div><div class="s">${next ? 'next ' + fdate(next.dep) : 'none published'}</div></div>
  <div class="card stat"><div class="l">${ic('users', 'sm')}Seats available</div><div class="v">${seats}</div><div class="s">${staff ? sold + ' sold · ' + (seats + sold) + ' total' : 'across all departures'}</div></div>
  <div class="card stat"><div class="l">${ic('calendar', 'sm')}Departing in 30 days</div><div class="v">${soon.length}</div><div class="s">${soon.length ? sum(soon, g => g.seats) + ' seats still open' : 'nothing imminent'}</div></div>
  <div class="card stat"><div class="l">${ic('alert', 'sm')}Last seats</div><div class="v">${low.length}</div><div class="s">${out.length} sold out</div></div>
  ${isFinite(lowest) ? `<div class="card stat"><div class="l">${ic('tag', 'sm')}Lowest fare</div><div class="v">${fnum(lowest)}</div><div class="s">PKR per person</div></div>` : ''}</div>`;
}
VIEWS.groups = {
  title: 'Group packages', roles: ['admin', 'staff', 'agent'],
  render() {
    const f = gf(), gs = S.groups || [], have = new Set(gs.map(g => g.id)); [...GSEL].forEach(id => { if (!have.has(id)) GSEL.delete(id); });
    const airs = uniq(gs.map(gCode).filter(Boolean)).sort(), secs = uniq(gs.map(gSector).filter(Boolean)).sort(), months = uniq(gs.map(g => g.dep.slice(0, 7))).sort(), v = gView();
    return `<div class="ph"><div><h1>Group packages</h1><p>Departure management · live seats, pricing and bookings. Departed groups are removed automatically.</p></div><div class="sp">${isStaff() && can('groups.create') ? `<button class="btn pri" data-act="gAdd">${ic('plus')}Add departure</button><button class="btn" data-act="gImport">${ic('upload')}Import PDF</button>` : ''}${isStaff() && (isAdmin() || can('assistant.groups')) ? `<a class="btn" href="#/assistant">${ic('spark')}Ask AI</a>` : ''}<a class="btn" href="#/calculator">${ic('terminal')}Calculator</a></div></div>
    ${gs.length ? gKpis(gs) : ''}
    <div class="gd-bar"><div class="tabs" role="tablist" aria-label="View">${[['cards', 'grid', 'Departures'], ['table', 'list', 'Table'], ['month', 'calendar', 'By month']].map(x => `<button role="tab" aria-selected="${v === x[0]}" class="${v === x[0] ? 'on' : ''}" data-act="gView" data-a="${x[0]}">${ic(x[1], 'sm')}${x[2]}</button>`).join('')}</div>
    ${airs.length > 1 ? `<div class="chips" role="group" aria-label="Airline">${`<button class="chip ${!f.air ? 'on' : ''}" data-act="gAir" data-a="">All airlines</button>` + airs.map(a => `<button class="chip ${f.air === a ? 'on' : ''}" data-act="gAir" data-a="${esc(a)}">${airBadge(a, gAirName(gs.find(g => gCode(g) === a) || {}), 20)}${esc(gAirName(gs.find(g => gCode(g) === a) || {}))}<i>${gs.filter(g => gCode(g) === a).length}</i></button>`).join('')}</div>` : ''}</div>
    ${secs.length > 1 ? `<div class="chips gd-secs" role="group" aria-label="Sector"><span class="gd-secl">Sector</span>${`<button class="chip ${!f.sec ? 'on' : ''}" data-act="gSec" data-a="">All sectors</button>` + secs.map(x => `<button class="chip ${f.sec === x ? 'on' : ''}" data-act="gSec" data-a="${esc(x)}">${esc(x.replace('-', ' → '))}<i>${gs.filter(g => gSector(g) === x).length}</i></button>`).join('')}</div>` : ''}
    <div class="fb"><div class="fld grow"><span>Search</span><input value="${esc(f.q || '')}" placeholder="Hotel, flight number, group code" data-inp="gQ"></div><div class="fld"><span>Month</span><select data-chg="gF" data-k="mon">${opts(months.map(m => [m, MONTHS[+m.slice(5) - 1] + ' ' + m.slice(0, 4)]), f.mon, 'Any month')}</select></div><div class="fld"><span>Nights</span><select data-chg="gF" data-k="n">${opts(uniq(gs.map(g => g.n)).sort((a, b) => a - b), f.n, 'Any')}</select></div><div class="fld"><span>Flight type</span><select data-chg="gF" data-k="ft">${opts([['direct', 'Direct only'], ['conn', 'With connections']], f.ft, 'Any')}</select></div><div class="fld"><span>Max price / person</span><input type="number" min="0" step="5000" value="${f.max || ''}" placeholder="PKR" data-chg="gF" data-k="max"></div><div class="fld"><span>Sort</span><select data-chg="gF" data-k="sort">${opts([['', 'Departure date'], ['price', 'Lowest price'], ['seats', 'Most seats']], f.sort)}</select></div><div class="qk"><label class="chk"><input type="checkbox" ${f.avail ? 'checked' : ''} data-chg="gF" data-k="avail">Only with seats</label><button class="btn sm ghost" data-act="gClear">${ic('x', 'sm')}Clear</button></div></div>
    <div id="gselbar">${gSelBar()}</div>
    <div id="glist">${gList()}</div>`;
  }
};
ACT.gView = a => { gf().view = a; renderView(); };

/* ---------- departure workspace (modal with tabs) ---------- */
const GD = { id: '', tab: 'overview' };
const gdTabs = () => [['overview', 'Overview', 'info'], ['pricing', 'Pricing & booking', 'tag'], ['bookings', 'Bookings', 'briefcase'], ['passengers', 'Passengers', 'users']].filter(t => isStaff() || t[0] !== 'passengers' || heldBy(S.groups.find(g => g.id === GD.id) || {}).length);
function gdOverview(g) {
  const sold = soldSeats(g), cap = g.seats + sold, st = gStatus(g);
  return `<div class="gd-ov"><div class="gd-ovc"><div class="sec">Flights</div>${gLegBig('Outbound', g.out)}${gLegBig('Return', g.inb)}</div>
  <div class="gd-ovc"><div class="sec">Inventory</div><div class="gd-invbox"><div><b>${g.seats <= 0 ? 0 : g.seats}</b><small>seats left</small></div>${isStaff() ? `<div><b>${sold}</b><small>seats sold</small></div><div><b>${cap}</b><small>total capacity</small></div>` : ''}<span class="bdg ${st[0]}">${st[1]}</span></div>${isStaff() ? `<div class="gd-meter ${st[0]} lg"><i style="width:${cap ? Math.round(sold / cap * 100) : 0}%"></i></div>` : ''}
    <div class="sec" style="margin-top:20px">Hotels</div>${g.pk.map(k => `<div class="gd-hot"><span class="gd-hi">${ic('building')}</span><div><b>${esc(k.mk || '-')}</b><small>Makkah · ${k.mkn} nights${k.mkd ? ' · ' + esc(k.mkd) + ' from Haram' : ''}</small></div></div><div class="gd-hot"><span class="gd-hi">${ic('building')}</span><div><b>${esc(k.md || '-')}</b><small>Madinah · ${k.mdn} nights${k.mdd ? ' · ' + esc(k.mdd) + ' from Masjid' : ''}</small></div></div>`).join('<hr class="gd-hr">')}</div></div>`;
}
const gLegBig = (t, l) => `<div class="gd-lb"><div class="gd-lbt"><small>${t}</small><b>${esc(l.fn)}</b></div><div class="gd-lbr"><div><b>${esc(l.dt)}</b><span>${esc(l.from)}</span></div><div class="gd-lbl"></div><div><b>${esc(l.at)}</b><span>${esc(l.to)}</span></div></div><small>${fdow(l.date)}, ${fdate(l.date)}${l.bag ? ' · ' + l.bag + ' kg baggage' : ''}</small> ${stopTag(l)}${segList(l)}</div>`;
function gdPricing(g) {
  const staff = isStaff(), pct = S.groupCostPct || 95, out = g.seats <= 0;
  return `<div class="tw"><table class="t gd-ptab"><thead><tr><th>Package</th>${ROOMS.map(r => `<th class="r">${r[1]}</th>`).join('')}</tr></thead><tbody>${g.pk.map(k => `<tr><td><b>${esc(k.mk || '-')}</b> <span class="sub">${k.mkn}N</span><div class="sub">${esc(k.md || '-')} · ${k.mdn}N</div></td>${ROOMS.map(r => { const p = k.p[r[0]], cost = Math.round(p * pct / 100); return `<td class="r">${p ? `<button class="gd-pc ${out ? 'na' : ''}" data-act="gBook" data-a="${esc(g.id)}|${esc(k.id)}|${r[2]}"><small>Book</small>${fnum(p)}</button>${staff ? `<div class="gd-mg">cost ${fnum(cost)}<br><b>margin ${fnum(p - cost)}</b></div>` : ''}` : '<span class="faint">-</span>'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div><p class="hint" style="margin-top:10px">${out ? 'This departure is sold out.' : 'Choose a price to start a booking. Travellers can be added on the booking form and seats are held automatically.'} Prices are PKR per person.</p>`;
}
function gdBookings(g) {
  const rows = heldBy(g);
  if (!rows.length) return `<div class="empty" style="padding:30px 10px">${ic('briefcase')}<h3>No bookings hold seats yet</h3><p>${g.seats > 0 ? 'Start the first booking from the Pricing tab.' : ''}</p></div>`;
  return `<div class="tw"><table class="t"><thead><tr><th>Booking</th><th>Agent / customer</th><th>Room</th><th class="r">Seats</th><th class="r">Amount</th><th>Status</th></tr></thead><tbody>${rows.map(b => `<tr class="click" data-act="open" data-a="${esc(b.id)}"><td><span class="bno">${esc(b.no)}</span><div class="sub">${esc(lead(b))} · ${fdate(b.created)}</div></td><td>${esc((P(b.partyId) || {}).name || '-')}</td><td>${esc(b.groupRef.room || '-')}</td><td class="r num">${b.groupRef.seats || 0}</td><td class="r num">${typeof bSell === 'function' ? fmt(bSell(b)) : ''}</td><td>${sbadge(b.status)}</td></tr>`).join('')}</tbody></table></div>`;
}
const gdManifest = g => heldBy(g).flatMap(b => b.pax.map((x, i) => ({ b, x, i })));
function gdPassengers(g) {
  const rows = gdManifest(g);
  if (!rows.length) return `<div class="empty" style="padding:30px 10px">${ic('users')}<h3>No passengers yet</h3><p>Travellers appear here as soon as a booking holds seats on this departure.</p></div>`;
  return `<div class="row" style="gap:8px;margin-bottom:12px"><button class="btn sm" data-act="gdCopyM">${ic('copy', 'sm')}Copy manifest</button><button class="btn sm" data-act="gdCsv">${ic('download', 'sm')}Download CSV</button><span class="hint" style="margin-left:auto">${rows.length} passenger(s) on ${heldBy(g).length} booking(s)</span></div>
  <div class="tw"><table class="t"><thead><tr><th>#</th><th>Name</th><th>Passport</th><th>DOB</th><th>Nationality</th><th>Type</th><th>Room</th><th>Booking</th></tr></thead><tbody>${rows.map((r, n) => `<tr class="click" data-act="open" data-a="${esc(r.b.id)}"><td class="num">${n + 1}</td><td><b>${esc(r.x.n)}</b></td><td class="mono">${esc(r.x.pp || '-')}</td><td>${r.x.dob ? fdate(r.x.dob) : '-'}</td><td>${esc(r.x.nat || '-')}</td><td>${esc(r.x.t || 'Adult')}</td><td>${esc(r.b.groupRef.room || '-')}</td><td><span class="bno">${esc(r.b.no)}</span></td></tr>`).join('')}</tbody></table></div>`;
}
const gdBody = g => ({ overview: gdOverview, pricing: gdPricing, bookings: gdBookings, passengers: gdPassengers }[GD.tab] || gdOverview)(g);
const gdHtml = g => `<div class="gd-tabs"><div class="tabs">${gdTabs().map(t => `<button class="${GD.tab === t[0] ? 'on' : ''}" data-act="gdTab" data-a="${t[0]}">${ic(t[2], 'sm')}${t[1]}${t[0] === 'bookings' ? `<i>${heldBy(g).length}</i>` : ''}</button>`).join('')}</div></div><div id="gd-body" class="gd-pane">${gdBody(g)}</div>`;
ACT.gDetail = id => {
  const g = (S.groups || []).find(x => x.id === id); if (!g) return; GD.id = id; GD.tab = 'overview';
  openModal({ title: `${gAirName(g)} · ${fdate(g.dep)} · ${g.id}`, wide: true, body: `<div id="gd-root">${gdHtml(g)}</div>`,
    foot: `<button class="btn ghost" data-act="closeModal">Close</button><span class="sp"></span>${isStaff() && can('groups.edit') ? `<button class="btn" data-act="gSeats" data-a="${esc(g.id)}">${ic('users', 'sm')}Update seats</button>` : ''}<button class="btn" data-act="gQuote" data-a="${esc(g.id)}">${ic('terminal', 'sm')}Quote</button><button class="btn pri" data-act="gdTab" data-a="pricing">${ic('briefcase', 'sm')}Book seats</button>` });
};
ACT.gdTab = a => { const g = (S.groups || []).find(x => x.id === GD.id); if (!g) return; GD.tab = a; const r = $('#gd-root'); if (r) r.innerHTML = gdHtml(g); };
const gdFile = g => 'manifest-' + g.id;
ACT.gdCopyM = () => { const g = S.groups.find(x => x.id === GD.id); navigator.clipboard.writeText(['#\tName\tPassport\tDOB\tNationality\tType\tRoom\tBooking', ...gdManifest(g).map((r, n) => [n + 1, r.x.n, r.x.pp, r.x.dob, r.x.nat, r.x.t, r.b.groupRef.room, r.b.no].join('\t'))].join('\n')).then(() => toast('Manifest copied')); };
ACT.gdCsv = () => {
  const g = S.groups.find(x => x.id === GD.id), q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const csv = [['No', 'Name', 'Passport', 'DOB', 'Nationality', 'Type', 'Room', 'Booking', 'Status'].map(q).join(','), ...gdManifest(g).map((r, n) => [n + 1, r.x.n, r.x.pp, r.x.dob, r.x.nat, r.x.t, r.b.groupRef.room, r.b.no, r.b.status].map(q).join(','))].join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })); a.download = gdFile(g) + '.csv'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
};

CHG.gF = (v, t) => { gf()[t.dataset.k] = v; renderView(); };
INP.gQ = debounce(v => { gf().q = v; $('#glist').innerHTML = gList(); gSelRefresh(); });
ACT.gSec = a => { gf().sec = a; renderView(); };
ACT.gAir = a => { gf().air = a; renderView(); };
ACT.gClear = () => { UI.f.grp = {}; renderView(); };
ACT.gCopy = id => navigator.clipboard.writeText(groupText(S.groups.find(g => g.id === id)).replace(/\*/g, '')).then(() => toast('Group details copied'));
ACT.gQuote = id => { UI.calc2 = UI.calc2 || null; UI.calcMode = 'group'; cc().gid = id; cc().pid = ''; go('calculator'); };
ACT.gBook = a => {
  const [gid, pid, room] = a.split('|'), g = S.groups.find(x => x.id === gid), k = g.pk.find(x => x.id === pid), price = k.p[ROOMS.find(r => r[2] === room)[0]];
  const cost = isStaff() ? Math.round(price * (S.groupCostPct || 95) / 100) : '';
  UI.prefill = { category: 'Group Package', groupRef: { gid, pid, room, seats: 0 }, services: [{ ...SVC_DEF('package'), type: 'package', title: `Umrah group ${g.airline} ${fdate(g.dep)} - ${room}`, qty: 1, autoQty: true, sell: price, cost, from: g.dep, to: g.ret,
    d: { code: g.id, airline: g.airline, out: g.out, inb: g.inb, makkah: k.mk, madinah: k.md, mkn: k.mkn, mdn: k.mdn, mkd: k.mkd, mdd: k.mdd, room } }] };
  go('bookingform', 'new');
};
ACT.gSeats = id => openModal({ title: 'Seats remaining · ' + id, body: fld('Seats left', `<input id="gs-n" type="number" inputmode="numeric" min="0" max="999" value="${S.groups.find(g => g.id === id).seats}">`), foot: `<button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn pri" data-act="gSeatsSave" data-a="${esc(id)}">Save</button>` });
ACT.gSeatsSave = async (id, b) => { try { await doRpc(b, 'setSeats', { id, seats: val('gs-n') }, 'Seats updated', closeModal); } catch { /* toast shown */ } };
const gSelRefresh = () => { const b = $('#gselbar'); if (b) b.innerHTML = gSelBar(); };
ACT.gNoop = () => {};
ACT.gSel = (id, t) => { if (t.checked) GSEL.add(id); else GSEL.delete(id); const row = t.closest('.gd-card, tr, .gd-mrow'); if (row) row.classList.toggle('sel', t.checked); gSelRefresh(); };
ACT.gSelAll = (a, t) => { const rows = gRows(); rows.forEach(g => { if (t.checked) GSEL.add(g.id); else GSEL.delete(g.id); }); $('#glist').innerHTML = gList(); gSelRefresh(); };
ACT.gSelClear = () => { GSEL.clear(); $('#glist').innerHTML = gList(); gSelRefresh(); };
/* Bulk removal: only the selected departures that are currently shown are sent. The server removes group listings only (never bookings, payments or ledgers) and refuses the whole batch when any group has active bookings until it is confirmed a second time. */
ACT.gBulkDel = async () => {
  const ids = gSelIds(); if (!ids.length) return;
  const list = ids.slice(0, 8).map(esc).join(', ') + (ids.length > 8 ? ' and ' + (ids.length - 8) + ' more' : '');
  if (!await confirmBox('Delete selected groups', `Remove <b>${ids.length}</b> departure${ids.length === 1 ? '' : 's'} from the catalogue?<br><br>${list}<br><br>Only the group listings are removed. Bookings, payments, ledgers and customers are not changed.`, 'Delete ' + ids.length, true)) return;
  const done = r => { ids.forEach(i => GSEL.delete(i)); toast(r.removed + ' group' + (r.removed === 1 ? '' : 's') + ' removed' + (r.missing && r.missing.length ? ' · ' + r.missing.length + ' already gone' : '')); gSelRefresh(); };
  try { done(await doRpc(null, 'delGroups', { ids })); }
  catch (e) { if (e.needForce && await confirmBox('Groups have active bookings', esc(e.message), 'Remove anyway', true)) { try { done(await doRpc(null, 'delGroups', { ids, force: true })); } catch { /* toast shown */ } } }
};
ACT.gDel = async id => {
  if (!await confirmBox('Remove group', 'Remove ' + esc(id) + ' from the catalogue?', 'Remove', true)) return;
  try { await doRpc(null, 'delGroup', { id }, 'Group removed'); } catch (e) { if (e.needForce && await confirmBox('Group has bookings', esc(e.message), 'Remove anyway', true)) await doRpc(null, 'delGroup', { id, force: true }, 'Group removed'); }
};

/* ---------- PDF import ---------- */
let IMP = [];
ACT.gImport = () => openModal({ title: 'Import supplier groups PDF', wide: true, body: `<div class="drop" data-act="gPick" id="drop">${ic('upload', 'lg')}<h3>Choose the "Umrah Groups" PDF</h3><p class="mute">Groups, flights, hotels, prices and seats are extracted automatically. Nothing is published until you confirm.</p><input type="file" id="gfile" accept="application/pdf" class="hide" data-chg="gFile"></div><div id="gprev"></div>` });
ACT.gPick = () => $('#gfile').click();
CHG.gFile = async (v, t) => {
  const f = t.files[0]; if (!f) return; const pv = $('#gprev'); pv.innerHTML = '<div class="c" style="padding:18px"><span class="spin dk"></span><div class="mute" style="margin-top:8px">Reading PDF...</div></div>';
  try {
    await loadPdf();
    IMP = await PdfParse.parsePdfFile(f); const t0 = todayISO(), live = IMP.filter(g => g.dep >= t0);
    if (!IMP.length) { pv.innerHTML = '<div class="errbox">No groups could be read from this PDF. Make sure it is the supplier "Umrah Groups" export.</div>'; return; }
    pv.innerHTML = `<div class="okbox" style="margin:14px 0">${IMP.length} group(s), ${sum(IMP, g => g.pk.length)} package(s) found${live.length < IMP.length ? ` · ${IMP.length - live.length} already departed will be skipped` : ''}.</div><div class="card tw" style="max-height:300px;overflow:auto"><table class="t"><thead><tr><th>Group</th><th>Departure</th><th>Return</th><th>Flight</th><th>Seats</th><th>Pkgs</th></tr></thead><tbody>${IMP.map(g => `<tr><td>${esc(g.id)}</td><td>${fdate(g.dep)}</td><td>${fdate(g.ret)}</td><td>${esc(g.out.fn)} / ${esc(g.inb.fn)}</td><td>${g.seats}</td><td>${g.pk.length}</td></tr>`).join('')}</tbody></table></div><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn pri" data-act="gPub">Publish ${live.length} group(s)</button></div>`;
  } catch (e) { pv.innerHTML = `<div class="errbox">${esc(e.message)}</div>`; }
};
ACT.gPub = async (a, b) => { await doRpc(b, 'saveGroups', { groups: IMP }, 'Groups published', closeModal); };

