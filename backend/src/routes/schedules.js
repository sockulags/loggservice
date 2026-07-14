const express = require('express');
const { randomUUID } = require('crypto');
const { getPool } = require('../database');
const { appendEvent } = require('../services/chain');
const { FREQUENCIES, listWithStatus, rowToSchedule } = require('../services/schedules');
const { requireAuth, requestTenantId } = require('../middleware/apikey');
const { isValidActionFormat } = require('../actions');
const logger = require('../logger');

const router = express.Router();

/**
 * Schedule changes alter what the audit trail promises to contain, so they
 * are session-user-only (API keys record events, humans manage the control
 * plan) and every change is itself appended to the chain.
 */
function requireSessionRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(403).json({ error: 'Schedule changes require a signed-in user' });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient role' });
    }
    return next();
  };
}

async function recordScheduleChange(req, action, schedule) {
  await appendEvent(requestTenantId(req), {
    actor: {
      type: 'user',
      id: req.user.email,
      recorded_by: { via: 'user', id: req.user.id, email: req.user.email }
    },
    action,
    target: { type: 'schedule', id: schedule.id, name: schedule.action },
    context: {
      schedule_action: schedule.action,
      frequency: schedule.frequency,
      grace_days: schedule.grace_days,
      active: schedule.active
    }
  });
}

// GET /api/schedules — all schedules with computed ok/due/overdue status.
router.get('/', requireAuth(), async (req, res) => {
  try {
    const schedules = await listWithStatus(requestTenantId(req));
    const overdue = schedules.filter(s => s.status === 'overdue').length;
    res.json({ schedules, overdue });
  } catch (error) {
    logger.error({ err: error }, 'Error listing schedules');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/schedules — create a scheduled control.
router.post('/', requireSessionRole('admin', 'editor'), async (req, res) => {
  try {
    const { action, title, frequency, grace_days } = req.body || {};
    if (!isValidActionFormat(action)) {
      return res.status(400).json({ error: 'action is required and must be namespaced, e.g. "access.review.completed"' });
    }
    if (!FREQUENCIES.includes(frequency)) {
      return res.status(400).json({ error: `frequency must be one of: ${FREQUENCIES.join(', ')}` });
    }
    const grace = grace_days === undefined ? 0 : parseInt(grace_days);
    if (!Number.isInteger(grace) || grace < 0 || grace > 365) {
      return res.status(400).json({ error: 'grace_days must be an integer between 0 and 365' });
    }
    if (title !== undefined && (typeof title !== 'string' || title.length > 200)) {
      return res.status(400).json({ error: 'title must be a string of at most 200 characters' });
    }

    const { rows } = await getPool().query(
      `INSERT INTO schedules (id, tenant_id, action, title, frequency, grace_days, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, action) DO NOTHING
       RETURNING *`,
      [randomUUID(), requestTenantId(req), action, title || null, frequency, grace, req.user.email]
    );
    if (!rows.length) {
      return res.status(409).json({ error: 'A schedule for this action already exists' });
    }

    const schedule = rowToSchedule(rows[0]);
    await recordScheduleChange(req, 'control.schedule.created', schedule);
    res.status(201).json({ schedule });
  } catch (error) {
    logger.error({ err: error }, 'Error creating schedule');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/schedules/:id — update frequency, grace, title or active flag.
router.patch('/:id', requireSessionRole('admin', 'editor'), async (req, res) => {
  try {
    const { title, frequency, grace_days, active } = req.body || {};
    const updates = [];
    const params = [];

    if (frequency !== undefined) {
      if (!FREQUENCIES.includes(frequency)) {
        return res.status(400).json({ error: `frequency must be one of: ${FREQUENCIES.join(', ')}` });
      }
      params.push(frequency);
      updates.push(`frequency = $${params.length}`);
    }
    if (grace_days !== undefined) {
      const grace = parseInt(grace_days);
      if (!Number.isInteger(grace) || grace < 0 || grace > 365) {
        return res.status(400).json({ error: 'grace_days must be an integer between 0 and 365' });
      }
      params.push(grace);
      updates.push(`grace_days = $${params.length}`);
    }
    if (title !== undefined) {
      if (typeof title !== 'string' || title.length > 200) {
        return res.status(400).json({ error: 'title must be a string of at most 200 characters' });
      }
      params.push(title);
      updates.push(`title = $${params.length}`);
    }
    if (active !== undefined) {
      if (typeof active !== 'boolean') {
        return res.status(400).json({ error: 'active must be a boolean' });
      }
      params.push(active);
      updates.push(`active = $${params.length}`);
    }
    if (!updates.length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    params.push(req.params.id, requestTenantId(req));
    const { rows } = await getPool().query(
      `UPDATE schedules SET ${updates.join(', ')}
       WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
       RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Schedule not found' });

    const schedule = rowToSchedule(rows[0]);
    await recordScheduleChange(req, 'control.schedule.updated', schedule);
    res.json({ schedule });
  } catch (error) {
    logger.error({ err: error }, 'Error updating schedule');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/schedules/:id — remove a scheduled control (admin only).
router.delete('/:id', requireSessionRole('admin'), async (req, res) => {
  try {
    const { rows } = await getPool().query(
      'DELETE FROM schedules WHERE id = $1 AND tenant_id = $2 RETURNING *',
      [req.params.id, requestTenantId(req)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Schedule not found' });

    const schedule = rowToSchedule(rows[0]);
    await recordScheduleChange(req, 'control.schedule.removed', schedule);
    res.json({ removed: true });
  } catch (error) {
    logger.error({ err: error }, 'Error deleting schedule');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
