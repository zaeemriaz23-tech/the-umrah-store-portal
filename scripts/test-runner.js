'use strict';
// Run test servers in isolated mode so a developer's or production .env can never connect tests to live MySQL.
const { spawnSync } = require('child_process');
const path = require('path');
const tests = [
  'cloud-backup-test.js', 'airline-logo-test.js', 'approval-submission-test.js', 'travelport-contract-test.js', 'engine-check.js', 'currency-native-test.js', 'premium-ui-test.js', 'v12-operations-test.js', 'maintenance-access-test.js', 'admin-center-test.js', 'booking-voucher-test.js', 'voucher-branding-test.js', 'quotation-ui-test.js', 'quotation-chat-test.js', 'seatsync-test.js', 'supplier-sync-test.js', 'maintenance-test.js', 'white-label-test.js', 'rbac-test.js', 'bank-ai-test.js', 'extras-test.js',
  'payfast-test.js', 'grok-rotation-test.js', 'upgrade-safe-tests.js', 'ai-groups-test.js', 'live-test.js', 'mysql-store-test.js', 'mysql-live-test.js'
];
const env = { ...process.env, CRM_TEST_MODE: '1', NODE_ENV: 'test', ENV_FILE: '' };
for (const key of Object.keys(env)) if (/^(DB_|MYSQL_|DATABASE_URL$)/.test(key)) delete env[key];
for (const test of tests) {
  console.log(`\n========== ${test} ==========`);
  const r = spawnSync(process.execPath, [path.join(__dirname, test)], { stdio: 'inherit', env, timeout: 180000 });
  if (r.error) { console.error(r.error.message); process.exit(1); }
  if (r.status !== 0) { console.error(`\nFAILED: ${test} (exit ${r.status})`); process.exit(r.status || 1); }
}
console.log('\nALL CRM TESTS PASSED');
