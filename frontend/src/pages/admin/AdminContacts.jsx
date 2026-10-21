import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';

const fmtDt = (dt) => (dt ? `${new Date(dt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${new Date(dt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '—');
const PER_PAGE = 10;

export default function AdminContacts({ onUnreadChange }) {
  const [contacts, setContacts] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/admin/contacts');
      setContacts(data);
      setError('');
      onUnreadChange?.(data.filter((c) => !c.read).length);
    } catch (e) {
      setError(e.message);
    }
  }, [onUnreadChange]);

  useEffect(() => { load(); }, [load]);

  async function markRead(id) {
    setBusyId(id);
    try { await api.post(`/api/admin/contacts/${id}/read`); await load(); }
    catch (e) { window.alert(e.message); }
    finally { setBusyId(null); }
  }
  async function del(id) {
    if (!window.confirm('Delete this contact submission?')) return;
    setBusyId(id);
    try { await api.del(`/api/admin/contacts/${id}`); await load(); }
    catch (e) { window.alert(e.message); }
    finally { setBusyId(null); }
  }

  if (error) return <div className="adm-empty-row" style={{ color: 'var(--danger)' }}>{error}</div>;

  const unread = contacts ? contacts.filter((c) => !c.read).length : 0;
  const slice = contacts ? contacts.slice((page - 1) * PER_PAGE, page * PER_PAGE) : [];

  return (
    <div>
      <div className="adm-top-bar">
        <div style={{ fontSize: 15, fontWeight: 700 }}>Contact Submissions</div>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{contacts ? (unread > 0 ? `${unread} unread` : contacts.length ? 'All read' : '') : ''}</span>
      </div>
      <div className="adm-card" style={{ padding: 0 }}>
        <div className="adm-tbl-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Phone</th><th>Message</th><th>Date</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {!contacts ? (
                <tr className="adm-empty-row"><td colSpan={7}>Loading…</td></tr>
              ) : !contacts.length ? (
                <tr className="adm-empty-row"><td colSpan={7}>No contact submissions yet.</td></tr>
              ) : slice.map((c) => (
                <tr key={c._id} style={!c.read ? { background: 'rgba(239,68,68,0.04)' } : undefined}>
                  <td style={{ fontWeight: c.read ? 400 : 700 }}>{c.name}</td>
                  <td><a href={`mailto:${c.email}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{c.email}</a></td>
                  <td>{c.phone || '—'}</td>
                  <td style={{ maxWidth: 260, whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--muted)' }}>{c.message.slice(0, 120)}{c.message.length > 120 ? '…' : ''}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDt(c.createdAt)}</td>
                  <td>{c.read ? <span className="adm-badge adm-badge-active">Read</span> : <span className="adm-badge adm-badge-warn">Unread</span>}</td>
                  <td className="adm-acts">
                    {!c.read && <button className="adm-act-btn info" title="Mark Read" disabled={busyId === c._id} onClick={() => markRead(c._id)}>✅</button>}
                    <button className="adm-act-btn delete" title="Delete" disabled={busyId === c._id} onClick={() => del(c._id)}>🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {contacts && contacts.length > 0 && <Pagination page={page} perPage={PER_PAGE} total={contacts.length} onChange={setPage} />}
      </div>
    </div>
  );
}
