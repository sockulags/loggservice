import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

const STATUS_LABEL = {
  ok: 'on time',
  due: 'due',
  overdue: 'overdue',
  inactive: 'inactive'
};

function Schedules({ user }) {
  const [schedules, setSchedules] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [form, setForm] = useState({ action: '', title: '', frequency: 'quarterly', grace_days: 14 });
  const [error, setError] = useState(null);

  const canEdit = user && (user.role === 'admin' || user.role === 'editor');

  const load = useCallback(() => {
    api.schedules().then(res => setSchedules(res.data.schedules)).catch(() => {});
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    api.catalog().then(res => setCatalog(res.data.actions)).catch(() => {});
  }, []);

  const create = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.createSchedule({ ...form, grace_days: Number(form.grace_days) });
      setForm({ action: '', title: '', frequency: 'quarterly', grace_days: 14 });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create schedule');
    }
  };

  const toggleActive = async (s) => {
    await api.patchSchedule(s.id, { active: !s.active });
    load();
  };

  const remove = async (s) => {
    await api.deleteSchedule(s.id);
    load();
  };

  const overdue = schedules.filter(s => s.status === 'overdue').length;

  return (
    <section className="schedules-view">
      <div className="card">
        <h2>Scheduled controls</h2>
        <p className="hint">
          The chain proves what was recorded is genuine; schedules surface what
          should have been recorded but wasn't. Overdue controls appear in the
          PDF report.
        </p>
        {schedules.length > 0 && (
          <p className={overdue ? 'sched-summary overdue' : 'sched-summary ok'}>
            {overdue
              ? `${overdue} of ${schedules.length} scheduled control(s) overdue`
              : `All ${schedules.length} scheduled control(s) on time`}
          </p>
        )}
        <table className="admin-table">
          <thead>
            <tr><th>control</th><th>frequency</th><th>last logged</th><th>next due</th><th>status</th>{canEdit && <th></th>}</tr>
          </thead>
          <tbody>
            {schedules.map(s => (
              <tr key={s.id} className={s.active ? '' : 'disabled-row'}>
                <td>
                  <div>{s.title || s.action}</div>
                  <div className="mono hint">{s.action}</div>
                </td>
                <td>{s.frequency}{s.grace_days > 0 ? ` (+${s.grace_days}d grace)` : ''}</td>
                <td className="mono time">{s.last_event_at ? s.last_event_at.slice(0, 10) : 'never'}</td>
                <td className="mono time">{s.next_due_at ? s.next_due_at.slice(0, 10) : '—'}</td>
                <td><span className={`sched-status ${s.status}`}>{STATUS_LABEL[s.status] || s.status}</span></td>
                {canEdit && (
                  <td className="row-actions">
                    <button className="btn tiny" onClick={() => toggleActive(s)}>
                      {s.active ? 'pause' : 'resume'}
                    </button>
                    {user.role === 'admin' && (
                      <button className="btn tiny" onClick={() => remove(s)}>remove</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!schedules.length && (
              <tr><td colSpan={canEdit ? 6 : 5} className="hint">No scheduled controls yet.</td></tr>
            )}
          </tbody>
        </table>

        {canEdit && (
          <form className="inline-form" onSubmit={create}>
            <input
              placeholder="action (e.g. access.review.completed)"
              list="schedule-actions"
              value={form.action}
              onChange={e => setForm(f => ({ ...f, action: e.target.value }))}
              required
            />
            <datalist id="schedule-actions">
              {catalog.map(a => <option key={a.action} value={a.action}>{a.title}</option>)}
            </datalist>
            <input
              placeholder="title (optional)"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            />
            <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
              {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <input
              type="number" min="0" max="365" title="grace days"
              value={form.grace_days}
              onChange={e => setForm(f => ({ ...f, grace_days: e.target.value }))}
            />
            <button className="btn primary" type="submit">Add schedule</button>
          </form>
        )}
        {error && <p className="form-error">{error}</p>}
      </div>
    </section>
  );
}

export default Schedules;
