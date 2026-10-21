import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import AdminLicenses from './AdminLicenses';
import AdminUsers from './AdminUsers';
import AdminRevenue from './AdminRevenue';
import AdminSettings from './AdminSettings';
import AdminContacts from './AdminContacts';
import './Admin.css';

// "Payments" tab intentionally omitted — its entire backend
// (/api/admin/payments, /api/admin/payment/verify|reject) doesn't exist
// server-side, same as the public payment flow. Nothing to show.
const TABS = [
  { key: 'licenses', label: '🗝️ Licenses' },
  { key: 'users', label: '👥 Users' },
  { key: 'revenue', label: '💰 Revenue' },
  { key: 'settings', label: '⚙️ Settings' },
  { key: 'contacts', label: '📬 Contacts' },
];

export default function Admin() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('licenses');
  const [appName, setAppName] = useState('SCANR');
  const [unreadContacts, setUnreadContacts] = useState(0);

  useEffect(() => {
    api.get('/api/public/app-name').then((d) => {
      if (d?.appName) setAppName(d.appName);
    }).catch(() => {});
  }, []);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="adm-root">
      <div className="adm-hdr">
        <div className="adm-hdr-logo">{appName}<span>.</span> <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>Admin</span></div>
        <div className="adm-hdr-right">
          <a className="adm-hdr-link" href="/dashboard">← Back to App</a>
          <button className="adm-logout-btn" onClick={handleLogout}>Sign Out</button>
        </div>
      </div>

      <div className="adm-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`adm-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'contacts' && unreadContacts > 0 && <span className="adm-tab-badge">{unreadContacts}</span>}
          </button>
        ))}
      </div>

      <div className="adm-content">
        {tab === 'licenses' && <AdminLicenses />}
        {tab === 'users' && <AdminUsers />}
        {tab === 'revenue' && <AdminRevenue />}
        {tab === 'settings' && <AdminSettings />}
        {tab === 'contacts' && <AdminContacts onUnreadChange={setUnreadContacts} />}
      </div>
    </div>
  );
}
