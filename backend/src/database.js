const logger = require('./logger');
const { runMigrations } = require('./migrations');

// PostgreSQL is the only supported database.
const DATABASE_URL = process.env.DATABASE_URL;

let pool = null;
let defaultTenantId = null;

// Re-asserted on every boot (not only via migrations) so the database-level
// append-only guarantee self-heals even if someone with owner privileges
// dropped the trigger or replaced the function. Matches the pre-migration
// behavior, where this DDL ran at every startup.
const APPEND_ONLY_GUARD = `
CREATE OR REPLACE FUNCTION forbid_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_append_only ON events;
CREATE TRIGGER events_append_only
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION forbid_event_mutation();
`;

/**
 * Initialize the database: connect, run pending migrations, ensure the
 * default tenant. The schema lives in versioned .sql files under
 * backend/migrations/ and is applied by the runner in src/migrations.js.
 */
async function initDatabase() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required (PostgreSQL connection string)');
  }

  const { Pool } = require('pg');
  pool = new Pool({ connectionString: DATABASE_URL });

  try {
    const client = await pool.connect();
    logger.info({ url: DATABASE_URL.replace(/:[^:@]*@/, ':***@') }, 'Connected to PostgreSQL');
    try {
      // The runner logs each applied (or baselined) migration itself.
      await runMigrations(client);
      await client.query(APPEND_ONLY_GUARD);

      // Self-hosted MVP: one organization per installation. The tenants table
      // exists from day one so multi-tenant operation needs no migration.
      const tenantName = process.env.TENANT_NAME || 'default';
      const { randomUUID } = require('crypto');
      await client.query(
        `INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
        [randomUUID(), tenantName]
      );
      const res = await client.query('SELECT id FROM tenants WHERE name = $1', [tenantName]);
      defaultTenantId = res.rows[0].id;

      logger.info({ tenant: tenantName }, 'Schema initialized');
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, 'Failed to initialize PostgreSQL');
    throw err;
  }
}

function getPool() {
  if (!pool) {
    throw new Error('PostgreSQL pool is not initialized. Call initDatabase() first');
  }
  return pool;
}

function getDefaultTenantId() {
  if (!defaultTenantId) {
    throw new Error('Database is not initialized. Call initDatabase() first');
  }
  return defaultTenantId;
}

async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    defaultTenantId = null;
    logger.info('PostgreSQL connection pool closed');
  }
}

module.exports = {
  initDatabase,
  getPool,
  getDefaultTenantId,
  closeDatabase
};
