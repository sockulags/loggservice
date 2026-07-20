const request = require('supertest');
const express = require('express');

jest.mock('../logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), fatal: jest.fn()
}));

const mockPoolQuery = jest.fn();
jest.mock('../database', () => ({
  getPool: () => ({ query: mockPoolQuery })
}));

const mockOverdueCountByTenant = jest.fn();
jest.mock('../services/schedules', () => ({
  overdueCountByTenant: (...args) => mockOverdueCountByTenant(...args)
}));

// Load the module with metrics enabled so the default process metrics
// (registered at module load) are present for the handler test below.
const savedEnv = { METRICS_ENABLED: process.env.METRICS_ENABLED, METRICS_TOKEN: process.env.METRICS_TOKEN };
process.env.METRICS_ENABLED = 'true';
const metrics = require('../metrics');

const TENANT = 'aaaaaaaa-0000-0000-0000-000000000001';

function makeApp() {
  const app = express();
  app.get('/metrics', metrics.metricsHandler);
  return app;
}

describe('metrics module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    metrics.register.resetMetrics();
    delete process.env.METRICS_ENABLED;
    delete process.env.METRICS_TOKEN;
    mockPoolQuery.mockResolvedValue({ rows: [] });
    mockOverdueCountByTenant.mockResolvedValue(new Map());
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe('isEnabled', () => {
    test('only the exact string "true" enables metrics', () => {
      process.env.METRICS_ENABLED = 'true';
      expect(metrics.isEnabled()).toBe(true);
    });

    test.each([undefined, '', 'false', 'TRUE', '1', 'yes', 'banana'])('%s keeps metrics disabled', (value) => {
      if (value === undefined) delete process.env.METRICS_ENABLED;
      else process.env.METRICS_ENABLED = value;
      expect(metrics.isEnabled()).toBe(false);
    });
  });

  describe('instrumented metrics', () => {
    test('recordEventIngested increments the counter per tenant', async () => {
      metrics.recordEventIngested(TENANT);
      metrics.recordEventIngested(TENANT);
      const body = await metrics.register.metrics();
      expect(body).toContain(`clomp_events_ingested_total{tenant_id="${TENANT}"} 2`);
    });

    test('recordCheckpointSigned increments the counter per tenant', async () => {
      metrics.recordCheckpointSigned(TENANT);
      const body = await metrics.register.metrics();
      expect(body).toContain(`clomp_checkpoints_signed_total{tenant_id="${TENANT}"} 1`);
    });

    test('recordChainVerification sets the last-verify gauge', async () => {
      metrics.recordChainVerification(TENANT, true);
      expect(await metrics.register.metrics()).toContain(`clomp_chain_last_verify_ok{tenant_id="${TENANT}"} 1`);

      metrics.recordChainVerification(TENANT, false);
      expect(await metrics.register.metrics()).toContain(`clomp_chain_last_verify_ok{tenant_id="${TENANT}"} 0`);
    });
  });

  describe('scrape-time metrics', () => {
    test('checkpoint age is read from the database on scrape', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [{ tenant_id: TENANT, age_seconds: '3600.5' }] });
      const body = await metrics.register.metrics();
      expect(body).toContain(`clomp_checkpoint_age_seconds{tenant_id="${TENANT}"} 3600.5`);
      expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('FROM checkpoints'));
    });

    test('overdue controls come from the schedules service on scrape', async () => {
      mockOverdueCountByTenant.mockResolvedValue(new Map([[TENANT, 3], ['tenant-2', 0]]));
      const body = await metrics.register.metrics();
      expect(body).toContain(`clomp_overdue_controls{tenant_id="${TENANT}"} 3`);
      expect(body).toContain('clomp_overdue_controls{tenant_id="tenant-2"} 0');
    });

    test('a failing database does not fail the scrape', async () => {
      mockPoolQuery.mockRejectedValue(new Error('db down'));
      mockOverdueCountByTenant.mockRejectedValue(new Error('db down'));
      const body = await metrics.register.metrics();
      expect(body).toContain('clomp_events_ingested_total');
    });
  });

  describe('httpMetricsMiddleware', () => {
    test('observes request duration labelled with the matched route', async () => {
      const app = express();
      app.use(metrics.httpMetricsMiddleware);
      app.get('/api/things/:id', (req, res) => res.json({ ok: true }));

      await request(app).get('/api/things/42');

      const body = await metrics.register.metrics();
      expect(body).toContain(
        'clomp_http_request_duration_seconds_count{method="GET",route="/api/things/:id",status_code="200"} 1'
      );
    });

    test('does not observe requests that never match a route', async () => {
      const app = express();
      app.use(metrics.httpMetricsMiddleware);

      await request(app).get('/no/such/route');

      const body = await metrics.register.metrics();
      expect(body).not.toContain('clomp_http_request_duration_seconds_count{');
    });

    test('recording helpers never throw, even on bad label input', () => {
      expect(() => metrics.recordEventIngested({ not: 'a string' })).not.toThrow();
      expect(() => metrics.recordChainVerification(undefined, true)).not.toThrow();
    });
  });

  describe('metricsHandler', () => {
    test('serves the Prometheus text exposition', async () => {
      metrics.recordEventIngested(TENANT);
      const res = await request(makeApp()).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.text).toContain('clomp_events_ingested_total');
      expect(res.text).toContain('process_cpu_user_seconds_total'); // default metrics
    });

    test('requires the bearer token when METRICS_TOKEN is set', async () => {
      process.env.METRICS_TOKEN = 'sekret';

      expect((await request(makeApp()).get('/metrics')).status).toBe(401);
      expect((await request(makeApp()).get('/metrics').set('Authorization', 'Bearer wrong')).status).toBe(401);
      expect((await request(makeApp()).get('/metrics').set('Authorization', 'Bearer sekret-but-longer')).status).toBe(401);

      const ok = await request(makeApp()).get('/metrics').set('Authorization', 'Bearer sekret');
      expect(ok.status).toBe(200);
    });
  });
});
