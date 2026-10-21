import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getDeviceFingerprint } from '../utils/fingerprint';
import './Login.css';

export default function Register() {
  const { register, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const plan = params.get('plan');
  const redirect = params.get('redirect');
  const redirectUrl = plan && redirect === 'payment' ? `/payment?plan=${plan}` : '/dashboard';

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState(null); // { text, ok }

  // Already-logged-in users skip straight through.
  useEffect(() => {
    if (!authLoading && user) {
      if (redirectUrl.startsWith('/payment')) window.location.replace(redirectUrl); // not migrated yet
      else navigate(redirectUrl, { replace: true });
    }
  }, [authLoading, user, navigate, redirectUrl]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password || !confirm) {
      setMsg({ text: 'All fields are required.', ok: false });
      return;
    }
    if (password !== confirm) {
      setMsg({ text: 'Passwords do not match.', ok: false });
      return;
    }
    if (password.length < 6) {
      setMsg({ text: 'Password must be at least 6 characters.', ok: false });
      return;
    }

    setSubmitting(true);
    setMsg(null);
    try {
      await register({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        deviceFingerprint: getDeviceFingerprint(),
      });
      setMsg({ text: 'Account created! Redirecting...', ok: true });
      setTimeout(() => {
        if (redirectUrl.startsWith('/payment')) window.location.href = redirectUrl; // not migrated yet
        else navigate(redirectUrl, { replace: true });
      }, 900);
    } catch (err) {
      setMsg({ text: err.message || 'Registration failed.', ok: false });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page" style={{ padding: 24 }}>
      <div className="auth-card" style={{ maxWidth: 420 }}>
        <div className="auth-title">Create your account</div>
        <div className="auth-sub">Get started — it only takes a minute</div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="auth-field">
              <label htmlFor="firstName">First Name</label>
              <input id="firstName" className="auth-input" type="text" placeholder="John" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="auth-field">
              <label htmlFor="lastName">Last Name</label>
              <input id="lastName" className="auth-input" type="text" placeholder="Doe" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>

          <div className="auth-field">
            <label htmlFor="email">Email</label>
            <input id="email" className="auth-input" type="email" placeholder="you@example.com" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                className="auth-input"
                style={{ paddingRight: 52 }}
                type={showPw ? 'text' : 'password'}
                placeholder="Min. 6 characters"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="pw-toggle" onClick={() => setShowPw((v) => !v)}>{showPw ? 'Hide' : 'Show'}</button>
            </div>
          </div>

          <div className="auth-field">
            <label htmlFor="confirm">Confirm Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="confirm"
                className="auth-input"
                style={{ paddingRight: 52 }}
                type={showConfirm ? 'text' : 'password'}
                placeholder="Repeat password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <button type="button" className="pw-toggle" onClick={() => setShowConfirm((v) => !v)}>{showConfirm ? 'Hide' : 'Show'}</button>
            </div>
          </div>

          <button className="auth-btn" type="submit" disabled={submitting}>
            {submitting ? 'Creating account...' : 'Create Account'}
          </button>
          {msg && <div className="auth-msg" style={{ color: msg.ok ? '#29ffb8' : undefined }}>{msg.text}</div>}
        </form>

        <div className="auth-link">Already have an account? <Link to="/login">Sign in</Link></div>
      </div>
    </div>
  );
}
