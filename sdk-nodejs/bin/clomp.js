#!/usr/bin/env node
/**
 * clomp CLI — record and inspect tamper-evident audit events from the shell.
 *
 * Configuration via environment:
 *   CLOMP_API_URL   e.g. http://localhost:3001
 *   CLOMP_API_KEY   clomp_live_...
 *
 * Commands:
 *   clomp record <action> [--actor type:id] [--target type:id]
 *                [--context '<json>'] [--occurred-at <iso>] [--evidence <file>]
 *   clomp verify
 *   clomp schedules [--fail-on-overdue]
 *   clomp export [--out <file>] [--from <iso>] [--to <iso>]
 *   clomp catalog
 *
 * Offline commands (no server access, no API key):
 *   clomp verify-file <export.jsonl>            recompute the chain locally
 *   clomp anchor-check <digest> <export.jsonl>  compare an archived checkpoint
 *                                               (anchoring email/webhook JSON)
 *                                               against an export
 *
 * Exit codes: 0 ok · 1 failure (verify: broken chain; schedules with
 * --fail-on-overdue: at least one overdue control) — cron/CI friendly.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API_URL = (process.env.CLOMP_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const API_KEY = process.env.CLOMP_API_KEY;

function fail(msg) {
  console.error(`clomp: ${msg}`);
  process.exit(1);
}

function arg(argv, name, fallback = undefined) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

function parseRef(value, flag) {
  if (!value) return undefined;
  const idx = value.indexOf(':');
  if (idx < 1) fail(`--${flag} must be type:id, e.g. system:web-01`);
  return { type: value.slice(0, idx), id: value.slice(idx + 1) };
}

async function api(pathName, options = {}) {
  if (!API_KEY) fail('CLOMP_API_KEY is not set');
  const res = await fetch(`${API_URL}${pathName}`, {
    ...options,
    headers: { 'X-API-Key': API_KEY, ...(options.headers || {}) }
  }).catch(err => fail(`cannot reach ${API_URL}: ${err.message}`));
  return res;
}

async function apiJson(pathName, options = {}) {
  const res = await api(pathName, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) fail(body.error || `${options.method || 'GET'} ${pathName} → ${res.status}`);
  return body;
}

async function cmdRecord(argv) {
  const action = argv[0];
  if (!action || action.startsWith('--')) fail('usage: clomp record <action> [--actor type:id] [--target type:id] ...');

  const actor = parseRef(arg(argv, 'actor'), 'actor') || { type: 'service', id: 'clomp-cli' };
  const target = parseRef(arg(argv, 'target'), 'target');
  const occurredAt = arg(argv, 'occurred-at');
  let context;
  const rawContext = arg(argv, 'context');
  if (rawContext) {
    try { context = JSON.parse(rawContext); } catch { fail('--context must be valid JSON'); }
  }

  let evidence;
  const evidenceFile = arg(argv, 'evidence');
  if (evidenceFile) {
    const buffer = fs.readFileSync(evidenceFile);
    const form = new FormData();
    form.append('file', new Blob([buffer]), path.basename(evidenceFile));
    const uploaded = await apiJson('/api/evidence', { method: 'POST', body: form });
    evidence = [uploaded];
    console.error(`uploaded evidence ${uploaded.filename} (sha256 ${uploaded.sha256})`);
  }

  const body = await apiJson('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action, actor, target, context, evidence,
      ...(occurredAt && { occurred_at: new Date(occurredAt).toISOString() })
    })
  });
  console.log(`recorded #${body.event.sequence} ${action}` +
    (body.known_action ? '' : ' (action not in catalog — will be flagged in reports)'));
}

async function cmdVerify() {
  const body = await apiJson('/api/verify');
  if (body.intact) {
    console.log(`chain intact — ${body.verified} events verified` +
      (body.anchored_at ? `, anchored at checkpoint #${body.anchored_at.sequence}` : '') +
      (body.checkpoint ? `, checkpoint #${body.checkpoint.sequence} signature ${body.checkpoint.signature_valid ? 'valid' : 'INVALID'}` : ''));
    if (body.checkpoint && !body.checkpoint.signature_valid) process.exit(1);
  } else {
    console.error(`CHAIN BROKEN at sequence ${body.firstBreak} (${body.reason}) — ${body.verified} events verified before the break`);
    process.exit(1);
  }
}

async function cmdSchedules(argv) {
  const { schedules, overdue } = await apiJson('/api/schedules');
  if (!schedules.length) {
    console.log('no scheduled controls');
    return;
  }
  for (const s of schedules) {
    const last = s.last_event_at ? s.last_event_at.slice(0, 10) : 'never';
    const due = s.next_due_at ? s.next_due_at.slice(0, 10) : '—';
    console.log(`${s.status.padEnd(8)} ${(s.title || s.action).padEnd(40)} ${s.frequency.padEnd(10)} last ${last}  due ${due}`);
  }
  if (overdue > 0) {
    console.error(`${overdue} control(s) overdue`);
    if (arg(argv, 'fail-on-overdue', false)) process.exit(1);
  }
}

async function cmdExport(argv) {
  const params = new URLSearchParams();
  const from = arg(argv, 'from');
  const to = arg(argv, 'to');
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const res = await api(`/api/export/jsonl?${params}`);
  if (!res.ok) fail(`export failed: ${res.status}`);
  const text = await res.text();
  const out = arg(argv, 'out');
  if (out) {
    fs.writeFileSync(out, text);
    console.error(`wrote ${out} (${text.split('\n').filter(Boolean).length} lines)`);
  } else {
    process.stdout.write(text);
  }
}

async function cmdCatalog() {
  const { actions } = await apiJson('/api/events/catalog');
  for (const a of actions) {
    console.log(`${a.action.padEnd(30)} ${a.title.padEnd(35)} SOC2: ${a.soc2.join(',').padEnd(20)} NIS2: ${a.nis2.join(',')}`);
  }
}

// ---------------------------------------------------------------------------
// Offline verification — mirrors the server's canonical JSON and hash rules
// (see the hash chain specification in the docs) with zero dependencies.

const GENESIS_HASH = '0'.repeat(64);

// Byte-identical to the server's canonical.js — the output feeds SHA-256.
function canonicalize(value) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(v => (v === undefined ? 'null' : canonicalize(v))).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
    const parts = keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k]));
    return '{' + parts.join(',') + '}';
  }
  throw new TypeError(`Cannot canonicalize value of type ${typeof value}`);
}

function eventHash(prevHashHex, event) {
  const payload = canonicalize({
    tenant_id: event.tenant_id,
    sequence: event.sequence,
    occurred_at: event.occurred_at,
    recorded_at: event.recorded_at,
    actor: event.actor,
    action: event.action,
    target: event.target ?? null,
    context: event.context ?? null,
    evidence: event.evidence ?? null
  });
  const h = crypto.createHash('sha256');
  h.update(Buffer.from(prevHashHex, 'hex'));
  h.update(Buffer.from(payload, 'utf8'));
  return h.digest('hex');
}

function verifyCheckpointSignature(cp) {
  const payload = canonicalize({ tenant_id: cp.tenant_id, sequence: cp.sequence, hash: cp.hash, signed_at: cp.signed_at });
  return crypto.verify(
    null,
    Buffer.from(payload, 'utf8'),
    crypto.createPublicKey(cp.public_key),
    Buffer.from(cp.signature, 'base64')
  );
}

function readExport(file) {
  const eventsByTenant = new Map();
  const checkpoints = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    if (obj.type === 'event') {
      if (!eventsByTenant.has(obj.tenant_id)) eventsByTenant.set(obj.tenant_id, []);
      eventsByTenant.get(obj.tenant_id).push(obj);
    } else if (obj.type === 'checkpoint') {
      checkpoints.push(obj);
    }
  }
  return { eventsByTenant, checkpoints };
}

function cmdVerifyFile(argv) {
  const file = argv[0];
  if (!file) fail('usage: clomp verify-file <export.jsonl>');
  const { eventsByTenant, checkpoints } = readExport(file);
  if (!eventsByTenant.size) fail('no events found in export');

  let ok = true;
  for (const [tenantId, events] of eventsByTenant) {
    events.sort((a, b) => a.sequence - b.sequence);
    let expectedPrev = events[0].sequence === 1 ? GENESIS_HASH : events[0].prev_hash;
    let expectedSeq = events[0].sequence;

    for (const event of events) {
      if (event.sequence !== expectedSeq) { console.error(`✘ ${tenantId}: sequence gap at ${expectedSeq}`); ok = false; break; }
      if (event.prev_hash !== expectedPrev) { console.error(`✘ ${tenantId}: prev_hash mismatch at ${event.sequence}`); ok = false; break; }
      if (eventHash(event.prev_hash, event) !== event.hash) { console.error(`✘ ${tenantId}: hash mismatch at ${event.sequence}`); ok = false; break; }
      expectedPrev = event.hash;
      expectedSeq++;
    }
    if (ok) {
      console.log(`✔ ${tenantId}: ${events.length} events verified, chain intact` +
        (events[0].sequence !== 1 ? ` (partial export starting at sequence ${events[0].sequence})` : ''));
    }

    for (const cp of checkpoints.filter(c => c.tenant_id === tenantId)) {
      const sigOk = verifyCheckpointSignature(cp);
      const referenced = events.find(e => e.sequence === cp.sequence);
      const hashOk = !referenced || referenced.hash === cp.hash;
      if (!sigOk || !hashOk) {
        console.error(`✘ ${tenantId}: checkpoint #${cp.sequence} ${sigOk ? 'hash mismatch' : 'signature invalid'}`);
        ok = false;
      } else {
        console.log(`✔ ${tenantId}: checkpoint #${cp.sequence} signed ${cp.signed_at} — signature valid`);
      }
    }
  }
  process.exit(ok ? 0 : 1);
}

/** Parse an anchoring artifact: webhook JSON, or the anchoring email text. */
function parseDigest(file) {
  const text = fs.readFileSync(file, 'utf8');
  try {
    const obj = JSON.parse(text);
    if (obj.hash && obj.signature) return obj;
  } catch { /* not JSON — try the email format */ }

  const grab = (re) => text.match(re)?.[1]?.trim();
  const cp = {
    tenant_id: grab(/tenant:\s*(\S+)/),
    sequence: parseInt(grab(/sequence:\s*(\d+)/)),
    hash: grab(/chain tip:\s*([0-9a-f]{64})/),
    signed_at: grab(/signed at:\s*(\S+)/),
    signature: grab(/signature[^:]*:\s*\n([A-Za-z0-9+/=]+)/),
    public_key: text.match(/(-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----)/)?.[1]
  };
  if (!cp.tenant_id || !cp.hash || !cp.signature || !cp.public_key || Number.isNaN(cp.sequence)) {
    fail('could not parse the digest file (expected anchoring email text or webhook JSON)');
  }
  return cp;
}

function cmdAnchorCheck(argv) {
  const [digestFile, exportFile] = argv;
  if (!digestFile || !exportFile) fail('usage: clomp anchor-check <digest-file> <export.jsonl>');

  const cp = parseDigest(digestFile);

  if (!verifyCheckpointSignature(cp)) {
    console.error(`✘ archived checkpoint #${cp.sequence}: signature INVALID`);
    process.exit(1);
  }
  console.log(`✔ archived checkpoint #${cp.sequence}: signature valid (signed ${cp.signed_at})`);

  const { eventsByTenant, checkpoints } = readExport(exportFile);
  const events = eventsByTenant.get(cp.tenant_id) || [];
  const event = events.find(e => e.sequence === cp.sequence);
  const exported = checkpoints.find(c => c.tenant_id === cp.tenant_id && c.sequence === cp.sequence);

  if (!event && !exported) {
    console.error(`✘ the export contains neither event nor checkpoint at sequence ${cp.sequence} for this tenant — cannot cross-check (was this range retention-pruned without its archive?)`);
    process.exit(1);
  }
  let ok = true;
  if (event && event.hash !== cp.hash) {
    console.error(`✘ HISTORY MISMATCH: export's event #${cp.sequence} has hash ${event.hash.slice(0, 12)}…, the archived checkpoint says ${cp.hash.slice(0, 12)}… — the chain was rewritten after this checkpoint was anchored`);
    ok = false;
  }
  if (exported && exported.hash !== cp.hash) {
    console.error(`✘ HISTORY MISMATCH: export's checkpoint #${cp.sequence} does not match the archived one`);
    ok = false;
  }
  if (ok) {
    console.log(`✔ export matches the archived checkpoint — history up to sequence ${cp.sequence} is the same history that was anchored`);
  }
  process.exit(ok ? 0 : 1);
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  switch (cmd) {
    case 'record': return cmdRecord(argv);
    case 'verify': return cmdVerify();
    case 'schedules': return cmdSchedules(argv);
    case 'export': return cmdExport(argv);
    case 'catalog': return cmdCatalog();
    case 'verify-file': return cmdVerifyFile(argv);
    case 'anchor-check': return cmdAnchorCheck(argv);
    default:
      console.error('usage: clomp <record|verify|schedules|export|catalog|verify-file|anchor-check> [options]');
      console.error('       see header of this file or the README for details');
      process.exit(cmd ? 1 : 0);
  }
}

main().catch(err => fail(err.message));
