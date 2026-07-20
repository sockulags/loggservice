jest.mock('../logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), fatal: jest.fn()
}));

const fs = require('fs');
const os = require('os');
const path = require('path');

const { runMigrations, loadMigrations, DEFAULT_MIGRATIONS_DIR } = require('../migrations');

function makeFixtureDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clomp-migrations-'));
  for (const [name, sql] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), sql);
  }
  return dir;
}

function makeClient({ appliedRows = [], eventsTableExists = false, failOn = null } = {}) {
  return {
    query: jest.fn(async (sql) => {
      const s = String(sql);
      if (failOn && s.includes(failOn)) {
        throw new Error('syntax error near boom');
      }
      if (s.startsWith('SELECT version FROM schema_migrations')) {
        return { rows: appliedRows };
      }
      if (s.includes('to_regclass')) {
        return { rows: [{ events_table: eventsTableExists ? 'events' : null }] };
      }
      return { rows: [], rowCount: 0 };
    })
  };
}

function executedSql(client) {
  return client.query.mock.calls.map((c) => String(c[0]));
}

const FIXTURES = {
  '001_initial.sql': 'CREATE TABLE IF NOT EXISTS events (id UUID PRIMARY KEY);',
  '002_add_widgets.sql': 'CREATE TABLE IF NOT EXISTS widgets (id UUID PRIMARY KEY);'
};

describe('loadMigrations', () => {
  test('returns migrations sorted by version with parsed names', () => {
    const dir = makeFixtureDir({
      '002_add_widgets.sql': 'B',
      '001_initial.sql': 'A',
      'notes.txt': 'ignored'
    });
    const migrations = loadMigrations(dir);
    expect(migrations.map((m) => m.version)).toEqual([1, 2]);
    expect(migrations.map((m) => m.name)).toEqual(['initial', 'add_widgets']);
    expect(migrations.map((m) => m.sql)).toEqual(['A', 'B']);
  });

  test('rejects malformed migration filenames', () => {
    const dir = makeFixtureDir({ 'initial.sql': 'A' });
    expect(() => loadMigrations(dir)).toThrow(/Invalid migration filename/);
  });

  test('rejects duplicate version numbers', () => {
    const dir = makeFixtureDir({ '001_a.sql': 'A', '01_b.sql': 'B' });
    expect(() => loadMigrations(dir)).toThrow(/Duplicate migration version 1/);
  });

  test('rejects version numbers that overflow the int4 version column', () => {
    const dir = makeFixtureDir({ '99999999999_too_big.sql': 'A' });
    expect(() => loadMigrations(dir)).toThrow(/Invalid migration filename/);
  });

  test('the shipped migrations directory is valid and starts at 001_initial', () => {
    const migrations = loadMigrations(DEFAULT_MIGRATIONS_DIR);
    expect(migrations.length).toBeGreaterThanOrEqual(1);
    expect(migrations[0].version).toBe(1);
    expect(migrations[0].name).toBe('initial');
    expect(migrations[0].sql).toContain('CREATE TABLE IF NOT EXISTS events');
    expect(migrations[0].sql).toContain('events are append-only');
  });
});

describe('runMigrations', () => {
  test('fresh database: applies all migrations in order, each in a transaction', async () => {
    const dir = makeFixtureDir(FIXTURES);
    const client = makeClient();

    const result = await runMigrations(client, { dir });

    expect(result.baselined).toBe(false);
    expect(result.applied).toEqual(['001_initial.sql', '002_add_widgets.sql']);

    const sql = executedSql(client);
    const seq = sql.filter((s) =>
      s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK' ||
      s.includes('events') || s.includes('widgets')
    );
    expect(seq).toEqual([
      "SELECT to_regclass('events') AS events_table",
      'BEGIN',
      FIXTURES['001_initial.sql'],
      'COMMIT',
      'BEGIN',
      FIXTURES['002_add_widgets.sql'],
      'COMMIT'
    ]);

    const inserts = client.query.mock.calls
      .filter((c) => String(c[0]).startsWith('INSERT INTO schema_migrations') && !String(c[0]).includes('ON CONFLICT'))
      .map((c) => c[1]);
    expect(inserts).toEqual([[1, 'initial'], [2, 'add_widgets']]);
  });

  test('takes the advisory lock before any DDL and releases it last', async () => {
    const dir = makeFixtureDir(FIXTURES);
    const client = makeClient();
    await runMigrations(client, { dir });

    const sql = executedSql(client);
    expect(sql[0]).toBe('SELECT pg_advisory_lock($1, $2)');
    expect(sql[1]).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
    expect(sql[sql.length - 1]).toBe('SELECT pg_advisory_unlock($1, $2)');
    // Two-argument form: separate key space from the per-tenant chain locks.
    expect(client.query.mock.calls[0][1]).toEqual([727685, 1]);
  });

  test('existing install: baselines 001 without re-running it, still applies later migrations', async () => {
    const dir = makeFixtureDir(FIXTURES);
    const client = makeClient({ eventsTableExists: true });

    const result = await runMigrations(client, { dir });

    expect(result.baselined).toBe(true);
    expect(result.applied).toEqual(['002_add_widgets.sql']);

    const sql = executedSql(client);
    expect(sql).not.toContain(FIXTURES['001_initial.sql']);
    expect(sql).toContain(FIXTURES['002_add_widgets.sql']);

    const baseline = client.query.mock.calls.find((c) => String(c[0]).includes('ON CONFLICT (version) DO NOTHING'));
    expect(baseline).toBeTruthy();
    expect(baseline[1]).toEqual([1, 'initial']);
  });

  test('fully migrated database: no-op, no transactions started', async () => {
    const dir = makeFixtureDir(FIXTURES);
    const client = makeClient({ appliedRows: [{ version: 1 }, { version: 2 }] });

    const result = await runMigrations(client, { dir });

    expect(result).toEqual({ applied: [], baselined: false });
    const sql = executedSql(client);
    expect(sql).not.toContain('BEGIN');
    expect(sql.some((s) => s.includes('to_regclass'))).toBe(false);
  });

  test('partially migrated database: applies only pending migrations, skips baseline probe', async () => {
    const dir = makeFixtureDir(FIXTURES);
    const client = makeClient({ appliedRows: [{ version: 1 }] });

    const result = await runMigrations(client, { dir });

    expect(result.applied).toEqual(['002_add_widgets.sql']);
    const sql = executedSql(client);
    expect(sql).not.toContain(FIXTURES['001_initial.sql']);
    expect(sql.some((s) => s.includes('to_regclass'))).toBe(false);
  });

  test('a failing ROLLBACK does not mask the original migration error', async () => {
    const dir = makeFixtureDir(FIXTURES);
    const client = makeClient({ failOn: 'widgets' });
    const inner = client.query.getMockImplementation();
    client.query.mockImplementation(async (sql) => {
      if (String(sql) === 'ROLLBACK') throw new Error('connection terminated');
      return inner(sql);
    });

    await expect(runMigrations(client, { dir })).rejects.toThrow(
      /Migration 002_add_widgets\.sql failed: syntax error near boom/
    );
  });

  test('failed migration: rolls back, releases the lock, and reports the file', async () => {
    const dir = makeFixtureDir(FIXTURES);
    const client = makeClient({ failOn: 'widgets' });

    await expect(runMigrations(client, { dir })).rejects.toThrow(
      /Migration 002_add_widgets\.sql failed: syntax error near boom/
    );

    const sql = executedSql(client);
    expect(sql).toContain('ROLLBACK');
    expect(sql[sql.length - 1]).toBe('SELECT pg_advisory_unlock($1, $2)');
    // 001 committed before the failure; its record insert went through.
    const inserts = client.query.mock.calls
      .filter((c) => String(c[0]).startsWith('INSERT INTO schema_migrations') && !String(c[0]).includes('ON CONFLICT'))
      .map((c) => c[1]);
    expect(inserts).toEqual([[1, 'initial']]);
  });
});
