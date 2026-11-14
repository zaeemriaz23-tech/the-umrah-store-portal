/* Umrah Groups PDF parser. Works in the browser (pdf.js) and in Node (tests / seeding).
   parseGroupsFromPages(pages, now) where pages = [{width, items:[{str,x,y}]}] */
(function (root) {
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const COLS = [0.02, 0.163, 0.394, 0.625, 0.7145, 0.8017, 0.8897, 1.01]; // pkg, makkah, madinah, sharing, quad, triple, double
  const FLT = /([A-Z]{2})\s?(\d{2,4})\s+(\d{1,2})\s([A-Za-z]{3})\s+([A-Z]{3})-([A-Z]{3})\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s+Baggage:\s*(\d+)\s*Kg/g;
  const pad = n => String(n).padStart(2, '0');
  const iso = (y, m, d) => y + '-' + pad(m + 1) + '-' + pad(d);
  const cleanDist = s => {
    s = String(s || '').replace(/^Distance:\s*/i, '').trim();
    s = s.replace(/\s*m$/i, '').replace(/\bMTR\b|\bMtr\b/gi, 'm').replace(/\s*M\s*$/i, '').trim();
    if (/^shuttle service/i.test(s)) return 'Shuttle service';
    if (/^shuttle/i.test(s)) return 'Shuttle';
    if (!s) return '';
    return /m$/i.test(s) ? s.replace(/\s+/g, ' ') : s + ' m';
  };
  function rowsOf(page) {
    const items = page.items.filter(i => i.str && i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x), rows = [];
    for (const it of items) {
      const r = rows.find(r => Math.abs(r.y - it.y) <= 2.6);
      if (r) r.items.push(it); else rows.push({ y: it.y, items: [it], w: page.width });
    }
    rows.forEach(r => r.items.sort((a, b) => a.x - b.x));
    return rows.sort((a, b) => b.y - a.y);
  }
  function cols(row) {
    const out = ['', '', '', '', '', '', ''];
    for (const it of row.items) {
      const f = it.x / row.w; let c = -1;
      for (let i = 0; i < 7; i++) if (f >= COLS[i] && f < COLS[i + 1]) { c = i; break; }
      if (c >= 0) out[c] += (out[c] ? ' ' : '') + it.str.trim();
    }
    return out;
  }
  function parseGroupsFromPages(pages, now) {
    now = now || new Date();
    let gen = null;
    for (const p of pages) for (const it of p.items) { const m = /Generated:\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(it.str); if (m) gen = { y: +m[3], m: +m[2] - 1 }; }
    gen = gen || { y: now.getFullYear(), m: now.getMonth() };
    const yearFor = (m, base) => (m < base.m - 0 && base === gen ? gen.y + 1 : gen.y);
    const groups = []; let g = null, pk = null;
    const finish = () => { if (g && g.id && g.out && g.inb && g.pk.length) groups.push(g); g = null; pk = null; };
    for (const page of pages) for (const row of rowsOf(page)) {
      const text = row.items.map(i => i.str.trim()).join(' ').replace(/\s+/g, ' ');
      let m;
      if ((m = /^Group (\d+):\s*(.+)$/.exec(text))) { finish(); g = { no: +m[1], code: m[2].trim(), id: '', pk: [] }; continue; }
      if (!g) continue;
      if ((m = /Airline:\s*([A-Z0-9]{2})\s*-\s*(.+)$/.exec(text))) { g.air = m[1]; g.airline = m[2].trim(); continue; }
      const ug = /\bUG-\d+\b/.exec(text); if (ug && !g.id) g.id = ug[0];
      FLT.lastIndex = 0; const fl = []; let fm;
      while ((fm = FLT.exec(text))) fl.push(fm);
      if (fl.length && !g.out) {
        const f = fl[0], pre = text.slice(0, f.index), post = text.slice(f.index + f[0].length);
        const nm = /(\d+)\s*$/.exec(pre.replace(/Nights/i, '').trim()), sm = /^\s*(\d+)/.exec(post);
        if (nm) g.n = +nm[1]; if (sm) g.seats = +sm[1]; g._f1 = f;
      }
      if (fl.length) for (const f of fl) {
        const leg = { fn: f[1] + ' ' + f[2], d: +f[3], mo: MON[f[4].toLowerCase()], from: f[5], to: f[6], dt: f[7], at: f[8], bag: +f[9] };
        if (!g.out) g.out = leg; else if (!g.inb && (leg.fn !== g.out.fn || leg.d !== g.out.d || leg.mo !== g.out.mo)) g.inb = leg;
      }
      if (g.out && g.seats == null && (m = /^(\d{1,3})\s+(\d{1,4})$/.exec(text))) { g.n = +m[1]; g.seats = +m[2]; continue; }
      const c = cols(row);
      if (/^UP-\d+$/.test(c[0].split(' ')[0]) && c[3].replace(/\D/g, '')) {
        pk = { id: c[0].split(' ')[0], mk: c[1], md: c[2], mkn: 0, mdn: 0, mkd: '', mdd: '', p: { sh: +c[3].replace(/\D/g, ''), qd: +c[4].replace(/\D/g, ''), tr: +c[5].replace(/\D/g, ''), db: +c[6].replace(/\D/g, '') } };
        g.pk.push(pk); continue;
      }
      if (pk && (m = /Makkah:\s*(\d+)\s*Madinah:\s*(\d+)/.exec(c[0]))) { pk.mkn = +m[1]; pk.mdn = +m[2]; pk.mkd = cleanDist(/^Distance/i.test(c[1]) ? c[1] : ''); pk.mdd = cleanDist(/^Distance/i.test(c[2]) ? c[2] : ''); pk = null; }
    }
    finish();
    for (const g of groups) {
      const o = g.out, i = g.inb, y0 = o.mo < gen.m ? gen.y + 1 : gen.y, y1 = i.mo < o.mo ? y0 + 1 : y0;
      g.dep = iso(y0, o.mo, o.d); g.ret = iso(y1, i.mo, i.d);
      g.out = { fn: o.fn, date: g.dep, from: o.from, to: o.to, dt: o.dt, at: o.at, bag: o.bag };
      g.inb = { fn: i.fn, date: g.ret, from: i.from, to: i.to, dt: i.dt, at: i.at, bag: i.bag };
      delete g._f1;
      if (!g.n) g.n = Math.round((new Date(g.ret) - new Date(g.dep)) / 864e5);
    }
    return groups;
  }
  // converts pdf.js text content to upright viewport coordinates (handles rotated pages)
  const pageFrom = (vp, tc) => ({ width: vp.width, items: tc.items.map(t => { const v = vp.convertToViewportPoint(t.transform[4], t.transform[5]); return { str: t.str, x: v[0], y: vp.height - v[1] }; }) });
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  const isoFromDmy = (s, fallbackYear) => {
    const m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/.exec(String(s || '').trim());
    if (!m) return '';
    let y = +m[3]; if (y < 100) y += y >= 70 ? 1900 : 2000;
    const d = +m[1], mo = +m[2];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return iso(y, mo - 1, d);
  };
  const isoFromDayMon = (day, mon, year) => {
    const m = MONTHS[String(mon || '').slice(0, 3).toLowerCase()];
    if (m == null) return '';
    return iso(year, m, +day);
  };
  function voucherRows(pages) {
    const out = [];
    for (const page of pages || []) for (const row of rowsOf(page)) {
      const text = row.items.map(i => String(i.str || '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      if (text) out.push(text);
    }
    return out;
  }
  function parseHotelVoucherFromPages(pages, now) {
    now = now || new Date();
    const rows = voucherRows(pages), text = rows.join('\n');
    const pick = re => { const m = re.exec(text); return m ? String(m[1] || '').trim() : ''; };
    const issuedBy = pick(/\bLAT\s*[-:]\s*(.+?)(?=\s+Hotel\s+Voucher|\n|$)/i) || pick(/^\s*(.+?)\s*\n\s*Hotel\s+Voucher/im);
    const voucherNo = pick(/Voucher\s+No\s*:\s*([A-Z0-9-]+)/i);
    const branch = pick(/Branch\s*:\s*([A-Z0-9-]+)/i);
    const iata = pick(/IATA\s*:\s*(.+?)(?=\s+Voucher\s+No\s*:|\n|$)/i);
    const saudiCompany = pick(/Saudi\s+Company\s*:\s*(.+?)(?=\s+Date\s*:|\n|$)/i);
    const manualNo = pick(/Manual\s+No\s*:\s*(.*?)(?=Group\s*#?\.?\s*\d+|\n|$)/i);
    const groupNo = pick(/Group\s*#?\.?\s*:?\s*(\d+)/i);
    const whatsapp = pick(/Whatsapp[ \t]*:[ \t]*([^\r\n]*)/i);
    const voucherDateRaw = pick(/Date\s*:\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i);
    const voucherDate = isoFromDmy(voucherDateRaw, now.getFullYear());
    const familyHead = pick(/Family\s+Head\s*:\s*(.+?)(?=\s+Total\s+PAX\s*:|\s+Whatsapp\s*:|\n|$)/i);
    const totalPax = +(pick(/Total\s+PAX\s*:\s*(\d+)/i) || 0);
    const packageName = pick(/Package\s*:\s*(.+?)(?=\s+Manual\s+No\s*:|\s+Group\s*#?\.?\s*:|\n|$)/i);
    const accountName = issuedBy.replace(/^LAT\s*[-:]\s*/i, '').trim();

    const pax = [];
    let inPax = false;
    for (const line of rows) {
      if (/Pilgrims\s+Details/i.test(line)) { inPax = true; continue; }
      if (inPax && /\bAdults\s*:/i.test(line)) break;
      if (!inPax || /Mutamer\s+Name|Gender\s+PPNO/i.test(line)) continue;
      const m = /^(.+?)\s+(Male|Female)\s+([A-Z0-9]{6,12})\s+(Adult|Child|Infant)\b(?:\s+(Yes|No))?/i.exec(line);
      if (!m) continue;
      pax.push({ n: m[1].trim().replace(/\s{2,}/g, ' '), pp: m[3].toUpperCase(), dob: '', nat: 'Pakistani', g: /^Female$/i.test(m[2]) ? 'F' : 'M', t: m[4][0].toUpperCase() + m[4].slice(1).toLowerCase() });
    }

    const anchorDate = voucherDate || (now.getFullYear() + '-01-01');
    const anchor = new Date(anchorDate + 'T00:00:00');
    const anchorYear = Number.isFinite(anchor.getTime()) ? anchor.getFullYear() : now.getFullYear();
    const anchorMonth = Number.isFinite(anchor.getTime()) ? anchor.getMonth() : now.getMonth();
    const hotels = [];
    let inAccommodation = false;
    for (const line of rows) {
      if (/Accommodation\s+Details/i.test(line)) { inAccommodation = true; continue; }
      if (inAccommodation && /Total\s+Nights\s*:/i.test(line)) break;
      if (!inAccommodation || /Hotel\s+Name|Confirm\s+No|Check\s*In/i.test(line)) continue;
      const dates = [...line.matchAll(/\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\b/g)].map(m => m[1]);
      if (dates.length < 2) continue;
      const cityMatches = [...line.matchAll(/\b(Madinah|Medinah|Makkah|Jeddah)\b/gi)];
      if (!cityMatches.length) continue;
      // Some supplier exports repeat the city in the Hotel Name column when the hotel is blank (e.g. "Makkah Makkah").
      const cityMatch = cityMatches.length > 1 && cityMatches[0].index === 0 ? cityMatches[1] : cityMatches[0];
      const cityRaw = cityMatch[1], city = /^medinah$/i.test(cityRaw) ? 'Madinah' : cityRaw[0].toUpperCase() + cityRaw.slice(1).toLowerCase();
      let hotel = line.slice(0, cityMatch.index).trim();
      if (norm(hotel) === norm(city)) hotel = '';
      const tail = line.slice(cityMatch.index + cityMatch[0].length);
      const mealMatch = /\b(RO|BB|HB|FB|EP|CP|MAP|AP)\b/i.exec(tail);
      const room = (mealMatch ? tail.slice(0, mealMatch.index) : tail).trim().replace(/\s{2,}/g, ' ');
      const mealCode = mealMatch ? mealMatch[1].toUpperCase() : '';
      const meals = { RO: 'Room only', BB: 'Breakfast', HB: 'Half board', FB: 'Full board', EP: 'Room only', CP: 'Breakfast', MAP: 'Half board', AP: 'Full board' };
      const cin = isoFromDmy(dates[0], anchorYear), cout = isoFromDmy(dates[1], anchorYear);
      const nightsMatch = /\s(\d{1,2})\s*$/.exec(line);
      let nights = nightsMatch ? +nightsMatch[1] : 0;
      if (!nights && cin && cout) nights = Math.max(1, Math.round((new Date(cout) - new Date(cin)) / 86400000));
      hotels.push({ hotel, city, roomType: room, meal: meals[mealCode] || 'Room only', mealCode, cin, cout, nights, confirm: '' });
    }

    const legs = [];
    const legRe = /\b([A-Z0-9]{2,3}-\d{2,4})\s+([A-Z]{3})-([A-Z]{3})\s+(\d{1,2})-([A-Z]{3})\s+(\d{2}:\d{2})\s+(\d{1,2})-([A-Z]{3})\s+(\d{2}:\d{2})/gi;
    let lm;
    while ((lm = legRe.exec(text))) {
      const monthDep = MONTHS[lm[5].toLowerCase()], monthArr = MONTHS[lm[8].toLowerCase()];
      let year = anchorYear;
      if (monthDep != null && monthDep < anchorMonth) year++;
      const depDate = isoFromDayMon(lm[4], lm[5], year);
      let arrYear = year; if (monthArr != null && monthDep != null && monthArr < monthDep) arrYear++;
      legs.push({ fno: lm[1].replace(/-/g, '-'), from: lm[2], to: lm[3], date: depDate, dep: lm[6], arrDate: isoFromDayMon(lm[7], lm[8], arrYear), arr: lm[9] });
    }

    let transport = null, inTransport = false;
    for (const line of rows) {
      if (/Transport\s*\/\s*Services/i.test(line)) { inTransport = true; continue; }
      if (inTransport && /Departure\s+from\s+Pakistan/i.test(line)) break;
      if (!inTransport || /^Name\s+Type\s+BRN/i.test(line)) continue;
      const m = /^(.+?)\s+(By\s+.+)$/i.exec(line);
      if (m) { transport = { name: m[1].trim(), type: m[2].trim() }; break; }
    }
    const note = pick(/Note\s*:\s*(.+?)(?:\n|$)/i);
    const adults = +(pick(/Adults\s*:\s*(\d+)/i) || 0), children = +(pick(/Childs?\s*:\s*(\d+)/i) || 0), infants = +(pick(/Infants?\s*:\s*(\d+)/i) || 0), totalBeds = +(pick(/Total\s+BEDS\s*:\s*(\d+)/i) || 0);
    if (!pax.length && !hotels.length && !legs.length) throw new Error('No readable hotel voucher data was found. This PDF may be scanned or use an unsupported layout.');
    const warnings = [];
    if (totalPax && pax.length !== totalPax) warnings.push(`Voucher says ${totalPax} passengers, but ${pax.length} traveller rows were read. Review the traveller list.`);
    if (!accountName) warnings.push('The issuing agent name was not detected. Select the correct account manually.');
    if (!hotels.length) warnings.push('No accommodation rows were detected. Add hotel services manually.');
    return { kind: 'hotel-voucher', issuedBy, accountName, voucherNo, branch, voucherDate, familyHead, totalPax, packageName, iata, saudiCompany, manualNo, groupNo, whatsapp, totalBeds, pax, hotels, legs, transport, note, counts: { adults, children, infants }, warnings, rawText: text };
  }
  const api = { parseGroupsFromPages, parseHotelVoucherFromPages, cleanDist, pageFrom, voucherRows, isoFromDmy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PdfParse = api;
  // browser helpers share one PDF reader so group imports and hotel-voucher imports use identical extraction.
  async function readPdfPages(file) {
    if (!root.pdfjsLib) throw new Error('PDF reader has not loaded. Refresh the page and try again.');
    root.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
    const doc = await root.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise, pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const pg = await doc.getPage(n), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent();
      pages.push(api.pageFrom(vp, tc));
    }
    return pages;
  }
  api.parsePdfFile = async file => parseGroupsFromPages(await readPdfPages(file));
  api.parseHotelVoucherFile = async file => parseHotelVoucherFromPages(await readPdfPages(file));
})(typeof window !== 'undefined' ? window : globalThis);
