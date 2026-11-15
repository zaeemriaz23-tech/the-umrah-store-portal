'use strict';
// Isolated state-level test for agent submission and administrator approval; never touches production data.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tus-approval-'));
process.env.DATA_DIR = tmp;
process.env.CRM_TEST_MODE = '1';
process.env.NODE_ENV = 'test';
for (const k of Object.keys(process.env)) if (/^(DB_|MYSQL_|DATABASE_URL$)/.test(k)) delete process.env[k];
const D = require('../lib/db');
const { OPS } = require('../lib/ops');
const { db } = D;
try {
  db.parties.push({ id: 1001, kind: 'agent', name: 'Test Agency', active: true, opening: 0, limit: 1000000 });
  const agent = { id: 'user-agent', role: 'agent', pid: 1001, name: 'Test Agent' };
  const created = OPS.saveBooking(agent, { category: 'Custom', pax: [{ n: 'Test Pilgrim', pp: 'AB1234567' }], services: [{ type: 'hotel', title: 'Makkah Hotel', sell: 1000, qty: 1, from: '2030-01-01', to: '2030-01-05' }] });
  const booking = db.bookings.find(x => x.id === created.id);
  assert(booking, 'new agent booking is stored');
  assert.equal(booking.status, 'Pending', 'agent bookings never self-approve');
  assert(booking.approvalRequestedAt && booking.approvalRequestedBy === agent.name, 'submission records requester and timestamp');
  assert(booking.history.some(x => x.a === 'Submitted for approval'), 'submission is part of the booking audit history');
  const admin = { id: 'admin', role: 'admin', name: 'Administrator' };
  OPS.setStatus(admin, { id: booking.id, status: 'Confirmed' });
  assert.equal(booking.status, 'Confirmed', 'administrator can approve');
  assert(booking.approvedAt && booking.approvedBy === admin.name, 'approval records approver and timestamp');
  assert(!booking.approvalRequestedAt && !booking.approvalRequestedBy, 'approved booking no longer carries pending metadata');
  assert(booking.history.some(x => x.a === 'Approved'), 'approval is recorded in the booking history');
  const directAdmin = OPS.saveBooking(admin, { confirm: true, partyId: 1001, category: 'Custom', pax: [{ n: 'Admin Pilgrim', pp: 'CD1234567' }], services: [{ type: 'visa', title: 'Umrah Visa', sell: 500 }] });
  const direct = db.bookings.find(x => x.id === directAdmin.id);
  assert.equal(direct.status, 'Confirmed', 'admin may explicitly confirm a booking at creation');
  assert(!direct.approvalRequestedAt && !direct.approvalRequestedBy, 'admin-confirmed booking does not retain stale pending metadata');
  assert(!direct.history.some(x => x.a === 'Submitted for approval'), 'admin-confirmed booking is not falsely shown as awaiting approval');
  console.log('PASS approval-submission-test: agent submissions are pending and auditable; admin approval is recorded cleanly');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
