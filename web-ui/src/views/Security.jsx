import React, { useState, useEffect, useCallback } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import api from '../api';

function Passkeys() {
  const [enabled, setEnabled] = useState(false);
  const [passkeys, setPasskeys] = useState([]);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.passkeys().then(res => setPasskeys(res.data.passkeys)).catch(() => {});
  }, []);

  useEffect(() => {
    api.passkeyConfig()
      .then(res => setEnabled(Boolean(res.data.enabled)))
      .catch(() => setEnabled(false));
    load();
  }, [load]);

  const register = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const { data } = await api.passkeyRegisterOptions(password);
      const response = await startRegistration({ optionsJSON: data.options });
      await api.passkeyRegisterVerify(data.challenge_id, response, name || undefined);
      setPassword('');
      setName('');
      setMessage('Passkey registered.');
      load();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to register passkey');
    }
  };

  const remove = async (pk) => {
    await api.passkeyDelete(pk.id);
    load();
  };

  return (
    <div className="card">
      <h2>Passkeys</h2>
      {!enabled && (
        <p className="hint">
          Not enabled on this instance. Passkeys need HTTPS and a stable domain —
          set <code>WEBAUTHN_ORIGIN</code> on the server to turn them on.
          {passkeys.length > 0 && ' Your registered passkeys are listed below but cannot be used until then.'}
        </p>
      )}
      {enabled && (
        <p className="hint">
          A passkey signs you in without a password and counts as MFA on its
          own. Registering one requires your password.
        </p>
      )}

      {passkeys.length > 0 && (
        <table className="admin-table">
          <thead><tr><th>name</th><th>created</th><th>last used</th><th></th></tr></thead>
          <tbody>
            {passkeys.map(pk => (
              <tr key={pk.id}>
                <td>{pk.name || 'unnamed passkey'}</td>
                <td className="mono time">{String(pk.created_at).slice(0, 10)}</td>
                <td className="mono time">{pk.last_used_at ? String(pk.last_used_at).slice(0, 10) : '—'}</td>
                <td className="row-actions">
                  <button className="btn tiny" onClick={() => remove(pk)}>remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {enabled && (
        <form className="inline-form" onSubmit={register}>
          <input
            placeholder="name (e.g. work laptop)"
            value={name} onChange={e => setName(e.target.value)}
          />
          <input
            type="password" placeholder="account password" autoComplete="current-password"
            value={password} onChange={e => setPassword(e.target.value)} required
          />
          <button className="btn primary" type="submit">Add passkey</button>
        </form>
      )}
      {message && <p className="ok-message">{message}</p>}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setMessage('Password changed. Other sessions have been signed out.');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to change password');
    }
  };

  return (
    <div className="card">
      <h2>Change password</h2>
      <p className="hint">
        Change the initial password you were given as soon as you sign in.
        Changing it signs out every other session.
      </p>
      <form className="inline-form" onSubmit={submit}>
        <input
          type="password" placeholder="current password" autoComplete="current-password"
          value={current} onChange={e => setCurrent(e.target.value)} required
        />
        <input
          type="password" placeholder="new password (min 10 chars)" autoComplete="new-password"
          minLength={10} value={next} onChange={e => setNext(e.target.value)} required
        />
        <button className="btn primary" type="submit">Change password</button>
      </form>
      {message && <p className="ok-message">{message}</p>}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function Sessions() {
  const [sessions, setSessions] = useState([]);
  const [message, setMessage] = useState(null);

  const load = useCallback(() => {
    api.sessions().then(res => setSessions(res.data.sessions)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const revoke = async (s) => {
    await api.revokeSession(s.id);
    load();
  };

  const revokeOthers = async () => {
    const res = await api.revokeOtherSessions();
    setMessage(`Signed out ${res.data.revoked} other session(s).`);
    load();
  };

  const when = (t) => (t ? String(t).slice(0, 16).replace('T', ' ') : '—');

  return (
    <div className="card">
      <h2>Active sessions</h2>
      <p className="hint">
        Everywhere your account is signed in. Revoke anything you don't
        recognize — and change your password.
      </p>
      <table className="admin-table">
        <thead><tr><th>browser</th><th>signed in</th><th>last active</th><th></th></tr></thead>
        <tbody>
          {sessions.map(s => (
            <tr key={s.id}>
              <td>
                {s.user_agent ? s.user_agent.slice(0, 60) : 'unknown'}
                {s.current && <span className="role-chip" style={{ marginLeft: '0.5rem' }}>this session</span>}
              </td>
              <td className="mono time">{when(s.created_at)}</td>
              <td className="mono time">{when(s.last_used_at)}</td>
              <td className="row-actions">
                {!s.current && <button className="btn tiny" onClick={() => revoke(s)}>revoke</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sessions.length > 1 && (
        <div className="button-row">
          <button className="btn" onClick={revokeOthers}>Sign out everywhere else</button>
        </div>
      )}
      {message && <p className="ok-message">{message}</p>}
    </div>
  );
}

function Security() {
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const startSetup = async () => {
    setError(null);
    setMessage(null);
    setRecoveryCodes(null);
    try {
      const res = await api.totpSetup();
      setSetup(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start TOTP setup');
    }
  };

  const enable = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.totpEnable(code);
      setRecoveryCodes(res.data.recovery_codes);
      setSetup(null);
      setCode('');
      setMessage('TOTP is now enabled for your account.');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to enable TOTP');
    }
  };

  const disable = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api.totpDisable(password);
      setPassword('');
      setRecoveryCodes(null);
      setMessage('TOTP disabled.');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to disable TOTP');
    }
  };

  return (
    <section className="security-view">
      <ChangePassword />
      <Sessions />
      <Passkeys />
      <div className="card">
        <h2>Two-factor authentication (TOTP)</h2>
        <p className="hint">
          Passkeys are on the roadmap; TOTP works everywhere today — including
          intranet installations without TLS.
        </p>

        {!setup && (
          <div className="button-row">
            <button className="btn primary" onClick={startSetup}>Set up TOTP</button>
          </div>
        )}

        {setup && (
          <form onSubmit={enable}>
            <p>Add this secret to your authenticator app:</p>
            <code className="mono block">{setup.secret}</code>
            <p className="hint mono block">{setup.otpauth_url}</p>
            <label>
              Enter the 6-digit code to confirm
              <input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoFocus />
            </label>
            <button className="btn primary" type="submit">Enable TOTP</button>
          </form>
        )}

        {recoveryCodes && (
          <div className="one-time">
            <strong>Recovery codes</strong> — each works once, store them safely:
            <div className="recovery-grid">
              {recoveryCodes.map(rc => <code key={rc} className="mono">{rc}</code>)}
            </div>
          </div>
        )}

        <form className="inline-form" onSubmit={disable}>
          <input
            type="password"
            placeholder="password to disable TOTP"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <button className="btn" type="submit" disabled={!password}>Disable TOTP</button>
        </form>

        {message && <p className="ok-message">{message}</p>}
        {error && <p className="form-error">{error}</p>}
      </div>
    </section>
  );
}

export default Security;
