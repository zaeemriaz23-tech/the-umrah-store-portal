/* Admin panels inside "Services & sync": Supplier sync (automatic Meezab inventory) and Maintenance mode. Loaded after v-tus.js. */
(function () {
  'use strict';
  const SP = { inv: null, state: 'all', q: '', loading: false, busy: false, open: {} };
  const ago = iso => { if (!iso) return 'never'; const s = Math.max(0, (Date.now() - new Date(iso)) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : new Date(iso).toLocaleDateString(); };
  const L = { ok: ['Healthy', 'green'], error: ['Retrying', 'amber'], needs_reauth: ['Needs sign-in', 'red'], idle: ['Waiting', 'gray'], disabled: ['Off', 'gray'] };
  const n = v => (v == null ? '-' : Number(v).toLocaleString('en-US'));
  const post = (u, b) => api(u, { method: 'POST', body: JSON.stringify(b || {}) });
  const busy = (on, btn) => { SP.busy = on; if (btn) btn.disabled = on; };

  window.supplierTab = function () {
    const z = S.supplierSyncAdmin; if (!z) return empty('shield', 'Not available', 'Only administrators can manage supplier sync.');
    const [lbl, col] = L[z.status] || L.idle, t = z.totals || {}, s = z.summary || {}, h = z.history || [];
    return `${!z.configured ? `<div class="warnbox" style="margin-bottom:14px"><b>Waiting for server credentials.</b> Set <code>MEEZAB_USERNAME</code> and <code>MEEZAB_PASSWORD</code> in the hosting environment (and <code>MEEZAB_LOGIN_PATH</code> if the supplier sign-in page is not <code>/login</code>), then restart. You can also paste a signed-in session below. Credentials are never typed or stored here.</div>` : ''}
    ${z.status === 'needs_reauth' ? `<div class="warnbox" style="margin-bottom:14px"><b>Sign-in needed.</b> ${esc(z.lastError)}<br>Sign in to the supplier CRM in your own browser, copy the session cookie and paste it below. We never bypass CAPTCHA or verification codes.</div>` : ''}
    ${z.status === 'error' && z.lastError ? `<div class="warnbox" style="margin-bottom:14px"><b>Last attempt failed, retrying automatically.</b> ${esc(z.lastError)}<br>The previous inventory stays in place until a complete, valid response arrives.</div>` : ''}
    <div class="kpis"><div class="kpi"><span>Status</span><b>${badge('x', lbl).replace('gray', col)}</b><small class="sub">${z.nextAt && z.enabled ? 'next run ' + new Date(z.nextAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}</small></div>
      <div class="kpi"><span>Last successful sync</span><b style="font-size:16px">${ago(z.lastOkAt)}</b><small class="sub">${z.lastOkAt ? esc(new Date(z.lastOkAt).toLocaleString()) : ''}</small></div>
      <div class="kpi"><span>Groups</span><b>${n(t.activeGroups)}</b><small class="sub">${n(t.groups)} total · ${n(t.inactiveGroups)} inactive</small></div>
      <div class="kpi"><span>Packages</span><b>${n(t.activePackages)}</b><small class="sub">${n(t.packages)} total · ${n(t.inactivePackages)} inactive</small></div></div>
    <div class="gap"></div><div class="kpis"><div class="kpi"><span>New (last run)</span><b>${n((s.newGroups || 0))} <small>groups</small></b><small class="sub">${n(s.newPackages || 0)} packages</small></div>
      <div class="kpi"><span>Updated (last run)</span><b>${n(s.updatedGroups || 0)} <small>groups</small></b><small class="sub">${n(s.updatedPackages || 0)} packages</small></div>
      <div class="kpi"><span>Removed / inactive (last run)</span><b>${n(s.removedGroups || 0)} <small>groups</small></b><small class="sub">${n(s.removedPackages || 0)} packages</small></div>
      <div class="kpi"><span>Needs attention</span><b>${n((t.awaitingSeats || 0) + (t.needPrice || 0))}</b><small class="sub">${n(t.awaitingSeats || 0)} seats unreadable · ${n(t.needPrice || 0)} unpriced</small></div></div>
    <div class="gap"></div><div class="card cp"><div class="row sb" style="flex-wrap:wrap;gap:12px"><div class="row" style="gap:18px;flex-wrap:wrap;align-items:center">
      <label class="chk"><input type="checkbox" id="spOn" ${z.enabled ? 'checked' : ''}> Automatic sync</label>
      <label class="row" style="gap:8px">Every <input id="spInt" type="number" min="1" max="60" value="${z.intervalMin}" style="width:70px"> minutes</label>
      <label class="row" style="gap:8px" title="A package or group must be missing from this many complete syncs in a row before it is deactivated">Deactivate after <select id="spMiss" style="width:auto">${[1, 2, 3, 4, 5].map(k => `<option ${z.missThreshold === k ? 'selected' : ''}>${k}</option>`).join('')}</select> missed sync(s)</label>
      <label class="chk" title="Auto-created selling prices follow supplier price plus your markup. A price you edit is locked and never changed again."><input type="checkbox" id="spPf" ${z.priceFollow ? 'checked' : ''}> Keep auto-priced packages in step with supplier cost</label>
      <button class="btn sm" data-act="spSave">${ic('check', 'sm')}Save</button></div>
      <button class="btn pri" data-act="spRun" ${z.running || !z.configured ? 'disabled' : ''}>${ic('activity', 'sm')}Sync now</button></div>
    <div class="hint" style="margin-top:10px">Read-only toward <b>${esc(z.host || 'the supplier CRM')}</b>${z.endpoint ? ' (' + esc(z.endpoint) + ')' : ''}: groups and packages are discovered, updated and deactivated automatically, matched by GroupOid and PackageCode. Nothing is ever deleted, bookings, agents, ledgers and payments are never touched, and an unreadable seat value is never treated as zero.</div></div>
    ${z.configured || z.hasSession ? `<div class="gap"></div><div class="card cp"><div class="ch"><h3>Supply a fresh session</h3></div><div class="row" style="gap:10px;flex-wrap:wrap"><input id="spCookie" type="password" autocomplete="off" placeholder="Paste the Cookie header value from your signed-in browser" style="flex:1;min-width:260px"><button class="btn" data-act="spSess">${ic('key', 'sm')}Use this session</button></div><div class="hint" style="margin-top:8px">${z.canStoreSession ? 'Stored encrypted on the server.' : 'Kept in server memory only (set MEEZAB_SECRET_KEY to keep it across restarts).'} It is never shown to agents.</div></div>` : ''}
    <div class="gap"></div><div class="card"><div class="ch"><h3>Synchronised inventory</h3><div class="row" style="gap:8px;flex-wrap:wrap"><select id="spSt" style="width:auto"><option value="all" ${SP.state === 'all' ? 'selected' : ''}>All</option><option value="active" ${SP.state === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${SP.state === 'inactive' ? 'selected' : ''}>Inactive</option></select><input id="spQ" placeholder="Search code, airline, GroupOid, package" value="${esc(SP.q)}" style="width:240px"><button class="btn sm" data-act="spInv">${SP.loading ? 'Loading...' : 'Load inventory'}</button></div></div>
      <div id="spInvBox">${invHtml()}</div></div>
    <div class="gap"></div><div class="card"><div class="ch"><h3>Sync history</h3><span class="sub">Latest ${h.length} entries (identical quiet runs are merged)</span></div>
    ${h.length ? `<div class="tw"><table class="t"><thead><tr><th>When</th><th>By</th><th>Result</th><th class="num">Groups</th><th class="num">Pkgs</th><th class="num">New g/p</th><th class="num">Upd g/p</th><th class="num">Removed g/p</th><th class="num">Seats ?</th><th class="num">Time</th></tr></thead><tbody>${h.map(e => `<tr><td>${esc(new Date(e.at).toLocaleString())}${e.repeat > 1 ? `<div class="sub">${e.repeat} identical runs</div>` : ''}</td><td>${esc(e.manual ? 'Manual' : 'Auto')}${e.by && !['scheduler', 'startup'].includes(e.by) ? ' - ' + esc(e.by) : ''}</td><td>${e.ok ? badge('x', 'OK').replace('gray', 'green') : `<span class="bdg red">Failed</span><div class="sub" style="max-width:340px;white-space:normal">${esc(e.error || '')}</div>`}</td><td class="num">${e.ok ? n(e.groups) : '-'}</td><td class="num">${e.ok ? n(e.packages) : '-'}</td><td class="num">${e.ok ? (e.newGroups || 0) + ' / ' + (e.newPackages || 0) : '-'}</td><td class="num">${e.ok ? (e.updatedGroups || 0) + ' / ' + (e.updatedPackages || 0) : '-'}</td><td class="num">${e.ok ? (e.removedGroups || 0) + ' / ' + (e.removedPackages || 0) : '-'}</td><td class="num">${e.ok ? (e.unknownSeats || 0) : '-'}</td><td class="num">${e.ms != null ? (e.ms / 1000).toFixed(1) + 's' : '-'}</td></tr>`).join('')}</tbody></table></div>` : `<div class="pad sub">No sync has run yet.</div>`}</div>
    ${z.shape && z.shape.keys ? `<div class="gap"></div><div class="card cp"><div class="ch"><h3>Supplier fields detected</h3><span class="sub">${n(z.shape.rows)} rows · ${esc(ago(z.shape.at))}</span></div><div class="hint" style="word-break:break-word">${z.shape.keys.map(k => `<code>${esc(k)}</code>`).join(' ')}</div></div>` : ''}`;
  };

  function invHtml() {
    if (SP.inv === null) return `<div class="pad sub">Click <b>Load inventory</b> to browse every synchronised group and package.</div>`;
    if (!SP.inv.length) return `<div class="pad sub">Nothing matches.</div>`;
    return `<div class="tw" style="max-height:520px;overflow:auto"><table class="t"><thead><tr><th>Group</th><th>GroupOid</th><th>Airline</th><th>Departs</th><th>Returns</th><th class="num">Seats</th><th>State</th><th class="num">Packages</th></tr></thead><tbody>${SP.inv.map(g => `<tr class="click" data-act="spOpen" data-a="${esc(g.id)}"><td><b>${esc(g.code)}</b><div class="sub">${esc(g.id)}</div></td><td class="sub">${esc(g.oid)}</td><td>${esc(g.airline)}</td><td>${esc(g.dep)}</td><td>${esc(g.ret)}</td><td class="num">${g.seatsKnown ? g.seats : '<span class="sub">unreadable</span>'}</td><td>${g.active ? '<span class="bdg green">Active</span>' : '<span class="bdg gray">Inactive</span>'}${g.adopted ? ' <span class="bdg gray">Linked</span>' : ''}</td><td class="num">${g.packages.filter(p => p.active).length} / ${g.packages.length}</td></tr>${SP.open[g.id] ? `<tr><td colspan="8" style="background:var(--bg2,#f6f7fb)">${g.packages.length ? `<table class="t"><thead><tr><th>Package</th><th>Hotels</th><th class="num">Supplier cost (sh/qd/tr/db)</th><th class="num">Our price</th><th>State</th></tr></thead><tbody>${g.packages.map(p => `<tr><td>${esc(p.code || p.id)}</td><td>${esc([p.mk, p.md].filter(Boolean).join(' + ') || '-')}</td><td class="num">${p.cost ? ['sh', 'qd', 'tr', 'db'].map(k => n(p.cost[k] || 0)).join(' / ') : '-'}</td><td class="num">${p.sell ? ['sh', 'qd', 'tr', 'db'].map(k => n(p.sell[k] || 0)).join(' / ') : '-'}${p.locked ? ' <span class="bdg gray">locked</span>' : p.auto ? ' <span class="bdg gray">auto</span>' : ''}</td><td>${p.active ? '<span class="bdg green">Active</span>' : '<span class="bdg gray">Inactive</span>'}</td></tr>`).join('')}</tbody></table>` : '<span class="sub">This group has no packages.</span>'}</td></tr>` : ''}`).join('')}</tbody></table></div>`;
  }
  const paintInv = () => { const b = document.getElementById('spInvBox'); if (b) b.innerHTML = invHtml(); };
  ACT.spOpen = id => { SP.open[id] = !SP.open[id]; paintInv(); };
  ACT.spInv = async (a, btn) => {
    SP.state = (document.getElementById('spSt') || {}).value || 'all'; SP.q = (document.getElementById('spQ') || {}).value || ''; SP.loading = true; if (btn) btn.disabled = true;
    try { const r = await api('/api/supplier/inventory?state=' + encodeURIComponent(SP.state) + '&q=' + encodeURIComponent(SP.q)); SP.inv = r.items || []; } catch (e) { toast(e.message, true); }
    SP.loading = false; if (btn) btn.disabled = false; paintInv();
  };
  ACT.spSave = async (a, btn) => {
    busy(true, btn);
    try { await post('/api/supplier/sync/config', { enabled: document.getElementById('spOn').checked, intervalMin: +val('spInt'), missThreshold: +val('spMiss'), priceFollow: document.getElementById('spPf').checked }); toast('Supplier sync settings saved'); await refresh(); } catch (e) { toast(e.message, true); }
    busy(false, btn);
  };
  ACT.spRun = async (a, btn) => {
    busy(true, btn);
    try { const r = await post('/api/supplier/sync/run'); toast(r.ok ? 'Supplier sync finished' : (r.error || (r.entry && r.entry.error) || 'Supplier sync failed'), !r.ok); await refresh(); if (SP.inv) ACT.spInv(); } catch (e) { toast(e.message, true); }
    busy(false, btn);
  };
  ACT.spSess = async (a, btn) => {
    busy(true, btn);
    try { const r = await post('/api/supplier/sync/session', { cookie: val('spCookie') }); toast(r.ok ? 'Signed in. Inventory synced.' : (r.error || 'Session saved'), !r.ok); await refresh(); } catch (e) { toast(e.message, true); }
    busy(false, btn);
  };

  /* ---------- maintenance ---------- */
  window.maintTab = function () {
    const m = S.maintenance; if (!m || m.on === undefined) return empty('shield', 'Not available', 'Only administrators can change maintenance mode.');
    return `<div class="card cp"><div class="row sb" style="flex-wrap:wrap;gap:14px;align-items:center"><div><h3 style="margin:0">Maintenance mode is <span class="bdg ${m.on ? 'red' : 'green'}">${m.on ? 'ON' : 'OFF'}</span></h3>
      <div class="sub" style="margin-top:6px">${m.on ? 'Visitors see the maintenance page, sign-ups are blocked and agents cannot sign in' + (m.since ? ' (since ' + esc(new Date(m.since).toLocaleString()) + (m.by ? ' by ' + esc(m.by) : '') + ')' : '') + '.' : 'The portal is open to everyone.'}</div></div>
      <button class="btn ${m.on ? 'pri' : ''}" data-act="mtToggle" data-a="${m.on ? 'off' : 'on'}">${m.on ? 'Turn maintenance OFF' : 'Turn maintenance ON'}</button></div></div>
    <div class="gap"></div><div class="card cp"><div class="ch"><h3>What visitors see</h3><a class="btn sm" href="/?preview=maintenance" target="_blank" rel="noopener">${ic('eye', 'sm')}Preview page</a></div>
      <div class="g1" style="display:grid;gap:12px">${fld('Headline', `<input id="mtTitle" maxlength="90" placeholder="We are upgrading the platform" value="${esc(m.title || '')}">`)}${fld('Message', `<textarea id="mtMsg" rows="3" maxlength="500" placeholder="The portal is briefly offline while we make improvements...">${esc(m.message || '')}</textarea>`)}${fld('Expected back (optional)', `<input id="mtEta" maxlength="60" placeholder="e.g. Today, 6:00 PM PKT" value="${esc(m.eta || '')}">`)}
      <label class="chk"><input type="checkbox" id="mtStaff" ${m.allowStaff ? 'checked' : ''}> Let staff accounts keep working (administrators always can)</label></div>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-act="mtSave">${ic('check', 'sm')}Save message</button></div>
      <div class="hint" style="margin-top:10px">Enforced on the server. While it is on: public pages show the maintenance page, new applications and enquiries are refused, and agents are signed out of the API. Administrators are never locked out, payment-gateway callbacks keep working, and no account, booking, payment or ledger is touched. Turning it off restores everything instantly.</div></div>`;
  };
  const mtBody = () => ({ title: val('mtTitle'), message: val('mtMsg'), eta: val('mtEta'), allowStaff: document.getElementById('mtStaff').checked });
  ACT.mtSave = async (a, btn) => { busy(true, btn); try { await post('/api/admin/maintenance', mtBody()); toast('Maintenance message saved'); await refresh(); } catch (e) { toast(e.message, true); } busy(false, btn); };
  ACT.mtToggle = async (mode, btn) => {
    const on = mode === 'on';
    if (on && !confirm('Turn maintenance mode ON?\n\nVisitors will see the maintenance page and agents will not be able to sign in. Administrators keep full access.')) return;
    busy(true, btn);
    try { await post('/api/admin/maintenance', { ...mtBody(), on }); toast('Maintenance mode is now ' + (on ? 'ON' : 'OFF')); await refresh(); } catch (e) { toast(e.message, true); }
    busy(false, btn);
  };
})();
