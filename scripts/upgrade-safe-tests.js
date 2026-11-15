'use strict';
/* Regression tests for manual receipt editing, payment permission, and durable chat attachments. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tus-upgrade-'));
process.env.CRM_TEST_MODE = '1'; process.env.NODE_ENV = 'test'; process.env.DATA_DIR = dir;
const D = require('../lib/db'), { db } = D;
const { OPS } = require('../lib/ops');
const PM = require('../lib/perms');
const Chat = require('../lib/chat');
const admin = { id: 'admin', role: 'admin', name: 'Test Admin' };
(async () => {
  try {
    db.parties.push({ id: 71, kind: 'agent', name: 'Test Agent', active: true });
    db.settings.calc.pkrPerSar = 280;
    db.payments.push({ id: 'PY-TEST1', partyId: 71, amt: 2750, currency: 'SAR', currencyAmount: 10, currencyFxRate: 275, via: 'manual', status: 'Approved', date: '2026-11-15', method: 'Cash', note: '', ref: '', bookingId: '' });
    const p = OPS.updatePayment(admin, { id: 'PY-TEST1', currency: 'SAR', amount: '12.50', date: '2026-11-15', method: 'Bank transfer', ref: 'EDIT-1', bookingId: '', note: 'corrected' });
    const row = db.payments.find(x => x.id === 'PY-TEST1');
    assert.strictEqual(p.amount, 3438, 'SAR edits preserve the original FX snapshot');
    assert.strictEqual(row.currencyFxRate, 275);
    assert.strictEqual(row.edits.length, 1, 'payment edit stores previous values');
    assert.strictEqual(row.ref, 'EDIT-1');
    db.payments.push({ id: 'PY-LOCK', partyId: 71, amt: 100, currency: 'PKR', currencyAmount: 100, via: 'payfast', status: 'Approved', date: '2026-11-15', method: 'Online', note: '' });
    assert.throws(() => OPS.updatePayment(admin, { id: 'PY-LOCK', currency: 'PKR', amount: 100 }), /Only manually recorded/);
    assert.strictEqual(PM.CATALOG['payments.edit'].adminOnly, false);

    assert.throws(() => Chat.start({ name: 'Invalid visitor', message: '', attachments: [{ name: 'bad.exe', mime: 'application/octet-stream', data: 'AAAA' }] }, '127.0.0.1', 'test-agent'), /not supported/);
    assert.strictEqual(db.chats.length, 0, 'invalid attachments must not leave an orphan conversation');
    const started = Chat.start({ name: 'Visitor Test', message: 'Hello support' }, '127.0.0.1', 'test-agent');
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    const message = Chat.find(started.id);
    const sent = Chat.visitorSend(message, 'Please see this image', [{ name: 'test.png', mime: 'image/png', data: 'data:image/png;base64,' + png }]);
    assert.strictEqual(sent.attachments.length, 1);
    const file = sent.attachments[0].file;
    assert.ok(fs.existsSync(path.join(dir, 'chats', file)), 'chat uploads are written to durable chat storage');
    assert.strictEqual(sent.attachments[0].kind, 'image');
    const staff = { id: 'staff-test', role: 'staff', name: 'Test Staff', grants: ['chat.view'] };
    const voice = Buffer.from('1a45dfa3', 'hex').toString('base64');
    const staffReply = Chat.staffReply(staff, message, '', [{ name: 'voice.webm', mime: 'audio/webm', data: 'data:audio/webm;base64,' + voice }]);
    assert.strictEqual(staffReply.attachments[0].kind, 'audio', 'staff can send voice attachments too');
    assert.ok(fs.existsSync(path.join(dir, 'chats', staffReply.attachments[0].file)));
    assert.throws(() => Chat.visitorSend(message, '', [{ name: 'bad.exe', mime: 'application/octet-stream', data: 'AAAA' }]), /not supported/);
    assert.strictEqual(db.chats.length, 1, 'chat messages remain in the persistent state collection');
    console.log('PASS upgrade-safe-tests: manual payment audit, locked gateway payment, editable permission, visitor/staff attachment storage, orphan-chat prevention and safe MIME validation');
  } finally { try { await D.flushAsync(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
})().catch(e => { console.error(e); process.exitCode = 1; });
