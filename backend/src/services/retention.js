const fs = require('fs');
const crypto = require('crypto');
const { getPool } = require('../database');
const { appendEvent, rowToEvent } = require('./chain');
const logger = require('../logger');

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(path)
      .on('data', chunk => h.update(chunk))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

/**
 * Retention pruning that preserves chain verifiability.
 *
 * Events are append-only at the database level, so pruning is a deliberate,
 * privileged operation — never an API. The rules that keep the remaining
 * chain provable:
 *
 * 1. Pruning only ever cuts at a SIGNED CHECKPOINT: the prune point P is the
 *    highest checkpointed sequence whose events are older than the cutoff.
 *    After the prune, the first retained event (P+1) carries prev_hash =
 *    hash(P), and the checkpoint attests (P, hash(P)) with an Ed25519
 *    signature — verifyChain anchors there instead of at genesis.
 * 2. The pruned range is archived to JSONL first (same format as the export,
 *    offline-verifiable with scripts/verify-export.js).
 * 3. A `retention.pruned` event is appended to the chain BEFORE deleting,
 *    recording the range, count, cutoff and the archive file's SHA-256. The
 *    prune itself is forever part of the history.
 * 4. The append-only trigger is disabled only inside the delete transaction.
 */

/**
 * Decide what a prune would remove for one tenant.
 * Returns null when there is nothing prunable (no old events, or no
 * checkpoint at or below the age cutoff to anchor the remaining chain).
 */
async function planPrune(tenantId, cutoff) {
  const pool = getPool();

  const { rows: oldRows } = await pool.query(
    `SELECT MAX(sequence) AS max FROM events
     WHERE tenant_id = $1 AND recorded_at < $2`,
    [tenantId, cutoff.toISOString()]
  );
  const maxOld = oldRows[0].max !== null ? Number(oldRows[0].max) : null;
  if (maxOld === null) return null;

  // The prune point must be a checkpointed sequence ≤ the age cutoff, and we
  // must retain at least the tip: never prune the entire chain.
  const { rows: tipRows } = await pool.query(
    'SELECT MAX(sequence) AS max FROM events WHERE tenant_id = $1',
    [tenantId]
  );
  const tip = Number(tipRows[0].max);

  const { rows: cpRows } = await pool.query(
    `SELECT sequence, hash FROM checkpoints
     WHERE tenant_id = $1 AND sequence <= $2 AND sequence < $3
     ORDER BY sequence DESC LIMIT 1`,
    [tenantId, maxOld, tip]
  );
  if (!cpRows.length) return null;

  const pruneTo = Number(cpRows[0].sequence);
  const { rows: countRows } = await pool.query(
    'SELECT COUNT(*) AS n, MIN(sequence) AS min FROM events WHERE tenant_id = $1 AND sequence <= $2',
    [tenantId, pruneTo]
  );
  const count = Number(countRows[0].n);
  if (count === 0) return null;

  return {
    tenantId,
    pruneFrom: Number(countRows[0].min),
    pruneTo,
    count,
    anchorHash: cpRows[0].hash,
    cutoff: cutoff.toISOString()
  };
}

/** Write the to-be-pruned range (plus all checkpoints) to a JSONL archive. */
async function archiveRange(plan, archivePath) {
  const pool = getPool();
  // 'wx' so an existing archive is never silently overwritten; opening via
  // promises surfaces EEXIST as a rejection instead of a stream error event.
  const handle = await fs.promises.open(archivePath, 'wx');
  const out = handle.createWriteStream();

  const BATCH = 1000;
  let cursor = plan.pruneFrom - 1;
  for (;;) {
    const { rows } = await pool.query(
      `SELECT * FROM events WHERE tenant_id = $1 AND sequence > $2 AND sequence <= $3
       ORDER BY sequence ASC LIMIT ${BATCH}`,
      [plan.tenantId, cursor, plan.pruneTo]
    );
    if (!rows.length) break;
    for (const row of rows) {
      out.write(JSON.stringify({ type: 'event', ...rowToEvent(row) }) + '\n');
      cursor = Number(row.sequence);
    }
    if (rows.length < BATCH) break;
  }

  const { rows: cps } = await pool.query(
    `SELECT tenant_id, sequence, hash, signature, public_key, signed_at
     FROM checkpoints WHERE tenant_id = $1 ORDER BY signed_at ASC`,
    [plan.tenantId]
  );
  for (const cp of cps) {
    out.write(JSON.stringify({
      type: 'checkpoint',
      tenant_id: cp.tenant_id,
      sequence: Number(cp.sequence),
      hash: cp.hash,
      signature: cp.signature,
      public_key: cp.public_key,
      signed_at: new Date(cp.signed_at).toISOString()
    }) + '\n');
  }

  await new Promise((resolve, reject) => {
    out.end(err => (err ? reject(err) : resolve()));
  });
  return sha256File(archivePath);
}

/**
 * Execute a prune plan: archive, record the prune on the chain, then delete
 * inside a transaction with the append-only trigger disabled.
 * Requires a connection role that owns the events table (ALTER TABLE).
 */
async function executePrune(plan, { archivePath, actor }) {
  const archiveSha256 = await archiveRange(plan, archivePath);

  // On the chain before anything disappears: the prune is itself history.
  await appendEvent(plan.tenantId, {
    actor: actor || { type: 'system', id: 'retention' },
    action: 'retention.pruned',
    target: { type: 'chain', id: plan.tenantId },
    context: {
      pruned_from_sequence: plan.pruneFrom,
      pruned_to_sequence: plan.pruneTo,
      pruned_count: plan.count,
      cutoff: plan.cutoff,
      anchor_checkpoint_sequence: plan.pruneTo,
      archive_sha256: archiveSha256
    }
  });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE events DISABLE TRIGGER events_append_only');
    const { rowCount } = await client.query(
      'DELETE FROM events WHERE tenant_id = $1 AND sequence <= $2',
      [plan.tenantId, plan.pruneTo]
    );
    await client.query('ALTER TABLE events ENABLE TRIGGER events_append_only');
    await client.query('COMMIT');
    logger.info({ tenantId: plan.tenantId, pruneTo: plan.pruneTo, deleted: rowCount }, 'Retention prune complete');
    return { deleted: rowCount, archiveSha256 };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { planPrune, archiveRange, executePrune };
