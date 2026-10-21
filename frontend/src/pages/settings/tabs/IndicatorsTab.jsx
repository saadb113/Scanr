import { useEffect, useState } from 'react';
import { api } from '../../../api/client';

export default function IndicatorsTab() {
  const [rsiLen, setRsiLen] = useState(14);
  const [fastLen, setFastLen] = useState(12);
  const [slowLen, setSlowLen] = useState(26);
  const [signalLen, setSignalLen] = useState(9);
  const [savedMsg, setSavedMsg] = useState(false);

  useEffect(() => {
    api.get('/api/settings').then((s) => {
      if (s.rsiLen) setRsiLen(s.rsiLen);
      if (s.fastLen) setFastLen(s.fastLen);
      if (s.slowLen) setSlowLen(s.slowLen);
      if (s.signalLen) setSignalLen(s.signalLen);
    }).catch(() => {});
  }, []);

  async function save() {
    await api.post('/api/settings', { rsiLen: +rsiLen, fastLen: +fastLen, slowLen: +slowLen, signalLen: +signalLen });
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2500);
  }

  return (
    <div className="sp-grid">
      <div className="sp-card">
        <div className="sp-card-title">RSI Parameters</div>
        <div className="s-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ marginBottom: 0 }}>RSI Length</label>
          <input type="number" className="s-num-input" min="2" max="50" value={rsiLen} onChange={(e) => setRsiLen(e.target.value)} />
        </div>
      </div>
      <div className="sp-card">
        <div className="sp-card-title">MACD Parameters</div>
        <div className="s-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ marginBottom: 0 }}>Fast Length</label>
          <input type="number" className="s-num-input" min="1" max="50" value={fastLen} onChange={(e) => setFastLen(e.target.value)} />
        </div>
        <div className="s-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ marginBottom: 0 }}>Slow Length</label>
          <input type="number" className="s-num-input" min="1" max="100" value={slowLen} onChange={(e) => setSlowLen(e.target.value)} />
        </div>
        <div className="s-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ marginBottom: 0 }}>Signal Length</label>
          <input type="number" className="s-num-input" min="1" max="50" value={signalLen} onChange={(e) => setSignalLen(e.target.value)} />
        </div>
      </div>
      <div className="sp-card">
        <div className="sp-card-title">Save Indicators</div>
        <button onClick={save} style={{ background: 'linear-gradient(135deg,#065f46,#00c896)', color: '#000', border: 'none', borderRadius: 8, padding: '0.5rem 1.2rem', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>💾 Save</button>
        {savedMsg && <div style={{ fontSize: 13, color: 'var(--accent-green,#00e5a0)', marginTop: '0.4rem', fontWeight: 600 }}>✓ Saved!</div>}
      </div>
    </div>
  );
}
