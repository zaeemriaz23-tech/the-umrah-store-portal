'use strict';
const MINPW = () => Math.max(6, +(require('./db').db.settings.security || {}).minPassword || 8);
const fs = require('fs');
const path = require('path');
const D = require('./db');
const { db, DATA, hash, check, nid, today, fail, need, str, num, isoDate, logAct, party, token, uniqueNo } = D;
const F = require('./files');
const L = require('./ledger');
const PM = require('./perms');
const Gr = require('./groups');
const Mail = require('./mailer');
const Promos = require('./promos');
PM.init();

const isAdmin = u => u.role === 'admin';
const isStaff = u => u.role === 'admin' || u.role === 'staff';
const canApprove = u => isAdmin(u) || (u.role === 'staff' && PM.can(u, 'bookings.approve'));
const canCosts = u => isAdmin(u) || (u.role === 'staff' && PM.can(u, 'bookings.costs'));
const TYPES = ['visa', 'hotel', 'transport', 'flight', 'package', 'other'];
const QTYPES = ['flight', 'hotel', 'visa', 'transport', 'package', 'other'];
const nowISO = () => new Date().toISOString();
const BANK_KINDS = ['bank', 'wallet', 'raast'], BANK_THEMES = ['green', 'gold', 'navy', 'maroon', 'slate', 'teal'];
const normBank = b => ({ id: str(b.id, 20) || 'bk' + nid(), kind: BANK_KINDS.includes(b.kind) ? b.kind : 'bank', title: str(b.title, 80), bank: str(b.bank, 80), branch: str(b.branch, 80), account: str(b.account, 60), iban: str(b.iban, 60).replace(/\s+/g, '').toUpperCase(), swift: str(b.swift, 20).toUpperCase(), wallet: str(b.wallet, 30), raast: str(b.raast, 60), currency: str(b.currency, 6).toUpperCase() || 'PKR', vis: ['public', 'agents', 'staff'].includes(b.vis) ? b.vis : (b.public === false ? 'agents' : 'public'), order: Math.max(0, Math.min(999, Math.round(+b.order) || 0)), note: str(b.note, 200), instructions: str(b.instructions, 300), theme: BANK_THEMES.includes(b.theme) ? b.theme : 'green', active: b.active !== false, public: b.public !== false, logo: typeof b.logo === 'string' && b.logo.length < 200000 && /^data:image\//.test(b.logo) ? b.logo : '', qr: typeof b.qr === 'string' && b.qr.length < 450000 && /^(data:image\/|\/)/.test(b.qr) ? b.qr : '' });
const MODES = { receipt: ['.jpg', '.jpeg', '.png', '.pdf', '.webp', '.heic', '.gif'] };

/* ---------- helpers ---------- */
const cleanObj = (o, depth = 0) => {
  if (!o || typeof o !== 'object' || depth > 2) return {};
  const out = {};
  Object.keys(o).slice(0, 40).forEach(k => {
    const v = o[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = cleanObj(v, depth + 1);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 300);
  });
  return out;
};
const getBooking = (u, id) => {
  const b = db.bookings.find(x => x.id === id || x.no === id);
  if (!b) fail('Booking not found');
  if (u.role === 'agent' && b.partyId != u.pid) fail('Booking not found');
  if (u.role === 'supplier') fail('Not allowed');
  return b;
};
const releaseSeats = b => {
  if (b.groupRef && b.groupRef.seats) { const g = db.groups.find(x => x.id === b.groupRef.gid); if (g) g.seats += b.groupRef.seats; b.groupRef.seats = 0; }
};
const takeSeats = (b, force, isEdit) => {
  if (!b.groupRef) return;
  const g = db.groups.find(x => x.id === b.groupRef.gid); if (!g) { b.groupRef.seats = 0; return; }
  if (!isEdit && !force && !require('./groups').isLive(g)) fail('This group is no longer available. Please choose another departure.');
  if (b.pax.length > g.seats && !force) fail('Only ' + g.seats + ' seat(s) left on this group', { seats: true });
  b.groupRef.seats = Math.min(b.pax.length, g.seats); g.seats -= b.groupRef.seats;
};
const sumBy = (b, f) => f(b);
const diffSummary = (o, n) => {
  const c = [];
  if (o.category !== n.category) c.push('category');
  if (o.partyId != n.partyId) c.push('account');
  if (JSON.stringify(o.pax) !== JSON.stringify(n.pax)) c.push('travellers');
  if (L.bookingSell(o) !== L.bookingSell(n)) c.push('sell ' + L.bookingSell(o) + ' > ' + L.bookingSell(n));
  if (L.bookingCost(o) !== L.bookingCost(n)) c.push('cost ' + L.bookingCost(o) + ' > ' + L.bookingCost(n));
  if (JSON.stringify(o.services.map(s => s.supId)) !== JSON.stringify(n.services.map(s => s.supId))) c.push('supplier');
  if (JSON.stringify(o.services.map(s => s.d)) !== JSON.stringify(n.services.map(s => s.d))) c.push('service details');
  if (o.from !== n.from || o.to !== n.to) c.push('dates');
  if (o.notes !== n.notes) c.push('notes');
  return c.length ? c.join(', ') : 'no material change';
};

const OPS = {
  /* ================= BOOKINGS ================= */
  saveBooking(u, p) {
    need(u.role !== 'supplier', 'Not allowed');
    const old = p.id ? getBooking(u, p.id) : null;
    if (old && u.role === 'agent') need(old.status === 'Pending', 'This booking has been processed. Ask the office to change it.');
    const pid = u.role === 'agent' ? u.pid : +p.partyId;
    const pty = party(pid);
    if (!pty || pty.kind === 'supplier') fail('Select the agent or customer this booking belongs to');
    const px = (p.pax || []).map(x => ({ n: str(x.n, 80), pp: str(x.pp, 24).toUpperCase().replace(/\s+/g, ''), dob: isoDate(x.dob), nat: str(x.nat, 40), g: x.g === 'F' ? 'F' : 'M', t: ['Adult', 'Child', 'Infant'].includes(x.t) ? x.t : 'Adult', beds: x.beds !== false, visaNo: str(x.visaNo, 40), pnr: str(x.pnr, 24) }));
    if (!px.length) fail('Add at least one traveller');
    if (px.length > 60) fail('Too many travellers in one booking');
    if (px.some(x => !x.n || !x.pp)) fail('Enter the name and passport number for every traveller');
    const seen = new Set();
    px.forEach(x => { if (seen.has(x.pp)) fail('Passport ' + x.pp + ' is repeated in this booking'); seen.add(x.pp); });
    const oldSvc = old ? Object.fromEntries(old.services.map(s => [s.id, s])) : {};
    const accountingFx = +((db.settings.calc || {}).pkrPerSar) || 0;
    const normalizeMoney = (svc, key, prev) => {
      const rawKey = key + 'Amount', currencyKey = key + 'Currency';
      const hasNativeValue = Object.prototype.hasOwnProperty.call(svc, rawKey) && svc[rawKey] !== '' && svc[rawKey] !== null && svc[rawKey] !== undefined;
      if (hasNativeValue) {
        const currency = svc[currencyKey] === 'SAR' ? 'SAR' : 'PKR';
        const nativeMoney = value => Math.max(0, Math.round((Number.isFinite(+value) ? +value : 0) * 100) / 100);
        const amount = nativeMoney(svc[rawKey]);
        // When editing an unrelated booking field, retain the exact original base amount and FX snapshot.
        // Only a changed native amount or currency is converted at the current office rate.
        const prevAmount = prev && prev[rawKey] !== undefined && prev[rawKey] !== null ? nativeMoney(prev[rawKey]) : null;
        if (prev && prev[currencyKey] === currency && prevAmount !== null && Math.round(prevAmount * 100) === Math.round(amount * 100)) {
          return { base: num(svc[key]), currency, amount, fx: num(prev[key + 'FxRate']) || 1 };
        }
        if (currency === 'SAR' && amount > 0 && !(accountingFx > 0)) fail('Set the office SAR → PKR exchange rate before saving SAR booking prices. You can choose PKR for this service instead.');
        return { base: currency === 'SAR' ? Math.round(amount * accountingFx) : Math.round(amount), currency, amount, fx: currency === 'SAR' ? accountingFx : 1 };
      }
      // Older clients and historical records use PKR base amounts. Preserve their meaning.
      if (prev && prev[currencyKey]) {
        const prevFx = num(prev[key + 'FxRate']) || 1;
        const previousNative = prev[rawKey] !== undefined && prev[rawKey] !== null && prev[rawKey] !== ''
          ? Math.max(0, Math.round((Number.isFinite(+prev[rawKey]) ? +prev[rawKey] : 0) * 100) / 100)
          : (prev[currencyKey] === 'SAR' && prevFx > 0 ? Math.round((num(svc[key]) / prevFx) * 100) / 100 : num(svc[key]));
        return { base: num(svc[key]), currency: prev[currencyKey], amount: previousNative, fx: prevFx };
      }
      return { base: num(svc[key]), currency: 'PKR', amount: num(svc[key]), fx: 1 };
    };
    const svcs = (p.services || []).slice(0, 40).map((s, i) => {
      const type = TYPES.includes(s.type) ? s.type : 'other', prev = oldSvc[s.id], sale = normalizeMoney(s, 'sell', prev);
      const o = {
        id: prev ? prev.id : 's' + nid(), type, title: str(s.title, 160), qty: Math.max(1, num(s.qty) || 1), sell: sale.base,
        sellCurrency: sale.currency, sellAmount: sale.amount, sellFxRate: sale.fx,
        supId: null, cost: 0, conf: prev ? prev.conf : '', cs: prev ? prev.cs : 'Requested',
        from: isoDate(s.from), to: isoDate(s.to), d: cleanObj(s.d)
      };
      if (canCosts(u)) {
        const cost = normalizeMoney(s, 'cost', prev);
        o.supId = s.supId && party(s.supId) && party(s.supId).kind === 'supplier' ? +s.supId : null;
        o.cost = cost.base; o.costCurrency = cost.currency; o.costAmount = cost.amount; o.costFxRate = cost.fx;
        o.conf = str(s.conf, 80); o.cs = o.conf ? 'Confirmed' : (['Requested', 'Confirmed'].includes(s.cs) ? s.cs : 'Requested');
      } else if (prev) { o.supId = prev.supId; o.cost = prev.cost; o.costCurrency = prev.costCurrency || 'PKR'; o.costAmount = prev.costAmount ?? prev.cost; o.costFxRate = prev.costFxRate || 1; }
      if (!o.title) o.title = { visa: 'Visa', hotel: (o.d.hotel || 'Hotel'), transport: (o.d.route || 'Transport'), flight: ((o.d.fno || '') + ' ' + (o.d.from || '') + '-' + (o.d.to || '')).trim() || 'Flight', package: 'Umrah package', other: 'Service' }[type];
      return o;
    });
    if (!svcs.length) fail('Add at least one service to this booking');
    const dates = svcs.flatMap(s => [s.from, s.to]).filter(Boolean).sort();
    const b = {
      id: old ? old.id : 'b' + nid(), no: old ? old.no : uniqueNo(), partyId: pid, category: str(p.category, 60) || 'Custom', status: old ? old.status : (p.confirm && canApprove(u) ? 'Confirmed' : 'Pending'),
      pax: px, services: svcs, from: isoDate(p.from) || dates[0] || '', to: isoDate(p.to) || dates[dates.length - 1] || '',
      notes: str(p.notes, 800), internal: isStaff(u) ? str(p.internal, 800) : (old ? old.internal : ''),
      voucherMeta: (() => { const m = cleanObj(p.voucherMeta || (old && old.voucherMeta) || {}); return { iata: str(m.iata, 120), saudiCompany: str(m.saudiCompany, 120), branch: str(m.branch, 40), voucherDate: isoDate(m.voucherDate), manualNo: str(m.manualNo, 50), groupNo: str(m.groupNo, 60), familyHead: str(m.familyHead, 100), whatsapp: str(m.whatsapp, 40), packageName: str(m.packageName, 80), supplierVoucherNo: str(m.supplierVoucherNo, 60), issuedBy: str(m.issuedBy, 120), totalPax: Math.max(0, Math.min(100, num(m.totalPax))), totalBeds: Math.max(0, Math.min(100, num(m.totalBeds))), adults: Math.max(0, Math.min(100, num(m.adults))), children: Math.max(0, Math.min(100, num(m.children))), infants: Math.max(0, Math.min(100, num(m.infants))) }; })(),
      created: old ? old.created : today(), createdAt: old ? old.createdAt : nowISO(), by: old ? old.by : u.name, history: old ? old.history : [],
      groupRef: old ? old.groupRef : (p.groupRef && p.groupRef.gid ? { gid: str(p.groupRef.gid, 30), pid: str(p.groupRef.pid, 30), room: str(p.groupRef.room, 20), seats: 0 } : null),
      queryId: old ? old.queryId : (p.queryId || null)
    };
    if (old) { ['approvedBy', 'approvedAt', 'cdate', 'approvalRequestedAt', 'approvalRequestedBy'].forEach(k => { if (old[k]) b[k] = old[k]; }); }
    if (!old && b.status === 'Pending') { b.approvalRequestedAt = nowISO(); b.approvalRequestedBy = u.name; }
    const force = isStaff(u) && !!p.force && (isAdmin(u) || PM.can(u, 'bookings.override'));
    /* similar booking on the same passport / same travel dates */
    if (!force) {
      for (const x of px) {
        const d = db.bookings.find(o => o.status !== 'Cancelled' && (!old || o.id !== old.id) && o.pax.some(y => y.pp === x.pp) &&
          ((b.from && o.from) ? (o.from <= (b.to || b.from) && (o.to || o.from) >= b.from) : (o.category === b.category && o.created === b.created)));
        if (d) fail('Passport ' + x.pp + ' already has booking ' + d.no + ' (' + (d.from || 'no dates') + (d.to ? ' to ' + d.to : '') + ', ' + d.status + '). A similar booking cannot be created for the same travel dates.', { dup: true, dupNo: d.no });
      }
    }
    /* available balance / credit limit */
    const delta = L.bookingSell(b) - (old ? L.bookingSell(old) : 0);
    if (false && pty.kind === 'agent' && delta > 0) { // rule: agents may book even at zero balance; the balance simply goes negative and shows as "-" in the ledger / header
      const w = L.wallet(pid);
      if (w.available < delta && !force) fail('Available balance is PKR ' + Math.max(0, Math.round(w.available)).toLocaleString('en-US') + ' - this booking needs PKR ' + Math.round(delta).toLocaleString('en-US') + '. Add a payment or ask the office to raise the credit limit.', { limit: true });
    }
    if (old) { releaseSeats(old); b.groupRef = old.groupRef; }
    takeSeats(b, force, !!old);
    if (old) {
      b.history.push({ t: nowISO(), u: u.name, a: 'Edited: ' + diffSummary(old, b) });
      Object.assign(old, b);
    } else {
      b.history = [{ t: nowISO(), u: u.name, a: b.status === 'Pending' ? 'Submitted for approval' : 'Booking created' }];
      if (p.confirm && canApprove(u)) { b.status = 'Confirmed'; b.approvedBy = u.name; b.approvedAt = nowISO(); delete b.approvalRequestedAt; delete b.approvalRequestedBy; b.history.push({ t: nowISO(), u: u.name, a: 'Approved at creation' }); }
      db.bookings.push(b);
      if (b.queryId) { const q = db.queries.find(x => x.id === b.queryId); if (q) { q.status = 'Booked'; q.bookingId = b.id; } }
    }
    logAct(u, old ? 'Booking edited' : 'Booking created', b.no + ' - ' + pty.name + ' - PKR ' + L.bookingSell(b));
    return { id: b.id, no: b.no };
  },
  setStatus(u, p) {
    const b = getBooking(u, p.id), to = p.status;
    if (to === 'Confirmed') { need(canApprove(u), 'Only the administrator can approve bookings'); b.status = 'Confirmed'; b.approvedBy = u.name; b.approvedAt = nowISO(); delete b.approvalRequestedAt; delete b.approvalRequestedBy; delete b.cdate; }
    else if (to === 'Cancelled') {
      need(isStaff(u) || (u.role === 'agent' && b.status === 'Pending'), 'Not allowed');
      if (b.status !== 'Cancelled') { releaseSeats(b); b.cdate = today(); }
      b.status = 'Cancelled';
    } else if (to === 'Pending') {
      need(isStaff(u), 'Not allowed');
      if (b.status === 'Cancelled') takeSeats(b, true);
      b.status = 'Pending'; b.approvalRequestedAt = nowISO(); b.approvalRequestedBy = u.name; delete b.approvedBy; delete b.approvedAt; delete b.cdate;
    } else fail('Bad status');
    b.history.push({ t: nowISO(), u: u.name, a: to === 'Confirmed' ? 'Approved' : to === 'Cancelled' ? 'Cancelled' : 'Moved back to pending' });
    logAct(u, 'Booking ' + to.toLowerCase(), b.no);
  },
  svcConfirm(u, p) {
    need(isStaff(u) || u.role === 'supplier');
    const b = db.bookings.find(x => x.id === p.bid); if (!b) fail('Booking not found');
    const s = b.services.find(x => x.id === p.sid); if (!s) fail('Service not found');
    if (u.role === 'supplier') need(s.supId == u.pid, 'Not your service');
    s.conf = str(p.conf, 80); s.cs = s.conf ? 'Confirmed' : 'Requested';
    b.history.push({ t: nowISO(), u: u.name, a: 'Supplier confirmation ' + (s.conf || 'cleared') + ' for ' + s.title });
    logAct(u, 'Service confirmation', b.no + ' ' + s.conf);
  },
  delBooking(u, p) {
    need(isStaff(u)); const b = db.bookings.find(x => x.id === p.id); if (!b) fail('Booking not found');
    releaseSeats(b); db.bookings = db.bookings.filter(x => x !== b); db.vouchers = db.vouchers.filter(v => v.bookingId !== b.id);
    logAct(u, 'Booking deleted', b.no);
  },

  /* ================= CUSTOM QUOTATIONS ================= */
  saveQuotation(u, p) {
    need(isStaff(u), 'Only the internal team can create quotations');
    const old = p.id ? db.quotations.find(x => x.id === String(p.id)) : null;
    if (p.id && !old) fail('Quotation not found');
    if (old && (old.status === 'Converted' || old.bookingId)) fail('This quotation has already been converted. Edit the resulting booking instead.');
    const customer = p.customer || {}, currency = ['PKR', 'SAR', 'USD', 'AED', 'GBP', 'EUR'].includes(String(p.currency || '').toUpperCase()) ? String(p.currency).toUpperCase() : 'PKR';
    const customerName = str(customer.name, 100);
    if (!customerName) fail('Enter the customer name before saving this quotation');
    if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(str(customer.email, 120))) fail('Enter a valid customer email address');
    const validCategories = ['hotel', 'flight', 'visa', 'transport', 'package', 'other'];
    const legacyTravel = p.travelDetails && typeof p.travelDetails === 'object' ? p.travelDetails : {};
    const dateStamp = value => {
      const date = isoDate(value), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
      if (!m) return NaN;
      const stamp = Date.UTC(+m[1], +m[2] - 1, +m[3]);
      return new Date(stamp).toISOString().slice(0, 10) === date ? stamp : NaN;
    };
    const items = (Array.isArray(p.items) ? p.items : []).slice(0, 30).map((x, i) => {
      const category = validCategories.includes(x.category) ? x.category : 'other';
      const priceRaw = Number(x.unitPrice), title = str(x.title, 160);
      if (!title) return null;
      const details = cleanObj(x.details || {});
      let qtyRaw = Number(x.qty), unit = str(x.unit, 30) || 'service';
      if (category === 'hotel') {
        // Hotel pricing is always calculated from the actual stay, not an editable free-form quantity.
        const checkIn = isoDate(details.checkIn || details.cin || legacyTravel.checkIn);
        const checkOut = isoDate(details.checkOut || details.cout || legacyTravel.checkOut);
        const start = dateStamp(checkIn), end = dateStamp(checkOut);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) fail('Hotel line "' + title + '" needs a valid check-in and a check-out after check-in.');
        const rooms = Math.max(1, Math.min(100, Math.round(Number(details.rooms || legacyTravel.rooms || 1)) || 1));
        const nights = Math.round((end - start) / 86400000);
        details.checkIn = checkIn; details.checkOut = checkOut; details.rooms = rooms; details.nights = nights;
        details.city = str(details.city || legacyTravel.city, 80);
        details.roomType = str(details.roomType || details.room || legacyTravel.room, 80);
        details.mealPlan = str(details.mealPlan || details.meal || legacyTravel.meal, 80);
        qtyRaw = nights * rooms; unit = 'room-nights';
      }
      const qty = Number.isFinite(qtyRaw) ? Math.max(0.01, Math.min(100000, Math.round(qtyRaw * 100) / 100)) : 1;
      const unitPrice = Number.isFinite(priceRaw) ? Math.max(0, Math.min(1e12, Math.round(priceRaw * 100) / 100)) : 0;
      return { id: old && old.items[i] && old.items[i].id ? old.items[i].id : 'qi' + nid(), category, title, description: str(x.description, 1200), qty, unit, unitPrice, total: Math.round(qty * unitPrice * 100) / 100, details };
    }).filter(Boolean);
    if (!items.length) fail('Add at least one priced or described service line');
    const subtotal = Math.round(items.reduce((a, x) => a + x.total, 0) * 100) / 100;
    const discount = Math.min(subtotal, Math.max(0, Math.round((Number(p.discount) || 0) * 100) / 100));
    const taxPct = Math.max(0, Math.min(100, Math.round((Number(p.taxPct) || 0) * 100) / 100));
    const tax = Math.round((subtotal - discount) * taxPct) / 100;
    const total = Math.round((subtotal - discount + tax) * 100) / 100;
    const partyId = p.partyId ? (+p.partyId || null) : null;
    if (partyId && !db.parties.some(x => x.id === partyId && x.kind !== 'supplier')) fail('Select a valid agent or customer account');
    const travellers = (Array.isArray(p.travellers) ? p.travellers : []).slice(0, 60).map(x => ({ name: str(x.name, 100), type: ['Adult', 'Child', 'Infant'].includes(x.type) ? x.type : 'Adult', passport: str(x.passport, 24).toUpperCase().replace(/\s+/g, ''), dob: isoDate(x.dob), nationality: str(x.nationality, 40), gender: x.gender === 'F' ? 'F' : 'M', visaNo: str(x.visaNo, 40), pnr: str(x.pnr, 24), beds: x.beds !== false })).filter(x => x.name || x.passport || x.dob || x.visaNo || x.pnr);
    const now = nowISO();
    const status = ['Draft', 'Sent', 'Accepted', 'Declined', 'Expired'].includes(p.status) ? p.status : (old ? old.status : 'Draft');
    const included = (Array.isArray(p.included) ? p.included : []).slice(0, 40).map(x => str(x, 180)).filter(Boolean);
    const excluded = (Array.isArray(p.excluded) ? p.excluded : []).slice(0, 40).map(x => str(x, 180)).filter(Boolean);
    const customFields = (Array.isArray(p.customFields) ? p.customFields : []).slice(0, 30).map(x => ({ label: str(x.label, 80), value: str(x.value, 300) })).filter(x => x.label || x.value);
    const record = {
      ...(old || {}), id: old ? old.id : 'qt' + nid(), no: old ? old.no : 'TUS-Q-' + today().replace(/-/g, '') + '-' + String(nid()).padStart(5, '0'),
      partyId, customer: { name: customerName, phone: str(customer.phone, 40), email: str(customer.email, 120), address: str(customer.address, 300), company: str(customer.company, 120) },
      travellers, paxCount: Math.max(travellers.length, Math.min(1000, Math.round(+p.paxCount || 0))), currency,
      quoteDate: isoDate(p.quoteDate) || today(), validUntil: isoDate(p.validUntil), reference: str(p.reference, 100), destination: str(p.destination, 120),
      items, subtotal, discount, taxPct, tax, total, travelDetails: cleanObj(p.travelDetails || {}), included, excluded, customFields, terms: str(p.terms, 2500), notes: str(p.notes, 1200), status,
      createdAt: old ? old.createdAt : now, createdBy: old ? old.createdBy : u.name, updatedAt: now, updatedBy: u.name
    };
    if (record.validUntil && record.validUntil < record.quoteDate) fail('Quotation validity date cannot be before the quotation date');
    if (old) { const before = old.total; Object.assign(old, record); logAct(u, 'Quotation updated', old.no + ' · ' + before + ' → ' + total + ' ' + currency); PM.audit(u, 'quotation.updated', old.no, { total, currency, status }); }
    else { db.quotations.push(record); logAct(u, 'Quotation created', record.no + ' · ' + customerName + ' · ' + total + ' ' + currency); PM.audit(u, 'quotation.created', record.no, { total, currency, status }); }
    return { id: record.id, no: record.no, total: record.total, currency: record.currency, status: record.status };
  },
  convertQuotationToBooking(u, p) {
    need(isStaff(u), 'Only the internal team can convert quotations');
    need(PM.can(u, 'quotations.view'), 'You need quotation access to convert this record');
    need(PM.can(u, 'bookings.create'), 'You need booking creation permission to convert a quotation');
    const q = db.quotations.find(x => x.id === String(p.id)); if (!q) fail('Quotation not found');
    if (q.bookingId) {
      const existing = db.bookings.find(b => b.id === q.bookingId);
      if (existing) return { id: existing.id, no: existing.no, alreadyConverted: true };
      fail('This quotation has a conversion record but its linked booking is missing. Contact an administrator; no duplicate was created.');
    }
    if (['Declined', 'Expired'].includes(q.status)) fail('A declined or expired quotation cannot be converted. Update its status before converting.');
    if (!['PKR', 'SAR'].includes(q.currency)) fail('Bookings currently support PKR and SAR. Change this quotation to PKR or SAR and review its prices before conversion.');
    const travellers = Array.isArray(q.travellers) ? q.travellers : [];
    if (!travellers.length || travellers.some(x => !str(x.name, 100) || !str(x.passport, 24))) fail('Complete every traveller name and passport number in the quotation before converting it.');
    if (q.paxCount > travellers.length) fail('The quotation has ' + q.paxCount + ' travellers but only ' + travellers.length + ' traveller details. Add all travellers before converting.');
    const passportSet = new Set();
    for (const t of travellers) { const pp = str(t.passport, 24).toUpperCase().replace(/\s+/g, ''); if (passportSet.has(pp)) fail('Passport ' + pp + ' is repeated in this quotation. Correct it before converting.'); passportSet.add(pp); }
    if (!Array.isArray(q.items) || !q.items.length) fail('Add at least one quotation service before converting.');
    let pty = q.partyId ? party(q.partyId) : null;
    if (pty && pty.kind === 'supplier') pty = null;
    if (pty && pty.active === false) fail('The linked account is inactive. Reactivate or choose another account before converting.');
    if (!pty) {
      const email = str(q.customer && q.customer.email, 120).toLowerCase();
      const phone = str(q.customer && q.customer.phone, 40).replace(/[^\d+]/g, '');
      const matches = db.parties.filter(x => x.kind !== 'supplier' && x.active !== false && ((email && String(x.email || '').trim().toLowerCase() === email) || (phone && String(x.phone || '').replace(/[^\d+]/g, '') === phone)));
      const ids = [...new Set(matches.map(x => String(x.id)))];
      if (ids.length > 1) fail('More than one account matches this customer contact. Link the correct customer account to the quotation before converting.');
      if (matches.length) pty = matches[0];
    }
    let createdParty = null;
    if (!pty) {
      need(PM.can(u, 'customers.create'), 'Link an existing account or ask an administrator for customer creation permission before converting.');
      createdParty = { id: nid(), kind: 'customer', name: str(q.customer.name, 100), phone: str(q.customer.phone, 40), email: str(q.customer.email, 100), city: '', address: str(q.customer.address, 200), notes: 'Created from quotation ' + q.no, limit: 0, opening: 0, active: true, created: today() };
      db.parties.push(createdParty); pty = createdParty;
    }
    const gross = Math.max(0, Math.round((+q.total || 0) * 100));
    const basis = q.items.map(x => Math.max(0, Math.round((+x.total || 0) * 100)));
    const basisTotal = basis.reduce((a, x) => a + x, 0);
    let allocated = 0;
    const services = q.items.map((x, i) => {
      const cents = i === q.items.length - 1 ? gross - allocated : (basisTotal ? Math.round(gross * basis[i] / basisTotal) : Math.floor(gross / q.items.length));
      allocated += cents;
      const d = cleanObj(x.details || {}), td = q.travelDetails || {};
      if (x.category === 'hotel') Object.assign(d, { hotel: d.hotel || td.hotel || x.title, city: d.city || td.city || q.destination, cin: d.cin || d.checkIn || td.checkIn || '', cout: d.cout || d.checkOut || td.checkOut || '', room: d.room || d.roomType || td.room || '', meal: d.meal || d.mealPlan || td.meal || '', stars: d.stars || td.stars || '' });
      if (x.category === 'flight') Object.assign(d, { airline: d.airline || td.airline || '', fno: d.fno || td.flightNo || '', from: d.from || td.from || '', to: d.to || td.to || '', date: d.date || td.departureDate || '', dep: d.dep || td.departureTime || '', rdate: d.rdate || td.returnDate || '', rfno: d.rfno || td.returnFlightNo || '', cls: d.cls || td.cabin || '' });
      if (x.category === 'visa') Object.assign(d, { visaType: d.visaType || td.visaType || x.title, nationality: d.nationality || td.nationality || '', entry: d.entry || td.entry || '', validity: d.validity || td.validity || '', stayDays: d.stayDays || td.stayDays || '' });
      if (x.category === 'transport') Object.assign(d, { route: d.route || ((td.pickup || '') + (td.dropoff ? ' → ' + td.dropoff : '')) || x.title, pickup: d.pickup || td.pickup || '', dropoff: d.dropoff || td.dropoff || '', date: d.date || td.travelDate || '', time: d.time || td.pickupTime || '', vehicle: d.vehicle || td.vehicle || '' });
      if (x.category === 'package') Object.assign(d, { packageName: d.packageName || td.packageName || x.title, itinerary: d.itinerary || td.itinerary || '', duration: d.duration || td.duration || '' });
      d.quoteNo = q.no; d.quoteTitle = str(x.title, 160); d.quoteDescription = str(x.description, 1200); d.quoteQty = +x.qty || 1; d.quoteUnit = str(x.unit, 30) || 'service'; d.quoteUnitPrice = +x.unitPrice || 0; d.quoteLineTotal = +x.total || 0;
      d.quoteCurrency = q.currency; d.quoteDiscount = +q.discount || 0; d.quoteTax = +q.tax || 0;
      return { type: ['visa', 'hotel', 'transport', 'flight', 'package', 'other'].includes(x.category) ? x.category : 'other', title: str(x.title, 160) || 'Quoted service', qty: 1, sellAmount: cents / 100, sellCurrency: q.currency, from: x.details && (x.details.fromDate || x.details.checkIn || x.details.departureDate) || td.checkIn || td.departureDate || td.travelDate || td.startDate || '', to: x.details && (x.details.toDate || x.details.checkOut || x.details.returnDate) || td.checkOut || td.returnDate || td.endDate || '', d };
    });
    const pax = travellers.map(x => ({ n: str(x.name, 80), pp: str(x.passport, 24).toUpperCase().replace(/\s+/g, ''), dob: x.dob || '', nat: str(x.nationality, 40), g: x.gender === 'F' ? 'F' : 'M', t: ['Adult', 'Child', 'Infant'].includes(x.type) ? x.type : 'Adult', beds: x.beds !== false, visaNo: str(x.visaNo, 40), pnr: str(x.pnr, 24) }));
    const td = q.travelDetails || {};
    const travelNote = Object.entries(td).filter(([, v]) => v !== '' && v != null && typeof v !== 'object').map(([k, v]) => k.replace(/([A-Z])/g, ' $1') + ': ' + v).join(' · ');
    const noteParts = ['Converted from quotation ' + q.no, q.notes || '', travelNote, (q.included || []).length ? 'Included: ' + q.included.join('; ') : '', (q.excluded || []).length ? 'Excluded: ' + q.excluded.join('; ') : '', q.terms ? 'Terms: ' + q.terms : ''].filter(Boolean);
    try {
      const result = OPS.saveBooking(u, { partyId: pty.id, category: 'Custom quotation', pax, services, notes: noteParts.join(' | ').slice(0, 800), confirm: false });
      const booking = db.bookings.find(x => x.id === result.id);
      if (booking) { booking.sourceQuotationId = q.id; booking.sourceQuotationNo = q.no; booking.history.push({ t: nowISO(), u: u.name, a: 'Created from quotation ' + q.no }); }
      q.partyId = pty.id; q.bookingId = result.id; q.bookingNo = result.no; q.convertedAt = nowISO(); q.convertedBy = u.name; q.status = 'Converted';
      logAct(u, 'Quotation converted to booking', q.no + ' → ' + result.no); PM.audit(u, 'quotation.converted', q.no, { bookingId: result.id, bookingNo: result.no, total: q.total, currency: q.currency });
      return { id: result.id, no: result.no, bookingId: result.id, bookingNo: result.no, alreadyConverted: false };
    } catch (e) {
      if (createdParty) db.parties = db.parties.filter(x => x !== createdParty);
      throw e;
    }
  },
  delQuotation(u, p) {
    need(isStaff(u), 'Only the internal team can delete quotations');
    const q = db.quotations.find(x => x.id === String(p.id)); if (!q) fail('Quotation not found');
    if (q.bookingId || q.status === 'Converted') fail('This quotation is linked to a booking and cannot be deleted.');
    db.quotations = db.quotations.filter(x => x !== q); logAct(u, 'Quotation deleted', q.no + ' · ' + q.customer.name); PM.audit(u, 'quotation.deleted', q.no, {}); return {};
  },

  /* ================= VOUCHERS ================= */
  makeVoucher(u, p) {
    const b = getBooking(u, p.bid), kind = ['all', 'hotel', 'transport', 'flight', 'visa', 'package', 'other', 'custom'].includes(p.kind) ? p.kind : 'all';
    const sid = kind !== 'all' && kind !== 'custom' ? str(p.sid, 30) : '';
    if (sid) need(b.services.some(s => s.id === sid), 'Service not found');
    if (kind !== 'custom') {
      const ex = db.vouchers.find(v => v.bookingId === b.id && v.kind === kind && (v.sid || '') === sid);
      if (ex) return { token: ex.token, no: ex.no };
    }
    const v = { id: 'v' + nid(), no: 'VC-' + token(4).replace(/[^A-Za-z0-9]/g, 'x').toUpperCase().slice(0, 6), token: token(14), bookingId: b.id, kind, sid, createdBy: u.name, createdAt: nowISO() };
    if (kind === 'custom') v.custom = { title: str(p.title, 100) || 'Voucher', rows: (p.rows || []).slice(0, 30).map(r => ({ k: str(r.k, 60), v: str(r.v, 300) })).filter(r => r.k || r.v), notes: str(p.notes, 800) };
    db.vouchers.push(v); logAct(u, 'Voucher issued', v.no + ' ' + b.no + ' ' + kind);
    return { token: v.token, no: v.no };
  },
  delVoucher(u, p) { need(isStaff(u)); db.vouchers = db.vouchers.filter(v => v.id !== p.id); logAct(u, 'Voucher deleted', p.id); },

  /* ================= PAYMENTS ================= */
  addPayment(u, p) {
    need(u.role !== 'supplier', 'Not allowed');
    const PS = db.settings.payments, agent = u.role === 'agent', sys = u.id === 'system';
    if (agent && !sys && !PS.agentCanRecord) fail('Recording payments is switched off. Please contact the office.');
    const hasNativeAmount = p.currencyAmount !== undefined && p.currencyAmount !== null && p.currencyAmount !== '';
    const payCurrency = hasNativeAmount && p.currency === 'SAR' ? 'SAR' : 'PKR';
    const payNativeRaw = hasNativeAmount ? +p.currencyAmount : +p.amt;
    const payNative = Number.isFinite(payNativeRaw) ? Math.max(0, payNativeRaw) : 0;
    const payFx = payCurrency === 'SAR' ? (+((db.settings.calc || {}).pkrPerSar) || 0) : 1;
    if (payCurrency === 'SAR' && payNative > 0 && !(payFx > 0)) fail('The office SAR → PKR exchange rate is not set. Ask the administrator to update Rates & inventory.');
    const amt = hasNativeAmount ? Math.round(payNative * payFx) : Math.round(payNative);
    if (!(amt > 0)) fail('Enter a valid payment amount');
    if (agent && amt < PS.minAmount) fail('The minimum payment is PKR ' + PS.minAmount.toLocaleString('en-US') + ' (accounting base)');
    const pid = agent ? u.pid : +p.partyId, pty = party(pid); if (!pty) fail('Select who this payment is for');
    const bk = p.bookingId ? db.bookings.find(x => x.id === p.bookingId && x.partyId == pid) : null;
    const bank = p.bankId ? (db.settings.bank || []).find(b => b.id === p.bankId) : null;
    if (agent && PS.requireReceipt && !(p.file && p.file.data)) fail('Please attach your payment receipt');
    if (agent && PS.requireRef && !str(p.ref, 80)) fail('Please enter the transaction / reference number');
    const id = 'PY-' + nid();
    const method = str(p.method, 40) || (bank ? (bank.kind === 'wallet' ? 'JazzCash / Easypaisa' : bank.kind === 'raast' ? 'Online banking / Raast' : 'Bank transfer') : 'Cash');
    const auto = isAdmin(u) || (u.role === 'staff' && PM.can(u, 'payments.approve')) || (agent && !sys && PS.autoApproveUnder > 0 && amt <= PS.autoApproveUnder && !!(p.file && p.file.data));
    const r = { id, dir: pty.kind === 'supplier' ? 'out' : 'in', partyId: pid, amt, currency: payCurrency, currencyAmount: hasNativeAmount ? Math.round(payNative * 100) / 100 : amt, currencyFxRate: payFx, method, ref: str(p.ref, 80), date: isoDate(p.date) || today(), rc: '', status: auto ? 'Approved' : 'Pending', by: u.name, note: str(p.note, 300), bookingId: bk ? bk.id : '', bankId: bank ? bank.id : '', bankName: bank ? (bank.bank || bank.title) : '', via: 'manual', created: nowISO() };
    if (p.file && p.file.data) {
      const ext = (String(p.file.name).match(/\.[a-z0-9]{1,5}$/i) || ['.bin'])[0].toLowerCase();
      if (!MODES.receipt.includes(ext)) fail('Receipt must be an image or PDF');
      const buf = Buffer.from(String(p.file.data).split(',').pop(), 'base64');
      if (buf.length > 6e6) fail('Receipt too large (max 6 MB)');
      const sig = (n, ...b) => b.every((x, i) => buf[n + i] === x), tx = buf.toString('latin1', 4, 12);
      const okSig = { '.jpg': sig(0, 0xFF, 0xD8), '.jpeg': sig(0, 0xFF, 0xD8), '.png': sig(0, 0x89, 0x50, 0x4E, 0x47), '.gif': sig(0, 0x47, 0x49, 0x46), '.pdf': sig(0, 0x25, 0x50, 0x44, 0x46), '.webp': sig(0, 0x52, 0x49, 0x46, 0x46) && buf.toString('latin1', 8, 12) === 'WEBP', '.heic': /^ftyp/.test(tx) }[ext];
      if (!okSig) fail('Receipt file is not a valid image or PDF');
      fs.writeFileSync(path.join(DATA, 'receipts', id + ext), buf); F.put('receipts/' + id + ext, buf); r.rc = str(p.file.name, 100); r.rcd = '/receipts/' + id + ext;
    }
    db.payments.push(r); logAct(u, 'Payment recorded', id + ' ' + r.currency + ' ' + r.currencyAmount + ' (PKR base ' + amt + ', ' + r.status + ')');
    return { id, status: r.status };
  },
  updatePayment(u, p) {
    need(isStaff(u), 'Not allowed');
    const x = db.payments.find(y => y.id === p.id); if (!x) fail('Payment not found');
    if (x.via !== 'manual' || x.linkId || x.travelportOrderId || x.by === 'system' || /via payment link/i.test(String(x.note || ''))) fail('Only manually recorded office payments can be edited. Online, payment-link and imported transactions are locked for audit safety.');
    const currency = p.currency === 'SAR' ? 'SAR' : 'PKR';
    const native = Number(p.amount);
    if (!Number.isFinite(native) || !(native > 0) || native > 100000000) fail('Enter a valid payment amount');
    const partyRecord = party(x.partyId); if (!partyRecord) fail('The linked account no longer exists');
    const booking = p.bookingId ? db.bookings.find(b => b.id === p.bookingId && b.partyId == x.partyId) : null;
    if (p.bookingId && !booking) fail('Select a booking belonging to this account');
    let fx = 1, amt = Math.round(native);
    if (currency === 'SAR') {
      fx = x.currency === 'SAR' && +x.currencyFxRate > 0 ? +x.currencyFxRate : +((db.settings.calc || {}).pkrPerSar || 0);
      if (!(fx > 0)) fail('The office SAR → PKR exchange rate is not set. Update Rates & inventory before editing this payment.');
      amt = Math.round(native * fx);
    }
    const before = { amt: x.amt, currency: x.currency || 'PKR', currencyAmount: x.currencyAmount, currencyFxRate: x.currencyFxRate, date: x.date, method: x.method, ref: x.ref, note: x.note, bookingId: x.bookingId };
    x.edits = Array.isArray(x.edits) ? x.edits : []; x.edits.push({ at: nowISO(), by: u.name, before }); if (x.edits.length > 25) x.edits.shift();
    x.amt = amt; x.currency = currency; x.currencyAmount = Math.round(native * 100) / 100; x.currencyFxRate = fx;
    x.date = isoDate(p.date) || x.date; x.method = str(p.method, 40) || x.method; x.ref = str(p.ref, 80); x.note = str(p.note, 300); x.bookingId = booking ? booking.id : '';
    x.updatedAt = nowISO(); x.updatedBy = u.name;
    logAct(u, 'Manual payment edited', x.id + ' · ' + currency + ' ' + x.currencyAmount + ' (PKR base ' + amt + ')');
    return { id: x.id, amount: amt, currency };
  },
  approvePayment(u, p) {
    need(isStaff(u)); const x = db.payments.find(y => y.id === p.id); if (!x) fail('Not found'); x.status = 'Approved';
    if (x.linkId) { const l = db.paylinks.find(k => k.id === x.linkId); if (l) { l.status = 'Paid'; l.paymentId = x.id; } }
    if (x.travelportOrderId) { const o = (db.travelportOrders || []).find(k => k.id === x.travelportOrderId); if (o) { o.paymentStatus = 'Approved'; o.status = 'Payment Received - Ticketing Required'; o.paidAt = o.paidAt || nowISO(); o.paymentId = x.id; } }
    logAct(u, 'Payment approved', x.id);
  },
  rejectPayment(u, p) { need(isStaff(u)); const x = db.payments.find(y => y.id === p.id); if (!x) fail('Not found'); x.status = 'Rejected'; x.note = (x.note ? x.note + ' | ' : '') + str(p.reason, 120); logAct(u, 'Payment rejected', x.id); },
  delPayment(u, p) { need(isStaff(u)); db.payments = db.payments.filter(y => y.id !== p.id); logAct(u, 'Payment deleted', p.id); },
  createPaylink(u, p) {
    need(isStaff(u)); const pty = party(+p.partyId); if (!pty || pty.kind === 'supplier') fail('Select an agent or customer');
    const amt = Math.round(+p.amt); if (!(amt > 0)) fail('Enter a valid amount');
    const bk = p.bookingId ? db.bookings.find(x => x.id === p.bookingId) : null;
    const l = { id: 'PL-' + nid(), token: token(14), partyId: pty.id, amt, purpose: str(p.purpose, 160) || (bk ? 'Booking ' + bk.no : 'Payment'), bookingId: bk ? bk.id : '', status: 'Open', createdBy: u.name, createdAt: nowISO(), expiresAt: new Date(Date.now() + 864e5 * (num(p.days) || 7)).toISOString() };
    db.paylinks.push(l); logAct(u, 'Payment link created', l.id + ' PKR ' + amt); return { id: l.id, token: l.token };
  },
  cancelPaylink(u, p) { need(isStaff(u)); const l = db.paylinks.find(x => x.id === p.id); if (!l) fail('Not found'); if (l.status === 'Open') l.status = 'Cancelled'; },

  /* ================= JOURNAL / EXPENSES ================= */
  addEntry(u, p) {
    need(isStaff(u), 'Not allowed');
    const pty = party(+p.partyId); if (!pty) fail('Select an account');
    const dr = num(p.dr), cr = num(p.cr); if (!dr && !cr) fail('Enter a debit or a credit amount'); if (dr && cr) fail('Enter either a debit or a credit, not both');
    const id = 'JV-' + nid(); db.entries.push({ id, partyId: pty.id, date: isoDate(p.date) || today(), t: str(p.t, 200) || 'Journal entry', dr, cr, by: u.name });
    logAct(u, 'Journal entry', id + ' ' + pty.name + ' Dr ' + dr + ' Cr ' + cr); return { id };
  },
  delEntry(u, p) { need(isStaff(u)); db.entries = db.entries.filter(e => e.id !== p.id); logAct(u, 'Journal entry deleted', p.id); },
  addExpense(u, p) {
    need(isStaff(u)); const amt = num(p.amt); if (!amt) fail('Enter the expense amount');
    const e = { id: 'EX-' + nid(), date: isoDate(p.date) || today(), cat: str(p.cat, 60) || 'Other', amt, note: str(p.note, 300), by: u.name };
    db.expenses.push(e); logAct(u, 'Expense added', e.id + ' ' + e.cat + ' PKR ' + amt); return { id: e.id };
  },
  delExpense(u, p) { need(isStaff(u)); const n = db.expenses.length; db.expenses = db.expenses.filter(e => e.id !== p.id); if (n === db.expenses.length) fail('Expense not found'); logAct(u, 'Expense deleted', p.id); },

  /* ================= PARTIES & USERS ================= */
  saveParty(u, p) {
    const kind = ['agent', 'supplier', 'customer'].includes(p.kind) ? p.kind : 'agent';
    need(isStaff(u), 'Not allowed');
    const name = str(p.name, 100); if (!name) fail('Name is required');
    const dupe = db.parties.find(x => x.kind === kind && x.name.toLowerCase() === name.toLowerCase() && x.id != p.id); if (dupe) fail('An account with this name already exists');
    const x = p.id ? party(p.id) : null; if (p.id && !x) fail('Account not found');
    const d = { name, phone: str(p.phone, 40), email: str(p.email, 100), city: str(p.city, 60), address: str(p.address, 200), notes: str(p.notes, 300) };
    const t = x || { id: nid(), kind, limit: 0, opening: 0, active: true, created: today() };
    Object.assign(t, d);
    if (kind === 'agent' && (isAdmin(u) || PM.can(u, 'agents.edit'))) t.limit = num(p.limit);
    if (p.opening !== undefined && p.opening !== '' && isAdmin(u)) t.opening = Math.round(+p.opening) || 0;
    if (p.active !== undefined) t.active = !!p.active;
    if (!x) db.parties.push(t);
    const login = str(p.login, 40).toLowerCase(), pw = String(p.password || '');
    if ((kind === 'agent' || kind === 'supplier') && (isAdmin(u) || PM.can(u, kind + 's.edit')) && (login || pw)) {
      const lu = db.users.find(y => y.pid == t.id);
      if (pw) need(pw.length >= MINPW(), 'Password must be at least ' + MINPW() + ' characters');
      if (lu) { if (pw) lu.pw = hash(pw); lu.name = t.name; lu.active = t.active; }
      else if (login) {
        need(pw.length >= MINPW(), 'Password must be at least ' + MINPW() + ' characters'); need(!db.users.find(y => y.login === login), 'This login name is already taken');
        db.users.push({ id: 'u' + t.id, role: kind, pid: t.id, name: t.name, login, pw: hash(pw), active: true });
      }
    }
    logAct(u, x ? 'Account updated' : 'Account added', kind + ' ' + name); return { id: t.id };
  },
  delParty(u, p) {
    need(isStaff(u)); const x = party(p.id); if (!x) fail('Account not found');
    const used = db.bookings.some(b => b.partyId == x.id || b.services.some(s => s.supId == x.id)) || db.payments.some(y => y.partyId == x.id) || db.entries.some(e => e.partyId == x.id) || db.paylinks.some(l => l.partyId == x.id);
    if (used) fail('This account has transactions and cannot be deleted - its ledger must be preserved. You can deactivate it instead.');
    db.parties = db.parties.filter(y => y !== x); db.users = db.users.filter(y => y.pid != x.id); logAct(u, 'Account deleted', x.kind + ' ' + x.name);
  },
  saveUser(u, p) {
    need(isAdmin(u)); const login = str(p.login, 40).toLowerCase(), pw = String(p.password || '');
    need(login && pw.length >= MINPW(), 'Username and a password of at least ' + MINPW() + ' characters are required');
    const x = db.users.find(y => y.login === login);
    if (x) { x.pw = hash(pw); x.mustChange = false; logAct(u, 'Password reset', login); }
    else { db.users.push({ id: 's' + nid(), role: 'staff', name: str(p.name, 80) || login, login, pw: hash(pw), roleIds: [], grants: [], denies: [], created: new Date().toISOString() }); logAct(u, 'Staff user created', login); }
  },
  delUser(u, p) { need(isAdmin(u)); const x = db.users.find(y => y.id === p.id); need(x && x.role === 'staff', 'Only staff users can be removed here'); db.users = db.users.filter(y => y !== x); logAct(u, 'Staff user removed', x.login); },
  changePassword(u, p) {
    need(check(String(p.old || ''), u.pw), 'Current password is incorrect'); need(String(p.pw || '').length >= MINPW(), 'New password must be at least ' + MINPW() + ' characters');
    u.pw = hash(String(p.pw)); u.mustChange = false; logAct(u, 'Password changed', '');
  },

  /* ================= QUERIES ================= */
  addQuery(u, p) {
    need(u.role !== 'supplier'); const type = QTYPES.includes(p.type) ? p.type : 'other', text = str(p.text, 1200);
    if (!text && !p.details) fail('Describe what you need');
    const pid = u.role === 'agent' ? u.pid : (+p.partyId || null), hrs = db.settings.sla[type] || 24;
    const q = { id: 'q' + nid(), no: 'Q-' + token(3).replace(/[^A-Za-z0-9]/g, 'x').toUpperCase().slice(0, 5), type, source: str(p.source, 20) || (u.role === 'agent' ? 'agent' : 'staff'), partyId: pid,
      contact: { name: str(p.contactName, 80), phone: str(p.contactPhone, 40) }, text, details: cleanObj(p.details), status: 'Open', createdAt: nowISO(), dueAt: new Date(Date.now() + hrs * 36e5).toISOString(), by: u.name, log: [] };
    db.queries.push(q); logAct(u, 'Query created', q.no + ' ' + type); return { id: q.id, no: q.no };
  },
  respondQuery(u, p) {
    need(isStaff(u)); const q = db.queries.find(x => x.id === p.id); if (!q) fail('Query not found');
    need(['Open', 'Quoted', 'Expired'].includes(q.status), 'This query is already closed');
    const hasNative = p.currencyAmount !== undefined && p.currencyAmount !== null && p.currencyAmount !== '';
    const currency = hasNative && p.currency === 'SAR' ? 'SAR' : 'PKR';
    const nativeRaw = hasNative ? +p.currencyAmount : +p.amt;
    const nativeAmount = Number.isFinite(nativeRaw) ? Math.max(0, Math.round(nativeRaw * 100) / 100) : 0;
    const fx = currency === 'SAR' ? (+((db.settings.calc || {}).pkrPerSar) || 0) : 1;
    if (currency === 'SAR' && nativeAmount > 0 && !(fx > 0)) fail('Set the office SAR → PKR exchange rate before sending a SAR quote.');
    const baseAmount = hasNative ? Math.round(nativeAmount * fx) : num(p.amt);
    q.status = 'Quoted'; q.respondedAt = nowISO(); q.resp = { amt: baseAmount, currency, currencyAmount: hasNative ? nativeAmount : baseAmount, currencyFxRate: hasNative ? fx : 1, text: str(p.text, 1000), by: u.name, at: nowISO() };
    logAct(u, 'Query answered', q.no + ' ' + currency + ' ' + q.resp.currencyAmount + ' (PKR base ' + baseAmount + ')'); return {};
  },
  rejectQuery(u, p) { need(isStaff(u)); const q = db.queries.find(x => x.id === p.id); if (!q) fail('Query not found'); q.status = 'Rejected'; q.resp = { amt: 0, text: str(p.text, 400), by: u.name, at: nowISO() }; logAct(u, 'Query rejected', q.no); },
  acceptQuery(u, p) {
    const q = db.queries.find(x => x.id === p.id); if (!q) fail('Query not found');
    if (u.role === 'agent') need(q.partyId == u.pid); else need(isStaff(u));
    need(q.status === 'Quoted', 'There is no quote to accept'); q.status = 'Accepted'; q.acceptedAt = nowISO(); logAct(u, 'Quote accepted', q.no);
  },
  cancelQuery(u, p) {
    const q = db.queries.find(x => x.id === p.id); if (!q) fail('Query not found');
    if (u.role === 'agent') need(q.partyId == u.pid); else need(isStaff(u));
    if (['Open', 'Quoted'].includes(q.status)) q.status = 'Cancelled';
  },
  delQuery(u, p) { need(isStaff(u)); const n = db.queries.length; db.queries = db.queries.filter(q => q.id !== p.id && q.no !== p.id); if (n === db.queries.length) fail('Query not found'); logAct(u, 'Query deleted', p.id); },

  /* ================= GROUP PACKAGES ================= */
  /* Every write goes through lib/groups.js (strict validation). Permissions are enforced in lib/perms.js: create / edit / delete. */
  saveGroup(u, p) {
    need(isStaff(u));
    const raw = p.group && typeof p.group === 'object' ? p.group : p, prev = Gr.find(raw.id);
    const g = Gr.normGroup(raw, prev, { newId: () => 'UG-M' + nid(), allowPast: !!prev && prev.dep < today() });
    if (prev && g.seats !== prev.seats) logAct(u, 'Seats updated', g.id + ' = ' + g.seats);
    Gr.upsert(g); logAct(u, prev ? 'Group updated' : 'Group created', g.id + ' · ' + g.airline + ' · ' + g.dep);
    return { id: g.id, created: !prev };
  },
  saveGroups(u, p) {
    need(isStaff(u)); let n = 0; const skipped = [];
    (p.groups || []).forEach(raw => {
      try { const g = Gr.normGroup(raw, null, {}); const ex = Gr.find(g.id); if (ex && ex.meezab) g.seats = ex.seats; /* a re-import never overwrites seats the supplier sync has confirmed */ Gr.upsert(g); n++; } catch (e) { skipped.push((raw && raw.id ? raw.id + ': ' : '') + e.message); }
    });
    logAct(u, 'Groups imported', n + ' group(s)' + (skipped.length ? ', ' + skipped.length + ' skipped' : '')); return { count: n, skipped };
  },
  setSeats(u, p) { need(isStaff(u)); const g = Gr.find(p.id); if (!g) fail('Group not found'); g.seats = Math.min(999, num(p.seats)); logAct(u, 'Seats updated', g.id + ' = ' + g.seats); },
  delGroup(u, p) {
    need(isStaff(u)); const g = Gr.find(p.id); if (!g) fail('Group not found');
    const live = db.bookings.filter(b => b.status !== 'Cancelled' && b.groupRef && b.groupRef.gid === g.id).length;
    if (live && !p.force) fail(live + ' active booking(s) use this group. Cancel them first, or remove anyway to keep the bookings and drop the group.', { needForce: true });
    db.groups = db.groups.filter(x => x !== g); logAct(u, 'Group removed', g.id);
  },

  savePromo(u, p) { need(isStaff(u)); const o = Promos.save(p); logAct(u, p.id ? 'Promotion updated' : 'Promotion created', o.title); return { id: o.id }; },
  delPromo(u, p) { need(isStaff(u)); const o = Promos.remove(p.id); logAct(u, 'Promotion removed', o.title); },
  testMail(u, p) { need(u.role === 'admin' || PM.can(u, 'integrations.manage')); return Mail.test(p.id, p.to); },


  /* ================= SERVICES, BRAND FILTER, SEAT SYNC (administrator only) ================= */
  saveModules(u, p) { need(u.role === 'admin', 'Only the administrator can switch services on or off'); const M = require('./modules'); db.settings.modules = M.normalize(p.modules || {}, db.settings.modules); logAct(u, 'Services changed', Object.entries(db.settings.modules).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all on'); PM.audit(u, 'settings.changed', 'modules', { modules: db.settings.modules }); },
  saveBrandFilter(u, p) { need(u.role === 'admin', 'Only the administrator can change the brand filter'); const B = require('./brand'); db.settings.brandFilter = B.normalizeConfig(p, db.settings.brandFilter); logAct(u, 'Brand filter changed', db.settings.brandFilter.terms.length + ' term(s)'); PM.audit(u, 'settings.changed', 'brandFilter', { terms: db.settings.brandFilter.terms.length }); },
  previewBrand(u, p) { need(isStaff(u)); const B = require('./brand'); const cfg = B.normalizeConfig(p, db.settings.brandFilter); return { text: B.clean(String(p.text || '').slice(0, 2000), cfg), hit: B.contains(String(p.text || ''), cfg) }; },
  saveSeatSync(u, p) { need(u.role === 'admin', 'Only the administrator can change seat sync'); require('./meezab').saveConfig(p); logAct(u, 'Seat sync settings', (p.enabled ? 'on' : 'off') + ', every ' + p.intervalMin + ' min'); PM.audit(u, 'integrations.changed', 'seatsync', { enabled: !!p.enabled }); },
  /* ================= SETTINGS ================= */
  saveSettings(u, p) {
    need(isStaff(u), 'Not allowed'); const s = db.settings, changed = [];
    const G = (perm, field) => { if (p[field] === undefined) return false; PM.need(u, perm, 'You do not have permission to change ' + field); changed.push(field); return true; };
    const secret = (cur, v) => (v && !/^\*+$/.test(String(v)) ? str(v, 300) : cur);
    if (G('settings.company', 'company')) { const c = p.company; s.company = { name: str(c.name, 80) || s.company.name, tagline: str(c.tagline, 100), phone: str(c.phone, 60), whatsapp: str(c.whatsapp, 40), email: str(c.email, 100), ntn: str(c.ntn, 40), licence: str(c.licence, 60), address: str(c.address, 220), website: str(c.website, 100), footer: str(c.footer, 300), terms: str(c.terms, 1500) }; }
    if (G('settings.banking', 'bank') && Array.isArray(p.bank)) s.bank = p.bank.slice(0, 20).map(normBank).filter(b => b.title || b.iban || b.account || b.wallet || b.raast);
    if (G('settings.bookings', 'categories') && Array.isArray(p.categories)) s.categories = [...new Set(p.categories.map(x => str(x, 40)).filter(Boolean))].slice(0, 30);
    if (G('settings.bookings', 'expenseCats') && Array.isArray(p.expenseCats)) s.expenseCats = [...new Set(p.expenseCats.map(x => str(x, 40)).filter(Boolean))].slice(0, 30);
    if (G('settings.bookings', 'sla') && p.sla) QTYPES.forEach(k => { if (p.sla[k] !== undefined) s.sla[k] = Math.max(1, Math.min(240, +p.sla[k] || s.sla[k])); });
    if (G('settings.bookings', 'prefix')) s.prefix = (str(p.prefix, 6).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'TUS');
    if (G('settings.pricing', 'markupPct')) s.markupPct = Math.max(0, Math.min(100, +p.markupPct || 0));
    if (G('settings.pricing', 'groupCostPct')) s.groupCostPct = Math.max(1, Math.min(100, +p.groupCostPct || 95));
    if (G('settings.security', 'staffCanApprove')) s.staffCanApprove = !!p.staffCanApprove;
    if (G('settings.general', 'baseUrl')) s.baseUrl = str(p.baseUrl, 200).replace(/\/+$/, '');
    if (G('settings.general', 'tz') && p.tz) s.tz = str(p.tz, 60);
    if (G('settings.payments', 'payments') && p.payments) { const x = p.payments, cur = s.payments; s.payments = { minAmount: Math.max(1, Math.min(10000000, Math.round(+x.minAmount) || 1)), requireReceipt: !!x.requireReceipt, requireRef: !!x.requireRef, autoApproveUnder: Math.max(0, Math.min(10000000, Math.round(+x.autoApproveUnder) || 0)), agentCanRecord: x.agentCanRecord !== false, publicBankPage: x.publicBankPage !== false, instructions: str(x.instructions, 600), methods: (Array.isArray(x.methods) ? [...new Set(x.methods.map(m => str(m, 40)).filter(Boolean))].slice(0, 15) : cur.methods), quickAmounts: (Array.isArray(x.quickAmounts) ? x.quickAmounts.map(n => Math.round(+n)).filter(n => n > 0).slice(0, 8) : cur.quickAmounts) }; if (!s.payments.methods.length) s.payments.methods = cur.methods; }
    if (G('settings.security', 'security') && p.security) { const x = p.security; s.security = { sessionDays: Math.max(1, Math.min(60, Math.round(+x.sessionDays) || 7)), minPassword: Math.max(6, Math.min(32, Math.round(+x.minPassword) || 8)), loginMax: Math.max(3, Math.min(50, Math.round(+x.loginMax) || 10)) }; }
    if (G('integrations.manage', 'groq') && p.groq) { const x = p.groq, cur = s.groq; s.groq = { apiKey: secret(cur.apiKey, x.apiKey), model: str(x.model, 80) || cur.model, temperature: Math.max(0, Math.min(1, +x.temperature >= 0 ? +x.temperature : cur.temperature)), enabled: x.enabled !== false, allowWrites: x.allowWrites !== false, maxActions: Math.max(1, Math.min(20, Math.round(+x.maxActions) || 10)), instructions: str(x.instructions, 1500) }; }
    if (G('integrations.manage', 'grok') && p.grok) { const x = p.grok, cur = s.grok || { apiKeys: [] }; const existing = Array.isArray(cur.apiKeys) ? cur.apiKeys : []; const incoming = (Array.isArray(x.addKeys) ? x.addKeys : []).map(k => str(k, 300).trim()).filter(k => k && !/^\*+$/.test(k)); const kept = x.clearKeys === true ? [] : existing.slice(); for (const k of incoming) if (!kept.includes(k)) kept.push(k); s.grok = { apiKeys: kept.slice(0, 10), model: str(x.model, 100) || cur.model || 'grok-4.20-0309-non-reasoning', temperature: Math.max(0, Math.min(1, +x.temperature >= 0 ? +x.temperature : (cur.temperature ?? 0.2))), enabled: x.enabled !== false, allowWrites: x.allowWrites !== false, maxActions: Math.max(1, Math.min(20, Math.round(+x.maxActions) || 10)), instructions: str(x.instructions, 1500) }; changed.push('grok'); }
    if (G('integrations.manage', 'payfast') && p.payfast) s.payfast = { merchantId: str(p.payfast.merchantId, 60), merchantName: str(p.payfast.merchantName, 80), storeId: str(p.payfast.storeId, 40), env: p.payfast.env === 'live' ? 'live' : 'sandbox', securedKey: secret(s.payfast.securedKey, p.payfast.securedKey) };
    if (G('integrations.manage', 'mail') && p.mail) Mail.save(p.mail);
    logAct(u, 'Settings saved', changed.join(', '));
    PM.audit(u, changed.some(x => ['payfast', 'groq', 'grok', 'mail'].includes(x)) ? 'integrations.changed' : 'settings.changed', 'settings', { fields: changed });
  },
  setLogo(u, p) {
    need(isStaff(u)); const m = /^data:image\/(png|jpeg|webp|svg\+xml);base64,(.+)$/.exec(String(p.data || '')); if (!m) fail('Upload a PNG, JPG, WebP or SVG logo');
    const buf = Buffer.from(m[2], 'base64'); if (buf.length > 1.5e6) fail('Logo is too large (max 1.5 MB)');
    fs.readdirSync(path.join(DATA, 'brand')).filter(f => f.startsWith('logo.')).forEach(f => { fs.unlinkSync(path.join(DATA, 'brand', f)); F.del('brand/' + f); });
    const ext = { png: 'png', jpeg: 'jpg', webp: 'webp', 'svg+xml': 'svg' }[m[1]]; fs.writeFileSync(path.join(DATA, 'brand', 'logo.' + ext), buf); F.put('brand/logo.' + ext, buf);
    db.settings.logoV = Date.now(); logAct(u, 'Logo changed', '');
  },
  resetLogo(u) { need(isStaff(u)); fs.readdirSync(path.join(DATA, 'brand')).filter(f => f.startsWith('logo.')).forEach(f => { fs.unlinkSync(path.join(DATA, 'brand', f)); F.del('brand/' + f); }); db.settings.logoV = Date.now(); },

  /* ================= AIRLINE BRANDING ================= */
  setAirlineLogo(u, p) {
    need(isStaff(u), 'Only internal staff can manage airline logos');
    const AirLogos = require('./airline-logos');
    const result = AirLogos.save(p.code, p.data);
    db.settings.airlineLogoV = Date.now();
    global.TUS_AIRLINE_LOGO_V = db.settings.airlineLogoV;
    logAct(u, 'Airline logo updated', result.code);
    PM.audit(u, 'airline.logo_updated', result.code, { mime: result.mime, size: result.size });
    return { code: result.code, airlineLogoV: db.settings.airlineLogoV };
  },
  deleteAirlineLogo(u, p) {
    need(isStaff(u), 'Only internal staff can manage airline logos');
    const AirLogos = require('./airline-logos');
    const code = AirLogos.remove(p.code);
    db.settings.airlineLogoV = Date.now();
    global.TUS_AIRLINE_LOGO_V = db.settings.airlineLogoV;
    logAct(u, 'Airline logo removed', code);
    PM.audit(u, 'airline.logo_removed', code, {});
    return { code, airlineLogoV: db.settings.airlineLogoV };
  },

  /* ================= IMPORT ================= */
  importData(u, p) {
    need(isStaff(u)); const rows = p.rows || [], res = { added: 0, skipped: [] }, k = p.kind;
    const find = (kind, name) => db.parties.find(x => (!kind || x.kind === kind) && x.name.toLowerCase() === String(name || '').trim().toLowerCase());
    rows.forEach((r, i) => {
      const bad = why => res.skipped.push('Row ' + (i + 2) + ': ' + why);
      try {
        if (k === 'agents' || k === 'suppliers' || k === 'customers') { if (!r.name) return bad('name missing'); OPS.saveParty(u, { kind: k.slice(0, -1), name: r.name, limit: r.limit, login: r.login, password: r.password, phone: r.phone, city: r.city, opening: r.opening }); res.added++; }
        else if (k === 'ledger') { const a = find(null, r.account); if (!a) return bad('account "' + r.account + '" not found'); db.entries.push({ id: 'JV-' + nid(), partyId: a.id, date: isoDate(r.date) || today(), t: r.description || 'Imported entry', dr: num(r.debit), cr: num(r.credit), by: u.name }); res.added++; }
        else if (k === 'payments') { const a = find(null, r.party); if (!a) return bad('party "' + r.party + '" not found'); db.payments.push({ id: 'PY-' + nid(), dir: a.kind === 'supplier' ? 'out' : 'in', partyId: a.id, amt: num(r.amount), method: r.method || 'Imported', ref: r.ref || '', date: isoDate(r.date) || today(), rc: '', status: 'Approved', by: u.name, note: '', via: 'import', created: nowISO() }); res.added++; }
        else fail('Unknown import type');
      } catch (e) { bad(e.message); }
    });
    logAct(u, 'Import', k + ': ' + res.added + ' added, ' + res.skipped.length + ' skipped'); return res;
  }
};

Object.assign(OPS, require('./inventory').ops);
Object.assign(OPS, PM.STAFF_OPS);

/* ---------- time-driven housekeeping ---------- */
function sweep() {
  let changed = false; const now = Date.now(), t = today();
  db.queries.forEach(q => {
    if (q.status === 'Open' && new Date(q.dueAt).getTime() < now) { q.status = 'Expired'; q.resp = { amt: 0, text: 'Automatically rejected - no response within ' + (db.settings.sla[q.type] || 24) + ' hour(s).', by: 'system', at: nowISO() }; logAct(null, 'Query auto-rejected', q.no); changed = true; }
  });
  const n = db.groups.length; db.groups = db.groups.filter(g => g.dep >= t); if (db.groups.length !== n) { logAct(null, 'Departed groups removed', (n - db.groups.length) + ' group(s)'); changed = true; }
  Object.keys(db.sessions).forEach(k => { if (db.sessions[k].exp < now) { delete db.sessions[k]; changed = true; } });
  db.paylinks.forEach(l => { if (l.status === 'Open' && new Date(l.expiresAt).getTime() < now) { l.status = 'Expired'; changed = true; } });
  if (changed) D.save();
}

module.exports = { OPS, sweep, isAdmin, isStaff, canApprove, canCosts, TYPES, QTYPES };
Object.assign(OPS, require('./extras').TOPS); // after exports so circular requires see a complete module
