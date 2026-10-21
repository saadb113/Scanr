import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';

const fmt = (dt) => (dt ? new Date(dt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtDt = (dt) => (dt ? `${fmt(dt)} ${new Date(dt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '—');

function Badge({ status }) {
  return <span className={`adm-badge adm-badge-${status}`}>{status.charAt(0).toUpperCase() + status.slice(1)}</span>;
}

const emptyForm = { buyerName: '', buyerContact: '', purchaseDate: new Date().toISOString().split('T')[0], price: '', currency: 'USD', notes: '', expireToggle: false, expireAmount: '7', expireUnit: 'days' };

export default function AdminLicenses() {
  const [licenses, setLicenses] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [createMsg, setCreateMsg] = useState('');
  const [creating, setCreating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/admin/licenses');
      setLicenses(data);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const sorted = licenses ? [...licenses].sort((a, b) => {
    const now = new Date();
    const aExp = a.expiresAt && now > new Date(a.expiresAt);
    const bExp = b.expiresAt && now > new Date(b.expiresAt);
    return aExp === bExp ? 0 : aExp ? 1 : -1;
  }) : [];
  const PER_PAGE = 10;
  const slice = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  async function suspendLicense(id) {
    if (!window.confirm('Suspend this license? The user will lose access.')) return;
    try { await api.post(`/api/admin/licenses/suspend/${id}`); load(); } catch (e) { window.alert(e.message); }
  }
  async function reactivateLicense(id) {
    try { await api.post(`/api/admin/licenses/reactivate/${id}`); load(); } catch (e) { window.alert(e.message); }
  }
  async function deleteLicense(id, key, status) {
    let msg = `Are you sure you want to delete license ${key || id}?\nThis cannot be undone.`;
    if (status === 'active') msg += '\n\n⚠️ This license is active — the user will lose access immediately.';
    if (!window.confirm(msg)) return;
    try { await api.del(`/api/admin/licenses/${id}`); load(); } catch (e) { window.alert(e.message); }
  }
  async function transferLicense(id) {
    if (!window.confirm('Clear the device lock on this license? The user can re-activate from a new device.')) return;
    try {
      const d = await api.post(`/api/admin/licenses/transfer/${id}`);
      window.alert(`Device lock cleared. Transfers used: ${d.transferCount}/${d.maxTransfers}`);
      load();
    } catch (e) { window.alert(e.message); }
  }

  function openCreateModal() {
    setForm({ ...emptyForm, purchaseDate: new Date().toISOString().split('T')[0] });
    setCreateMsg('');
    setCreateOpen(true);
  }
  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function doCreateLicense() {
    if (!form.buyerName.trim() || !form.buyerContact.trim() || !form.purchaseDate || form.price === '') {
      setCreateMsg('Please fill in all required fields');
      return;
    }
    setCreating(true);
    try {
      const d = await api.post('/api/admin/licenses/create', {
        buyerName: form.buyerName.trim(),
        buyerContact: form.buyerContact.trim(),
        purchaseDate: form.purchaseDate,
        price: form.price,
        currency: form.currency,
        notes: form.notes.trim(),
        expiresAmount: form.expireToggle ? form.expireAmount : null,
        expiresUnit: form.expireToggle ? form.expireUnit : null,
      });
      setCreateOpen(false);
      setGeneratedKey(d.key);
      load();
    } catch (e) {
      setCreateMsg(e.message);
    } finally {
      setCreating(false);
    }
  }

  function copyKey() {
    navigator.clipboard.writeText(generatedKey);
  }

  if (error) return <div className="adm-empty-row" style={{ color: 'var(--danger)' }}>{error}</div>;

  return (
    <div>
      <div className="adm-top-bar">
        <div style={{ fontSize: 15, fontWeight: 700 }}>License Keys</div>
        <button className="adm-create-btn" onClick={openCreateModal}>+ Create License</button>
      </div>
      <div className="adm-card" style={{ padding: 0 }}>
        <div className="adm-tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>License Key</th><th>Buyer</th><th>Contact</th><th>Purchase Date</th><th>Price</th>
                <th>Status</th><th>Expires</th><th>Activated By</th><th>Activated At</th><th>Transfers</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!licenses ? (
                <tr className="adm-empty-row"><td colSpan={11}>Loading...</td></tr>
              ) : !licenses.length ? (
                <tr className="adm-empty-row"><td colSpan={11}>No licenses yet</td></tr>
              ) : slice.map((l) => {
                const now = new Date();
                const isExpired = l.expiresAt && now > new Date(l.expiresAt);
                const maxT = l.maxTransfers != null ? l.maxTransfers : 2;
                const curT = l.transferCount || 0;
                const user = l.activatedByUserId
                  ? <>{l.activatedByUserId.firstName || ''} {l.activatedByUserId.lastName || ''}<br /><span style={{ color: 'var(--muted)', fontSize: 11 }}>{l.activatedByUserId.email || ''}</span></>
                  : '—';
                return (
                  <tr key={l._id} style={isExpired ? { opacity: 0.5 } : undefined}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--success)' }}>{l.licenseKey}</td>
                    <td>{l.buyerName || '—'}</td>
                    <td>{l.buyerContact || '—'}</td>
                    <td>{fmt(l.purchaseDate)}</td>
                    <td>{l.price != null ? `${l.price} ${l.currency || 'USD'}` : '—'}</td>
                    <td><Badge status={l.status} /></td>
                    <td>
                      {!l.expiresAt ? <span style={{ color: 'var(--muted)', fontSize: 12 }}>Never</span>
                        : isExpired ? <span style={{ background: '#3b1a1a', color: '#f56565', fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 5 }}>EXPIRED</span>
                        : <span style={{ color: 'var(--warn)', fontSize: 12 }}>{fmt(l.expiresAt)}</span>}
                    </td>
                    <td>{user}</td>
                    <td>{fmtDt(l.activatedAt)}</td>
                    <td style={{ fontSize: 12, color: curT >= maxT ? 'var(--danger)' : 'var(--muted)' }}>{curT}/{maxT}</td>
                    <td>
                      <div className="adm-acts">
                        {l.status === 'active' && <button className="adm-act-btn suspend" title="Suspend" onClick={() => suspendLicense(l._id)}>⛔</button>}
                        {l.status === 'suspended' && <button className="adm-act-btn reactivate" title="Reactivate" onClick={() => reactivateLicense(l._id)}>✅</button>}
                        <button className="adm-act-btn delete" title="Delete" onClick={() => deleteLicense(l._id, l.licenseKey, l.status)}>🗑️</button>
                        {(l.status === 'active' || l.status === 'suspended') && curT < maxT && (
                          <button className="adm-act-btn transfer" title="Transfer" onClick={() => transferLicense(l._id)}>🔁</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {licenses && licenses.length > 0 && <Pagination page={page} perPage={PER_PAGE} total={sorted.length} onChange={setPage} />}
      </div>

      {createOpen && (
        <div className="adm-modal-bg open" onClick={(e) => { if (e.target === e.currentTarget) setCreateOpen(false); }}>
          <div className="adm-modal">
            <div className="adm-modal-title">Create License Key</div>
            <div className="adm-modal-row2">
              <div className="adm-modal-field"><label>Buyer Name *</label><input type="text" placeholder="Full name" value={form.buyerName} onChange={(e) => updateField('buyerName', e.target.value)} /></div>
              <div className="adm-modal-field"><label>Contact Number *</label><input type="text" placeholder="+1 234 567 8900" value={form.buyerContact} onChange={(e) => updateField('buyerContact', e.target.value)} /></div>
            </div>
            <div className="adm-modal-row2">
              <div className="adm-modal-field"><label>Purchase Date *</label><input type="date" value={form.purchaseDate} onChange={(e) => updateField('purchaseDate', e.target.value)} /></div>
              <div className="adm-modal-row2" style={{ gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                <div className="adm-modal-field" style={{ margin: 0 }}><label>Price *</label><input type="number" placeholder="0.00" min="0" step="0.01" value={form.price} onChange={(e) => updateField('price', e.target.value)} /></div>
                <div className="adm-modal-field" style={{ margin: 0 }}>
                  <label>Currency</label>
                  <select value={form.currency} onChange={(e) => updateField('currency', e.target.value)}>
                    <option value="USD">USD</option>
                    <option value="PKR">PKR</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="adm-modal-field"><label>Notes (optional)</label><textarea placeholder="Any additional notes…" value={form.notes} onChange={(e) => updateField('notes', e.target.value)} /></div>
            <div className="adm-modal-field" style={{ marginBottom: '0.35rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input style={{ width: 'max-content' }} type="checkbox" checked={form.expireToggle} onChange={(e) => updateField('expireToggle', e.target.checked)} />
                <span>Set Expiration</span>
              </label>
            </div>
            {form.expireToggle && (
              <div style={{ marginBottom: '0.5rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="adm-modal-field" style={{ margin: 0 }}><label>Duration</label><input type="number" min="1" value={form.expireAmount} onChange={(e) => updateField('expireAmount', e.target.value)} /></div>
                  <div className="adm-modal-field" style={{ margin: 0 }}>
                    <label>Unit</label>
                    <select value={form.expireUnit} onChange={(e) => updateField('expireUnit', e.target.value)}>
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                      <option value="weeks">Weeks</option>
                      <option value="months">Months</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
            {createMsg && <div className="adm-modal-msg err">{createMsg}</div>}
            <div className="adm-modal-btns">
              <button className="adm-modal-btn-cancel" onClick={() => setCreateOpen(false)}>Cancel</button>
              <button className="adm-modal-btn-ok" disabled={creating} onClick={doCreateLicense}>{creating ? 'Generating...' : 'Generate License'}</button>
            </div>
          </div>
        </div>
      )}

      {generatedKey && (
        <div className="adm-modal-bg open" onClick={(e) => { if (e.target === e.currentTarget) setGeneratedKey(null); }}>
          <div className="adm-modal">
            <div className="adm-modal-title">License Key Generated ✓</div>
            <div className="adm-key-box">
              <div className="adm-key-text">{generatedKey}</div>
              <button className="adm-copy-btn" onClick={copyKey}>📋 Copy Key</button>
            </div>
            <p className="adm-key-note">Share this key with the buyer. It will not be shown again.</p>
            <div className="adm-modal-btns" style={{ marginTop: 20 }}>
              <button className="adm-modal-btn-ok" style={{ flex: 1 }} onClick={() => setGeneratedKey(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
