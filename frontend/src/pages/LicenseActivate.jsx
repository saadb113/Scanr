import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { getDeviceFingerprint } from '../utils/fingerprint';
import './Login.css';
import './LicenseActivate.css';

export default function LicenseActivate() {
  const { logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [key, setKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState(null); // { text, ok }

  async function handleActivate() {
    const trimmed = key.trim().toUpperCase();
    if (!trimmed) {
      setMsg({ text: 'Please enter your license key.', ok: false });
      return;
    }
    setSubmitting(true);
    setMsg(null);
    try {
      await api.post('/api/license/activate', { key: trimmed, deviceFingerprint: getDeviceFingerprint() });
      setMsg({ text: 'License activated! Redirecting...', ok: true });
      await refreshUser();
      setTimeout(() => { window.location.href = '/'; }, 1000); // '/' not migrated yet
    } catch (err) {
      setMsg({ text: err.message || 'Activation failed.', ok: false });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="auth-page">
      <div className="lic-card">
        <div className="lic-icon">🔑</div>
        <h1>Activate Your License</h1>
        <p className="lic-sub">Enter the license key you received after purchase to unlock full access.</p>

        <label>License Key</label>
        <input
          className="key-input"
          type="text"
          placeholder="SCAN-XXXX-XXXX-XXXX-XXXX"
          maxLength={24}
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleActivate(); }}
        />
        <button className="auth-btn" disabled={submitting} onClick={handleActivate}>
          {submitting ? 'Activating...' : 'Activate'}
        </button>
        {msg && <div className="lic-msg" style={{ color: msg.ok ? '#29ffb8' : '#f56565' }}>{msg.text}</div>}

        <hr className="lic-divider" />
        <p className="lic-wa-text">Don't have a license key? Email us at support@scanr.me.</p>
        <a className="wa-btn" href="mailto:support@scanr.me?subject=License%20Activation%20Help">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" /></svg>
          Contact via Email
        </a>
        <br />
        <button className="licensesignout" onClick={handleSignOut}>🚪 Sign Out</button>
        <p className="lic-signin-link">Already have an account? <Link to="/login">Sign in</Link></p>
      </div>
    </div>
  );
}
