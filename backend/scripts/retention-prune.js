#!/usr/bin/env node
/**
 * Privileged retention pruning. Never exposed as an API — run it deliberately:
 *
 *   DATABASE_URL=postgresql://... node scripts/retention-prune.js \
 *     --keep-days 730 --archive-dir ./archives [--dry-run] [--yes]
 *
 * For every tenant it prunes events recorded before the cutoff, cutting only
 * at a signed checkpoint so the remaining chain stays verifiable (verifyChain
 * anchors at the checkpoint; scripts/verify-export.js already handles partial
 * history). The pruned range is archived to JSONL first, and the prune itself
 * is appended to the chain as a `retention.pruned` event with the archive's
 * SHA-256.
 *
 * Requires a role that owns the events table (the trigger is disabled inside
 * the delete transaction only).
 */

const fs = require('fs');
const path = require('path');
const { initDatabase, getPool, closeDatabase } = require('../src/database');
const { planPrune, executePrune } = require('../src/services/retention');
const { verifyChain } = require('../src/services/chain');

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

async function main() {
  const keepDays = parseInt(arg('keep-days', ''));
  const before = arg('before'); // explicit ISO cutoff, e.g. for tests
  const archiveDir = arg('archive-dir', './archives');
  const dryRun = Boolean(arg('dry-run', false));
  const yes = Boolean(arg('yes', false));

  let cutoff;
  if (before) {
    cutoff = new Date(before);
    if (Number.isNaN(cutoff.getTime())) {
      console.error('--before must be a valid ISO 8601 timestamp');
      process.exit(1);
    }
  } else if (Number.isInteger(keepDays) && keepDays >= 30) {
    cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000);
  } else {
    console.error('Usage: node scripts/retention-prune.js (--keep-days <n≥30> | --before <iso>) [--archive-dir dir] [--dry-run] [--yes]');
    process.exit(1);
  }

  console.log(`Cutoff: events recorded before ${cutoff.toISOString()}`);

  await initDatabase();
  try {
    const { rows: tenants } = await getPool().query('SELECT DISTINCT tenant_id FROM events');
    let pruned = 0;

    for (const { tenant_id } of tenants) {
      const plan = await planPrune(tenant_id, cutoff);
      if (!plan) {
        console.log(`tenant ${tenant_id}: nothing prunable (no old events, or no signed checkpoint to anchor at)`);
        continue;
      }

      console.log(`tenant ${tenant_id}: would prune sequences ${plan.pruneFrom}–${plan.pruneTo} (${plan.count} events), anchor checkpoint #${plan.pruneTo}`);
      if (dryRun) continue;

      if (!yes) {
        console.error('Refusing to prune without --yes (or use --dry-run to preview)');
        process.exit(1);
      }

      fs.mkdirSync(archiveDir, { recursive: true });
      const archivePath = path.join(
        archiveDir,
        `clomp-archive-${tenant_id.slice(0, 8)}-seq${plan.pruneFrom}-${plan.pruneTo}-${new Date().toISOString().slice(0, 10)}.jsonl`
      );

      const result = await executePrune(plan, { archivePath });
      console.log(`tenant ${tenant_id}: deleted ${result.deleted} events, archive ${archivePath} (sha256 ${result.archiveSha256})`);

      const check = await verifyChain(tenant_id);
      if (!check.intact) {
        console.error(`✘ POST-PRUNE VERIFY FAILED for tenant ${tenant_id}: ${check.reason} at ${check.firstBreak}`);
        process.exit(1);
      }
      console.log(`✔ post-prune verify: ${check.verified} events intact` +
        (check.anchored_at ? `, anchored at checkpoint #${check.anchored_at.sequence}` : ''));
      pruned++;
    }

    console.log(dryRun ? 'Dry run complete.' : `Done. ${pruned} tenant(s) pruned.`);
  } finally {
    await closeDatabase();
  }
}

main().catch(err => {
  console.error('Retention prune failed:', err);
  process.exit(1);
});
