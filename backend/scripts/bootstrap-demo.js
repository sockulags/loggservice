#!/usr/bin/env node
/**
 * DEMO MODE bootstrap — creates a demo admin with fixed, publicly documented
 * credentials and seeds ~6 months of demo data (scripts/seed-demo.js).
 *
 * Run by the `demo-bootstrap` one-shot service in docker-compose.demo.yml.
 * It is idempotent: rerunning resets the demo admin's password to the
 * documented value (revoking sessions) and skips seeding once the chain has
 * events. As a safety gate it refuses to touch a database that has events
 * but no demo admin — that is a real installation, not a demo.
 *
 * NEVER run this against a real installation. The credentials are public.
 *
 *   DATABASE_URL=postgresql://... node scripts/bootstrap-demo.js
 */

const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config();

const { upsertAdmin } = require('./create-admin');

const DEMO_EMAIL = (process.env.DEMO_ADMIN_EMAIL || 'demo@clomp.local').toLowerCase();
const DEMO_PASSWORD = process.env.DEMO_ADMIN_PASSWORD || 'clomp-demo';
const UI_PORT = process.env.DEMO_UI_PORT || '8080';
const API_PORT = process.env.DEMO_API_PORT || '3001';

const BANNER = `
=====================================================================
  DEMO MODE — NOT FOR PRODUCTION
  This instance uses fixed, publicly documented credentials.
  Anyone who can reach it can log in as admin.
=====================================================================
`;

async function main() {
  console.log(BANNER);

  const { initDatabase, getPool, getDefaultTenantId, closeDatabase } = require('../src/database');

  await initDatabase();
  const pool = getPool();
  const tenantId = getDefaultTenantId();

  const { rows } = await pool.query('SELECT COUNT(*) AS n FROM events WHERE tenant_id = $1', [tenantId]);
  const hasEvents = Number(rows[0].n) > 0;
  const demoUser = await pool.query('SELECT id FROM users WHERE email = $1', [DEMO_EMAIL]);

  // Safety gate: events but no demo admin means this database belongs to a
  // real installation. Refuse to plant public credentials in it.
  if (hasEvents && demoUser.rows.length === 0) {
    console.error(
      `Refusing to bootstrap: the database already has ${rows[0].n} events but no ${DEMO_EMAIL} user.\n` +
      'This looks like a real installation, not a demo. Aborting.'
    );
    process.exit(1);
  }

  // Demo admin. Idempotent: on rerun the password is reset to the documented
  // value, TOTP is disabled and existing sessions/recovery codes are revoked.
  const { created } = await upsertAdmin(DEMO_EMAIL, 'Demo Admin', DEMO_PASSWORD);
  console.log(created
    ? `Created demo admin ${DEMO_EMAIL}`
    : `Demo admin ${DEMO_EMAIL} already exists — password reset, sessions revoked.`);

  await closeDatabase();

  // Demo data. seed-demo.js refuses to touch a chain that already has events,
  // so only run it on a fresh database.
  if (hasEvents) {
    console.log(`Chain already has ${rows[0].n} events — skipping seed.`);
  } else {
    console.log('Seeding demo data (~6 months of activity, schedules, checkpoint)...\n');
    const result = spawnSync(process.execPath, [path.join(__dirname, 'seed-demo.js')], {
      stdio: 'inherit',
      env: process.env
    });
    if (result.status !== 0) {
      console.error('Demo seed failed.');
      process.exit(result.status || 1);
    }
  }

  console.log(`
Demo is ready.

  Web UI:   http://localhost:${UI_PORT}
  API:      http://localhost:${API_PORT}
  Login:    ${DEMO_EMAIL}
  Password: ${DEMO_PASSWORD}

Things to try: the Ledger tab (hash-chained events), Schedules (one control
is deliberately overdue), and Export (offline-verifiable JSONL + PDF report).
${BANNER}`);
}

main().catch(err => {
  console.error('Demo bootstrap failed:', err.message);
  process.exit(1);
});
