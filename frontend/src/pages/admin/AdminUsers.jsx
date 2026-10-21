import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';

const fmt = (dt) => (dt ? new Date(dt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtDt = (dt) => (dt ? `${fmt(dt)} ${new Date(dt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '—');

function Badge({ status }) {
  return <span className={`adm-badge adm-badge-${status}`}>{status.charAt(0).toUpperCase() + status.slice(1)}</span>;
}

function TierModal({ email, currentTier, onClose, onPick }) {
  return (
    <div className="adm-tier-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-tier-modal">
        <h3 style={{ fontSize: 17, fontWeight: 800, marginBottom: 10 }}>Change Account Tier</h3>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Email: <strong>{email}</strong></p>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Current Tier: <strong style={{ color: currentTier === 'premium' ? '#2ecc71' : '#7a8199' }}>{currentTier === 'premium' ? '⭐ Premium' : 'Free'}</strong></p>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Set to:</label>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="adm-tier-btn" onClick={() => onPick('free')}>Free</button>
            <button className="adm-tier-btn premium" onClick={() => onPick('premium')}>⭐ Premium</button>
          </div>
        </div>
        <button className="adm-modal-btn-cancel" style={{ width: '100%' }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function UserDetailModal({ userId, onClose, onSuspended }) {
  const [state, setState] = useState({ loading: true, error: '', detail: null });
  const [msg, setMsg] = useState(null);
  const [toast, setToast] = useState(false);

  const load = useCallback(async () => {
    setState({ loading: true, error: '', detail: null });
    try {
      const d = await api.get(`/api/admin/users/${userId}/detail`);
      setState({ loading: false, error: '', detail: d });
    } catch (e) {
      setState({ loading: false, error: e.message, detail: null });
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  async function clearSecurityLogs() {
    if (!window.confirm('Clear all security logs for this user? This clears login history, blocked attempts, and resets the suspicious flag.')) return;
    try {
      await api.post(`/api/admin/users/${userId}/clear-security-logs`);
      await load();
      setToast(true);
      setTimeout(() => setToast(false), 2500);
    } catch (e) { window.alert(e.message); }
  }

  async function suspend() {
    if (!window.confirm('Suspend this user? They will lose access.')) return;
    try {
      await api.post(`/api/admin/users/suspend/${userId}`);
      setMsg({ text: 'User suspended.', ok: true });
      onSuspended();
    } catch (e) {
      setMsg({ text: e.message, ok: false });
    }
  }

  const { loading, error, detail } = state;
  const u = detail?.user;
  const history = u?.loginHistory || [];
  const last = history.length ? history[history.length - 1] : null;
  const blocked = u?.blockedAttempts || [];

  return (
    <div className="adm-modal-bg open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-modal adm-modal-wide">
        <div className="adm-modal-title">
          {loading ? 'Loading...' : error ? 'Error' : `Security — ${u.firstName || ''} ${u.lastName || ''} <${u.email || ''}>`}
        </div>
        {error && <div className="adm-modal-msg err">{error}</div>}
        {u && (
          <>
            <div className="adm-detail-section">
              <h4>Device Info</h4>
              <div className="adm-detail-kv">
                <span>Registered Device</span><span style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{u.deviceFingerprint || '(none)'}</span>
                <span>Suspicious Flag</span><span>{u.suspiciousActivity ? <span className="adm-badge adm-badge-warn">⚠️ Flagged</span> : <span style={{ color: 'var(--success)' }}>✓ Clean</span>}</span>
                <span>Unique IPs</span><span>{detail.uniqueIPs}</span>
                <span>Unique Devices</span><span>{detail.uniqueFingerprints}</span>
                <span>Blocked Attempts</span><span>{blocked.length || 'None'}</span>
              </div>
            </div>
            <div className="adm-detail-section">
              <h4>Currently Logged In From</h4>
              <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
                {last ? (
                  <>
                    <span style={{ color: 'var(--text)' }}>{last.ip || '—'}</span>{' '}
                    <span style={{ color: 'var(--muted)' }}>|</span>{' '}
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{(last.userAgent || '—').slice(0, 40)}</span>{' '}
                    <span style={{ color: 'var(--muted)' }}>|</span>{' '}
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                      {last.timestamp ? new Date(new Date(last.timestamp).getTime() + 5 * 3600000).toUTCString().replace(' GMT', ' PKT') : '—'}
                    </span>
                  </>
                ) : 'No active session'}
              </div>
              <button className="adm-act-btn" style={{ background: 'rgba(245,101,101,0.12)', color: '#f56565', border: '1px solid rgba(245,101,101,0.3)' }} onClick={clearSecurityLogs}>🗑 Clear Security Logs</button>
            </div>
            <div className="adm-detail-section">
              <h4>Login History (last 20)</h4>
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                <table className="adm-hist-table">
                  <thead><tr><th>Date</th><th>IP</th><th>User Agent</th><th>FP Match</th></tr></thead>
                  <tbody>
                    {!history.length ? <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>No login history</td></tr> : (
                      [...history].reverse().map((h, i) => (
                        <tr key={i}>
                          <td>{h.timestamp ? fmtDt(h.timestamp) : '—'}</td>
                          <td style={{ fontSize: 11 }}>{h.ip || '—'}</td>
                          <td style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h.userAgent || ''}>{(h.userAgent || '—').slice(0, 40)}</td>
                          <td>{h.fingerprintMatch ? <span style={{ color: 'var(--success)' }}>✅</span> : <span style={{ color: 'var(--danger)' }}>❌</span>}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            {blocked.length > 0 && (
              <div className="adm-detail-section">
                <h4>Blocked Login Attempts</h4>
                <div style={{ maxHeight: 140, overflowY: 'auto' }}>
                  <table className="adm-hist-table">
                    <thead><tr><th>Date</th><th>IP</th><th>Fingerprint</th></tr></thead>
                    <tbody>
                      {[...blocked].reverse().map((b, i) => (
                        <tr key={i}>
                          <td>{b.timestamp ? fmtDt(b.timestamp) : '—'}</td>
                          <td style={{ fontSize: 11 }}>{b.ip || '—'}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{b.fingerprint || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
        <div className="adm-modal-btns">
          <button className="adm-modal-btn-cancel" onClick={onClose}>Close</button>
          {u && u.role !== 'admin' && u.licenseStatus === 'active' && (
            <button className="adm-act-btn suspend" style={{ padding: '10px 16px', fontSize: 13 }} onClick={suspend}>Suspend License</button>
          )}
        </div>
        {msg && <div className={`adm-modal-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
      </div>
      {toast && <div className="adm-toast">Security logs cleared</div>}
    </div>
  );
}

export default function AdminUsers() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [aiToday, setAiToday] = useState(null);
  const [tierModal, setTierModal] = useState(null); // { id, email, currentTier }
  const [detailUserId, setDetailUserId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/admin/users');
      setUsers(data);
      setError('');
      try {
        const stats = await api.get('/api/admin/analysis/stats');
        setAiToday(stats.totalToday || 0);
      } catch {
        // Endpoint isn't implemented server-side yet — leave the stat blank, same as the legacy page.
      }
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = users ? users.filter((u) =>
    `${u.firstName} ${u.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(search.toLowerCase())
  ) : [];
  const PER_PAGE = 10;
  const slice = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  async function suspendUser(id) {
    if (!window.confirm('Suspend this user? They will lose access.')) return;
    try { await api.post(`/api/admin/users/suspend/${id}`); load(); } catch (e) { window.alert(e.message); }
  }
  async function reactivateUser(id) {
    try { await api.post(`/api/admin/users/reactivate/${id}`); load(); } catch (e) { window.alert(e.message); }
  }
  async function deleteUser(id) {
    if (!window.confirm('Permanently delete this user account?')) return;
    try { await api.del(`/api/admin/users/${id}`); load(); } catch (e) { window.alert(e.message); }
  }
  async function resetAiLimit(id) {
    if (!window.confirm('Reset AI daily usage for this user?')) return;
    try { await api.post(`/api/admin/users/${id}/reset-ai-limit`, {}); load(); } catch (e) { window.alert(e.message); }
  }
  async function setUserTier(tier) {
    if (!tierModal) return;
    try {
      await api.post(`/api/admin/users/${tierModal.id}/tier`, { accountTier: tier });
      setTierModal(null);
      load();
    } catch (e) { window.alert(e.message); }
  }

  if (error) return <div className="adm-empty-row" style={{ color: 'var(--danger)' }}>{error}</div>;

  return (
    <div>
      <div className="adm-top-bar">
        <div style={{ fontSize: 15, fontWeight: 700 }}>Registered Users</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto', marginRight: 10 }}>AI Today: {aiToday ?? '—'}</div>
        <input className="adm-search-inp" placeholder="Search by name or email…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>
      <div className="adm-card" style={{ padding: 0 }}>
        <div className="adm-tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Tier</th><th>License Key</th><th>License Status</th>
                <th>AI Today</th><th>Last Login</th><th>Last IP</th><th>Security</th><th>Joined</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!users ? (
                <tr className="adm-empty-row"><td colSpan={11}>Loading...</td></tr>
              ) : !filtered.length ? (
                <tr className="adm-empty-row"><td colSpan={11}>No users yet</td></tr>
              ) : slice.map((u) => {
                const isAdmin = u.role === 'admin';
                const aiUsed = Number(u.aiAnalysisCount || 0);
                return (
                  <tr key={u._id}>
                    <td>
                      {u.firstName || ''} {u.lastName || ''}
                      {isAdmin && <span className="adm-badge adm-badge-active" style={{ fontSize: 10, marginLeft: 4 }}>Admin</span>}
                      {u.suspiciousActivity && <span className="adm-badge adm-badge-warn" title="Suspicious activity detected" style={{ marginLeft: 4 }}>⚠️</span>}
                    </td>
                    <td>{u.email || ''}</td>
                    <td><span className={`adm-badge ${u.accountTier === 'premium' ? 'adm-badge-active' : 'adm-badge-inactive'}`}>{u.accountTier === 'premium' ? '⭐ Premium' : 'Free'}</span></td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{u.licenseKey || '—'}</td>
                    <td><Badge status={u.licenseStatus || 'inactive'} /></td>
                    <td style={{ fontSize: 12, color: u.accountTier === 'premium' ? 'var(--success)' : 'var(--muted)' }}>{u.accountTier === 'premium' ? 'Unlimited' : `${aiUsed}/3`}</td>
                    <td>{fmtDt(u.lastLogin)}</td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{u.lastIp || '—'}</td>
                    <td>{u.suspiciousActivity ? <span className="adm-badge adm-badge-warn">⚠️ Flagged</span> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>OK</span>}</td>
                    <td>{fmt(u.createdAt)}</td>
                    <td>
                      <div className="adm-acts">
                        {!isAdmin && (
                          <>
                            {u.licenseStatus === 'active' && <button className="adm-act-btn suspend" title="Suspend" onClick={() => suspendUser(u._id)}>⛔</button>}
                            {u.licenseStatus === 'suspended' && <button className="adm-act-btn reactivate" title="Reactivate" onClick={() => reactivateUser(u._id)}>✅</button>}
                            <button className="adm-act-btn tier" title="Change Tier" onClick={() => setTierModal({ id: u._id, email: u.email, currentTier: u.accountTier })}>⭐</button>
                            <button className="adm-act-btn reset" title="Reset AI Limit" onClick={() => resetAiLimit(u._id)}>♻️</button>
                            <button className="adm-act-btn delete" title="Delete" onClick={() => deleteUser(u._id)}>🗑️</button>
                          </>
                        )}
                        <button className="adm-act-btn info" title="Security" onClick={() => setDetailUserId(u._id)}>🛡️</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {users && filtered.length > 0 && <Pagination page={page} perPage={PER_PAGE} total={filtered.length} onChange={setPage} />}
      </div>

      {tierModal && (
        <TierModal email={tierModal.email} currentTier={tierModal.currentTier} onClose={() => setTierModal(null)} onPick={setUserTier} />
      )}
      {detailUserId && (
        <UserDetailModal userId={detailUserId} onClose={() => setDetailUserId(null)} onSuspended={load} />
      )}
    </div>
  );
}
