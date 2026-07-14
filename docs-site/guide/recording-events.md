# Recording events

An event answers: **who** (`actor`) did **what** (`action`) to **which
object** (`target`), **when** (`occurred_at`), with optional free-form
`context` and attached `evidence`.

```json
{
  "action": "access.review.completed",
  "actor": { "type": "user", "id": "lucas" },
  "target": { "type": "scope", "id": "all-prod" },
  "context": { "reviewed_accounts": 44, "revoked": 2 },
  "occurred_at": "2026-07-07T09:00:00Z"
}
```

- `action` is a namespaced, lowercase dot-separated string. The
  [action catalog](/reference/action-catalog) is seeded with SOC 2- and
  NIS2-tagged activity types; unknown actions are accepted but flagged in
  reports.
- `actor` requires at least `{ type, id }` where type is `user`, `service`
  or `system`. The server always stamps *how* the event entered the system
  (`recorded_by`: the session user or the API key) — the caller cannot
  spoof that part.
- `occurred_at` may be in the past — **backfill is a feature**. The server
  sets `recorded_at`, and both timestamps are hashed, so late entries are
  visible for what they are.

## Four ways in

### The web UI

The **Record** tab: pick an action from the catalog, describe the target,
attach evidence. For people logging reviews, incidents and tests.

### The Node.js SDK

```js
const Clomp = require('@clomp/sdk-node');

const clomp = new Clomp({
  apiUrl: 'https://clomp.internal.example.com',
  apiKey: process.env.CLOMP_API_KEY,
  defaultActor: { type: 'service', id: 'billing-api' }
});

clomp.record('access.revoked', {
  target: { type: 'user', id: 'u-42' },
  context: { reason: 'offboarding' }
});

await clomp.destroy(); // flush before exit
```

The SDK queues events and sends them oldest-first, retries on network
trouble, and never crashes the host application. See the
[SDK reference](/reference/sdk).

### The CLI

For cron jobs, CI pipelines and runbooks:

```bash
export CLOMP_API_URL=https://clomp.internal.example.com
export CLOMP_API_KEY=clomp_live_...

clomp record patch.applied --actor service:ci --target system:web-01
clomp record access.review.completed --actor user:lucas \
  --target scope:all-prod --evidence ./review-q3.pdf
```

See the [CLI reference](/reference/cli).

### Plain REST

```bash
curl -X POST https://clomp.internal.example.com/api/events \
  -H "X-API-Key: clomp_live_..." \
  -H "Content-Type: application/json" \
  -d '{"action":"backup.tested","actor":{"type":"user","id":"ops"},"target":{"type":"system","id":"primary-db"}}'
```

See the [REST API reference](/reference/rest-api).

## Who may write

| Credential | May record events |
|---|---|
| API key (`clomp_live_…`) | ✔ — machine writers, scoped to the tenant |
| Session user, role `admin` or `editor` | ✔ |
| Session user, role `auditor` | ✘ — read-only + export |
