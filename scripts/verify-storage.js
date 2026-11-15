#!/usr/bin/env node
'use strict';
/**
 * Read-only storage report. Never writes, never migrates.
 *   node scripts/verify-storage.js
 * Uses the same DB_* / DATA_DIR environment variables as the app (and a .env file if present).
 */
require('../lib/env');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const dir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const keys = ['users', 'parties', 'bookings', 'vouchers', 'payments', 'entries', 'expenses', 'queries', 'groups', 'hotels', 'tickets', 'notifs'];
const count = o => keys.map(k => '  ' + k.padEnd(10) + (Array.isArray(o[k]) ? o[k].length : 0)).join('\n');
const fail = m => { console.error('STORAGE CHECK FAILED: ' + m); process.exit(1); };
(async () => {
  const have = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'].filter(k => process.env[k]);
  if (have.length && have.length < 4) fail('MySQL configuration is incomplete (need DB_HOST, DB_NAME, DB_USER, DB_PASSWORD).');
  if (have.length === 4) {
    const mysql = require('mysql2/promise');
    const c = await mysql.createConnection({ host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, ssl: /^(1|true|yes)$/i.test(process.env.DB_SSL || '') ? {} : undefined }).catch(e => fail('cannot connect to MySQL: ' + e.message));
    try {
      const [tb] = await c.query("SELECT TABLE_NAME n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('crm_state','crm_state_backups','crm_files')");
      const names = tb.map(x => x.n);
      console.log('Driver:      MySQL (' + process.env.DB_NAME + ' @ ' + process.env.DB_HOST + ')');
      console.log('Tables:      ' + (names.join(', ') || 'none yet (the app creates them on first start)'));
      if (names.includes('crm_state')) {
        const [s] = await c.query('SELECT revision, updated_at, payload FROM crm_state WHERE id = 1');
        if (!s.length) console.log('crm_state:   EMPTY (the app will import db.json or recover from a restore point on start)');
        else { let o; try { o = JSON.parse(s[0].payload); } catch { fail('crm_state.payload is not valid JSON'); } console.log('crm_state:   revision ' + s[0].revision + ', updated ' + new Date(s[0].updated_at).toISOString() + ', app version ' + (o.appVersion || 'unversioned') + ', ' + s[0].payload.length + ' chars\nRecords:\n' + count(o)); }
      }
      if (names.includes('crm_state_backups')) {
        const [b] = await c.query('SELECT kind, COUNT(*) n, MAX(created_at) last FROM crm_state_backups GROUP BY kind');
        console.log('Restore points:' + (b.length ? '' : ' none')); b.forEach(x => console.log('  ' + String(x.kind).padEnd(14) + x.n + ' (latest ' + new Date(x.last).toISOString() + ')'));
      }
      if (names.includes('crm_files')) { const [f] = await c.query('SELECT COUNT(*) n, COALESCE(SUM(size_bytes),0) b FROM crm_files'); console.log('Uploaded files in MySQL: ' + f[0].n + ' (' + f[0].b + ' bytes)'); }
    } finally { await c.end(); }
  } else console.log('Driver:      JSON (MySQL variables are NOT set - data is only on this disk)');
  const file = path.join(dir, 'db.json');
  console.log('DATA_DIR:    ' + dir);
  if (fs.existsSync(file)) { try { const o = JSON.parse(fs.readFileSync(file, 'utf8')); console.log('Local db.json: valid, revision ' + (o.rev || '?') + ', ' + fs.statSync(file).size + ' bytes' + (have.length === 4 ? '' : '\nRecords:\n' + count(o))); } catch (e) { fail('local db.json is not valid JSON: ' + e.message); } }
  else console.log('Local db.json: not present');
  console.log('Result:      OK');
})().catch(e => fail(e.message));
