'use strict';
/** Durable custom airline logos shared by every group-package surface. */
const fs = require('fs');
const path = require('path');
const D = require('./db');
const F = require('./files');
const DIR = path.join(D.DATA, 'brand', 'airlines', 'custom');
const TYPES = {
  'image/png': { ext: 'png', mime: 'image/png', ok: b => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) },
  'image/jpeg': { ext: 'jpg', mime: 'image/jpeg', ok: b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', mime: 'image/webp', ok: b => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' }
};
const codeOf = value => {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2}$/.test(code)) { const e = new Error('Enter a valid two-character IATA airline code, such as SV, PK or EK.'); e.status = 400; throw e; }
  return code;
};
function find(code) {
  code = codeOf(code);
  const found = [];
  for (const ext of ['png', 'jpg', 'webp']) {
    const file = path.join(DIR, code + '.' + ext);
    try { const st = fs.statSync(file); if (st.isFile()) found.push({ code, ext, mime: TYPES[ext === 'jpg' ? 'image/jpeg' : 'image/' + ext].mime, path: file, mtime: st.mtimeMs }); } catch { /* try next format */ }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  if (found[0]) delete found[0].mtime;
  return found[0] || null;
}
function list() {
  let entries = []; try { entries = fs.readdirSync(DIR, { withFileTypes: true }); } catch { return []; }
  const byCode = new Map();
  entries.filter(x => x.isFile() && /^[A-Z0-9]{2}\.(png|jpg|webp)$/.test(x.name)).forEach(x => {
    const code = x.name.slice(0, 2), file = path.join(DIR, x.name); let updatedAt = '', mtime = 0;
    try { const st = fs.statSync(file); mtime = st.mtimeMs; updatedAt = st.mtime.toISOString().slice(0, 16).replace('T', ' '); } catch { /* file may be replaced */ }
    const prev = byCode.get(code); if (!prev || mtime >= prev.mtime) byCode.set(code, { code, file: x.name, updatedAt, mtime });
  });
  return [...byCode.values()].map(({ mtime, ...x }) => x).sort((a, b) => a.code.localeCompare(b.code));
}
function save(rawCode, dataUrl) {
  const code = codeOf(rawCode), match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl || ''));
  if (!match) { const e = new Error('Upload a valid PNG, JPG or WebP airline logo.'); e.status = 400; throw e; }
  const type = TYPES[match[1]], buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 1.5 * 1024 * 1024) { const e = new Error('Airline logo must be between 1 byte and 1.5 MB.'); e.status = 413; throw e; }
  if (!type.ok(buffer)) { const e = new Error('The uploaded file contents do not match its image format.'); e.status = 400; throw e; }
  fs.mkdirSync(DIR, { recursive: true });
  const target = path.join(DIR, code + '.' + type.ext), tmp = target + '.tmp';
  // Write and atomically publish the new image before deleting the old format.
  try { fs.writeFileSync(tmp, buffer, { flag: 'w' }); fs.renameSync(tmp, target); }
  catch (e) { try { fs.unlinkSync(tmp); } catch { /* already removed */ } throw e; }
  for (const ext of ['png', 'jpg', 'webp']) {
    const old = path.join(DIR, code + '.' + ext);
    if (old !== target && fs.existsSync(old)) { fs.unlinkSync(old); F.del('brand/airlines/custom/' + code + '.' + ext); }
  }
  F.put('brand/airlines/custom/' + code + '.' + type.ext, buffer);
  return { code, ext: type.ext, mime: type.mime, size: buffer.length };
}
function remove(rawCode) {
  const code = codeOf(rawCode);
  for (const ext of ['png', 'jpg', 'webp']) {
    const file = path.join(DIR, code + '.' + ext);
    if (fs.existsSync(file)) { fs.unlinkSync(file); F.del('brand/airlines/custom/' + code + '.' + ext); }
  }
  return code;
}
module.exports = { DIR, codeOf, find, list, save, remove };
