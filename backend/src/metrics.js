const client = require('prom-client');
const logger = require('./logger');
const secureEquals = require('./secureEquals');
const { getPool } = require('./database');
const { overdueCountByTenant } = require('./services/schedules');

/**
 * Prometheus metrics for the audit engine (opt-in).
 *
 * Counters and gauges fed by the record*() helpers are always collected
 * in-memory (an increment costs nothing), but everything with real overhead —
 * the /metrics endpoint, the per-request HTTP histogram middleware, and the
 * default Node.js process metrics — is only active when METRICS_ENABLED=true.
 * Because the output exposes operational details — tenant ids, ingestion
 * rates, checkpoint cadence — the endpoint should stay on a trusted network
 * and/or behind METRICS_TOKEN (Bearer auth).
 *
 * Two kinds of metrics live here:
 *  - Instrumented: services call the thin record*() helpers below
 *    (increment/set only, never a query — and never a throw: telemetry must
 *    not break recording or verification).
 *  - Scrape-time: gauges whose truth lives in the database (checkpoint age,
 *    overdue controls) query it in their collect() callback, so they are
 *    accurate even right after a restart.
 *
 * Cardinality note: per-tenant label series live for the process lifetime and
 * are never removed when a tenant disappears. clomp runs one (or a handful
 * of) tenants per install, so this stays tiny; revisit before any
 * many-tenant deployment.
 */

const register = new client.Registry();

function isEnabled() {
  return process.env.METRICS_ENABLED === 'true';
}

// Default process metrics (event-loop lag, GC, memory) install observers and
// timers, so only collect them when metrics are actually exposed.
if (isEnabled()) {
  client.collectDefaultMetrics({ register });
}

// --- Instrumented metrics (set from services) -------------------------------

const eventsIngestedTotal = new client.Counter({
  name: 'clomp_events_ingested_total',
  help: 'Events appended to the hash chain since process start',
  labelNames: ['tenant_id'],
  registers: [register]
});

const checkpointsSignedTotal = new client.Counter({
  name: 'clomp_checkpoints_signed_total',
  help: 'Signed checkpoints created since process start',
  labelNames: ['tenant_id'],
  registers: [register]
});

const chainLastVerifyOk = new client.Gauge({
  name: 'clomp_chain_last_verify_ok',
  help: 'Result of the most recent chain verification (1 = intact, 0 = broken). ' +
    'Set to 1 only by a full-chain verification; a failed verification (full ' +
    'or partial) sets 0. Absent until a verification has run.',
  labelNames: ['tenant_id'],
  registers: [register]
});

/**
 * The record*() helpers run inside the append/sign/verify paths, after the
 * real work has committed. A telemetry failure there must never surface as a
 * failure of the audit operation itself, so they swallow (and log) errors.
 */
function guarded(fn) {
  return (...args) => {
    try {
      fn(...args);
    } catch (err) {
      logger.error({ err }, 'Failed to record metric');
    }
  };
}

/** Called after an event has been committed to the chain. */
const recordEventIngested = guarded((tenantId) => {
  eventsIngestedTotal.inc({ tenant_id: tenantId });
});

/** Called after a checkpoint has been signed and stored. */
const recordCheckpointSigned = guarded((tenantId) => {
  checkpointsSignedTotal.inc({ tenant_id: tenantId });
});

/** Called when a chain verification completes with a genuine outcome. */
const recordChainVerification = guarded((tenantId, intact) => {
  chainLastVerifyOk.set({ tenant_id: tenantId }, intact ? 1 : 0);
});

// --- Scrape-time metrics (queried from the database on collect) -------------

/**
 * A per-tenant gauge whose truth lives in the database: fetchValues() returns
 * a Map of tenant_id -> number and runs on every scrape, so values are
 * accurate even right after a restart. A failing database never fails the
 * scrape — the gauge simply keeps its previous values (and /health reports
 * the outage) while the error is logged.
 */
function makeScrapeGauge({ name, help }, fetchValues) {
  return new client.Gauge({
    name,
    help,
    labelNames: ['tenant_id'],
    registers: [register],
    async collect() {
      try {
        const values = await fetchValues();
        this.reset();
        for (const [tenantId, value] of values) {
          this.set({ tenant_id: tenantId }, value);
        }
      } catch (err) {
        logger.error({ err, metric: name }, 'Failed to collect scrape-time metric');
      }
    }
  });
}

const checkpointAgeSeconds = makeScrapeGauge(
  {
    name: 'clomp_checkpoint_age_seconds',
    help: 'Seconds since the most recent signed checkpoint, per tenant'
  },
  async () => {
    const { rows } = await getPool().query(
      `SELECT tenant_id, EXTRACT(EPOCH FROM (NOW() - MAX(signed_at))) AS age_seconds
       FROM checkpoints GROUP BY tenant_id`
    );
    return new Map(rows.map(row => [row.tenant_id, Number(row.age_seconds)]));
  }
);

const overdueControls = makeScrapeGauge(
  {
    name: 'clomp_overdue_controls',
    help: 'Active scheduled controls currently past their grace deadline, per tenant'
  },
  () => overdueCountByTenant()
);

// --- HTTP request duration ---------------------------------------------------

const httpRequestDuration = new client.Histogram({
  name: 'clomp_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

/**
 * Express middleware timing requests, labelled with the matched Express route
 * pattern (bounded cardinality). Requests that never match a route — static
 * assets, unknown paths, rate-limited short-circuits — are not observed.
 * Mounted only when metrics are enabled.
 */
function httpMetricsMiddleware(req, res, next) {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    if (!req.route) return;
    end({
      method: req.method,
      route: (req.baseUrl || '') + req.route.path,
      status_code: res.statusCode
    });
  });
  next();
}

// --- Endpoint ----------------------------------------------------------------

/** GET /metrics handler. Requires Bearer METRICS_TOKEN when one is set. */
async function metricsHandler(req, res) {
  const token = process.env.METRICS_TOKEN;
  if (token) {
    const header = req.headers.authorization || '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!secureEquals(provided, token)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    logger.error({ err }, 'Failed to render metrics');
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  register,
  isEnabled,
  metricsHandler,
  httpMetricsMiddleware,
  recordEventIngested,
  recordCheckpointSigned,
  recordChainVerification,
  checkpointAgeSeconds,
  overdueControls
};
