import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import './ChallengeList.css';

const fmt2 = (n) => (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2);
const STATUS_LABELS = { 'on-track': '✅ ON TRACK', 'at-risk': '⚠️ AT RISK', passed: '✅ PASSED', failed: '❌ FAILED' };

function computeStatus(c, currentPnl) {
  const target = c.accountSize * (c.profitTargetPct / 100);
  const maxDD = c.accountSize * (c.maxTotalDrawdownPct / 100);
  if (currentPnl >= target) return 'passed';
  if (currentPnl <= -maxDD) return 'failed';
  const totalUsedPct = currentPnl < 0 ? -currentPnl / maxDD : 0;
  if (totalUsedPct > 0.7) return 'at-risk';
  return 'on-track';
}

const emptyForm = {
  title: 'My Challenge',
  accountSize: '',
  profitTargetPct: '10',
  maxDailyDrawdownPct: '5',
  maxTotalDrawdownPct: '10',
  startDate: new Date().toISOString().split('T')[0],
  durationDays: '30',
};

function ChallengeCard({ c, onDelete, onOpen }) {
  const today = new Date().toISOString().split('T')[0];
  const currentPnl = c.totalPnl || 0;
  const totalDD = c.totalDrawdown || 0;
  const dailyDD = c.dailyDate === today ? c.dailyDrawdown || 0 : 0;

  const target = c.accountSize * (c.profitTargetPct / 100);
  const maxDD = c.accountSize * (c.maxTotalDrawdownPct / 100);
  const dailyDDLimit = c.accountSize * (c.maxDailyDrawdownPct / 100);

  const startDt = new Date(c.startDate || today);
  const endDt = new Date(startDt);
  endDt.setDate(endDt.getDate() + (c.durationDays || 30));
  const daysLeft = Math.max(0, Math.ceil((endDt - new Date()) / 86400000));

  const profitPct = target > 0 ? Math.min(100, Math.max(0, (currentPnl / target) * 100)) : 0;
  const totalDDPct = maxDD > 0 ? Math.min(100, (-totalDD / maxDD) * 100) : 0;
  const dailyDDPct = dailyDDLimit > 0 ? Math.min(100, (-dailyDD / dailyDDLimit) * 100) : 0;

  const status = c.status && c.status !== 'active' ? c.status : computeStatus(c, currentPnl);
  const finalStatus = daysLeft === 0 && status === 'on-track' ? 'failed' : status;

  const profitBarColor = profitPct >= 100 ? 'var(--green)' : profitPct > 50 ? '#00c57d' : 'var(--blue)';
  const totalDDColor = totalDDPct > 70 ? 'var(--red)' : totalDDPct > 40 ? 'var(--amber)' : 'var(--text-muted)';
  const dailyDDColor = dailyDDPct > 70 ? 'var(--red)' : dailyDDPct > 40 ? 'var(--amber)' : 'var(--text-muted)';

  return (
    <div className="ch-card" onClick={(e) => { if (!e.target.closest('.ch-delete-btn')) onOpen(c._id); }}>
      <button className="ch-delete-btn" title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(c._id); }}>✕</button>
      <div className="ch-card-top">
        <div>
          <div className="ch-card-title">{c.title || 'Challenge'}</div>
          <div className="ch-card-meta">${(c.accountSize || 0).toLocaleString()} account · {c.profitTargetPct}% target · Started {c.startDate || '—'}</div>
        </div>
        <span className={`ch-badge ${finalStatus}`}>{STATUS_LABELS[finalStatus] || finalStatus.toUpperCase()}</span>
      </div>
      <div className="ch-meters">
        <div className="ch-meter">
          <div className="ch-meter-row">
            <span className="ch-meter-label">Profit Progress</span>
            <span className="ch-meter-val" style={{ color: profitBarColor }}>{fmt2(currentPnl)} / ${target.toFixed(2)}</span>
          </div>
          <div className="ch-bar-bg"><div className="ch-bar-fill" style={{ width: `${profitPct}%`, background: profitBarColor }} /></div>
        </div>
        <div className="ch-meter">
          <div className="ch-meter-row">
            <span className="ch-meter-label">Daily Drawdown</span>
            <span className="ch-meter-val" style={{ color: dailyDDColor }}>{dailyDDPct.toFixed(1)}% used (limit ${dailyDDLimit.toFixed(0)})</span>
          </div>
          <div className="ch-bar-bg"><div className="ch-bar-fill" style={{ width: `${dailyDDPct}%`, background: dailyDDColor }} /></div>
        </div>
        <div className="ch-meter">
          <div className="ch-meter-row">
            <span className="ch-meter-label">Total Drawdown</span>
            <span className="ch-meter-val" style={{ color: totalDDColor }}>{totalDDPct.toFixed(1)}% used (limit ${maxDD.toFixed(0)})</span>
          </div>
          <div className="ch-bar-bg"><div className="ch-bar-fill" style={{ width: `${totalDDPct}%`, background: totalDDColor }} /></div>
        </div>
      </div>
      <div className="ch-days-row">
        <span className="ch-days-chip">⏱ {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining</span>
        <span className="ch-days-chip">📅 {c.durationDays || 30} day challenge</span>
        {(c.tradesCount || 0) > 0 && <span className="ch-days-chip">{c.wins || 0}W / {c.losses || 0}L</span>}
      </div>
    </div>
  );
}

export default function ChallengeList() {
  const navigate = useNavigate();
  const [challenges, setChallenges] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formMsg, setFormMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.get('/api/challenge');
      setChallenges(d.challenges || []);
      setLoadError('');
    } catch {
      setLoadError('Failed to load challenges.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    const accountSize = parseFloat(form.accountSize);
    if (!accountSize || accountSize < 1) { setFormMsg('Account size required'); return; }
    if (!form.startDate) { setFormMsg('Start date required'); return; }
    try {
      await api.post('/api/challenge', {
        title: form.title.trim() || 'My Challenge',
        accountSize,
        profitTargetPct: parseFloat(form.profitTargetPct),
        maxDailyDrawdownPct: parseFloat(form.maxDailyDrawdownPct),
        maxTotalDrawdownPct: parseFloat(form.maxTotalDrawdownPct),
        startDate: form.startDate,
        durationDays: parseInt(form.durationDays, 10) || 30,
      });
      setFormOpen(false);
      setForm(emptyForm);
      setFormMsg('');
      load();
    } catch (e) {
      setFormMsg(e.message);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this challenge?')) return;
    await api.del(`/api/challenge/${id}`);
    load();
  }

  return (
    <div className="ch-wrap">
      <div className="ch-header">
        <div className="ch-title">🏆 Prop Firm Challenge</div>
        <button className="ch-add-btn" onClick={() => { setFormOpen((v) => !v); setFormMsg(''); }}>+ New Challenge</button>
      </div>

      <div className={`ch-form-card${formOpen ? ' open' : ''}`}>
        <div className="ch-form-title">New Funded Account Challenge</div>
        <div className="ch-form-grid">
          <div className="ch-field wide">
            <label>Challenge Title</label>
            <input type="text" placeholder="e.g. FTMO Phase 1" value={form.title} onChange={(e) => updateField('title', e.target.value)} />
          </div>
          <div className="ch-field">
            <label>Account Size ($)</label>
            <input type="number" placeholder="10000" min="100" value={form.accountSize} onChange={(e) => updateField('accountSize', e.target.value)} />
          </div>
          <div className="ch-field">
            <label>Profit Target (%)</label>
            <input type="number" min="0.1" step="0.1" value={form.profitTargetPct} onChange={(e) => updateField('profitTargetPct', e.target.value)} />
          </div>
          <div className="ch-field">
            <label>Max Daily Drawdown (%)</label>
            <input type="number" min="0.1" step="0.1" value={form.maxDailyDrawdownPct} onChange={(e) => updateField('maxDailyDrawdownPct', e.target.value)} />
          </div>
          <div className="ch-field">
            <label>Max Total Drawdown (%)</label>
            <input type="number" min="0.1" step="0.1" value={form.maxTotalDrawdownPct} onChange={(e) => updateField('maxTotalDrawdownPct', e.target.value)} />
          </div>
          <div className="ch-field">
            <label>Start Date</label>
            <input type="date" value={form.startDate} onChange={(e) => updateField('startDate', e.target.value)} />
          </div>
          <div className="ch-field">
            <label>Duration (days)</label>
            <input type="number" min="1" value={form.durationDays} onChange={(e) => updateField('durationDays', e.target.value)} />
          </div>
        </div>
        {formMsg && <div className="ch-msg" style={{ display: 'block' }}>{formMsg}</div>}
        <div className="ch-form-btns">
          <button className="ch-cancel-btn" onClick={() => setFormOpen(false)}>Cancel</button>
          <button className="ch-save-btn" onClick={handleSave}>Save Challenge</button>
        </div>
      </div>

      {loadError ? (
        <div className="ch-empty">{loadError}</div>
      ) : challenges === null ? (
        <div className="ch-loading">Loading challenges…</div>
      ) : !challenges.length ? (
        <div className="ch-empty">No challenges yet. Click "+ New Challenge" to get started.</div>
      ) : (
        <div className="ch-list">
          {challenges.map((c) => (
            <ChallengeCard key={c._id} c={c} onDelete={handleDelete} onOpen={(id) => navigate(`/challenge/${id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}
