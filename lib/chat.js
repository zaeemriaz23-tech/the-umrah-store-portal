'use strict';
/**
 * Live chat between website visitors and the team.
 * - Conversations and every message are stored in the database (history survives restarts).
 * - Real time: Server-Sent Events for visitors and for staff; the clients fall back to polling if a proxy buffers streams.
 * - Visitors only ever hold their own conversation (id + secret token). Staff need chat.view / chat.manage.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const D = require('./db');
const { db, DATA, nid, str, save } = D;
const F = require('./files');
const PM = require('./perms');
const X = require('./extras');
const Mail = require('./mailer');

db.chats = db.chats || [];
const staffStreams = new Set(), visitorStreams = new Map(); // res objects
const MAX_MSG = 1000, MAX_PER_CHAT = 600, MAX_ATTACHMENTS = 4, MAX_FILE = 10 * 1024 * 1024, MAX_TOTAL_FILES = 30 * 1024 * 1024;
const MIME_EXT = { 'image/jpeg':'.jpg', 'image/png':'.png', 'image/webp':'.webp', 'image/gif':'.gif', 'image/heic':'.heic', 'image/heif':'.heif', 'application/pdf':'.pdf', 'text/plain':'.txt', 'application/msword':'.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx', 'application/vnd.ms-excel':'.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'.xlsx', 'text/csv':'.csv', 'audio/webm':'.webm', 'audio/ogg':'.ogg', 'audio/mp4':'.m4a', 'audio/mpeg':'.mp3', 'audio/wav':'.wav', 'audio/x-wav':'.wav', 'audio/aac':'.aac', 'video/mp4':'.mp4', 'video/webm':'.webm', 'application/vnd.ms-powerpoint':'.ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation':'.pptx', 'application/zip':'.zip', 'application/x-zip-compressed':'.zip', 'video/quicktime':'.mov' };
const iso = () => new Date().toISOString();
const tok = () => crypto.randomBytes(18).toString('base64url');
const safeEq = (a, b) => { try { return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; } };
const clean = (v, n) => str(v, n).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const online = () => staffStreams.size;
const find = id => db.chats.find(c => c.id === String(id));
const msgOut = m => ({ id: m.id, t: m.t, from: m.from, by: m.by, text: m.text, attachments: (m.attachments || []).map(a => ({ file: a.file, name: a.name, mime: a.mime, size: a.size, kind: a.kind })) });
const summary = c => { const last = c.messages[c.messages.length - 1] || {}, preview = str(last.text, 90) || ((last.attachments || []).length ? '📎 ' + (last.attachments.length === 1 ? last.attachments[0].name : last.attachments.length + ' attachments') : ''); return { id: c.id, name: c.name, email: c.email, phone: c.phone, page: c.page, status: c.status, createdAt: c.createdAt, updatedAt: c.updatedAt, unread: c.unreadStaff, count: c.messages.length, assignedTo: c.assignedTo || '', assignedName: c.assignedName || '', last: { text: preview, from: last.from, t: last.t } }; };
const emit = (set, ev, data) => { const line = 'event: ' + ev + '\ndata: ' + JSON.stringify(data) + '\n\n'; set.forEach(r => { try { r.write(line); } catch { set.delete(r); } }); };
const toVisitor = (c, ev, data) => { const s = visitorStreams.get(c.id); if (s) emit(s, ev, data); };
const toStaff = (ev, data) => emit(staffStreams, ev, data);
const unreadTotal = () => db.chats.reduce((a, c) => a + (c.status === 'open' ? c.unreadStaff : 0), 0);

function add(c, from, by, text, attachments = []) {
  const m = { id: c.messages.length ? c.messages[c.messages.length - 1].id + 1 : 1, t: iso(), from, by: by || '', text: text || '', attachments: attachments || [] };
  c.messages.push(m); if (c.messages.length > MAX_PER_CHAT) c.messages.splice(0, c.messages.length - MAX_PER_CHAT);
  c.updatedAt = m.t; return m;
}
function saveAttachments(chat, rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  if (rows.length > MAX_ATTACHMENTS) throw Object.assign(new Error('Attach up to ' + MAX_ATTACHMENTS + ' files per message.'), { status: 400 });
  const valid = []; let total = 0;
  for (const row of rows) {
    let mime = String(row && row.mime || '').split(';')[0].trim().toLowerCase();
    let ext = MIME_EXT[mime];
    if (!ext) { const guessed=String(row&&row.name||'').match(/\.([a-z0-9]{1,8})$/i); const e=guessed?guessed[1].toLowerCase():''; const byExt={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',heic:'image/heic',heif:'image/heif',pdf:'application/pdf',txt:'text/plain',csv:'text/csv',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',zip:'application/zip',webm:'audio/webm',ogg:'audio/ogg',mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',aac:'audio/aac',mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm'}; if(byExt[e]){mime=byExt[e];ext=MIME_EXT[mime];} }
    if (!ext) throw Object.assign(new Error('This file type is not supported: ' + (mime || 'unknown')), { status: 400 });
    const raw = String(row.data || ''), b64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
    if (!b64 || b64.length > Math.ceil(MAX_FILE * 1.4)) throw Object.assign(new Error('File is empty or too large (max 10 MB each).'), { status: 400 });
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length || buf.length > MAX_FILE) throw Object.assign(new Error('Each attachment must be 10 MB or smaller.'), { status: 400 });
    total += buf.length; if (total > MAX_TOTAL_FILES) throw Object.assign(new Error('The combined attachments must be 30 MB or smaller.'), { status: 400 });
    const sig = (...bytes) => bytes.every((v, i) => buf[i] === v);
    if (mime === 'image/jpeg' && !sig(0xff,0xd8,0xff)) throw Object.assign(new Error('Invalid JPEG image.'), { status: 400 });
    if (mime === 'image/png' && !sig(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a)) throw Object.assign(new Error('Invalid PNG image.'), { status: 400 });
    if (mime === 'image/gif' && !['GIF87a','GIF89a'].includes(buf.toString('ascii',0,6))) throw Object.assign(new Error('Invalid GIF image.'), { status: 400 });
    if (mime === 'image/webp' && !(buf.toString('ascii',0,4)==='RIFF' && buf.toString('ascii',8,12)==='WEBP')) throw Object.assign(new Error('Invalid WebP image.'), { status: 400 });
    if (mime === 'application/pdf' && buf.toString('ascii',0,5)!=='%PDF-') throw Object.assign(new Error('Invalid PDF file.'), { status: 400 });
    if (mime.startsWith('audio/')) {
      const ok = (mime === 'audio/webm' && (buf.toString('hex',0,4)==='1a45dfa3' || buf.toString('ascii',0,4)==='RIFF')) ||
        (mime === 'audio/ogg' && buf.toString('ascii',0,4)==='OggS') ||
        (['audio/mp4','audio/mpeg','audio/aac'].includes(mime) && (buf.toString('ascii',4,8)==='ftyp' || buf[0]===0xff || buf.toString('ascii',0,3)==='ID3')) ||
        ((mime==='audio/wav'||mime==='audio/x-wav') && buf.toString('ascii',0,4)==='RIFF' && buf.toString('ascii',8,12)==='WAVE');
      if (!ok) throw Object.assign(new Error('The audio recording format could not be verified. Please record again.'), { status: 400 });
    }
    const name = clean(row.name || 'Attachment' + ext, 120).replace(/[\\/\r\n]/g, '_') || 'Attachment' + ext;
    valid.push({ mime, ext, buf, name, kind: mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : 'file' });
  }
  /* Validate the complete message before writing any file, so a rejected later item cannot leave orphan uploads. */
  fs.mkdirSync(path.join(DATA, 'chats'), { recursive: true });
  const written = [];
  try {
    for (const item of valid) {
      const file = chat.id + '-' + crypto.randomBytes(12).toString('hex') + item.ext;
      const rel = 'chats/' + file;
      fs.writeFileSync(path.join(DATA, rel), item.buf, { flag: 'wx' }); F.put(rel, item.buf);
      written.push({ file, name: item.name, mime: item.mime, size: item.buf.length, kind: item.kind });
    }
  } catch (e) {
    for (const a of written) { try { fs.unlinkSync(path.join(DATA, 'chats', a.file)); } catch {} F.del('chats/' + a.file); }
    throw Object.assign(new Error('An attachment could not be saved. Please retry the message.'), { status: 500, cause: e });
  }
  return written;
}
function chatFileMeta(chat, file) {
  for (const m of (chat.messages || [])) for (const a of (m.attachments || [])) if (a.file === file) return a;
  return null;
}
function start(p, ip, ua) {
  const name = clean(p.name, 60), text = clean(p.message, MAX_MSG);
  if (name.length < 2) throw Object.assign(new Error('Please enter your name.'), { status: 400 });
  if (!text && !(Array.isArray(p.attachments) && p.attachments.length)) throw Object.assign(new Error('Please type a message or attach a file.'), { status: 400 });
  const email = clean(p.email, 120), phone = clean(p.phone, 30).replace(/[^\d+ ()-]/g, '');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw Object.assign(new Error('That email address does not look right.'), { status: 400 });
  const c = { id: 'c' + nid(), token: tok(), name, email, phone, page: clean(p.page, 200), ua: clean(ua, 160), ip: String(ip || '').slice(0, 45), status: 'open', createdAt: iso(), updatedAt: iso(), unreadStaff: 0, unreadVisitor: 0, messages: [] };
  /* Save and validate uploads before publishing the new conversation in the shared state. */
  const attachments = saveAttachments(c, p.attachments);
  const m = add(c, 'visitor', name, text, attachments); c.unreadStaff = 1;
  const sys = add(c, 'system', 'Team', online() ? 'Thanks ' + name.split(' ')[0] + '. A team member will reply here in a moment.' : 'Thanks ' + name.split(' ')[0] + '. Our team is offline right now. Leave your number or email and we will get back to you soon.');
  db.chats.push(c); announce(c, m, true); save(); return { id: c.id, token: c.token, messages: [m, sys].map(msgOut), online: online() > 0 };
}
function announce(c, m, isNew) {
  const s = summary(c);
  toStaff('message', { chat: s, message: msgOut(m), unreadTotal: unreadTotal() });
  if (isNew || c.unreadStaff === 1) X.push({ role: 'staff' }, isNew ? 'New live chat' : 'New chat message', c.name + ': ' + str(m.text || ((m.attachments || []).length + ' attachment(s)'), 120), '#/chat/' + c.id, 'chat', 'chat.view');
  if (isNew || (!online() && Date.now() - (c.lastMail || 0) > 6e5)) { c.lastMail = Date.now(); Mail.send('chat.new', { subject: (isNew ? 'New live chat from ' : 'New chat message from ') + c.name, text: c.name + (c.phone ? ' · ' + c.phone : '') + (c.email ? ' · ' + c.email : '') + (c.page ? '\nPage: ' + c.page : '') + '\n\n' + (m.text || '') + ((m.attachments || []).length ? '\nAttachments: ' + m.attachments.map(a => a.name).join(', ') : ''), link: '#/chat/' + c.id }); }
}
function visitorSend(c, text, rawAttachments) {
  text = clean(text, MAX_MSG); if (!text && !(Array.isArray(rawAttachments) && rawAttachments.length)) throw Object.assign(new Error('Type a message or attach a file.'), { status: 400 });
  if (c.status === 'closed') throw Object.assign(new Error('This chat was closed. Start a new one.'), { status: 409 });
  const attachments = saveAttachments(c, rawAttachments); const m = add(c, 'visitor', c.name, text, attachments); c.unreadStaff++; announce(c, m, false); save(); return msgOut(m);
}
function staffReply(u, c, text, rawAttachments) {
  text = clean(text, 2000); if (!text && !(Array.isArray(rawAttachments) && rawAttachments.length)) throw Object.assign(new Error('Type a reply or attach a file.'), { status: 400 });
  const attachments = saveAttachments(c, rawAttachments); const m = add(c, 'staff', u.name, text, attachments); c.unreadStaff = 0; c.unreadVisitor++; if (c.status === 'closed') c.status = 'open';
  if (!c.assignedTo) { c.assignedTo = u.id; c.assignedName = u.name; }
  toVisitor(c, 'message', { message: msgOut(m) }); toStaff('message', { chat: summary(c), message: msgOut(m), unreadTotal: unreadTotal() });
  if (c.email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email)) Mail.send('chat.reply', { to: c.email, subject: 'The Umrah Store has replied to your message', text: 'Assalam o Alaikum ' + c.name + ',\n\n' + u.name + ' from The Umrah Store has replied to your live chat. Please return to the same browser and device where you started the chat to continue the conversation.\n\nReply: ' + (m.text || ((m.attachments || []).length + ' attachment(s)')) + '\n\nThe Umrah Store' });
  save(); return msgOut(m);
}
function sweep() { const cut = Date.now() - 365 * 864e5, n = db.chats.length; db.chats = db.chats.filter(c => Date.parse(c.updatedAt) > cut); return n - db.chats.length; }

function sse(req, res, set, hello) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.statusCode = 200; res.write('retry: 4000\n\n'); set.add(res); if (hello) res.write('event: hello\ndata: ' + JSON.stringify(hello) + '\n\n');
  const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { clearInterval(beat); set.delete(res); } }, 20000);
  req.on('close', () => { clearInterval(beat); set.delete(res); if (set === staffStreams) toStaff('presence', { online: online() }); });
}

function mount(app, { auth, limit }) {
  const canView = (req, res, next) => (req.u && PM.can(req.u, 'chat.view') ? next() : res.status(req.u ? 403 : 401).json({ error: req.u ? 'You do not have permission to use live chat' : 'Login required' }));
  const canManage = (req, res, next) => (req.u && PM.can(req.u, 'chat.manage') ? next() : res.status(req.u ? 403 : 401).json({ error: 'You do not have permission to manage chats' }));
  const mine = (req, res) => { const c = find(req.params.id), t = String(req.query.token || (req.body && req.body.token) || ''); if (!c || !safeEq(c.token, t)) { res.status(404).json({ error: 'Chat not found' }); return null; } return c; };
  const wrap = f => (req, res) => { try { res.json(f(req, res) || { ok: true }); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };

  /* ---- visitors (no login) ---- */
  app.get('/api/chat/status', (req, res) => res.set('Cache-Control', 'no-store').json({ online: online() > 0 }));
  app.get('/api/chat-file/:file', async (req, res) => {
    const file = path.basename(String(req.params.file || ''));
    if (!/^c\d+-[a-f0-9]{24}\.(jpg|jpeg|png|webp|gif|heic|heif|pdf|txt|doc|docx|xls|xlsx|ppt|pptx|csv|zip|webm|ogg|m4a|mp3|wav|aac|mp4|mov)$/.test(file)) return res.sendStatus(404);
    const chat = find(req.query.chat); if (!chat) return res.sendStatus(404);
    const meta = chatFileMeta(chat, file); if (!meta) return res.sendStatus(404);
    const tokenValue = String(req.query.token || '');
    const visitorOK = safeEq(chat.token, tokenValue);
    const staffOK = req.u && PM.can(req.u, 'chat.view');
    if (!visitorOK && !staffOK) return res.sendStatus(404);
    let buf; const full = path.join(DATA, 'chats', file);
    try { buf = fs.readFileSync(full); } catch { try { buf = await F.get('chats/' + file); } catch { buf = null; } }
    if (!buf) return res.sendStatus(404);
    if (!fs.existsSync(full)) { fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, buf); }
    const inline = req.query.download !== '1' && (meta.kind === 'image' || meta.kind === 'audio' || meta.mime === 'application/pdf');
    res.set({ 'Content-Type': meta.mime, 'Content-Length': String(buf.length), 'Content-Disposition': (inline ? 'inline' : 'attachment') + '; filename="' + encodeURIComponent(meta.name).replace(/['()]/g, '') + '"', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(buf);
  });
  app.post('/api/chat/start', (req, res) => { if (!limit('chs:' + req.ip, 6, 36e5)) return res.status(429).json({ error: 'Too many chats started. Please call or WhatsApp us.' }); try { res.json(start(req.body || {}, req.ip, req.get('user-agent'))); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } });
  app.get('/api/chat/:id/messages', (req, res) => { const c = mine(req, res); if (!c) return; const after = +req.query.after || 0; c.unreadVisitor = 0; res.set('Cache-Control', 'no-store').json({ status: c.status, online: online() > 0, messages: c.messages.filter(m => m.id > after).map(msgOut) }); });
  app.post('/api/chat/:id/send', (req, res) => { const c = mine(req, res); if (!c) return; if (!limit('chm:' + c.id, 20, 6e4)) return res.status(429).json({ error: 'You are sending messages too fast.' }); try { res.json({ message: visitorSend(c, req.body.text, req.body.attachments) }); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } });
  app.get('/api/chat/:id/stream', (req, res) => { const c = mine(req, res); if (!c) return; if (!visitorStreams.has(c.id)) visitorStreams.set(c.id, new Set()); const s = visitorStreams.get(c.id); sse(req, res, s, { online: online() > 0 }); req.on('close', () => { if (!s.size) visitorStreams.delete(c.id); }); });

  /* ---- staff ---- */
  app.get('/api/chat-admin/stream', auth, canView, (req, res) => { sse(req, res, staffStreams, { online: online() + 1, unreadTotal: unreadTotal() }); toStaff('presence', { online: online() }); });
  app.get('/api/chat-admin/list', auth, canView, (req, res) => { const q = String(req.query.q || '').toLowerCase().trim(), st = req.query.status; res.set('Cache-Control', 'no-store').json({ unreadTotal: unreadTotal(), online: online(), items: db.chats.filter(c => (!st || c.status === st) && (!q || (c.name + ' ' + c.email + ' ' + c.phone + ' ' + c.messages.map(m => (m.text || '') + ' ' + (m.attachments || []).map(a => a.name).join(' ')).join(' ')).toLowerCase().includes(q))).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 200).map(summary) }); });
  app.get('/api/chat-admin/:id', auth, canView, (req, res) => { const c = find(req.params.id); if (!c) return res.status(404).json({ error: 'Chat not found' }); res.set('Cache-Control', 'no-store').json({ ...summary(c), ua: c.ua, messages: c.messages.map(msgOut) }); });
  app.post('/api/chat-admin/:id/reply', auth, canView, (req, res) => { const c = find(req.params.id); if (!c) return res.status(404).json({ error: 'Chat not found' }); try { res.json({ message: staffReply(req.u, c, req.body.text, req.body.attachments) }); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } });
  app.post('/api/chat-admin/:id/read', auth, canView, wrap(req => { const c = find(req.params.id); if (!c) throw Object.assign(new Error('Chat not found'), { status: 404 }); c.unreadStaff = 0; save(); toStaff('read', { id: c.id, unreadTotal: unreadTotal() }); }));
  app.post('/api/chat-admin/:id/close', auth, canView, wrap(req => { const c = find(req.params.id); if (!c) throw Object.assign(new Error('Chat not found'), { status: 404 }); c.status = 'closed'; add(c, 'system', 'Team', 'This chat was closed by ' + req.u.name + '. Start a new chat any time.'); toVisitor(c, 'closed', {}); toStaff('read', { id: c.id, unreadTotal: unreadTotal(), closed: true }); save(); }));
  app.post('/api/chat-admin/:id/reopen', auth, canView, wrap(req => { const c = find(req.params.id); if (!c) throw Object.assign(new Error('Chat not found'), { status: 404 }); c.status = 'open'; save(); }));
  app.post('/api/chat-admin/:id/assign', auth, canManage, wrap(req => { const c = find(req.params.id); if (!c) throw Object.assign(new Error('Chat not found'), { status: 404 }); c.assignedTo = req.u.id; c.assignedName = req.u.name; save(); }));
  app.delete('/api/chat-admin/:id', auth, canManage, wrap(req => { const c = find(req.params.id); if (!c) throw Object.assign(new Error('Chat not found'), { status: 404 }); db.chats = db.chats.filter(x => x !== c); (c.messages || []).forEach(m => (m.attachments || []).forEach(a => { try { fs.unlinkSync(path.join(DATA, 'chats', path.basename(a.file))); } catch {} F.del('chats/' + path.basename(a.file)); })); D.logAct(req.u, 'Chat deleted', c.name); save(); toStaff('read', { id: c.id, unreadTotal: unreadTotal(), closed: true }); }));
}
module.exports = { mount, sweep, online, unreadTotal, start, find, visitorSend, staffReply };
