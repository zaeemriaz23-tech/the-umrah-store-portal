'use strict';
/* Tests banking, payment rules, public bank page and the OpenRouter assistant (against a local mock endpoint). Run: node scripts/bank-ai-test.js */
const { spawn } = require('child_process'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm2-')), PORT = 3800 + Math.floor(Math.random() * 90), B = 'http://127.0.0.1:' + PORT;
let pass = 0, failN = 0; const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { failN++; console.log('  FAIL', m); } };
/* mock OpenRouter: first call -> tool call, second -> final text */
let openrouterSeen = [];
const mock = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => {
  res.setHeader('content-type', 'application/json');
  if (req.url.startsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b', architecture: { input_modalities: ['text'], output_modalities: ['text'] } }, { id: 'google/gemini-2.5-flash', architecture: { input_modalities: ['text','image'], output_modalities: ['text'] } }] }));
  if (req.headers.authorization !== 'Bearer mock-openrouter-token') { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: 'bad key' } })); }
  const j = JSON.parse(b); openrouterSeen.push(j); const last = j.messages[j.messages.length - 1];
  if (last.role === 'user') return res.end(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [/add agent/i.test(last.content) ? { id: 'c1', type: 'function', function: { name: 'add_party', arguments: JSON.stringify({ kind: 'agent', name: 'Mock Travels' }) } } : { id: 'c1', type: 'function', function: { name: 'business_summary', arguments: '{}' } }] } }] }));
  res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Done: ' + String(last.content).slice(0, 60) } }] }));
}); });
class C { constructor() { this.c = ''; }
  async req(m, u, b) { const r = await fetch(B + u, { method: m, headers: { 'content-type': 'application/json', cookie: this.c }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) this.c = sc.split(';')[0]; const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { s: r.status, j }; }
  login(l, p) { return this.req('POST', '/api/login', { login: l, password: p }); } rpc(op, p) { return this.req('POST', '/api/rpc', { op, ...p }); } get(u) { return this.req('GET', u); } post(u, b) { return this.req('POST', u, b); } }
(async () => {
  await new Promise(r => mock.listen(0, r)); const mp = mock.address().port;
  const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, DATA_DIR: dir, ADMIN_PASSWORD: 'AdminPass#1', OPENROUTER_BASE_URL: 'http://127.0.0.1:' + mp }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => srv.stdout.on('data', d => /running/.test(String(d)) && r()));
  const A = new C(); await A.login('admin', 'AdminPass#1');
  console.log('Banking');
  const banks = [{ title: 'Umrah Store', bank: 'Meezan Bank', account: '0123456789', iban: 'pk36 meze 0000 0123 4567 89', theme: 'navy' }, { kind: 'wallet', title: 'Umrah Store', bank: 'JazzCash', wallet: '03001234567', theme: 'gold' }, { kind: 'raast', title: 'Umrah Store', bank: 'Raast', raast: '03001234567', public: false }, { title: 'Hidden', bank: 'Old Bank', account: '1', active: false }];
  ok((await A.rpc('saveSettings', { bank: banks })).s === 200, 'admin saves bank directory');
  const st = (await A.get('/api/state')).j; ok(st.settings.bank.length === 4 && st.settings.bank[0].iban === 'PK36MEZE0000012345678' + '9', 'IBAN normalised, 4 accounts stored');
  const pub = (await new C().get('/api/public/banks')).j; ok(pub.length === 2 && pub[0].bank === 'Meezan Bank' && !pub.some(b => b.bank === 'Old Bank' || b.bank === 'Raast'), 'public list hides inactive and non-public accounts');
  const page = (await new C().get('/bank-accounts')).j; ok(typeof page === 'string' && page.includes('Meezan Bank') && page.includes('JazzCash') && !page.includes('Old Bank'), 'anyone can open /bank-accounts (no login)');
  await A.rpc('saveSettings', { payments: { publicBankPage: false, minAmount: 1000, requireReceipt: true, requireRef: false, autoApproveUnder: 50000, agentCanRecord: true, methods: ['Bank transfer', 'Cash'], quickAmounts: [5000, 10000], instructions: 'Credited in 2 hours' } });
  ok((await new C().get('/api/public/banks')).j.length === 0, 'public page can be switched off');
  await A.rpc('saveSettings', { payments: { ...st.settings.payments, publicBankPage: true, minAmount: 1000, requireReceipt: true, autoApproveUnder: 50000, agentCanRecord: true, methods: ['Bank transfer', 'Cash'], quickAmounts: [5000], instructions: 'Credited in 2 hours' } });
  console.log('Agent payments');
  const ag = (await A.rpc('saveParty', { kind: 'agent', name: 'Al Noor', limit: 1e6, login: 'alnoor', password: 'AgentPass#1' })).j.id;
  const G = new C(); await G.login('alnoor', 'AgentPass#1'); const gs = (await G.get('/api/state')).j;
  ok(gs.bank.length === 3 && !gs.bank.some(b => b.bank === 'Old Bank'), 'agent sees active accounts only (cards list)');
  ok(gs.payRules && gs.payRules.minAmount === 1000 && gs.payRules.quickAmounts[0] === 5000 && !gs.settings, 'agent gets payment rules but no settings');
  const png = { name: 'r.png', data: 'data:image/png;base64,iVBORw0KGgo=' };
  ok((await G.rpc('addPayment', { amt: 500, file: png })).s === 400, 'below minimum rejected');
  ok((await G.rpc('addPayment', { amt: 5000 })).s === 400, 'receipt required when switched on');
  const bid = gs.bank[0].id;
  const small = await G.rpc('addPayment', { amt: 20000, bankId: bid, ref: 'TX1', file: png }); ok(small.s === 200 && small.j.status === 'Approved', 'receipt under auto-approve limit posts instantly');
  const big = await G.rpc('addPayment', { amt: 90000, bankId: bid, file: png }); ok(big.s === 200 && big.j.status === 'Pending', 'larger receipt waits for approval');
  const pays = (await G.get('/api/state')).j.payments; ok(pays.every(p => p.bankName === 'Meezan Bank' && p.method === 'Bank transfer'), 'payment stores the bank and derives method');
  ok((await G.rpc('addPayment', { amt: 20000, file: png, partyId: 999 })).s === 200 && (await G.get('/api/state')).j.payments.every(p => p.partyId == ag), 'agent cannot pay into someone else\'s account (partyId ignored)');
  ok([400, 403].includes((await G.rpc('saveSettings', { bank: [] })).s) && [400, 403].includes((await G.rpc('saveSettings', { payments: { minAmount: 1 } })).s) && (await A.get('/api/state')).j.settings.bank.length === 4 && (await A.get('/api/state')).j.settings.payments.minAmount === 1000, 'agent cannot change banking or payment rules');
  await A.rpc('saveSettings', { payments: { ...st.settings.payments, agentCanRecord: false } });
  ok((await G.rpc('addPayment', { amt: 5000, file: png })).s === 400, 'records can be switched off for agents');
  console.log('Settings');
  ok((await A.rpc('saveSettings', { security: { sessionDays: 3, minPassword: 10, loginMax: 5 } })).s === 200, 'security settings saved');
  ok((await A.rpc('saveParty', { kind: 'agent', name: 'Short Pw', login: 'shortpw', password: 'abc12345' })).s === 400, 'minimum password length enforced');
  const gst=(await A.get('/api/state')).j.settings;
  ok(gst.openrouter&&gst.openrouter.keyCount===0&&!gst.openrouter.envKey,'settings expose OpenRouter configuration without a saved key');
  console.log('Operations Copilot');
  const noKey=(await A.post('/api/ai',{q:'summary'})).j;
  ok(/Bookings/.test(noKey.reply)&&!noKey.ai,'without a key, simple read commands still work');
  const test=await A.post('/api/ai/test',{key:'mock-openrouter-token'});
  ok(test.s===200&&test.j.ok&&test.j.models.some(m=>m.id==='openai/gpt-oss-120b'),'admin can test an OpenRouter key and discover models');
  await A.rpc('saveSettings',{openrouter:{addKeys:['mock-openrouter-token'],model:'openai/gpt-oss-120b',visionModel:'google/gemini-2.5-flash',enabled:true,allowWrites:true,maxActions:5,temperature:.2,instructions:'Be brief'}});
  const cfg=(await A.get('/api/state')).j.settings.openrouter;
  ok(cfg.keyCount===1&&/^\\*+token$/.test(cfg.keys[0].masked),'OpenRouter key is masked in browser state');
  openrouterSeen=[];
  const r1=(await A.post('/api/ai',{q:'how are we doing',history:[{role:'user',content:'hi'}]})).j;
  ok(r1.ai&&/^Done/.test(r1.reply)&&openrouterSeen.length===2,'assistant answers using a read tool (2 OpenRouter round trips)');
  ok(openrouterSeen[0].tools.some(t=>t.function.name==='get_ledger')&&openrouterSeen[0].tools.some(t=>t.function.name==='add_party')&&openrouterSeen[0].messages[0].content.includes('Be brief'),'existing CRM tools and admin instructions reach OpenRouter');
  ok(!JSON.stringify(openrouterSeen).includes('AdminPass')&&!JSON.stringify(openrouterSeen).includes('mock-openrouter-token'),'passwords and API tokens are never sent in prompts');
  const r2=(await A.post('/api/ai',{q:'add agent Mock Travels'})).j;
  ok(r2.actions.length===1&&r2.actions[0].op==='add_party','write requests only create proposals');
  ok(!(await A.get('/api/state')).j.parties.some(p=>p.name==='Mock Travels'),'nothing changes before confirmation');
  const run=(await A.post('/api/ai/run',{actions:r2.actions})).j;
  ok(run.results[0].ok&&(await A.get('/api/state')).j.parties.some(p=>p.name==='Mock Travels'),'confirmation executes the change');
  ok((await G.post('/api/ai',{q:'x'})).s===403,'agents cannot use the assistant');
  ok((await A.post('/api/ai/run',{actions:[{op:'saveSettings',args:{}}]})).j.results[0].ok===false,'assistant cannot execute settings operations');
  await A.rpc('saveSettings',{openrouter:{allowWrites:false}});
  openrouterSeen=[];
  const r3=(await A.post('/api/ai',{q:'x'})).j;
  ok(openrouterSeen[0].tools.every(t=>!/^(add|remove)_/.test(t.function.name)),'read-only mode hides write tools');
  srv.kill('SIGTERM'); mock.close();
  console.log('\n' + pass + ' passed, ' + failN + ' failed'); process.exit(failN ? 1 : 0);
})();
