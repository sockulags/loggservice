jest.mock('../logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), fatal: jest.fn()
}));

const mockPgClient = {
  query: jest.fn(),
  release: jest.fn()
};

const mockPgPool = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn()
};

jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPgPool)
}));

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

describe('database', () => {
  let database;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env.DATABASE_URL = 'postgresql://user:secret@localhost:5432/testdb';
    mockPgPool.connect.mockResolvedValue(mockPgClient);
    mockPgPool.end.mockResolvedValue(undefined);
    mockPgClient.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.startsWith('SELECT id FROM tenants')) {
        return { rows: [{ id: TENANT_ID }] };
      }
      return { rows: [], rowCount: 0 };
    });

    database = require('../database');
    await database.initDatabase();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  test('initDatabase applies the versioned migrations including the append-only trigger', () => {
    expect(mockPgPool.connect).toHaveBeenCalled();
    const executed = mockPgClient.query.mock.calls.map(c => String(c[0]));
    expect(executed.some(s => s.includes('CREATE TABLE IF NOT EXISTS schema_migrations'))).toBe(true);
    const schemaSql = executed.find(s => s.includes('CREATE TABLE IF NOT EXISTS events'));
    expect(schemaSql).toBeTruthy();
    expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS checkpoints');
    expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(schemaSql).toContain('events are append-only');
    expect(schemaSql).toContain('BEFORE UPDATE OR DELETE ON events');
    expect(mockPgClient.release).toHaveBeenCalled();
  });

  test('initDatabase records each applied migration in schema_migrations', () => {
    const { loadMigrations } = require('../migrations');
    const shippedVersions = loadMigrations().map(m => m.version);
    const recorded = mockPgClient.query.mock.calls
      .filter(c => String(c[0]).startsWith('INSERT INTO schema_migrations') && !String(c[0]).includes('ON CONFLICT'))
      .map(c => c[1][0]);
    expect(recorded).toEqual(shippedVersions);
  });

  test('initDatabase baselines an already-bootstrapped database instead of re-running 001', async () => {
    jest.resetModules();
    jest.clearAllMocks();
    mockPgPool.connect.mockResolvedValue(mockPgClient);
    mockPgClient.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.startsWith('SELECT id FROM tenants')) {
        return { rows: [{ id: TENANT_ID }] };
      }
      if (s.includes('to_regclass')) {
        return { rows: [{ events_table: 'events' }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const freshDatabase = require('../database');
    await freshDatabase.initDatabase();

    const executed = mockPgClient.query.mock.calls.map(c => String(c[0]));
    // 001 (full schema) must not run again against an existing install...
    expect(executed.some(s => s.includes('CREATE TABLE IF NOT EXISTS events'))).toBe(false);
    // ...it is recorded as already applied instead,
    const baseline = mockPgClient.query.mock.calls.find(c => String(c[0]).includes('ON CONFLICT (version) DO NOTHING'));
    expect(baseline[1]).toEqual([1, 'initial']);
    // ...and later migrations still apply.
    expect(executed.some(s => s.includes('ADD COLUMN IF NOT EXISTS user_agent'))).toBe(true);
    // The append-only guard is re-asserted on every boot regardless of path.
    expect(executed.some(s => s.includes('BEFORE UPDATE OR DELETE ON events'))).toBe(true);
    expect(freshDatabase.getDefaultTenantId()).toBe(TENANT_ID);
  });

  test('initDatabase ensures the default tenant and exposes its id', () => {
    expect(database.getDefaultTenantId()).toBe(TENANT_ID);
    const insertCall = mockPgClient.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO tenants'));
    expect(insertCall).toBeTruthy();
    expect(String(insertCall[0])).toContain('ON CONFLICT (name) DO NOTHING');
  });

  test('initDatabase throws without DATABASE_URL', async () => {
    jest.resetModules();
    delete process.env.DATABASE_URL;
    const freshDatabase = require('../database');
    await expect(freshDatabase.initDatabase()).rejects.toThrow(/DATABASE_URL/);
  });

  test('getPool/getDefaultTenantId throw before initialization', () => {
    jest.resetModules();
    const freshDatabase = require('../database');
    expect(() => freshDatabase.getPool()).toThrow(/not initialized/);
    expect(() => freshDatabase.getDefaultTenantId()).toThrow(/not initialized/);
  });

  test('initDatabase rejects when the connection fails', async () => {
    jest.resetModules();
    mockPgPool.connect.mockRejectedValueOnce(new Error('connection refused'));
    const freshDatabase = require('../database');
    await expect(freshDatabase.initDatabase()).rejects.toThrow('connection refused');
  });

  test('closeDatabase ends the pool and resets state', async () => {
    await database.closeDatabase();
    expect(mockPgPool.end).toHaveBeenCalled();
    expect(() => database.getPool()).toThrow(/not initialized/);
  });
});
