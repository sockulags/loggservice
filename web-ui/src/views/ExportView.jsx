import React, { useState } from 'react';
import { exportUrls } from '../api';

function ExportView() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [framework, setFramework] = useState('all');

  const fromIso = from ? new Date(from).toISOString() : '';
  const toIso = to ? new Date(to).toISOString() : '';

  return (
    <section className="export-view">
      <div className="card">
        <h2>Export</h2>
        <p>
          Exports are what you hand to an auditor. The JSONL file is verifiable
          offline with <code>scripts/verify-export.js</code> — no access to this
          server needed. The PDF is a formatted report mapped to SOC 2 criteria
          and NIS2 articles.
        </p>

        <div className="field-row">
          <label>
            From
            <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} />
          </label>
          <label>
            Framework
            <select value={framework} onChange={e => setFramework(e.target.value)}>
              <option value="all">SOC 2 + NIS2</option>
              <option value="soc2">SOC 2 only</option>
              <option value="nis2">NIS2 only</option>
            </select>
          </label>
        </div>

        <div className="button-row">
          <a className="btn primary" href={exportUrls.report(fromIso, toIso, framework)}>
            Download PDF report
          </a>
          <a className="btn" href={exportUrls.jsonl(fromIso, toIso)}>
            Download JSONL (verifiable)
          </a>
        </div>

        <p className="hint">
          Leave the range empty to export everything.
        </p>
      </div>
    </section>
  );
}

export default ExportView;
