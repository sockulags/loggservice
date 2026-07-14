const request = require('supertest');
const express = require('express');

jest.mock('../../logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), fatal: jest.fn()
}));

const mockPoolQuery = jest.fn();
const mockAppendEvent = jest.fn();

jest.mock('../../database', () => ({
  getPool: () => ({ query: mockPoolQuery })
}));
jest.mock('../../services/chain', () => ({
  appendEvent: (...args) => mockAppendEvent(...args)
}));

const scheduleRoutes = require('../../routes/schedules');

const TENANT = 'aaaaaaaa-0000-0000-0000-000000000001';

function appAs(principal) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    Object.assign(req, principal);
    next();
  });
  app.use('/api/schedules', scheduleRoutes);
  return app;
}

const adminApp = () => appAs({ user: { id: 'u1', email: 'admin@x.se', role: 'admin', tenant_id: TENANT } });
const editorApp = () => appAs({ user: { id: 'u2', email: 'e@x.se', role: 'editor', tenant_id: TENANT } });
const auditorApp = () => appAs({ user: { id: 'u3', email: 'a@x.se', role: 'auditor', tenant_id: TENANT } });
const apiKeyApp = () => appAs({ apiKey: { id: 'k1', name: 'ci-bot', tenant_id: TENANT } });
const anonApp = () => appAs({});

const scheduleRow = (extra = {}) => ({
  id: '11111111-0000-0000-0000-000000000001',
  tenant_id: TENANT,
  action: 'access.review.completed',
  title: 'Quarterly access review',
  frequency: 'quarterly',
  grace_days: 14,
  active: true,
  created_by: 'admin@x.se',
  created_at: new Date('2026-01-01T00:00:00Z'),
  ...extra
});

describe('schedule routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppendEvent.mockResolvedValue({ sequence: 1 });
  });

  describe('GET /api/schedules', () => {
    test('lists schedules with computed status and overdue count', async () => {
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [scheduleRow()] })
        .mockResolvedValueOnce({ rows: [] }); // no matching events → overdue

      const res = await request(auditorApp()).get('/api/schedules');
      expect(res.status).toBe(200);
      expect(res.body.schedules).toHaveLength(1);
      expect(res.body.schedules[0].status).toBe('overdue');
      expect(res.body.overdue).toBe(1);
    });

    test('API keys may read schedules', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });
      expect((await request(apiKeyApp()).get('/api/schedules')).status).toBe(200);
    });

    test('requires authentication', async () => {
      expect((await request(anonApp()).get('/api/schedules')).status).toBe(401);
    });
  });

  describe('POST /api/schedules', () => {
    const VALID = { action: 'access.review.completed', title: 'Quarterly access review', frequency: 'quarterly', grace_days: 14 };

    test('creates a schedule and records the change on the chain', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [scheduleRow()] });

      const res = await request(editorApp()).post('/api/schedules').send(VALID);
      expect(res.status).toBe(201);
      expect(res.body.schedule.action).toBe('access.review.completed');
      expect(mockAppendEvent).toHaveBeenCalledWith(TENANT, expect.objectContaining({
        action: 'control.schedule.created',
        target: expect.objectContaining({ type: 'schedule' })
      }));
    });

    test('rejects duplicates with 409', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });
      expect((await request(editorApp()).post('/api/schedules').send(VALID)).status).toBe(409);
      expect(mockAppendEvent).not.toHaveBeenCalled();
    });

    test.each([
      [{ ...VALID, action: 'notdotted' }, 'action'],
      [{ ...VALID, frequency: 'fortnightly' }, 'frequency'],
      [{ ...VALID, grace_days: -1 }, 'grace_days'],
      [{ ...VALID, grace_days: 9999 }, 'grace_days'],
      [{ ...VALID, title: 'x'.repeat(201) }, 'title']
    ])('validates input %#', async (body, field) => {
      const res = await request(editorApp()).post('/api/schedules').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain(field);
    });

    test('rejects API keys and auditors', async () => {
      expect((await request(apiKeyApp()).post('/api/schedules').send(VALID)).status).toBe(403);
      expect((await request(auditorApp()).post('/api/schedules').send(VALID)).status).toBe(403);
      expect((await request(anonApp()).post('/api/schedules').send(VALID)).status).toBe(403);
    });
  });

  describe('PATCH /api/schedules/:id', () => {
    test('updates fields and records the change', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [scheduleRow({ frequency: 'monthly' })] });

      const res = await request(adminApp())
        .patch('/api/schedules/11111111-0000-0000-0000-000000000001')
        .send({ frequency: 'monthly' });
      expect(res.status).toBe(200);
      expect(res.body.schedule.frequency).toBe('monthly');
      expect(mockAppendEvent).toHaveBeenCalledWith(TENANT, expect.objectContaining({
        action: 'control.schedule.updated'
      }));
    });

    test('404 on unknown id', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(adminApp()).patch('/api/schedules/nope').send({ active: false });
      expect(res.status).toBe(404);
    });

    test('400 on empty body', async () => {
      expect((await request(adminApp()).patch('/api/schedules/x').send({})).status).toBe(400);
    });
  });

  describe('DELETE /api/schedules/:id', () => {
    test('admin removes a schedule and records the change', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [scheduleRow()] });
      const res = await request(adminApp()).delete('/api/schedules/11111111-0000-0000-0000-000000000001');
      expect(res.status).toBe(200);
      expect(mockAppendEvent).toHaveBeenCalledWith(TENANT, expect.objectContaining({
        action: 'control.schedule.removed'
      }));
    });

    test('editors may not delete', async () => {
      expect((await request(editorApp()).delete('/api/schedules/x')).status).toBe(403);
    });
  });
});
