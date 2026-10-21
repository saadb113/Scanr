import { useEffect, useState } from 'react';
import { api } from '../../../api/client';

const lbl = { fontSize: '0.75rem', color: '#4b5563', display: 'block', marginBottom: '0.2rem' };

const DEFAULTS = {
  startTime: '08:00', endTime: '18:00', maxTrades: 3, scanInterval: 30, cooldownMinutes: 15,
  minScore: 75, timeframe: '5m', basePositionSize: 0, maxLossPerTradePct: 1,
  dailyDrawdownPct: 5, maxConsecutiveLosses: 3, minVolume: 30, atrMin: 0, atrMax: 9999999,
  customCoins: '', demoMode: false, emailRecipient: '',
  notifyOnAgentShutdown: true, notifyOnTradePlaced: true, notifyOnTradeClosed: true, notifyOnDailySummary: true,
};

export default function AgentTab() {
  const [s, setS] = useState(DEFAULTS);
  const [savedMsg, setSavedMsg] = useState(false);
  const [testMsg, setTestMsg] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api.get('/api/agent/settings').then((j) => {
      if (j.ok && j.settings) setS((prev) => ({ ...prev, ...j.settings }));
    }).catch(() => {});
  }, []);

  function set(key, value) {
    setS((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    const body = {
      startTime: s.startTime, endTime: s.endTime,
      maxTrades: parseInt(s.maxTrades, 10), scanInterval: parseInt(s.scanInterval, 10),
      cooldownMinutes: parseInt(s.cooldownMinutes, 10), minScore: parseInt(s.minScore, 10),
      basePositionSize: parseFloat(s.basePositionSize) || 0, maxLossPerTradePct: parseFloat(s.maxLossPerTradePct),
      dailyDrawdownPct: parseFloat(s.dailyDrawdownPct), maxConsecutiveLosses: parseInt(s.maxConsecutiveLosses, 10),
      minVolume: parseFloat(s.minVolume), atrMin: parseFloat(s.atrMin) || 0, atrMax: parseFloat(s.atrMax) || 9999999,
      timeframe: s.timeframe || '5m', customCoins: s.customCoins.trim(), demoMode: s.demoMode,
      emailRecipient: s.emailRecipient.trim(),
      notifyOnAgentShutdown: s.notifyOnAgentShutdown, notifyOnTradePlaced: s.notifyOnTradePlaced,
      notifyOnTradeClosed: s.notifyOnTradeClosed, notifyOnDailySummary: s.notifyOnDailySummary,
    };
    try {
      const j = await api.post('/api/agent/settings', body);
      if (j.ok) { setSavedMsg(true); setTimeout(() => setSavedMsg(false), 2000); }
    } catch (e) { console.warn('agSaveSettings', e); }
  }

  async function testEmail() {
    setTesting(true);
    setTestMsg(null);
    try {
      const j = await api.post('/api/agent/test-email');
      setTestMsg(j.ok ? { ok: true, text: '✓ Test email sent!' } : { ok: false, text: `✗ ${j.error || 'Failed'}` });
    } catch (e) {
      setTestMsg({ ok: false, text: `✗ ${e.message}` });
    }
    setTesting(false);
    setTimeout(() => setTestMsg(null), 5000);
  }

  return (
    <div style={{ padding: '0.75rem 0 1.5rem' }}>
      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#a855f7', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.9rem' }}>📈 Day Trading Agent</div>

      <div style={{ marginBottom: '0.8rem' }}>
        <div style={{ fontSize: '0.68rem', color: '#6b7280', marginBottom: '0.35rem', fontWeight: 600 }}>Trading Window (PST)</div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div style={{ flex: 1 }}><label style={lbl}>Start</label><input type="time" className="s-input-full" value={s.startTime} onChange={(e) => set('startTime', e.target.value)} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>End (hard stop)</label><input type="time" className="s-input-full" value={s.endTime} onChange={(e) => set('endTime', e.target.value)} /></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.8rem' }}>
        <div><label style={lbl}>Max Trades / Day</label><input type="number" className="s-input-full" min="1" max="20" value={s.maxTrades} onChange={(e) => set('maxTrades', e.target.value)} /></div>
        <div><label style={lbl}>Scan Interval (min)</label><input type="number" className="s-input-full" min="5" max="120" value={s.scanInterval} onChange={(e) => set('scanInterval', e.target.value)} /></div>
        <div><label style={lbl}>Cooldown After Trade (min)</label><input type="number" className="s-input-full" min="0" max="120" value={s.cooldownMinutes} onChange={(e) => set('cooldownMinutes', e.target.value)} /></div>
        <div><label style={lbl}>Min AI Score (0-100)</label><input type="number" className="s-input-full" min="0" max="100" value={s.minScore} onChange={(e) => set('minScore', e.target.value)} /></div>
        <div>
          <label style={lbl}>Scan Timeframe</label>
          <select className="s-input-full" value={s.timeframe} onChange={(e) => set('timeframe', e.target.value)}>
            {['1m', '3m', '5m', '15m', '30m', '1h'].map((tf) => <option key={tf} value={tf}>{tf}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.8rem' }}>
        <div><label style={lbl}>Base Position (USDT, 0=auto)</label><input type="number" className="s-input-full" min="0" step="any" value={s.basePositionSize} onChange={(e) => set('basePositionSize', e.target.value)} /></div>
        <div><label style={lbl}>Max Loss / Trade (%)</label><input type="number" className="s-input-full" min="0.1" max="10" step="0.1" value={s.maxLossPerTradePct} onChange={(e) => set('maxLossPerTradePct', e.target.value)} /></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.8rem' }}>
        <div><label style={lbl}>Daily Drawdown Limit (%)</label><input type="number" className="s-input-full" min="1" max="50" step="0.5" value={s.dailyDrawdownPct} onChange={(e) => set('dailyDrawdownPct', e.target.value)} /></div>
        <div><label style={lbl}>Max Consecutive Losses</label><input type="number" className="s-input-full" min="1" max="10" value={s.maxConsecutiveLosses} onChange={(e) => set('maxConsecutiveLosses', e.target.value)} /></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.8rem' }}>
        <div><label style={lbl}>Min Volume (M USDT)</label><input type="number" className="s-input-full" min="0" value={s.minVolume} onChange={(e) => set('minVolume', e.target.value)} /></div>
        <div><label style={lbl}>ATR Min</label><input type="number" className="s-input-full" min="0" step="any" value={s.atrMin} onChange={(e) => set('atrMin', e.target.value)} /></div>
        <div><label style={lbl}>ATR Max</label><input type="number" className="s-input-full" min="0" step="any" value={s.atrMax} onChange={(e) => set('atrMax', e.target.value)} /></div>
      </div>

      <div style={{ marginBottom: '0.8rem' }}>
        <label style={lbl}>Custom Coin List (blank = use global list)</label>
        <input type="text" className="s-input-full" placeholder="e.g. BTCUSDT, ETHUSDT, SOLUSDT" value={s.customCoins} onChange={(e) => set('customCoins', e.target.value)} />
      </div>

      <div style={{ marginBottom: '0.8rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', color: '#9ca3af' }}>
          <input type="checkbox" checked={s.demoMode} onChange={(e) => set('demoMode', e.target.checked)} />
          <span>Demo Mode <span style={{ color: '#f59e0b', fontSize: '0.75rem' }}>(simulate trades, no real orders placed)</span></span>
        </label>
      </div>

      <div style={{ marginBottom: '0.8rem' }}>
        <div style={{ fontSize: '0.68rem', color: '#6b7280', marginBottom: '0.35rem', fontWeight: 600 }}>Email Notifications</div>
        <input type="email" className="s-input-full" placeholder="Recipient email (e.g. you@gmail.com)" style={{ marginBottom: '0.4rem' }} value={s.emailRecipient} onChange={(e) => set('emailRecipient', e.target.value)} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#9ca3af', cursor: 'pointer' }}><input type="checkbox" checked={s.notifyOnAgentShutdown} onChange={(e) => set('notifyOnAgentShutdown', e.target.checked)} /> Agent Start / Stop</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#9ca3af', cursor: 'pointer' }}><input type="checkbox" checked={s.notifyOnTradePlaced} onChange={(e) => set('notifyOnTradePlaced', e.target.checked)} /> Trade Placed</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#9ca3af', cursor: 'pointer' }}><input type="checkbox" checked={s.notifyOnTradeClosed} onChange={(e) => set('notifyOnTradeClosed', e.target.checked)} /> Trade Closed</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#9ca3af', cursor: 'pointer' }}><input type="checkbox" checked={s.notifyOnDailySummary} onChange={(e) => set('notifyOnDailySummary', e.target.checked)} /> Daily Summary</label>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.1rem' }}>
        <button onClick={save} style={{ flex: 1, background: 'linear-gradient(135deg,#5b21b6,#7c3aed)', border: 'none', borderRadius: 8, padding: '0.55rem', fontSize: '0.9rem', fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>💾 Save Agent Settings</button>
        <button onClick={testEmail} disabled={testing} style={{ background: '#0d1a10', border: '1px solid #166534', borderRadius: 8, padding: '0.55rem 0.75rem', fontSize: '0.9rem', fontWeight: 700, color: '#4ade80', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          {testing ? '⏳ Sending…' : '📧 Test Email'}
        </button>
      </div>
      {savedMsg && <div style={{ textAlign: 'center', fontSize: '0.82rem', color: '#4ade80', marginTop: '0.4rem' }}>Settings saved ✓</div>}
      {testMsg && <div style={{ textAlign: 'center', fontSize: '0.82rem', marginTop: '0.4rem', color: testMsg.ok ? '#4ade80' : '#f87171' }}>{testMsg.text}</div>}
    </div>
  );
}
