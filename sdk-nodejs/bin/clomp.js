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
 * Exit codes: 0 ok · 1 failure (verify: broken chain; schedules with
 * --fail-on-overdue: at least one overdue control) — cron/CI friendly.
 */

const fs = require('fs');
const path = require('path');

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

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  switch (cmd) {
    case 'record': return cmdRecord(argv);
    case 'verify': return cmdVerify();
    case 'schedules': return cmdSchedules(argv);
    case 'export': return cmdExport(argv);
    case 'catalog': return cmdCatalog();
    default:
      console.error('usage: clomp <record|verify|schedules|export|catalog> [options]');
      console.error('       see header of this file or the README for details');
      process.exit(cmd ? 1 : 0);
  }
}

main().catch(err => fail(err.message));
