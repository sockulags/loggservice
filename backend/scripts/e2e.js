#!/usr/bin/env node
/**
 * End-to-end proof of the product promise, against a real PostgreSQL:
 *
 *   record → checkpoint → verify → retention prune → export → offline verify
 *   → tamper → verify pinpoints the break → offline verify fails
 *
 * Runs the real server over HTTP with real auth (admin login, API key).
 * Used by CI (job e2e-postgres) and runnable locally:
 *
 *   DATABASE_URL=postgresql://clomp:dev@localhost:5432/clomp node scripts/e2e.js
 *
 * Exits 0 when every step holds, 1 otherwise. The database should be empty —
 * the script appends events and prunes; do not point it at production.
 */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = process.env.E2E_PORT || 3999;
const BASE = `http://localhost:${PORT}`;
const DATABASE_URL = process.env.DATABASE_URL;

let serverProc = null;
let pool = null;
let failures = 0;

function step(name, ok, detail = '') {
  const mark = ok ? '✔' : '✘';
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  if (!DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  // --- start the real server ---------------------------------------------
  serverProc = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'inherit', 'inherit']
  });
  step('server started', await waitForHealth());

  // --- break-glass admin + login + API key -------------------------------
  const adminOut = execFileSync(process.execPath, ['scripts/create-admin.js', 'e2e@example.com', 'E2E Admin'], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    encoding: 'utf8'
  });
  const password = adminOut.match(/One-time password: (\S+)/)?.[1];
  step('admin created with one-time password', Boolean(password));

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'e2e@example.com', password })
  });
  const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];
  step('admin login sets a session cookie', loginRes.status === 200 && Boolean(cookie));

  const keyRes = await fetch(`${BASE}/api/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ name: 'e2e-bot' })
  });
  const { key } = await keyRes.json();
  step('API key created', keyRes.status === 201 && key?.startsWith('clomp_live_'));
  const apiHeaders = { 'Content-Type': 'application/json', 'X-API-Key': key };

  // --- record events over HTTP --------------------------------------------
  for (let i = 1; i <= 5; i++) {
    const res = await fetch(`${BASE}/api/events`, {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        action: 'patch.applied',
        actor: { type: 'service', id: 'e2e' },
        target: { type: 'system', id: `web-${i}` }
      })
    });
    if (res.status !== 201) step(`event ${i} recorded`, false, `status ${res.status}`);
  }
  step('5 events recorded via API key', true);

  // --- checkpoint (in-process, same code the nightly job runs) ------------
  const { initDatabase, getPool, getDefaultTenantId, closeDatabase } = require('../src/database');
  await initDatabase();
  pool = getPool();
  const tenantId = getDefaultTenantId();
  const { createCheckpoint } = require('../src/services/checkpoints');
  const cp = await createCheckpoint(tenantId);
  step('checkpoint signed at chain tip', cp?.sequence === 5);

  const verify1 = await (await fetch(`${BASE}/api/verify`, { headers: apiHeaders })).json();
  step('verify: chain intact with valid checkpoint signature',
    verify1.intact === true && verify1.verified === 5 && verify1.checkpoint?.signature_valid === true,
    JSON.stringify(verify1));

  // --- two more events, then retention prune up to the checkpoint ---------
  for (let i = 6; i <= 7; i++) {
    await fetch(`${BASE}/api/events`, {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({ action: 'backup.tested', actor: { type: 'service', id: 'e2e' } })
    });
  }

  const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clomp-e2e-'));
  execFileSync(process.execPath, [
    'scripts/retention-prune.js',
    '--before', new Date(Date.now() + 60_000).toISOString(),
    '--archive-dir', archiveDir,
    '--yes'
  ], { cwd: path.join(__dirname, '..'), env: process.env, stdio: 'inherit' });

  const verify2 = await (await fetch(`${BASE}/api/verify`, { headers: apiHeaders })).json();
  step('verify after retention prune: intact, anchored at the signed checkpoint',
    verify2.intact === true && verify2.verified === 3 && verify2.anchored_at?.sequence === 5,
    JSON.stringify(verify2));

  const archiveFile = fs.readdirSync(archiveDir).find(f => f.endsWith('.jsonl'));
  const archiveVerify = spawnSyncVerifyExport(path.join(archiveDir, archiveFile));
  step('pruned archive verifies offline', archiveVerify === 0);

  // --- export + offline verification --------------------------------------
  const exportPath = path.join(archiveDir, 'export-intact.jsonl');
  fs.writeFileSync(exportPath, await (await fetch(`${BASE}/api/export/jsonl`, { headers: apiHeaders })).text());
  step('JSONL export verifies offline (partial history, checkpoint-anchored)', spawnSyncVerifyExport(exportPath) === 0);

  // --- tamper resistance ---------------------------------------------------
  let updateRejected = false;
  try {
    await pool.query(`UPDATE events SET action = 'forged.entry' WHERE sequence = 7`);
  } catch (err) {
    updateRejected = /append-only/.test(err.message);
  }
  step('plain UPDATE on events is rejected by the append-only trigger', updateRejected);

  await pool.query('ALTER TABLE events DISABLE TRIGGER events_append_only');
  await pool.query(`UPDATE events SET action = 'forged.entry' WHERE sequence = 7`);
  await pool.query('ALTER TABLE events ENABLE TRIGGER events_append_only');

  const verify3 = await (await fetch(`${BASE}/api/verify`, { headers: apiHeaders })).json();
  step('verify pinpoints the tampered event',
    verify3.intact === false && verify3.firstBreak === 7,
    JSON.stringify(verify3));

  const tamperedPath = path.join(archiveDir, 'export-tampered.jsonl');
  fs.writeFileSync(tamperedPath, await (await fetch(`${BASE}/api/export/jsonl`, { headers: apiHeaders })).text());
  step('offline verifier rejects the tampered export', spawnSyncVerifyExport(tamperedPath) === 1);

  await closeDatabase();
  pool = null;

  console.log(failures === 0 ? '\nE2E: all steps passed' : `\nE2E: ${failures} step(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

function spawnSyncVerifyExport(file) {
  const { status } = require('child_process').spawnSync(
    process.execPath, ['scripts/verify-export.js', file],
    { cwd: path.join(__dirname, '..'), stdio: 'inherit' }
  );
  return status;
}

main()
  .catch(err => {
    console.error('E2E failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    if (serverProc) serverProc.kill();
  });
