# Logging SDK & Server — Komplett fixlista (markdown att spara)

Här är en komplett, handlingsbar och prioriterad lista över allt jag anser bör fixas i er loggplattform (SDK + server). Dokumentet är gjort så att du enkelt kan klippa ut sektioner till issues/PRs. Jag har markerat **prioritet**, **varför**, **risk** och **konkreta kodexempel / teststeg** för varje åtgärd.

> Tips: skapa ett GitHub/GitLab epic och dela upp i issues enligt prioritet. Börja med "MUST" — de är korta och minskar risk direkt.

---

# Innehåll

1. Sammanfattning (snabbt)
2. MUST — Gör omedelbart före systemtest / staging
3. SHOULD — Viktigt att göra snart efter grundtester
4. NICE-TO-HAVE — Bra för skalbarhet och observability
5. GDPR / PII / retention / admin
6. Deployment, monitoring & incident playbook
7. Testplan & acceptanskriterier
8. Snabbstart: `curl` / testskript
9. Förslag till SQL-schema & index
10. Checklist för PR (vad varje PR ska innehålla)

---

# 1) Sammanfattning (kort)

Ni har en bra struktur. Prioriterade risker som jag vill att ni tar hand om först är:

* **Pool-hantering**: skapa inte `new Pool()` per request och gör inte `pool.end()` i request-path. Centralisera poolen.
* **Batch-insert**: byt per-row INSERT till multi-row INSERT eller COPY för bättre throughput.
* **Server-side redaction & size limits**: maskera PII och sakta/avvisa för stora `context`.
* **Persistens / worker / queue**: använd bakgrunds-processor (Redis / Kafka / queue table) om volymerna blir stora.
* **Metrics & alerts**: expose Prometheus-metrics för queue_length, failed_batches etc.

---

# 2) MUST — gör omedelbart före tester (hög prioritet)

Dessa åtgärder är enkla och minskar risk mycket.

## A. Centralisera Postgres-pool (singleton)

**Varför:** Ny Pool per request skapar massiv overhead och risk för TCP/connection exhaustion.
**Risk:** Instabil server vid flera samtidiga requests.

**Vad göra:** Skapa en singleton `pgPool` i `database.js` och använd `getPgPool()` i alla routes. Ta bort `pool.end()` i endpoints — använd `closeDatabase()` vid app shutdown.

**Kod (database.js):**

```js
// database.js
const { Pool } = require('pg');
let pgPool = null;

function initDatabase(connectionString) {
  if (!pgPool) {
    pgPool = new Pool({ connectionString });
    // optional: set pool size based on env
    // pgPool.options.max = parseInt(process.env.PG_POOL_MAX) || 20;
  }
  return pgPool;
}

function getPgPool() {
  if (!pgPool) throw new Error('Database not initialized. Call initDatabase first.');
  return pgPool;
}

async function closeDatabase() {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
}

module.exports = { initDatabase, getPgPool, closeDatabase };
```

**Ändring i endpoints:** ersätt `const pool = new Pool(...)` med `const pool = getPgPool()`; ta bort `await pool.end()` i `finally`.

**Test:** starta server, kör 200 parallella curl requests och observera antalet sockets (ska inte eskalera okontrollerat).

---

## B. Multi-row INSERT eller COPY för batch

**Varför:** En INSERT per lograd blir O(n) roundtrips; multi-row INSERT är mycket snabbare.

**Vad göra:** I `insertBatchPostgres` bygg en enhändelse SQL som sätter flera rader i ett VALUES-block eller använd `COPY` (psql) om mycket höga volymer.

**Exempel multi-row (bygg placeholders):**

```js
const { v4: uuidv4 } = require('uuid');

function buildMultiInsert(logs, service) {
  const cols = ['id','timestamp','level','service','message','context','correlation_id'];
  const values = [];
  const placeholders = logs.map((log, i) => {
    const idx = i * cols.length;
    const id = uuidv4();
    const ts = log.timestamp || new Date().toISOString();
    values.push(id, ts, log.level || 'info', service, log.message || null, log.context ? JSON.stringify(log.context) : null, log.correlation_id || null);
    const ph = new Array(cols.length).fill(0).map((_, j) => `$${idx + j + 1}`).join(',');
    return `(${ph})`;
  }).join(', ');

  const sql = `INSERT INTO logs (${cols.join(',')}) VALUES ${placeholders} RETURNING id,timestamp`;
  return { sql, values };
}
```

**Test:** skapa en batch med 10k events och jämför tid vs per-row.

---

## C. Enkel server-side redaction + maxContextSize

**Varför:** Förhindra att PII lämnar systemet eller lagras oavsiktligt. Enkel redaction räddar er juridiskt.

**Vad göra:**

* Implementera ett redaction-steg innan DB-insert.
* Avvisa eller trunkera kontext > `MAX_CONTEXT_BYTES` (ex: 100KB).
* Logga varningar om avvisning.

**Kod (redaction):**

```js
const SENSITIVE_KEYS = ['ssn','personal_number','card_number','credit_card','email','password','token'];

function redact(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (/\d{6}[- ]?\d{4}/.test(value)) return '***REDACTED***'; // pnr
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      if (SENSITIVE_KEYS.includes(k.toLowerCase())) { out[k] = '***REDACTED***'; continue; }
      out[k] = redact(value[k]);
    }
    return out;
  }
  return value;
}
```

**Tillämpning i endpoint:**

* `const safeContext = redact(event.context);`
* `if (Buffer.byteLength(JSON.stringify(safeContext), 'utf8') > MAX_CONTEXT_BYTES) reject/trim`

**Test:** skicka events med fält `ssn` eller mönster som personnummer och kontrollera DB att det står `***REDACTED***`.

---

# 3) SHOULD — gör snart (mellantid)

Dessa förbättringar stärker stabilitet och skalning.

## D. Introducera job/worker-arkitektur (durable queue)

**Varför:** Vid hög RL-servertrafik vill ni enqueue events och ack först när persisted; server kan då acceptera snabbt och processa i bakgrunden.

**Rekommendation:** Ingest endpoint → write to Redis list / Kafka topic / Postgres `ingest_queue` table → background worker pops och skriver till `logs` (batch + retry/backoff).

**Fördel:** resilient vid DB-peak; enkel retry.

---

## E. Retry/backoff med jitter för DB/HTTP

**Varför:** Transienta fel ska inte tappa events.

**Rekommendation (pseudo):**

* På 5xx eller network error: exponensiell backoff med jitter.
* 4xx (ex 422) → drop + report.
* Max retries = 3 (configurable).

**Kod-snippet:**

```js
async function retry(fn, retries = 3) {
  let attempt = 0;
  while (true) {
    try { return await fn(); } 
    catch (err) {
      if (++attempt > retries) throw err;
      const wait = Math.min(1000 * Math.pow(2, attempt) + Math.random()*200, 10000);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}
```

---

## F. Sampling, rate-limiting & quotas

**Varför:** Skydda backends och hålla kostnader under kontroll.

**Vad göra:**

* `error` events: 100% capture.
* `info/metric` events: default sample t.ex. 1–10% (konfig per tenant).
* Rate-limit per API-key / tenant: 429 med `Retry-After`.

---

## G. Add Prometheus metrics & health endpoints

**Varför:** Observability och alarms.

**Metrics att exponera:**

* `logs_ingest_requests_total`
* `logs_ingest_failures_total`
* `logs_batches_processed_total`
* `logs_batch_size_histogram`
* `db_insert_latency_seconds`
* `ingest_queue_length` (om queue används)

**Health endpoint:** `/health` returns 200 if DB and queue are OK.

---

## H. Remove blocking/synchronous code (no deasync)

**Varför:** Synchronous network IO blocks Node event loop; avoid.

**Vad göra:** Ensure all IO is `async/await` or Promise-based. If you used `deasync` anywhere — remove it.

---

# 4) NICE-TO-HAVE — för skalning & kvalitet

* **A/B sampling & dynamic sampling**: reduce sample rate during peaks.
* **Contract tests (Pact)**: protect consumers from breaking changes.
* **Schema registry / event versions**: `schemaVersion` in payload + accept-version header.
* **Retention lifecycle automation**: archive -> compress -> delete after retention; expose forget API per user.
* **Search/indexing**: consider separate searchable store (Elasticsearch / ClickHouse) for analytics.
* **Backup & restore** for archived JSONL files.

---

# 5) GDPR / PII / retention / admin

* **Policies to implement now:**

  * Explicit per-tenant retention policy.
  * `right-to-be-forgotten` API: anonymize logs for a tenant/user id (implement via update/DELETE or anonymize fields).
  * Region selection (where data stored).
* **Admin UI features:**

  * Show current retention, purge history.
  * Rotation for API keys.
  * Audit logs for admin actions.

---

# 6) Deployment & monitoring / incident playbook

* **Pre-deploy checklist:**

  * DB pool configured and tested.
  * Health endpoints pass.
  * Metrics visible in Prometheus/Grafana and alert rules set:

    * Queue length > threshold
    * Batch failures > X per minute
    * DB connections > 80% pool size
* **Incident playbook:**

  1. Detect via alert.
  2. Check `/health`.
  3. If DB down: scale DB read replicas or fail ingestion to queue (if queue exists).
  4. If queue backlog: increase worker concurrency or scale worker nodes.
  5. Postmortem: check if PII leaked.

---

# 7) Testplan & acceptanskriterier

* **Unit tests** for:

  * redaction recursive behavior.
  * buildMultiInsert correctness (placeholders + values).
* **Integration tests**:

  * Endpoint accepts a batch and persists N rows.
  * Endpoint rejects large context (>100KB).
  * Endpoint returns 422 if sensitive fields present (optional policy).
* **Load tests**:

  * Simulate 1000 req/s in staging. Observables: CPU, memory, DB connections, latencies.
* **Security tests**:

  * Ensure no tokens/api-keys are logged.
  * Search for regex patterns for PII in logs.

---

# 8) Snabbstart: testskript & curl

**Sample ingest request:**

```bash
curl -X POST http://localhost:3000/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {"timestamp":"2025-12-29T12:00:00Z","level":"info","message":"test","context":{"step":"1","email":"foo@example.com"}}
    ],
    "schemaVersion": "1.0"
  }'
```

**Simple load script (node):**

```js
// send-batches.js
const fetch = require('node-fetch');
async function send(i) {
  return fetch('http://localhost:3000/ingest', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      events: Array.from({length:10}).map((_,k)=>({timestamp:new Date().toISOString(), level:'info', message:`msg-${i}-${k}`, context:{i,k}}))
    })
  });
}
(async () => {
  const promises = [];
  for (let i=0;i<200;i++) promises.push(send(i));
  await Promise.all(promises);
  console.log('done');
})();
```

---

# 9) SQL-schema & indexförslag

**Bas-tabell `logs`**

```sql
CREATE TABLE logs (
  id UUID PRIMARY KEY,
  timestamp timestamptz NOT NULL,
  level text,
  service text,
  message text,
  context jsonb,
  correlation_id text,
  tenant_id text,
  created_at timestamptz DEFAULT now()
);

-- Index för snabba queries
CREATE INDEX idx_logs_tenant_timestamp ON logs(tenant_id, timestamp DESC);
CREATE INDEX idx_logs_correlation ON logs(correlation_id);
-- Partial index for error-level
CREATE INDEX idx_logs_errors ON logs(tenant_id, timestamp DESC) WHERE level='error';
```

**Ingest queue table (optional):**

```sql
CREATE TABLE ingest_queue (
  id serial PRIMARY KEY,
  payload jsonb NOT NULL,
  attempts int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  available_at timestamptz DEFAULT now()
);
CREATE INDEX idx_ingest_available ON ingest_queue(available_at);
```

---

# 10) Checklist för PR (vad varje PR ska innehålla)

* [ ] Kodändring + unit tests
* [ ] Integrationstest eller lokal testinstruktioner
* [ ] Uppdaterad README / migration guide (t.ex. "how to switch to singleton pool")
* [ ] Env-vars / config-dokumentation (PG_POOL_MAX, MAX_CONTEXT_BYTES etc.)
* [ ] Prometheus-metrics & grafana-dashboard (minimalt)
* [ ] GDPR/PII policy text för admin (exempel)
* [ ] Rollback-plan och migrationssteg

---

# Exempel-issue-förslag (kopiera -> skapa issue)

**Titel:** Centralize Postgres pool and remove per-request Pool creation
**Beskrivning:** Flytta all pool-hantering till `database.js` (`initDatabase` & `getPgPool`) och använd `getPgPool()` i alla modules. Ta bort anrop till `new Pool()` och `await pool.end()` i request-paths. Lägg till closeDatabase() som körs vid process shutdown.

**Acceptance criteria:**

* Inga fler `new Pool()` i repo.
* Server kör under load utan connection spike.
* Unit test för `getPgPool()` error if not initialized.

---
