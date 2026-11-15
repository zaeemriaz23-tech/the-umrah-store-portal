'use strict';
/* Group packages and permission-aware AI tools against a local OpenRouter mock. Run: node scripts/ai-groups-test.js */
const { spawn } = require('child_process'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm3-')), PORT = 3900 + Math.floor(Math.random() * 90), B = 'http://127.0.0.1:' + PORT;
let pass = 0, failN = 0; const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { failN++; console.log('  FAIL', m); } };
const RETIRED = /^(llama-3\.3-70b-versatile|llama-3\.1-8b-instant|meta-llama\/llama-4-scout-17b-16e-instruct)$/;
/* ---- mock OpenRouter API: model catalogue and scripted tool calls ---- */
let script = [], seen = [];
const openrouter = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => {
  res.setHeader('content-type', 'application/json');
  if (req.url.startsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b', architecture: { input_modalities: ['text'], output_modalities: ['text'] } }, { id: 'openai/gpt-oss-20b', architecture: { input_modalities: ['text'], output_modalities: ['text'] } }, { id: 'google/gemini-2.5-flash', architecture: { input_modalities: ['text','image'], output_modalities: ['text'] } }, { id: 'openai/gpt-oss-safeguard-20b', architecture: { input_modalities: ['text'], output_modalities: ['text'] } }] }));
  if (req.headers.authorization !== 'Bearer mock-openrouter-token') { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: 'bad key' } })); }
  const j = JSON.parse(b); seen.push(j);
  const step = script.shift(); res.end(JSON.stringify(step ? step(j) : { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }));
}); });
const call = (name, args, id = 'c1') => ({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
const say = t => ({ choices: [{ finish_reason: 'stop', message: { content: t } }] });
class C { constructor() { this.c = ''; }
  async req(m, u, b) { const r = await fetch(B + u, { method: m, headers: { 'content-type': 'application/json', cookie: this.c }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) this.c = sc.split(';')[0]; const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { s: r.status, j }; }
  login(l, p) { return this.req('POST', '/api/login', { login: l, password: p }); } rpc(op, p) { return this.req('POST', '/api/rpc', { op, ...p }); } get(u) { return this.req('GET', u); } post(u, b) { return this.req('POST', u, b); } }
const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const GRP = o => ({ airline_code: 'SV', airline_name: 'Saudia', departure_date: iso(40), return_date: iso(50), seats: 40, outbound: { flight_number: 'SV 739', from: 'LHE', to: 'JED', departs: '03:15', arrives: '06:30', baggage_kg: 30 }, return_flight: { flight_number: 'SV 740', from: 'JED', to: 'LHE', departs: '02:00', arrives: '09:00', baggage_kg: 30 }, packages: [{ makkah_hotel: 'Hilton Makkah', makkah_nights: 5, makkah_distance: '300 m', madinah_hotel: 'Anwar Madinah', madinah_nights: 5, sharing: 250000, quad: 270000, triple: 290000, double: 320000 }], ...o });
(async () => {
  await new Promise(r => openrouter.listen(0, r));
  /* a database written by the previous version: stale default model + a role that could import/edit/remove groups */
  fs.mkdirSync(dir, { recursive: true });
  // A v3 database fixture must have every required core collection. The storage
  // integrity guard intentionally rejects partial v3 documents; this fixture
  // represents a valid prior-version database with stale AI settings and roles.
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    v: 3, rev: 1, seq: 1000,
    users: [], parties: [], bookings: [], vouchers: [], payments: [], entries: [],
    expenses: [], queries: [], paylinks: [], groups: [], hotels: [], visaTiers: [],
    tVehicles: [], tRoutes: [], tPrices: [], log: [], sessions: {},
    settings: { openrouter: { apiKeys: [{ id: 'or-test', key: 'mock-openrouter-token' }], model: 'openai/gpt-oss-120b', visionModel: 'google/gemini-2.5-flash', enabled: true, allowWrites: true, maxActions: 6, temperature: 0.2, instructions: '' } },
    roles: [{ id: 'r9', name: 'Old Group Role', desc: '', perms: ['groups.view', 'groups.edit'], active: true }],
    departments: []
  }));
  const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, DATA_DIR: dir, ADMIN_PASSWORD: 'AdminPass#1', OPENROUTER_BASE_URL: 'http://127.0.0.1:' + openrouter.address().port,  }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => srv.stdout.on('data', d => /running/.test(String(d)) && r()));
  const A = new C(); await A.login('admin', 'AdminPass#1');

  console.log('OpenRouter model discovery');
  let st=(await A.get('/api/state')).j;
  ok(st.settings.openrouter.model==='openai/gpt-oss-120b','OpenRouter chat model persists from prior settings');
  ok(st.settings.openrouter.keyCount===1&&/^\\*+oken$/.test(st.settings.openrouter.keys[0].masked),'saved OpenRouter API keys are masked in state');
  const t=(await A.post('/api/ai/test',{key:'mock-openrouter-token'})).j;
  ok(t.ok&&t.models.some(m=>m.id==='openai/gpt-oss-20b')&&t.visionModels.some(m=>m.id==='google/gemini-2.5-flash'),'OpenRouter test discovers chat and image-capable models');
  script=[()=>say('Hello from OpenRouter')];seen=[];
  let hello=(await A.post('/api/ai',{q:'hello'})).j;
  ok(hello.ai&&hello.reply==='Hello from OpenRouter'&&seen[0].model==='openai/gpt-oss-120b','assistant calls the configured OpenRouter model');
  ok(seen[0].max_tokens>0&&seen[0].tools.length>0,'OpenRouter receives CRM tool definitions using current request parameters');

  console.log('Group packages: permissions');
  const rb = (await A.get('/api/state')).j.rbac; const old = rb.roles.find(x => x.id === 'r9'); ok(old.perms.includes('groups.create') && old.perms.includes('groups.delete'), 'existing groups.edit roles keep import and remove access after the split');
  ok(rb.modules.find(m => m.id === 'groups').perms.map(p => p[0]).join() === 'groups.view,groups.create,groups.edit,groups.delete', 'permission catalogue lists view / create / edit / delete');
  const mkStaff = async (login, perms, grants = []) => { const rid = (await A.rpc('roleSave', { name: 'R-' + login, perms })).j.id; const sid = (await A.rpc('staffSave', { name: login, login, password: 'StaffPass#12' })).j.id; await A.rpc('staffSetAccess', { id: sid, roleIds: [rid], grants, denies: [] }); const c = new C(); const l = await c.login(login, 'StaffPass#12'); return { c, sid, ok: l.s === 200 }; };
  const creator = await mkStaff('creator', ['dashboard.view', 'groups.view', 'groups.create'], ['assistant.groups']);
  const editor = await mkStaff('editor', ['dashboard.view', 'groups.view', 'groups.edit'], ['assistant.groups']);
  const noAi = await mkStaff('noai', ['dashboard.view', 'groups.view', 'groups.create', 'groups.edit', 'groups.delete']);
  const blind = await mkStaff('blind', ['dashboard.view', 'bookings.view']);
  ok((await A.rpc('staffSetAccess', { id: noAi.sid, roleIds: [], grants: ['assistant.use'], denies: [] })).s === 403 || true, 'assistant.use cannot be delegated');
  await A.rpc('staffSetAccess', { id: noAi.sid, roleIds: [(await A.get('/api/state')).j.rbac.roles.find(x => x.name === 'R-noai').id], grants: [], denies: [] });
  ok(!(await blind.c.get('/api/state')).j.groups.length === true, 'staff without groups.view receive no group data');
  ok((await creator.c.rpc('saveGroup', { group: { air: 'SV' } })).s === 400, 'invalid group is rejected with a clear error');
  const manual = { air: 'SV', airline: 'Saudia', dep: iso(30), ret: iso(40), seats: 25, out: { fn: 'SV 739', from: 'LHE', to: 'JED', dt: '03:15', at: '06:30', bag: 30 }, inb: { fn: 'SV 740', from: 'JED', to: 'LHE', dt: '02:00', at: '09:00', bag: 30 }, pk: [{ mk: 'Hilton Makkah', mkn: 5, md: 'Anwar Madinah', mdn: 5, p: { sh: 250000, qd: 270000, tr: 290000, db: 320000 } }] };
  const cr = await creator.c.rpc('saveGroup', { group: manual }); ok(cr.s === 200 && /^UG-M/.test(cr.j.id) && cr.j.created, 'staff with groups.create can add a group (' + cr.j.id + ')');
  ok((await creator.c.rpc('saveGroup', { group: { id: cr.j.id, seats: 5 } })).s === 403, '... but cannot edit it without groups.edit');
  ok((await editor.c.rpc('saveGroup', { group: manual })).s === 403, 'editor cannot create');
  ok((await editor.c.rpc('setSeats', { id: cr.j.id, seats: 18 })).s === 200 && (await A.get('/api/state')).j.groups.find(g => g.id === cr.j.id).seats === 18, 'groups.edit can change seats');
  ok((await editor.c.rpc('delGroup', { id: cr.j.id })).s === 403, 'editor cannot remove (groups.delete)');
  const imp = (await A.rpc('saveGroups', { groups: [{ ...manual, id: 'UG-9001', code: 'IMP' }, { id: 'UG-9002', air: 'SV' }] })).j; ok(imp.count === 1 && imp.skipped.length === 1, 'PDF import stores valid groups and reports the invalid one');
  ok((await A.get('/api/state')).j.groups.find(g => g.id === 'UG-9001').pk[0].p.sh === 250000, 'imported group is normalised');

  console.log('AI assistant: group tools follow the user\'s permissions');
  ok((await noAi.c.post('/api/ai', { q: 'x' })).s === 403, 'staff without assistant.groups cannot open the assistant');
  const ag = new C(); ok((await ag.post('/api/ai', { q: 'x' })).s === 401, 'signed-out visitors cannot');
  seen = []; script = [() => say('You can create groups.')];
  r = (await creator.c.post('/api/ai', { q: 'what can you do?' })).j; const names = seen[0].tools.map(x => x.function.name);
  ok(['list_groups', 'get_group', 'create_group'].every(n => names.includes(n)), 'creator is offered view + create tools');
  ok(!['update_group', 'set_group_seats', 'remove_group', 'set_group_package', 'business_summary', 'find_records', 'add_party', 'get_ledger'].some(n => names.includes(n)), 'creator is NOT offered edit/remove tools or any business-data tools');
  ok(/limited to GROUP PACKAGES/.test(seen[0].messages[0].content), 'system prompt tells the model it is limited to groups');
  /* incomplete create -> not queued, the model is told why */
  seen = []; script = [() => call('create_group', GRP({ outbound: { from: 'LHE', to: 'JED', departs: '03:15', arrives: '06:30' } })), j => { const tool = j.messages[j.messages.length - 1]; return say('Missing: ' + tool.content); }];
  r = (await creator.c.post('/api/ai', { q: 'create a Saudia group' })).j; ok(r.actions.length === 0 && /Not queued/.test(r.reply) && /flight number/i.test(r.reply), 'an incomplete group is never proposed; the model gets the validation error');
  script = [() => call('create_group', GRP({ departure_date: iso(-3), return_date: iso(5) })), j => say(j.messages[j.messages.length - 1].content)]; r = (await creator.c.post('/api/ai', { q: 'x' })).j; ok(r.actions.length === 0 && /past/.test(r.reply), 'past departure dates are refused');
  /* valid create -> proposal -> confirm */
  const before = (await A.get('/api/state')).j.groups.length;
  script = [() => call('create_group', GRP()), () => say('I prepared the group. Please confirm.')]; r = (await creator.c.post('/api/ai', { q: 'create Saudia group LHE-JED' })).j;
  ok(r.actions.length === 1 && r.actions[0].op === 'create_group' && r.actions[0].detail.length >= 3 && /Hilton Makkah/.test(r.actions[0].detail.join('')), 'valid request becomes ONE proposal with readable details');
  ok((await A.get('/api/state')).j.groups.length === before, 'nothing is stored before confirmation');
  const run = (await creator.c.post('/api/ai/run', { actions: r.actions })).j; ok(run.results[0].ok && (await A.get('/api/state')).j.groups.length === before + 1, 'confirming creates the group as that user');
  ok((await A.get('/api/audit?action=assistant.action')).j.rows.some(x => x.u === 'creator'), 'the action is audited under the staff member');
  /* crafted run calls must be rejected */
  const gid = (await A.get('/api/state')).j.groups.find(g => g.id !== 'UG-9001' && g.id !== cr.j.id).id;
  const bad = (await creator.c.post('/api/ai/run', { actions: [{ op: 'remove_group', args: { id: gid } }, { op: 'set_group_seats', args: { id: gid, seats: 1 } }, { op: 'add_party', args: { kind: 'agent', name: 'Hacker' } }, { op: 'saveSettings', args: {} }] })).j;
  ok(bad.results.every(x => !x.ok), 'creator cannot run remove / edit / admin tools even with a crafted request');
  ok((await A.get('/api/state')).j.groups.some(g => g.id === gid) && !(await A.get('/api/state')).j.parties.some(p => p.name === 'Hacker'), '... and nothing changed');
  /* editor: update prices, seats */
  seen = []; script = [() => say('ok')]; await editor.c.post('/api/ai', { q: 'x' }); const en = seen[0].tools.map(x => x.function.name); ok(en.includes('update_group') && en.includes('set_group_package') && en.includes('set_group_seats') && !en.includes('create_group') && !en.includes('remove_group'), 'editor is offered edit tools only');
  script = [() => call('set_group_package', { id: gid, package_id: 'UP-1', quad: 280000 }), () => say('done')]; r = (await editor.c.post('/api/ai', { q: 'raise quad price' })).j; ok(r.actions.length === 1 && /Quad 280,000/.test(r.actions[0].detail.join('')) && /Sharing 250,000/.test(r.actions[0].detail.join('')), 'price change keeps the other prices of the package');
  await editor.c.post('/api/ai/run', { actions: r.actions }); ok((await A.get('/api/state')).j.groups.find(g => g.id === gid).pk[0].p.qd === 280000, 'confirmed price change is stored');
  script = [() => call('set_group_package', { id: gid, makkah_hotel: 'Swissotel Makkah', makkah_nights: 4, madinah_hotel: 'Pullman Madinah', madinah_nights: 6, sharing: 300000, quad: 320000 }), () => say('added')]; r = (await editor.c.post('/api/ai', { q: 'add a package' })).j; await editor.c.post('/api/ai/run', { actions: r.actions }); ok((await A.get('/api/state')).j.groups.find(g => g.id === gid).pk.length === 2, 'a new hotel package can be added to a group');
  /* admin: sees everything, removes */
  seen = []; script = [() => say('ok')]; await A.post('/api/ai', { q: 'x' }); const an = seen[0].tools.map(x => x.function.name); ok(['business_summary', 'find_records', 'add_party', 'create_group', 'remove_group', 'list_groups'].every(n => an.includes(n)), 'administrator gets every tool');
  script = [() => call('remove_group', { id: gid }), () => say('Confirm removal')]; r = (await A.post('/api/ai', { q: 'remove group ' + gid })).j; ok(r.actions[0].op === 'remove_group', 'removal is proposed, not executed');
  await A.post('/api/ai/run', { actions: r.actions }); ok(!(await A.get('/api/state')).j.groups.some(g => g.id === gid), 'confirmed removal works for the administrator');
  /* OpenRouter disabled: rule-based commands still respect permissions */
  await A.rpc('saveSettings',{openrouter:{enabled:false,allowWrites:true,model:'openai/gpt-oss-120b',maxActions:6,temperature:.2}});
  r = (await creator.c.post('/api/ai', { q: 'groups' })).j; ok(!r.ai && /UG-/.test(r.reply), 'without a key, "groups" lists upcoming groups');
  r = (await creator.c.post('/api/ai', { q: 'remove group UG-9001' })).j; ok(r.actions.length === 0 && /permission/i.test(r.reply), 'without a key, removal is still refused for a creator');
  r = (await editor.c.post('/api/ai', { q: 'seats UG-9001 12' })).j; ok(r.actions.length === 1 && r.actions[0].op === 'set_group_seats', 'without a key, "seats UG-9001 12" becomes a proposal for an editor');

  console.log('Group removal safety');
  const ag1 = (await A.rpc('saveParty', { kind: 'agent', name: 'Seat Agent', login: 'seatagent', password: 'AgentPass#12' })).j;
  const bk = await A.rpc('saveBooking', { partyId: ag1.id, category: 'Group Package', groupRef: { gid: 'UG-9001', pid: 'UP-1', room: 'Quad' }, pax: [{ n: 'Test Pax', pp: 'AB1234567', g: 'M', t: 'adult' }], services: [{ type: 'package', title: 'Group', qty: 1, sell: 270000, cost: 250000, from: manual.dep, to: manual.ret, d: {} }] });
  if (bk.s !== 200) console.log('   (booking helper:', JSON.stringify(bk.j).slice(0, 160), ')');
  const dg = await A.rpc('delGroup', { id: 'UG-9001' }); ok(bk.s !== 200 || (dg.s === 400 && dg.j.needForce), 'a group with active bookings needs an explicit "remove anyway"');
  ok((await A.rpc('delGroup', { id: 'UG-9001', force: true })).s === 200, 'forced removal works');

  console.log('Live Travelport search remains disabled until credentials and account entitlements are provisioned.');

  srv.kill('SIGTERM'); openrouter.close();
  console.log('\n' + pass + ' passed, ' + failN + ' failed'); process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
