'use strict';
/* Exercises multi-key xAI fallback without contacting the live API. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tus-grok-'));
process.env.CRM_TEST_MODE = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = dir;
process.env.XAI_API_KEYS = 'xai-key-one\nxai-key-two';
process.env.XAI_BASE_URL = 'https://mock.x.ai/v1';
const AI = require('../lib/assistant');
const calls = [];
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
(async () => {
  try {
    const cfg = AI.groqCfg();
    assert.strictEqual(cfg.provider, 'grok');
    assert.deepStrictEqual(cfg.keys, ['xai-key-one', 'xai-key-two']);
    global.fetch = async (url, options) => {
      calls.push({ url: String(url), key: options.headers.authorization, body: JSON.parse(options.body || '{}') });
      if (options.headers.authorization === 'Bearer xai-key-one') return json(429, { error: { message: 'rate limit reached' } });
      return json(200, { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'backup key worked' } }] });
    };
    const state = {};
    const out = await AI.groqChat(cfg, { temperature: 0.2, max_completion_tokens: 3000, messages: [{ role: 'user', content: 'test' }] }, state);
    assert.strictEqual(calls.length, 2, 'second API key is tried immediately after first key receives 429');
    assert.strictEqual(calls[1].key, 'Bearer xai-key-two');
    assert.strictEqual(calls[1].url, 'https://mock.x.ai/v1/chat/completions');
    assert.strictEqual(calls[1].body.max_tokens, 3000);
    assert.strictEqual(out.choices[0].message.content, 'backup key worked');
    assert.match(state.notice, /backup key 2/i);
    console.log('PASS grok-rotation-test: xAI key list, 429 failover, backup-key response and notice');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
