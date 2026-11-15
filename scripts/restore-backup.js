#!/usr/bin/env node
'use strict';
/**
 * Restore a MySQL restore point directly in the database (use when the app cannot start).
 *   node scripts/restore-backup.js list
 *   node scripts/restore-backup.js <id|latest> --yes
 * Safe by design: stop the app first; a 'pre-restore' copy of the current state is stored before anything is replaced,
 * the CURRENT admin password is kept, and nothing is deleted.
 */
require('../lib/env');
const need = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
if (need.some(k => !process.env[k])) { console.error('Set DB_HOST, DB_NAME, DB_USER and DB_PASSWORD first.'); process.exit(1); }
const [, , arg, flag] = process.argv;
if (!arg) { console.error('Usage: node scripts/restore-backup.js list | <id|latest> --yes'); process.exit(1); }
(async () => {
  const mysql = require('mysql2/promise');
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, ssl: /^(1|true|yes)$/i.test(process.env.DB_SSL || '') ? {} : undefined });
  try {
    if (arg === 'list') {
      const [r] = await c.query('SELECT id, kind, revision, size_bytes, created_at, note FROM crm_state_backups ORDER BY id DESC LIMIT 60');
      r.forEach(x => console.log(String(x.id).padStart(5), String(x.kind).padEnd(14), 'rev ' + String(x.revision).padEnd(8), new Date(x.created_at).toISOString(), (x.note || '')));
      return;
    }
    const [rows] = arg === 'latest' ? await c.query('SELECT * FROM crm_state_backups ORDER BY id DESC LIMIT 1') : await c.execute('SELECT * FROM crm_state_backups WHERE id = ?', [Number(arg) || 0]);
    if (!rows.length) throw new Error('restore point not found');
    const b = rows[0]; let next; try { next = JSON.parse(b.payload); } catch { throw new Error('that restore point is corrupt'); }
    console.log('Restore point #' + b.id + ' (' + b.kind + ', revision ' + b.revision + ', ' + new Date(b.created_at).toISOString() + ')');
    if (flag !== '--yes') { console.log('Dry run only. Stop the app, then re-run with --yes to restore.'); return; }
    await c.beginTransaction();
    const [cur] = await c.query('SELECT revision, payload FROM crm_state WHERE id = 1 FOR UPDATE');
    let rev = Number(b.revision);
    if (cur.length) {
      const old = JSON.parse(cur[0].payload); rev = Math.max(rev, Number(cur[0].revision));
      await c.execute("INSERT INTO crm_state_backups (revision, payload, kind, note, size_bytes) VALUES (?, ?, 'pre-restore', ?, ?)", [Number(cur[0].revision), cur[0].payload, 'before CLI restore of #' + b.id, Buffer.byteLength(cur[0].payload)]);
      const a = (old.users || []).find(u => u.id === 'admin'); if (a && Array.isArray(next.users)) { const i = next.users.findIndex(u => u.id === 'admin'); if (i >= 0) next.users[i] = { ...next.users[i], pw: a.pw, mustChange: a.mustChange }; else next.users.unshift(a); }
      next.sessions = old.sessions || {};
    }
    next.rev = rev + 1;
    const json = JSON.stringify(next);
    if (cur.length) await c.execute('UPDATE crm_state SET revision = ?, payload = ? WHERE id = 1', [next.rev, json]);
    else await c.execute('INSERT INTO crm_state (id, revision, payload) VALUES (1, ?, ?)', [next.rev, json]);
    await c.commit();
    console.log('Restored. New revision ' + next.rev + '. A copy of the previous state was saved as a pre-restore restore point. Start the app again.');
  } catch (e) { try { await c.rollback(); } catch {} console.error('FAILED: ' + e.message); process.exitCode = 1; } finally { await c.end(); }
})();
