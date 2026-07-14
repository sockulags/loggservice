const { getPool } = require('../database');

/**
 * Scheduled controls: "this activity must be logged at least this often".
 * The complement of the hash chain — the chain proves recorded history is
 * genuine, schedules surface what should have been recorded but wasn't.
 */

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

/** Next due date: one frequency interval after the base date. */
function nextDue(base, frequency) {
  const d = new Date(base);
  switch (frequency) {
    case 'daily': d.setUTCDate(d.getUTCDate() + 1); break;
    case 'weekly': d.setUTCDate(d.getUTCDate() + 7); break;
    case 'monthly': d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'quarterly': d.setUTCMonth(d.getUTCMonth() + 3); break;
    case 'yearly': d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    default: throw new Error(`Unknown frequency: ${frequency}`);
  }
  return d;
}

/**
 * Status for one schedule given the last time its action was logged.
 * Never logged: the schedule's creation date starts the clock.
 */
function scheduleStatus(schedule, lastEventAt, now = new Date()) {
  const base = lastEventAt ? new Date(lastEventAt) : new Date(schedule.created_at);
  const due = nextDue(base, schedule.frequency);
  const deadline = new Date(due.getTime() + schedule.grace_days * 24 * 60 * 60 * 1000);

  let status = 'ok';
  if (now > deadline) status = 'overdue';
  else if (now > due) status = 'due';

  return {
    status,
    last_event_at: lastEventAt ? new Date(lastEventAt).toISOString() : null,
    next_due_at: due.toISOString(),
    deadline_at: deadline.toISOString()
  };
}

function rowToSchedule(row) {
  return {
    id: row.id,
    action: row.action,
    title: row.title,
    frequency: row.frequency,
    grace_days: row.grace_days,
    active: row.active,
    created_by: row.created_by,
    created_at: new Date(row.created_at).toISOString()
  };
}

/** All schedules for a tenant with computed status. */
async function listWithStatus(tenantId, now = new Date()) {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM schedules WHERE tenant_id = $1 ORDER BY created_at ASC',
    [tenantId]
  );
  if (!rows.length) return [];

  const actions = rows.map(r => r.action);
  const { rows: lastRows } = await pool.query(
    `SELECT action, MAX(occurred_at) AS last_at
     FROM events WHERE tenant_id = $1 AND action = ANY($2)
     GROUP BY action`,
    [tenantId, actions]
  );
  const lastByAction = new Map(lastRows.map(r => [r.action, r.last_at]));

  return rows.map(row => {
    const schedule = rowToSchedule(row);
    if (!row.active) return { ...schedule, status: 'inactive', last_event_at: null, next_due_at: null, deadline_at: null };
    return { ...schedule, ...scheduleStatus(row, lastByAction.get(row.action) || null, now) };
  });
}

module.exports = { FREQUENCIES, nextDue, scheduleStatus, listWithStatus, rowToSchedule };
