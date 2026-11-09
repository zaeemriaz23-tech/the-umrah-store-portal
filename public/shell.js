/* Application shell: grouped, role-aware navigation with collapsible sections, icon rail, quick-create menu.
 * Loaded after core.js. It replaces nav() and wraps renderRoot(); every route, permission check and badge is the one core.js already uses. */
'use strict';
(function () {
  const NAV_KEY = 'umrah.nav.v2', RAIL_KEY = 'umrah.rail.v1';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
  };
  UI.navOpen = UI.navOpen || store.get(NAV_KEY, {});

  /* ---- navigation model: one definition per role, groups > items ---- */
  function model() {
    const staff = isStaff(), pend = staff ? (S.bookings || []).filter(b => b.status === 'Pending').length : 0;
    const pq = staff ? (S.queries || []).filter(q => q.status === 'Open').length : isAgent() ? (S.queries || []).filter(q => q.status === 'Quoted').length : 0;
    const pp = staff ? (S.payments || []).filter(p => p.status === 'Pending').length : 0;
    const chat = staff && typeof chatBadge === 'function' ? chatBadge() : '';
    const L = (r, label, icon, badge, extra) => ({ r, label, icon, badge: badge || '', ...(extra || {}) });
    const G = (id, label, icon, items, def) => ({ id, label, icon, items: items.filter(Boolean), def: !!def });

    if (isSup()) return [
      L('home', 'Overview', 'home'),
      L('bookings', 'Services', 'briefcase'),
      L('account/' + S.user.pid, 'My ledger', 'book'),
      L('support', 'Help & support', 'ticket', tkBadge())
    ];
    if (staff) {
      const sell = [canAny(...VPERM.search) && L('search', 'Flights & hotels', 'search'), can('groups.view') && L('groups', 'Group packages', 'layers'), can('transport.view') && L('transport', 'Transport', 'bus'), can('calculator.view') && L('calculator', 'Umrah calculator', 'terminal')];
      const work = [canAny(...VPERM.bookings) && L('bookings', 'Bookings', 'briefcase', pend), can('queries.view') && L('queries', 'Quotes & queries', 'bell', pq), canAny(...VPERM.accounts) && L('accounts', 'Accounts', 'book'), can('payments.view') && L('payments', 'Payments', 'wallet', pp), can('rates.view') && L('rates', 'Rates & inventory', 'tag'), can('agents.create') && L('applications', 'Applications', 'users', S.appsPending || '')];
      const more = [can('reports.view') && L('reports', 'Reports', 'chart'), canAny(...VPERM.banking) && L('banking', 'Bank accounts', 'card'), can('chat.view') && L('chat', 'Live chat', 'chat', chat), can('support.view') && L('support', 'Support', 'ticket', tkBadge()), (can('promos.view') || can('promos.edit')) && L('promos', 'Promotions', 'tag'), (isAdmin() || can('assistant.groups')) && L('assistant', 'AI assistant', 'spark'), canAny(...VPERM.staff) && L('staff', 'Staff & access', 'shield'), canAny(...VPERM.settings) && L('settings', 'Settings', 'settings')];
      return [can('dashboard.view') && L('home', 'Dashboard', 'home'), G('sell', 'Sell', 'plane', sell), G('work', 'Manage', 'briefcase', work), G('more', 'More', 'settings', more)].filter(Boolean).filter(x => !x.items || x.items.length);
    }
    // agent / customer portal
    return [L('home', 'Dashboard', 'home'),
      G('sell', 'Sell', 'plane', [L('search', 'Flights & hotels', 'search'), L('groups', 'Group packages', 'layers'), L('transport', 'Transport', 'bus'), L('calculator', 'Umrah calculator', 'terminal')]),
      G('work', 'My account', 'briefcase', [L('bookings', 'My bookings', 'briefcase', pend), L('queries', 'Queries & quotes', 'bell', pq), L('account/' + S.user.pid, 'My ledger', 'book'), L('payments', 'Payments', 'wallet', pp), L('banking', 'Bank accounts', 'card')]),
      L('support', 'Help & support', 'ticket', tkBadge())];
  }

  function isOn(it, cur) {
    const [base, arg] = it.r.split('/');
    if (it.r === 'bookingform/new') return cur.name === 'bookingform' && cur.args[0] === 'new';
    if (base === 'bookings') return cur.name === 'bookings' || cur.name === 'booking' || (cur.name === 'bookingform' && cur.args[0] !== 'new');
    if (base === 'account') return cur.name === 'account' && String(cur.args[0]) === String(arg);
    if (base === 'accounts') return cur.name === 'accounts' || (cur.name === 'account' && isStaff());
    return base === cur.name;
  }

  window.nav = function nav() {
    const cur = route(), m = model();
    m.forEach(e => { if (e.items) e.items.forEach(i => { i.on = isOn(i, cur); }); else e.on = isOn(e, cur); });
    // expand the section of the page being viewed whenever the page changes
    if (false && UI.navSeen !== cur.name + '/' + (cur.args[0] || '')) {
      UI.navSeen = cur.name + '/' + (cur.args[0] || '');
      const g = m.find(e => e.items && e.items.some(i => i.on)); if (g && UI.navOpen[g.id] !== true) { UI.navOpen[g.id] = true; store.set(NAV_KEY, UI.navOpen); }
    }
    const link = (it, sub) => `<a href="#/${it.r}" class="${sub ? 'ns' : 'nx'}${it.on ? ' on' : ''}" title="${esc(it.label)}"${it.on ? ' aria-current="page"' : ''}>${ic(it.icon)}<span>${esc(it.label)}</span>${it.badge ? `<b class="nb">${it.badge}</b>` : ''}</a>`;
    return m.map(e => (e.items ? `<div class="nsec">${esc(e.label)}</div>${e.items.map(i => link(i, false)).join('')}` : link(e, false))).join('');
  };

  ACT.navGrp = id => {
    const g = $('.ng[data-g="' + id + '"]'); if (!g) return;
    const open = !g.classList.contains('open'); UI.navOpen[id] = open; store.set(NAV_KEY, UI.navOpen);
    g.classList.toggle('open', open); const h = g.querySelector('.ngh'); if (h) h.setAttribute('aria-expanded', open);
  };

  /* ---- icon rail (desktop) ---- */
  const applyRail = () => { const a = $('.app'); if (a) a.classList.toggle('rail', !!store.get(RAIL_KEY, false)); };
  ACT.rail = () => { store.set(RAIL_KEY, !store.get(RAIL_KEY, false)); applyRail(); };

  /* ---- quick create ---- */
  window.quickItems = function quickItems() {
    const o = [];
    if (!isSup() && !(isStaff() && !can('bookings.create'))) o.push(['href', '#/bookingform/new', 'briefcase', 'New booking', 'Travellers, services and pricing']);
    if (!isSup() && (!isStaff() || can('queries.view'))) o.push(['act', 'qNew', 'bell', 'New query', 'Ask the office for a quote']);
    if (isStaff() && can('payments.view')) o.push(['act', 'payAdd', 'wallet', 'Record payment', 'Receipt against an account']);
    if (isStaff() && can('groups.create')) o.push(['act', 'gAdd', 'layers', 'Add group departure', 'Flights, hotels and seat prices']);
    return o;
  };
  ACT.quick = () => {
    const m = $('#qmenu'); if (!m) return; const open = m.hidden; m.hidden = !open;
    const b = $('#qbtn'); if (b) b.setAttribute('aria-expanded', open);
  };
  ACT.quickGo = (a) => { const m = $('#qmenu'); if (m) m.hidden = true; if (ACT[a]) ACT[a](); };
  document.addEventListener('click', e => { const m = $('#qmenu'); if (m && !m.hidden && !e.target.closest('#qwrap')) m.hidden = true; });

  /* ---- keyboard: Ctrl/Cmd+K focuses global search; Esc closes menus ---- */
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { const i = $('#gsearch'); if (i) { e.preventDefault(); i.focus(); i.select(); } }
    if (e.key === 'Escape') { const m = $('#qmenu'); if (m) m.hidden = true; }
  });

  const rr = window.renderRoot;
  window.renderRoot = function () { rr(); applyRail(); };
})();
