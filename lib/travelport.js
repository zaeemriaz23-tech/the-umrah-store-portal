'use strict';
/** Travelport TripServices connector. Credentials are read only from server environment variables. */
const crypto = require('crypto');
const D = require('./db');
const { db } = D;

const searches = new Map();
const activeHolds = new Set();
const tokenState = { value: '', exp: 0, promise: null };
const ENV = () => process.env.TRAVELPORT_ENV === 'production' ? 'production' : 'preproduction';
const roots = () => ENV() === 'production'
  ? { auth: 'https://auth.travelport.net/oauth/token', air: 'https://api.travelport.net/11/air/', hotel: 'https://api.travelport.net/12/hotel/' }
  : { auth: 'https://auth.pp.travelport.net/oauth/token', air: 'https://api.pp.travelport.net/11/air/', hotel: 'https://api.pp.travelport.net/12/hotel/' };
const clean = (v, max = 180) => String(v == null ? '' : v).trim().slice(0, max);
const num = (v, d = 0) => Number.isFinite(+v) ? +v : d;
const int = (v, d, min, max) => Math.min(max, Math.max(min, parseInt(v, 10) || d));
const iso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
const arr = v => Array.isArray(v) ? v : v ? [v] : [];
const id = () => crypto.randomBytes(20).toString('hex');

function config() {
  const accessGroup = clean(process.env.TRAVELPORT_ACCESS_GROUP, 100);
  const pccCore = clean(process.env.TRAVELPORT_PCC_CORE, 100);
  const creds = ['TRAVELPORT_USERNAME', 'TRAVELPORT_PASSWORD', 'TRAVELPORT_CLIENT_ID', 'TRAVELPORT_CLIENT_SECRET'];
  const missing = creds.filter(k => !process.env[k]);
  if (!accessGroup && !pccCore) missing.push('TRAVELPORT_ACCESS_GROUP (or TRAVELPORT_PCC_CORE)');
  return { configured: missing.length === 0, missing, env: ENV(), accessGroup, pccCore };
}
async function testConnection() {
  await token();
  return { ok: true, environment: ENV(), message: 'Travelport OAuth authentication succeeded. This confirms credentials only; Air, Stays and booking entitlements still need separate API checks.' };
}
function status() {
  const c = config();
  return { provider: 'Travelport TripServices', configured: c.configured, environment: c.env, airEntitlement: 'Requires Travelport account provisioning', staysEntitlement: 'Requires Travelport Stays provisioning',
    tokenReady: !!tokenState.value && tokenState.exp > Date.now(), credentials: {
      username: !!process.env.TRAVELPORT_USERNAME, password: !!process.env.TRAVELPORT_PASSWORD,
      clientId: !!process.env.TRAVELPORT_CLIENT_ID, clientSecret: !!process.env.TRAVELPORT_CLIENT_SECRET,
      accessGroup: !!c.accessGroup, pccCore: !!c.pccCore
    }, missing: c.missing };
}
function authHeaders(token, stays = false) {
  const c = config(), h = { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip, deflate', 'Cache-Control': 'no-cache' };
  if (c.accessGroup) h.XAUTH_TRAVELPORT_ACCESSGROUP = c.accessGroup;
  else if (c.pccCore) h['TVP-PCC-CORE'] = c.pccCore;
  h['TVP-Trace-Id'] = 'TUS-' + id().slice(0, 24);
  if (stays) h['TVP-Enable-Error-Details'] = 'true';
  return h;
}
async function token(force = false) {
  const c = config();
  if (!c.configured) throw new Error('Travelport is not configured. Add the Travelport server environment variables in Hostinger.');
  if (!force && tokenState.value && tokenState.exp > Date.now() + 120000) return tokenState.value;
  if (tokenState.promise) return tokenState.promise;
  tokenState.promise = (async () => {
    const form = new URLSearchParams({ grant_type: 'password', username: process.env.TRAVELPORT_USERNAME, password: process.env.TRAVELPORT_PASSWORD, client_id: process.env.TRAVELPORT_CLIENT_ID, client_secret: process.env.TRAVELPORT_CLIENT_SECRET });
    const r = await fetch(roots().auth, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form.toString(), signal: AbortSignal.timeout(18000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error('Travelport authentication failed (' + r.status + '). Check the environment, credentials and access-group assignment in MyTravelport.');
    tokenState.value = j.access_token;
    tokenState.exp = Date.now() + Math.max(300, Math.min(86400, num(j.expires_in, 86400) - 180)) * 1000;
    return tokenState.value;
  })().finally(() => { tokenState.promise = null; });
  return tokenState.promise;
}
async function request(base, path, body, stays = false, retry = true) {
  const t = await token();
  const r = await fetch(base + path, { method: 'POST', headers: authHeaders(t, stays), body: JSON.stringify(body), signal: AbortSignal.timeout(35000) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && retry) { tokenState.value = ''; tokenState.exp = 0; return request(base, path, body, stays, false); }
  if (!r.ok) {
    const msg = arr(j.errors || j.Error || j.error).map(e => clean(e.message || e.Message || e.code || JSON.stringify(e), 260)).filter(Boolean).join('; ');
    throw new Error('Travelport API error (' + r.status + ')' + (msg ? ': ' + msg : '. Check API product provisioning and request details.'));
  }
  return j;
}
const durMins = s => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(String(s || '')); return m ? (+m[1] || 0) * 60 + (+m[2] || 0) : 0; };
const fmtDateTime = (d, t) => d && t ? d + 'T' + t : '';

function passengerCriteria(q) {
  const adults = int(q.adults, 1, 1, 9), children = int(q.children, 0, 0, 8), infants = int(q.infants, 0, 0, 4);
  if (adults + children + infants > 9) throw new Error('Travelport search supports up to 9 travellers per booking.');
  if (infants > adults) throw new Error('There cannot be more infants than adults.');
  const p = [{ '@type': 'PassengerCriteria', number: adults, passengerTypeCode: 'ADT' }];
  const ages = clean(q.ages, 50).split(',').map(x => int(x, 8, 2, 11));
  if (children) {
    const counts = new Map();
    for (let i = 0; i < children; i++) { const age = ages[i] || 8; counts.set(age, (counts.get(age) || 0) + 1); }
    counts.forEach((n, age) => p.push({ '@type': 'PassengerCriteria', number: n, passengerTypeCode: 'CNN', age: +age }));
  }
  if (infants) p.push({ '@type': 'PassengerCriteria', number: infants, passengerTypeCode: 'INF', age: 0 });
  return p;
}
function cabinModifier(cls) {
  const c = { '1': 'Economy', '2': 'PremiumEconomy', '3': 'Business', '4': 'First' }[String(cls || '1')];
  return c ? { '@type': 'SearchModifiersAir', CabinPreference: [{ '@type': 'CabinPreference', preferenceType: 'Permitted', cabins: [c] }] } : undefined;
}
function searchFlightsRequest(q) {
  const legs = Array.isArray(q.legs) ? q.legs : [{ from: q.from, to: q.to, date: q.date }, ...(iso(q.ret) ? [{ from: q.to, to: q.from, date: q.ret }] : [])];
  if (!legs.length || legs.length > 2) throw new Error('Live Travelport booking currently supports one-way and return itineraries. Multi-city booking will be enabled after its separate fare-combination workflow is certified.');
  const SearchCriteriaFlight = legs.map((l, i) => {
    const from = clean(l.from, 3).toUpperCase(), to = clean(l.to, 3).toUpperCase(), date = iso(l.date);
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || from === to || !date) throw new Error('A valid airport pair and date is required for each flight segment.');
    return { '@type': 'SearchCriteriaFlight', departureDate: date, legSequence: i + 1, From: { value: from }, To: { value: to } };
  });
  const req = { '@type': 'CatalogProductOfferingsRequestAir', offersPerPage: 50, sortBy: 'Price-LowToHigh', contentSourceList: String(process.env.TRAVELPORT_CONTENT_SOURCES || 'GDS').split(',').map(x => x.trim()).filter(x => ['GDS', 'NDC'].includes(x)), PassengerCriteria: passengerCriteria(q), SearchCriteriaFlight };
  const cm = cabinModifier(q.cls); if (cm) req.SearchModifiersAir = cm;
  if (!req.contentSourceList.length) req.contentSourceList = ['GDS'];
  return { CatalogProductOfferingsQueryRequest: { CatalogProductOfferingsRequest: req } };
}
function lists(j) {
  const cp = j.CatalogProductOfferingsResponse || j;
  const ref = arr(cp.ReferenceList || j.ReferenceList);
  const fl = ref.find(x => /ReferenceListFlight/.test(x['@type'] || ''));
  const pr = ref.find(x => /ReferenceListProduct/.test(x['@type'] || ''));
  const flightMap = new Map(arr(fl && fl.Flight).map(x => [x.id, x]));
  const productMap = new Map(arr(pr && pr.Product).map(x => [x.id, x]));
  return { cp, flightMap, productMap };
}
function refsForProduct(productRef, maps) {
  const product = maps.productMap.get(productRef);
  const segs = arr(product && product.FlightSegment).map(s => maps.flightMap.get(s.Flight && s.Flight.FlightRef)).filter(Boolean).map(f => ({
    no: clean(f.number, 20), from: clean(f.Departure && f.Departure.location, 3), to: clean(f.Arrival && f.Arrival.location, 3),
    dep: fmtDateTime(f.Departure && f.Departure.date, f.Departure && f.Departure.time), arr: fmtDateTime(f.Arrival && f.Arrival.date, f.Arrival && f.Arrival.time),
    air: clean(f.carrier, 4), dur: durMins(f.duration), plane: clean(f.equipment, 30), fromName: '', toName: ''
  }));
  return { segs, product };
}
function extractOptions(cpo, maps) {
  const options = [];
  for (const bo of arr(cpo.ProductBrandOptions)) for (const pbo of arr(bo.ProductBrandOffering)) {
    const pRefs = arr(pbo.Product).map(x => x.productRef).filter(Boolean);
    if (!pRefs.length) continue;
    const segs = pRefs.flatMap(ref => refsForProduct(ref, maps).segs);
    if (!segs.length) continue;
    const price = pbo.BestCombinablePrice || {}, total = num(price.TotalPrice && typeof price.TotalPrice === 'object' ? price.TotalPrice.value : price.TotalPrice, NaN), base = num(price.Base && typeof price.Base === 'object' ? price.Base.value : price.Base, NaN), currency = clean(price.CurrencyCode && (price.CurrencyCode.value || price.CurrencyCode.code) || price.CurrencyCode, 3) || 'PKR';
    if (!Number.isFinite(total) || total <= 0) continue;
    options.push({ pbo, segs, pRefs, total, base: Number.isFinite(base) ? base : total, currency, code: arr(pbo.CombinabilityCode).map(String) });
  }
  return options;
}
function toUiFlight(legs, options, round, best) {
  const segs = legs.flatMap(x => x.segs).sort((a, b) => String(a.dep).localeCompare(String(b.dep)));
  const first = segs[0], last = segs[segs.length - 1];
  if (!first || !last) return null;
  const airlines = [...new Set(segs.map(x => x.air))];
  const stops = legs.reduce((n, leg) => n + Math.max(0, leg.segs.length - 1), 0);
  return { token: '', bookingToken: '', best: !!best, airline: airlines[0], logo: '', airlines, nos: segs.map(s => (s.air + ' ' + s.no).trim()), from: first.from, fromName: first.fromName, to: last.to, toName: last.toName, dep: first.dep, arr: last.arr,
    dur: legs.reduce((n, l) => n + l.segs.reduce((s, x) => s + x.dur, 0), 0), stops, via: segs.slice(0, -1).map(x => x.to).join(', '), cls: options[0] && options[0].pbo.Brand && options[0].pbo.Brand.BrandRef || 'Economy', plane: [...new Set(segs.map(x => x.plane).filter(Boolean))].join(' / '),
    co2: 0, co2diff: 0, ext: [], overnight: false, lay: [], segs: segs.map(s => ({ ...s, legroom: '', delayed: false, night: false })), base: options[0].base, price: options[0].total, currency: options[0].currency, round: !!round, source: 'Travelport', providerToken: '' };
}
async function flights(q, user) {
  if (!config().configured) return { configured: false, provider: 'Travelport' };
  const body = searchFlightsRequest(q);
  const j = await request(roots().air, 'catalog/search/catalogproductofferings', body);
  const maps = lists(j), cpos = arr(maps.cp.CatalogProductOfferings && maps.cp.CatalogProductOfferings.CatalogProductOffering);
  const transaction = maps.cp.CatalogProductOfferings && maps.cp.CatalogProductOfferings.Identifier && maps.cp.CatalogProductOfferings.Identifier.value;
  if (!transaction || !cpos.length) return { configured: true, provider: 'Travelport', kind: 'flights', round: !!iso(q.ret), items: [] };
  const perLeg = new Map();
  cpos.forEach(cpo => { const n = +cpo.sequence || 1; if (!perLeg.has(n)) perLeg.set(n, []); perLeg.get(n).push({ cpo, options: extractOptions(cpo, maps) }); });
  const legsNo = [...perLeg.keys()].sort((a,b)=>a-b);
  const selected = [];
  if (legsNo.length <= 1) {
    for (const entry of (perLeg.get(legsNo[0]) || [])) for (const option of entry.options) selected.push({ legs: [{ segs: option.segs }], options: [option], refs: [{ id: entry.cpo.id, productRefs: option.pRefs }], price: option.total, currency: option.currency, base: option.base });
  } else {
    const first = perLeg.get(legsNo[0]) || [], second = perLeg.get(legsNo[1]) || [];
    for (const a of first) for (const ao of a.options) for (const b of second) for (const bo of b.options) {
      const code = ao.code.find(x => bo.code.includes(x)); if (!code || ao.currency !== bo.currency) continue;
      // Travelport returns the whole-itinerary BestCombinablePrice on each leg; take it once, not twice.
      selected.push({ legs: [{ segs: ao.segs }, { segs: bo.segs }], options: [ao, bo], refs: [{ id: a.cpo.id, productRefs: ao.pRefs }, { id: b.cpo.id, productRefs: bo.pRefs }], price: ao.total, currency: ao.currency, base: ao.base });
    }
  }
  // Multi-city beyond 2 legs requires multi-offer fare construction; do not fabricate combinations.
  const userToken = item => {
    const key = id(); searches.set(key, { at: Date.now(), userId: user && user.id || '', transaction, refs: item.refs, currency: item.currency, amount: item.price, base: item.base, query: q, type: 'flight' });
    return key;
  };
  const items = selected.sort((a,b)=>a.price-b.price).slice(0, 80).map((x, i) => {
    const o = toUiFlight(x.legs, x.options, legsNo.length > 1, i === 0);
    if (!o) return null;
    o.token = userToken(x); o.base = x.base; o.price = x.price; o.currency = x.currency; o.best = i === 0;
    return o;
  }).filter(Boolean);
  purge();
  return { configured: true, provider: 'Travelport', kind: 'flights', round: legsNo.length > 1, items, insight: null };
}
function purge() { const cut = Date.now() - 9 * 60 * 1000; for (const [k, v] of searches) if (v.at < cut) searches.delete(k); }
function ownedSearch(tokenId, userId) {
  purge(); const r = searches.get(clean(tokenId, 80));
  if (!r) throw new Error('This flight offer has expired. Run a fresh search and select the flight again.');
  if (r.userId && r.userId !== userId) throw new Error('This flight offer belongs to another user.');
  r.userId = userId; return r;
}
async function priceFlight(tokenId, user) {
  const s = ownedSearch(tokenId, user.id);
  if (s.type !== 'flight') throw new Error('This selection is not a flight offer.');
  const payload = { '@type': 'OfferQueryBuildFromCatalogProductOfferings', BuildFromCatalogProductOfferingsRequest: {
    '@type': 'BuildFromCatalogProductOfferingsRequestAir',
    CatalogProductOfferingsIdentifier: { Identifier: { value: s.transaction } },
    CatalogProductOfferingSelection: s.refs.map(r => ({ CatalogProductOfferingIdentifier: { Identifier: { value: r.id } }, ProductIdentifier: r.productRefs.map(p => ({ Identifier: { value: p } })) }))
  } };
  const j = await request(roots().air, 'price/offers/buildfromcatalogproductofferings', payload);
  const root = j.OfferListResponse || j;
  const offers = arr(root.OfferID || root.Offer || (root.OfferList && root.OfferList.OfferID));
  const first = offers[0] || root;
  const price = first.BestCombinablePrice || first.Price || root.BestCombinablePrice || {};
  const rawTotal = price.TotalPrice || price.Total, total = num(rawTotal && typeof rawTotal === 'object' ? rawTotal.value : rawTotal, NaN), currency = clean(price.CurrencyCode && (price.CurrencyCode.value || price.CurrencyCode.code) || price.CurrencyCode, 3) || s.currency;
  if (!(total > 0)) throw new Error('Travelport returned no confirmed price for this selection. Please search again.');
  const pricedToken = id(), sellTotal = Math.round(total * (1 + num(db.settings.markupPct) / 100) * 100) / 100;
  const paymentPkr = getOrderCurrencyToPkr(sellTotal, currency);
  searches.set(pricedToken, { ...s, at: Date.now(), priceId: root.Identifier && root.Identifier.value || first.Identifier && first.Identifier.value || '', priced: true, amount: total, currency, sellTotal, paymentPkr, priceResponse: j });
  return { configured: true, token: pricedToken, currency, total, sellTotal, paymentPkr, base: num(price.Base, total), taxes: num(price.TotalTaxes, 0), source: 'Travelport', note: 'Fare and availability revalidated by Travelport.' };
}

function cityLocation(city) {
  const n = clean(city, 100);
  return { city: n, countryCode: 'SA' };
}
function hotelSearchRequest(q) {
  const adults = int(q.adults, 2, 1, 16), children = int(q.children, 0, 0, 10), rooms = int(q.rooms, 1, 1, 8);
  const childAges = clean(q.ages, 80).split(',').filter(Boolean).slice(0, children).map(x => int(x, 8, 0, 17));
  const pf = { location: cityLocation(q.city || 'Makkah'), returnOnlyAvailableProperties: true, imageSize: 'LARGE', returnAllImageURLs: true, returnRateSummaryInfo: true };
  const hotelName = clean(q.hotelName || q.name, 100); if (hotelName) pf.hotelNameContains = hotelName;
  return { stayDetails: { checkInDateLocal: iso(q.cin), checkOutDateLocal: iso(q.cout), rooms, guests: { numberOfAdults: adults, numberOfChildren: children, ...(children ? { childAges } : {}) } }, propertyFilter: pf, requestedCurrency: clean(process.env.TRAVELPORT_HOTEL_CURRENCY || 'SAR', 3).toUpperCase() };
}
async function hotels(q, user) {
  if (!config().configured) return { configured: false, provider: 'Travelport' };
  const body = hotelSearchRequest(q);
  const j = await request(roots().hotel, 'search/searchcomplete', body, true);
  const root = j.hotelsResponse || j, raw = arr(root.hotels || root.propertyItems || root.Hotel);
  const getAmount = r => {
    const candidates = [r && r.pricing && r.pricing.total && r.pricing.total.value, r && r.pricing && r.pricing.total, r && r.pricing && r.pricing.TotalPrice, r && r.totalPrice && r.totalPrice.value, r && r.totalPrice, r && r.total && r.total.value, r && r.total];
    for (const v of candidates) { const n = num(v, NaN); if (Number.isFinite(n) && n > 0) return n; }
    return NaN;
  };
  const rateCandidates = h => [
    ...arr(h.lowestPublicAvailableRate), ...arr(h.lowestAvailableRate),
    ...arr(h.rates), ...arr(h.ratePlans), ...arr(h.rooms),
    ...arr(h.roomTypes).flatMap(rt => arr(rt.rates).map(r => ({ ...r, roomType: r.roomType || rt })))
  ];
  const items = raw.map((h, i) => {
    const pi = h.propertyInfo || {}, rates = rateCandidates(h), rate = rates.map(r => ({ r, amount: getAmount(r) })).filter(x => x.amount > 0).sort((a,b)=>a.amount-b.amount)[0];
    if (!rate) return null;
    const imgs = arr(h.images || pi.images).map(x => clean(x.url || x.imageUrl || x.uri || x, 800)).filter(x => /^https:\/\//i.test(x)).slice(0, 8);
    const star = num(pi.rating || pi.starRating, 0), currency = clean(rate.r.pricing && rate.r.pricing.total && (rate.r.pricing.total.currency || rate.r.pricing.total.currencyCode) || rate.r.pricing && rate.r.pricing.currency || rate.r.currency || body.requestedCurrency, 3).toUpperCase();
    const propertyKey = h.propertyKey || pi.propertyKey || '', rateKey = rate.r.rateKey || rate.r.id || '';
    const tokenId = id(); searches.set(tokenId, { at: Date.now(), userId: user.id, type: 'hotel', propertyKey, rateKey, amount: rate.amount, currency, hotel: clean(pi.propertyName || h.name), query: q });
    const cancel = rate.r.rateRules && rate.r.rateRules.cancelPolicy;
    return { token: tokenId, name: clean(pi.propertyName || h.name || pi.name, 160), type: 'hotel', img: imgs[0] || '', imgs, stars: star, rating: num(pi.guestRating || pi.ratingScore, 0), reviews: num(pi.reviewCount, 0), desc: clean(pi.description || h.description, 500), amenities: arr(h.amenities || pi.amenities).slice(0, 8).map(x => clean(x.name || x)), cin: q.cin, cout: q.cout, near: [], free: !!(cancel && (cancel.refundable === true || /free|refundable/i.test(JSON.stringify(cancel)))), base: rate.amount, baseTotal: rate.amount, currency, roomName: clean(rate.r.roomType && (rate.r.roomType.name || rate.r.roomType.description) || rate.r.roomName, 120), cancelPolicy: clean(cancel && (cancel.description || cancel.cancelNote || cancel), 300), provider: 'Travelport' };
  }).filter(Boolean);
  return { configured: true, provider: 'Travelport', kind: 'hotels', rooms, items };
}
function forUser(res, user) {
  const staff = user.role === 'admin' || user.role === 'staff', out = { ...res, staff, provider: 'Travelport', markup: db.settings.markupPct || 0 };
  if (Array.isArray(res.items)) out.items = res.items.map(item => {
    const r = { ...item, price: Math.round(num(item.base) * (1 + num(db.settings.markupPct) / 100) * 100) / 100 };
    if (!staff) { delete r.base; delete r.baseTotal; delete r.link; }
    return r;
  });
  return out;
}
function getOrderCurrencyToPkr(amount, currency) {
  const c = clean(currency, 3).toUpperCase();
  if (c === 'PKR') return Math.round(amount);
  if (c === 'SAR' && num(db.settings.calc && db.settings.calc.pkrPerSar) > 0) return Math.round(amount * num(db.settings.calc.pkrPerSar));
  const fx = db.fx && db.fx.perUnit && num(db.fx.perUnit[c]);
  if (fx > 0) return Math.round(amount * fx);
  throw new Error('Cannot take PayFast payment: no verified office exchange rate is saved for ' + c + ' to PKR. Ask the administrator to set the rate first.');
}
function makeTraveler(p) {
  const first = clean(p.firstName || p.given, 60), last = clean(p.lastName || p.surname, 60), birthDate = iso(p.birthDate || p.dob);
  if (!first || !last || !birthDate || !['Male','Female'].includes(p.gender)) throw new Error('Each traveller needs a first name, last name, date of birth and gender.');
  if ((first + last).length > 22) throw new Error('Travelport limits the combined first and last name to 22 characters. Please check the passport spelling and enter a shorter name only if it matches the travel document.');
  const passport = clean(p.passport || p.passportNumber, 30).toUpperCase();
  const expiry = iso(p.passportExpiry || p.expiry);
  if (!passport || !expiry || expiry <= new Date().toISOString().slice(0,10)) throw new Error('Enter a valid passport number and future passport expiry for each traveller.');
  const issue = clean(p.passportIssueCountry || p.nationality || 'PK', 2).toUpperCase();
  return { '@type': 'Traveler', passengerTypeCode: ['ADT','CNN','INF'].includes(p.ptc) ? p.ptc : 'ADT', birthDate, gender: p.gender,
    PersonName: { '@type': 'PersonNameDetail', Given: first.toUpperCase(), Surname: last.toUpperCase() },
    TravelDocument: [{ '@type': 'TravelDocumentDetail', docNumber: passport, docType: 'Passport', expireDate: expiry, issueCountry: issue, birthDate, Gender: p.gender, PersonName: { '@type': 'PersonNameDetail', Given: first.toUpperCase(), Surname: last.toUpperCase() } }],
    ...(clean(p.email,120) ? { Email: [{ value: clean(p.email,120) }] } : {}),
    ...(clean(p.phone,40) ? { Telephone: [{ '@type': 'Telephone', phoneNumber: clean(p.phone,40).replace(/[^\d+]/g,'') }] } : {}) };
}
async function holdFlight(tokenId, passengers, user) {
  const lockKey = clean(tokenId, 100);
  if (activeHolds.has(lockKey)) throw new Error('This Travelport reservation is already being created. Please do not submit it again.');
  activeHolds.add(lockKey);
  try { return await holdFlightOnce(tokenId, passengers, user); } finally { activeHolds.delete(lockKey); }
}
async function holdFlightOnce(tokenId, passengers, user) {
  if (user.role !== 'agent') throw new Error('Only an approved travel-agent account can create a supplier reservation from the portal.');
  const s = ownedSearch(tokenId, user.id); if (s.type !== 'flight') throw new Error('This offer is not a flight.');
  if (!s.priced) throw new Error('Revalidate the Travelport fare before creating a reservation.');
  if (s.holdOrderId) { const existing = (db.travelportOrders || []).find(x => x.id === s.holdOrderId && x.userId === user.id); if (existing) return { id: existing.id, locator: existing.locator, status: existing.status, amount: existing.sellAmount, currency: existing.sellCurrency, paymentPkr: existing.paymentPkr, expiry: existing.expiry, ticketStatus: existing.ticketStatus }; }
  if (!Array.isArray(passengers) || !passengers.length || passengers.length > 9) throw new Error('Add 1 to 9 travellers.');
  if (s.at < Date.now() - 8 * 60 * 1000) throw new Error('The fare hold window has expired. Search again.');
  const pax = passengers.map(makeTraveler);
  const expected = { ADT: int(s.query.adults, 1, 1, 9), CNN: int(s.query.children, 0, 0, 8), INF: int(s.query.infants, 0, 0, 4) };
  for (const code of Object.keys(expected)) if (pax.filter(x => x.passengerTypeCode === code).length !== expected[code]) throw new Error('Traveller details must match the passenger counts used in the search (' + expected.ADT + ' adults, ' + expected.CNN + ' children, ' + expected.INF + ' infants).');
  if (pax.filter(x => x.passengerTypeCode === 'ADT').length < 1) throw new Error('At least one adult traveller is required.');
  const root = roots().air;
  const workbench = await request(root, 'book/session/reservationworkbench', { '@type': 'Reservation' });
  const wb = workbench.ReservationResponse && ((workbench.ReservationResponse.Reservation && workbench.ReservationResponse.Reservation.Identifier && workbench.ReservationResponse.Reservation.Identifier.value) || (workbench.ReservationResponse.Identifier && workbench.ReservationResponse.Identifier.value));
  if (!wb) throw new Error('Travelport did not return a booking workbench identifier.');
  try {
    const add = { '@type': 'OfferQueryBuildFromCatalogProductOfferings', BuildFromCatalogProductOfferingsRequest: { '@type': 'BuildFromCatalogProductOfferingsRequestAir', CatalogProductOfferingsIdentifier: { Identifier: { value: s.transaction } }, CatalogProductOfferingSelection: s.refs.map(r => ({ CatalogProductOfferingIdentifier: { Identifier: { value: r.id } }, ProductIdentifier: r.productRefs.map(p => ({ Identifier: { value: p } })) })) } };
    await request(root, 'book/airoffer/reservationworkbench/' + encodeURIComponent(wb) + '/offers/buildfromcatalogproductofferings', add);
    for (let i = 0; i < pax.length; i += 9) await request(root, 'book/traveler/reservationworkbench/' + encodeURIComponent(wb) + '/travelers/list', { Traveler: pax.slice(i, i + 9) });
    const committed = await request(root, 'book/reservation/reservations/' + encodeURIComponent(wb), {});
    const reservation = committed.ReservationResponse && committed.ReservationResponse.Reservation || {};
    const receipts = arr(reservation.Receipt || reservation.Receipts), locator = receipts.map(r => r.Confirmation && r.Confirmation.Locator && r.Confirmation.Locator.value).find(Boolean) || reservation.Receipt && reservation.Receipt.Confirmation && reservation.Receipt.Confirmation.Locator && reservation.Receipt.Confirmation.Locator.value || '';
    if (!locator) throw new Error('Travelport did not confirm a reservation locator. Please check Travelport before retrying to avoid a duplicate booking.');
    const amount = num(s.amount), currency = clean(s.currency || 'PKR', 3);
    const sellAmount = num(s.sellTotal, amount * (1 + num(db.settings.markupPct) / 100));
    const payPkr = num(s.paymentPkr, getOrderCurrencyToPkr(sellAmount, currency));
    const o = { id: 'TP-' + D.nid(), partyId: user.pid, userId: user.id, kind: 'flight', provider: 'Travelport', status: 'Held - Payment Required', locator, currency, supplierAmount: amount, sellAmount, sellCurrency: currency, paymentPkr: payPkr,
      from: clean(s.query.from,3), to: clean(s.query.to,3), departure: iso(s.query.date), returnDate: iso(s.query.ret), passengerCount: pax.length, passengers: pax.map(x => ({ first: x.PersonName.Given, last: x.PersonName.Surname, ptc: x.passengerTypeCode })), createdAt: new Date().toISOString(), expiry: reservation.TermsAndConditionsFull && reservation.TermsAndConditionsFull.ExpiryDate || '', ticketStatus: 'Not ticketed', source: 'Travelport TripServices' };
    db.travelportOrders = Array.isArray(db.travelportOrders) ? db.travelportOrders : []; db.travelportOrders.push(o); s.holdOrderId = o.id; D.save();
    return { id: o.id, locator: o.locator, status: o.status, amount: o.sellAmount, currency: o.sellCurrency, paymentPkr: o.paymentPkr, expiry: o.expiry, ticketStatus: o.ticketStatus };
  } catch (e) {
    // Expire the uncommitted workbench server-side if Travelport provides the endpoint; do not retry the booking silently.
    throw e;
  }
}

module.exports = { config, status, token, testConnection, flights, hotels, priceFlight, holdFlight, getOrderCurrencyToPkr, ownedSearch, searchFlightsRequest, passengerCriteria, makeTraveler, cityLocation, hotelSearchRequest };
