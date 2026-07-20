const mockPoolQuery = jest.fn();

jest.mock('../../database', () => ({
  getPool: () => ({ query: mockPoolQuery })
}));

const { nextDue, scheduleStatus, listWithStatus, overdueCountByTenant } = require('../../services/schedules');

const TENANT = 'aaaaaaaa-0000-0000-0000-000000000001';

const scheduleRow = (extra = {}) => ({
  id: 's1',
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

describe('nextDue', () => {
  test.each([
    ['daily', '2026-07-02T00:00:00.000Z'],
    ['weekly', '2026-07-08T00:00:00.000Z'],
    ['monthly', '2026-08-01T00:00:00.000Z'],
    ['quarterly', '2026-10-01T00:00:00.000Z'],
    ['yearly', '2027-07-01T00:00:00.000Z']
  ])('%s adds one interval', (frequency, expected) => {
    expect(nextDue('2026-07-01T00:00:00Z', frequency).toISOString()).toBe(expected);
  });

  test('throws on unknown frequency', () => {
    expect(() => nextDue('2026-07-01T00:00:00Z', 'fortnightly')).toThrow('Unknown frequency');
  });
});

describe('scheduleStatus', () => {
  const schedule = scheduleRow();

  test('ok when the last event is within the interval', () => {
    const s = scheduleStatus(schedule, '2026-06-01T00:00:00Z', new Date('2026-07-14T00:00:00Z'));
    expect(s.status).toBe('ok');
    expect(s.next_due_at).toBe('2026-09-01T00:00:00.000Z');
  });

  test('due inside the grace period', () => {
    const s = scheduleStatus(schedule, '2026-04-01T00:00:00Z', new Date('2026-07-10T00:00:00Z'));
    expect(s.status).toBe('due');
    expect(s.deadline_at).toBe('2026-07-15T00:00:00.000Z');
  });

  test('overdue past the grace period', () => {
    const s = scheduleStatus(schedule, '2026-03-01T00:00:00Z', new Date('2026-07-14T00:00:00Z'));
    expect(s.status).toBe('overdue');
  });

  test('never-logged schedules start the clock at creation', () => {
    const s = scheduleStatus(schedule, null, new Date('2026-07-14T00:00:00Z'));
    expect(s.status).toBe('overdue'); // created 2026-01-01, quarterly + 14d grace
    expect(s.last_event_at).toBeNull();
    expect(s.next_due_at).toBe('2026-04-01T00:00:00.000Z');
  });
});

describe('listWithStatus', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns [] without querying events when there are no schedules', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    expect(await listWithStatus(TENANT)).toEqual([]);
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  test('joins schedules with the latest matching event', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [scheduleRow(), scheduleRow({ id: 's2', action: 'backup.tested', frequency: 'monthly', grace_days: 0 })] })
      .mockResolvedValueOnce({ rows: [{ action: 'access.review.completed', last_at: new Date('2026-07-01T00:00:00Z') }] });

    const list = await listWithStatus(TENANT, new Date('2026-07-14T00:00:00Z'));
    expect(list).toHaveLength(2);

    const review = list.find(s => s.action === 'access.review.completed');
    expect(review.status).toBe('ok');
    expect(review.last_event_at).toBe('2026-07-01T00:00:00.000Z');

    const backup = list.find(s => s.action === 'backup.tested');
    expect(backup.status).toBe('overdue'); // never logged since 2026-01-01
    expect(backup.last_event_at).toBeNull();
  });

  test('overdueCountByTenant counts overdue controls per tenant, keeping zeros', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [
          // Overdue: never logged since 2026-01-01 (quarterly + 14d grace).
          scheduleRow(),
          // Ok: logged recently (see lastRows below).
          scheduleRow({ id: 's2', action: 'backup.tested' }),
          // Other tenant with nothing overdue reports an explicit zero.
          scheduleRow({ id: 's3', tenant_id: 'tenant-2' })
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          { tenant_id: TENANT, action: 'backup.tested', last_at: new Date('2026-07-01T00:00:00Z') },
          { tenant_id: 'tenant-2', action: 'access.review.completed', last_at: new Date('2026-07-01T00:00:00Z') }
        ]
      });

    const counts = await overdueCountByTenant(new Date('2026-07-14T00:00:00Z'));
    expect(counts.get(TENANT)).toBe(1);
    expect(counts.get('tenant-2')).toBe(0);
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
  });

  test('overdueCountByTenant skips the events query when there are no active schedules', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    expect(await overdueCountByTenant()).toEqual(new Map());
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  test('inactive schedules are reported but not evaluated', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [scheduleRow({ active: false })] })
      .mockResolvedValueOnce({ rows: [] });

    const [s] = await listWithStatus(TENANT, new Date('2026-07-14T00:00:00Z'));
    expect(s.status).toBe('inactive');
    expect(s.next_due_at).toBeNull();
  });
});
