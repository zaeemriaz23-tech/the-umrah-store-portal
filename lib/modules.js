'use strict';
/**
 * Service modules. Disabling a module hides it and blocks NEW work in it; it never deletes or edits stored data,
 * so turning it back on restores everything exactly as it was.
 *
 * Reads (viewing existing bookings, payments, ledgers, vouchers) are never blocked, so financial records stay reachable
 * for staff even when a module is switched off. Only creation / editing operations and search endpoints are gated.
 */
const D = require('./db');

const LIST = [
  { key: 'groups', label: 'Group packages', hint: 'Group inventory, seat counts and the public group page' },
  { key: 'hotels', label: 'Hotels', hint: 'Hotel search, hotel rates and the Makkah / Madinah pages' },
  { key: 'flights', label: 'Flights', hint: 'Live flight search and flight service lines' },
  { key: 'transport', label: 'Transport', hint: 'Transport engine, vehicles, routes and fares' },
  { key: 'visa', label: 'Umrah visa', hint: 'Visa pricing tiers and the public visa page' },
  { key: 'packages', label: 'Packages', hint: 'Umrah package calculator and package services' },
  { key: 'wallet', label: 'Agent wallet', hint: 'Credit limit and balance widgets for agents' },
  { key: 'bank', label: 'Bank accounts', hint: 'Bank accounts shown to agents and on the public page' },
  { key: 'bookings', label: 'Bookings', hint: 'Creating and managing bookings and vouchers' },
  { key: 'payments', label: 'Payments', hint: 'Recording, approving and paying online' },
  { key: 'reports', label: 'Reports', hint: 'Sales, profit and export reports' }
];
const KEYS = LIST.map(m => m.key);

/** client route -> module(s). A route is visible if ANY listed module is on. */
const ROUTES = {
  groups: ['groups'], search: ['flights', 'hotels'], transport: ['transport'], calculator: ['packages'],
  bookings: ['bookings'], bookingform: ['bookings'], booking: ['bookings'], payments: ['payments'],
  banking: ['bank'], reports: ['reports']
};

/** rpc operation -> module that must be on. Only operations that create or change records in that module. */
const OPS = {
  saveGroup: 'groups', saveGroups: 'groups', setSeats: 'groups',
  saveHotel: 'hotels', saveVisaTiers: 'visa', saveVehicle: 'transport', saveRoute: 'transport', setFare: 'transport',
  saveBooking: 'bookings', makeVoucher: 'bookings',
  addPayment: 'payments', createPaylink: 'payments'
};

/** public SEO page key -> module(s) */
const PUBLIC_PAGES = { groups: ['groups'], calc: ['packages'], transport: ['transport'], flights: ['flights'], hotels: ['hotels'], makkah: ['hotels'], madinah: ['hotels'], visa: ['visa'] };

function state() {
  const m = (D.db.settings && D.db.settings.modules) || {};
  const out = {};
  KEYS.forEach(k => { out[k] = m[k] !== false; }); // default ON: nothing disappears on upgrade
  return out;
}
const enabled = key => state()[key] !== false;
const anyEnabled = keys => keys.some(enabled);
const routeVisible = name => (ROUTES[name] ? anyEnabled(ROUTES[name]) : true);
const pageEnabled = key => (PUBLIC_PAGES[key] ? anyEnabled(PUBLIC_PAGES[key]) : true);

/** throws a plain, user-readable error when the operation belongs to a disabled module */
function gateOp(op) {
  const k = OPS[op];
  if (k && !enabled(k)) D.fail('The ' + LIST.find(m => m.key === k).label + ' service is switched off. Ask an administrator to enable it in Settings > Services.');
}

function normalize(p, prev) {
  const cur = { ...state(), ...(prev || {}) };
  const out = {};
  KEYS.forEach(k => { out[k] = p && p[k] !== undefined ? !(p[k] === false || p[k] === 'false' || p[k] === 0 || p[k] === '0') : cur[k] !== false; });
  return out;
}

module.exports = { LIST, KEYS, ROUTES, OPS, PUBLIC_PAGES, state, enabled, anyEnabled, routeVisible, pageEnabled, gateOp, normalize };
