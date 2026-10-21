import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getDeviceFingerprint } from '../utils/fingerprint';
import './Login.css';

export default function Login() {
  const { login, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const kicked = params.get('kicked') === 'true';
  const next = params.get('next');
  const redirectTarget = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  // Already-logged-in users skip straight to the dashboard.
  useEffect(() => {
    if (!authLoading && user) navigate(redirectTarget, { replace: true });
  }, [authLoading, user, navigate, redirectTarget]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Please enter email and password.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const result = await login(email.trim(), password, getDeviceFingerprint());
      if (result?.licenseStatus === 'suspended') {
        navigate('/suspended');
        return;
      }
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        {kicked && (
          <div className="kicked-banner">
            <div className="kicked-banner-icon">⚠️</div>
            Your previous session was ended because your account was accessed from another device or browser.
          </div>
        )}
        <div className="auth-title">Welcome back</div>
        <div className="auth-sub">Sign in to your account</div>

        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="auth-input"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="auth-input"
              type="password"
              placeholder="Your password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button className="auth-btn" type="submit" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
          {error && <div className="auth-msg">{error}</div>}
        </form>

        <div className="auth-link">
          Don't have an account? <Link to="/register?plan=free">Register</Link>
        </div>
      </div>
    </div>
  );
}
