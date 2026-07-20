const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Default location of the numbered .sql migration files.
const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// Two-argument advisory lock (classid, objid). The two-int form lives in a
// separate key space from the single-bigint form used by the hash chain's
// per-tenant locks (pg_advisory_xact_lock(hashtext(tenant_id)) in
// services/chain.js), so no tenant id can ever collide with this key.
const MIGRATION_LOCK_CLASS = 727685;
const MIGRATION_LOCK_ID = 1;

// Up to 9 digits keeps the parsed version inside the int4 range of the
// schema_migrations.version column.
const FILENAME_PATTERN = /^(\d{1,9})_([A-Za-z0-9_-]+)\.sql$/;

/**
 * Read and validate the migration files in a directory.
 * Returns [{ version, name, filename, sql }] sorted by version; `sql` is a
 * lazy getter, so boots with nothing pending never read the file bodies.
 * Non-.sql files are ignored; malformed .sql names and duplicate version
 * numbers are hard errors so they cannot be silently skipped.
 */
function loadMigrations(dir = DEFAULT_MIGRATIONS_DIR) {
  const migrations = [];
  const seen = new Map();

  for (const filename of fs.readdirSync(dir)) {
    if (!filename.endsWith('.sql')) continue;
    const match = FILENAME_PATTERN.exec(filename);
    if (!match) {
      throw new Error(
        `Invalid migration filename "${filename}" — expected NNN_name.sql (e.g. 001_initial.sql, version up to 9 digits)`
      );
    }
    const version = parseInt(match[1], 10);
    if (seen.has(version)) {
      throw new Error(
        `Duplicate migration version ${version}: "${seen.get(version)}" and "${filename}"`
      );
    }
    seen.set(version, filename);
    const filePath = path.join(dir, filename);
    migrations.push({
      version,
      name: match[2],
      filename,
      get sql() {
        return fs.readFileSync(filePath, 'utf8');
      }
    });
  }

  migrations.sort((a, b) => a.version - b.version);
  return migrations;
}

/**
 * Apply pending migrations on the given pg client, in version order, each
 * inside its own transaction. Records applied versions in schema_migrations.
 *
 * Upgrade path for pre-migration installations: if schema_migrations is
 * empty but the events table already exists, the database was bootstrapped
 * by the old idempotent-DDL code. In that case migration 001 (the full
 * initial schema) is marked as applied without being re-run, and only later
 * migrations execute.
 *
 * Returns { applied: [filename...], baselined: boolean }.
 */
async function runMigrations(client, { dir = DEFAULT_MIGRATIONS_DIR } = {}) {
  const migrations = loadMigrations(dir);

  // Serialize migration runs across instances sharing the database. Taken
  // before any DDL so even the bookkeeping table is created by exactly one
  // instance at a time (CREATE TABLE IF NOT EXISTS is not concurrency-safe).
  await client.query('SELECT pg_advisory_lock($1, $2)', [MIGRATION_LOCK_CLASS, MIGRATION_LOCK_ID]);
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

    const appliedRes = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    const appliedVersions = new Set(appliedRes.rows.map((r) => Number(r.version)));

    let baselined = false;
    if (appliedVersions.size === 0 && migrations.length > 0) {
      // No migration history. Distinguish a fresh database from an existing
      // install that predates the migration framework. to_regclass resolves
      // via search_path, matching wherever the unqualified DDL created it.
      const probe = await client.query("SELECT to_regclass('events') AS events_table");
      const alreadyBootstrapped = Boolean(probe.rows[0] && probe.rows[0].events_table);
      if (alreadyBootstrapped) {
        const initial = migrations[0];
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
          [initial.version, initial.name]
        );
        appliedVersions.add(initial.version);
        baselined = true;
        logger.info(
          { migration: initial.filename },
          'Existing schema detected; baseline migration marked as applied without re-running'
        );
      }
    }

    const applied = [];
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [migration.version, migration.name]
        );
        await client.query('COMMIT');
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          // Keep the original migration error; the rollback failure (e.g. a
          // dropped connection) is secondary.
          logger.warn({ err: rollbackErr }, 'ROLLBACK after failed migration also failed');
        }
        err.message = `Migration ${migration.filename} failed: ${err.message}`;
        throw err;
      }
      applied.push(migration.filename);
      logger.info({ migration: migration.filename }, 'Migration applied');
    }

    return { applied, baselined };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1, $2)', [MIGRATION_LOCK_CLASS, MIGRATION_LOCK_ID]);
  }
}

module.exports = {
  runMigrations,
  loadMigrations,
  DEFAULT_MIGRATIONS_DIR,
  MIGRATION_LOCK_CLASS,
  MIGRATION_LOCK_ID
};
