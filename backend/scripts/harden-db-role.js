#!/usr/bin/env node
/**
 * Defense in depth: create a restricted database role for the application.
 *
 * By default the app connects as the role that owns the schema, which means
 * anyone holding DATABASE_URL credentials could disable the append-only
 * trigger. This script creates a non-owner role that can run the app but
 * can never UPDATE/DELETE events or ALTER the table:
 *
 *   DATABASE_URL=postgresql://clomp:owner-pw@host/clomp \
 *     node scripts/harden-db-role.js --role clomp_app --password 'strong-pw'
 *
 * Then point the backend at the new role:
 *   DATABASE_URL=postgresql://clomp_app:strong-pw@host/clomp
 *
 * Keep the owning role for schema upgrades and retention pruning only.
 * Re-run this script after upgrading clomp (new tables need new grants).
 */

require('dotenv').config();
const { initDatabase, getPool, closeDatabase } = require('../src/database');

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

async function main() {
  const role = arg('role', 'clomp_app');
  const password = arg('password') || process.env.HARDENED_ROLE_PASSWORD;

  if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
    console.error('--role must be a plain lowercase identifier');
    process.exit(1);
  }
  if (!password || typeof password !== 'string' || password.length < 12) {
    console.error('Provide --password (min 12 chars) or HARDENED_ROLE_PASSWORD');
    process.exit(1);
  }

  await initDatabase(); // ensures the schema exists before granting
  const pool = getPool();
  try {
    const { rows } = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
    // Identifier is validated above; the password travels as a literal.
    const quotedPassword = password.replace(/'/g, "''");
    if (!rows.length) {
      await pool.query(`CREATE ROLE ${role} LOGIN PASSWORD '${quotedPassword}'`);
      console.log(`Created role ${role}`);
    } else {
      await pool.query(`ALTER ROLE ${role} LOGIN PASSWORD '${quotedPassword}'`);
      console.log(`Role ${role} already exists — password updated`);
    }

    const { rows: dbRows } = await pool.query('SELECT current_database() AS db');
    const db = dbRows[0].db;

    await pool.query(`GRANT CONNECT ON DATABASE ${db} TO ${role}`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    // Full CRUD on application tables…
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    // …but events are append-only even without the trigger:
    await pool.query(`REVOKE UPDATE, DELETE ON events FROM ${role}`);

    console.log(`\nGrants applied. The role can read/write everything the app needs,`);
    console.log(`but has no UPDATE/DELETE on events and cannot ALTER tables or disable triggers.`);
    console.log(`\nPoint the backend at:`);
    console.log(`  DATABASE_URL=postgresql://${role}:<password>@<host>:<port>/${db}`);
    console.log(`\nKeep the owning role for: schema upgrades (backend startup once per`);
    console.log(`upgrade), scripts/retention-prune.js and scripts/harden-db-role.js.`);
  } finally {
    await closeDatabase();
  }
}

main().catch(err => {
  console.error('Hardening failed:', err.message);
  process.exit(1);
});
