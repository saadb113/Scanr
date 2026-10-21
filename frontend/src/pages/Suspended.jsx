import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Suspended.css';

export default function Suspended() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const expired = params.get('reason') === 'expired';

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="auth-page">
      <div className="susp-card">
        <div className="susp-icon">{expired ? '⏰' : '⚠️'}</div>
        <h1>{expired ? 'Your Demo License Has Expired' : 'Your License Has Been Suspended'}</h1>
        <p>
          {expired
            ? 'Your demo license has expired. Email us at support@scanr.me to get full access.'
            : 'Your access to this application has been suspended. Please contact support to resolve this issue and restore your access.'}
        </p>
        <a className="susp-wa-btn" href="mailto:support@scanr.me?subject=License%20Support">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" /></svg>
          Contact Support via Email
        </a>
        <button className="susp-logout-btn" onClick={handleLogout}>Sign Out</button>
      </div>
    </div>
  );
}
