// Retention pruning against an in-memory fake of the pg pool, with a real
// archive file written to a temp directory.

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), fatal: jest.fn()
}));

let store; // { events: [], checkpoints: [] }
let alterCalls;

function tenantEvents(tenantId) {
  return store.events.filter(e => e.tenant_id === tenantId);
}

const mockClient = {
  query: jest.fn(async (sql, params) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.startsWith('ALTER TABLE events')) {
      alterCalls.push(sql);
      return { rows: [] };
    }
    if (sql.startsWith('DELETE FROM events')) {
      const [tenantId, pruneTo] = params;
      const before = store.events.length;
      store.events = store.events.filter(e => !(e.tenant_id === tenantId && e.sequence <= Number(pruneTo)));
      return { rowCount: before - store.events.length, rows: [] };
    }
    if (sql.startsWith('SELECT sequence, hash FROM events')) {
      const rows = tenantEvents(params[0]).sort((a, b) => b.sequence - a.sequence).slice(0, 1);
      return { rows };
    }
    if (sql.includes('INSERT INTO events')) {
      const [id, tenant_id, sequence, occurred_at, recorded_at, actor, action, target, context, evidence, prev_hash, hash] = params;
      store.events.push({
        id, tenant_id, sequence, occurred_at, recorded_at,
        actor: JSON.parse(actor), action,
        target: target === null ? null : JSON.parse(target),
        context: context === null ? null : JSON.parse(context),
        evidence: evidence === null ? null : JSON.parse(evidence),
        prev_hash, hash
      });
      return { rows: [] };
    }
    throw new Error(`Unexpected client SQL: ${sql}`);
  }),
  release: jest.fn()
};

const mockPool = {
  connect: jest.fn(async () => mockClient),
  query: jest.fn(async (sql, params) => {
    if (sql.includes('recorded_at < $2')) {
      const [tenantId, cutoff] = params;
      const old = tenantEvents(tenantId).filter(e => new Date(e.recorded_at) < new Date(cutoff));
      return { rows: [{ max: old.length ? Math.max(...old.map(e => e.sequence)) : null }] };
    }
    if (sql.includes('MAX(sequence)')) {
      const seqs = tenantEvents(params[0]).map(e => e.sequence);
      return { rows: [{ max: seqs.length ? Math.max(...seqs) : null }] };
    }
    if (sql.includes('FROM checkpoints') && sql.includes('sequence <= $2')) {
      const [tenantId, maxOld, tip] = params;
      const rows = store.checkpoints
        .filter(c => c.tenant_id === tenantId && c.sequence <= Number(maxOld) && c.sequence < Number(tip))
        .sort((a, b) => b.sequence - a.sequence)
        .slice(0, 1);
      return { rows };
    }
    if (sql.includes('FROM checkpoints')) {
      return { rows: store.checkpoints.filter(c => c.tenant_id === params[0]) };
    }
    if (sql.includes('COUNT(*)')) {
      const [tenantId, pruneTo] = params;
      const range = tenantEvents(tenantId).filter(e => e.sequence <= Number(pruneTo));
      return { rows: [{ n: String(range.length), min: range.length ? Math.min(...range.map(e => e.sequence)) : null }] };
    }
    if (sql.includes('sequence > $2')) {
      const [tenantId, cursor, to] = params;
      const rows = tenantEvents(tenantId)
        .filter(e => e.sequence > Number(cursor) && e.sequence <= Number(to))
        .sort((a, b) => a.sequence - b.sequence);
      const limit = parseInt(sql.match(/LIMIT (\d+)/)[1]);
      return { rows: rows.slice(0, limit) };
    }
    throw new Error(`Unexpected pool SQL: ${sql}`);
  })
};

jest.mock('../../database', () => ({
  getPool: () => mockPool
}));

const { appendEvent } = require('../../services/chain');
const { planPrune, executePrune } = require('../../services/retention');

const TENANT = 'aaaaaaaa-0000-0000-0000-000000000001';
let tmpDir;

describe('retention', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store = { events: [], checkpoints: [] };
    alterCalls = [];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clomp-retention-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function seedChain(count, recordedAt) {
    const events = [];
    for (let i = 0; i < count; i++) {
      const e = await appendEvent(TENANT, { actor: { type: 'user', id: 'u1' }, action: 'training.completed' });
      events.push(e);
    }
    if (recordedAt) {
      // Backdate for age-based pruning; recorded_at is not part of test hashes' validity here.
      for (const e of store.events) e.recorded_at = recordedAt;
    }
    return events;
  }

  test('planPrune returns null when nothing is old enough', async () => {
    await seedChain(3, '2026-07-13T00:00:00.000Z');
    const plan = await planPrune(TENANT, new Date('2026-01-01T00:00:00Z'));
    expect(plan).toBeNull();
  });

  test('planPrune returns null without a checkpoint to anchor at', async () => {
    await seedChain(3, '2025-01-01T00:00:00.000Z');
    const plan = await planPrune(TENANT, new Date('2026-01-01T00:00:00Z'));
    expect(plan).toBeNull();
  });

  test('planPrune cuts at the highest signed checkpoint below the cutoff', async () => {
    await seedChain(5, '2025-01-01T00:00:00.000Z');
    const e2 = store.events.find(e => e.sequence === 2);
    const e3 = store.events.find(e => e.sequence === 3);
    store.checkpoints.push(
      { tenant_id: TENANT, sequence: 2, hash: e2.hash, signed_at: '2025-01-02T02:00:00.000Z' },
      { tenant_id: TENANT, sequence: 3, hash: e3.hash, signed_at: '2025-01-03T02:00:00.000Z' }
    );

    const plan = await planPrune(TENANT, new Date('2026-01-01T00:00:00Z'));
    expect(plan).toMatchObject({ pruneFrom: 1, pruneTo: 3, count: 3, anchorHash: e3.hash });
  });

  test('planPrune never prunes the chain tip even if everything is old', async () => {
    await seedChain(3, '2025-01-01T00:00:00.000Z');
    const tip = store.events.find(e => e.sequence === 3);
    store.checkpoints.push({ tenant_id: TENANT, sequence: 3, hash: tip.hash, signed_at: '2025-01-04T02:00:00.000Z' });

    // Only checkpoint is at the tip → nothing to anchor a full prune at.
    const plan = await planPrune(TENANT, new Date('2026-01-01T00:00:00Z'));
    expect(plan).toBeNull();
  });

  test('executePrune archives, records the prune on the chain, then deletes', async () => {
    await seedChain(5, '2025-01-01T00:00:00.000Z');
    const e3 = store.events.find(e => e.sequence === 3);
    store.checkpoints.push({ tenant_id: TENANT, sequence: 3, hash: e3.hash, signed_at: '2025-01-03T02:00:00.000Z' });

    const plan = await planPrune(TENANT, new Date('2026-01-01T00:00:00Z'));
    const archivePath = path.join(tmpDir, 'archive.jsonl');
    const result = await executePrune(plan, { archivePath });

    // Pruned events are gone, the rest of the chain remains.
    const remaining = tenantEvents(TENANT).map(e => e.sequence).sort((a, b) => a - b);
    expect(remaining[0]).toBe(4);

    // The prune itself is on the chain with the archive hash.
    const pruneEvent = tenantEvents(TENANT).find(e => e.action === 'retention.pruned');
    expect(pruneEvent).toBeDefined();
    expect(pruneEvent.context.pruned_to_sequence).toBe(3);
    expect(pruneEvent.context.archive_sha256).toBe(result.archiveSha256);

    // Archive contains the pruned events and the checkpoints.
    const lines = fs.readFileSync(archivePath, 'utf8').trim().split('\n').map(JSON.parse);
    expect(lines.filter(l => l.type === 'event').map(l => l.sequence)).toEqual([1, 2, 3]);
    expect(lines.some(l => l.type === 'checkpoint' && l.sequence === 3)).toBe(true);

    // Trigger toggled exactly around the delete.
    expect(alterCalls).toEqual([
      'ALTER TABLE events DISABLE TRIGGER events_append_only',
      'ALTER TABLE events ENABLE TRIGGER events_append_only'
    ]);
    expect(result.deleted).toBe(3);
  });

  test('executePrune refuses to overwrite an existing archive file', async () => {
    await seedChain(3, '2025-01-01T00:00:00.000Z');
    const e2 = store.events.find(e => e.sequence === 2);
    store.checkpoints.push({ tenant_id: TENANT, sequence: 2, hash: e2.hash, signed_at: '2025-01-02T02:00:00.000Z' });

    const plan = await planPrune(TENANT, new Date('2026-01-01T00:00:00Z'));
    const archivePath = path.join(tmpDir, 'archive.jsonl');
    fs.writeFileSync(archivePath, 'existing');

    await expect(executePrune(plan, { archivePath })).rejects.toThrow();
    // Nothing was deleted.
    expect(tenantEvents(TENANT).filter(e => e.action === 'training.completed')).toHaveLength(3);
  });
});
