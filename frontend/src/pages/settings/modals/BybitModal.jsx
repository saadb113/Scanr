import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import PasswordField from '../PasswordField';

export default function BybitModal({ open, onClose }) {
  const [env, setEnv] = useState('mainnet');
  const [mainnet, setMainnet] = useState({ apiKey: '', apiSecret: '' });
  const [testnet, setTestnet] = useState({ apiKey: '', apiSecret: '' });
  const [credMsg, setCredMsg] = useState(null);
  const [testMsg, setTestMsg] = useState(null);
  const [testing, setTesting] = useState(false);

  const [posCapital, setPosCapital] = useState(1000);
  const [posRisk, setPosRisk] = useState(1);
  const [posFeeRate, setPosFeeRate] = useState(0);
  const [posAccountType, setPosAccountType] = useState('futures_cross');
  const [posMsg, setPosMsg] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get('/api/bybit-store').then((d) => {
      if (d?.mainnet) setMainnet({ apiKey: d.mainnet.apiKey || '', apiSecret: d.mainnet.apiSecret || '' });
      if (d?.testnet) setTestnet({ apiKey: d.testnet.apiKey || '', apiSecret: d.testnet.apiSecret || '' });
      if (d?.activeEnv) setEnv(d.activeEnv);
    }).catch(() => {});
    api.get('/api/pos-settings').then((d) => {
      if (d.capital != null) setPosCapital(d.capital);
      if (d.riskPerTrade != null) setPosRisk(d.riskPerTrade);
      if (d.feeRate != null) setPosFeeRate(d.feeRate);
      if (d.accountType) setPosAccountType(d.accountType);
    }).catch(() => {});
  }, [open]);

  async function switchAccount(next) {
    setEnv(next);
    try { await api.post('/api/bybit-store', { activeEnv: next }); } catch { /* ignore */ }
  }

  async function saveAccount(which) {
    const creds = which === 'mainnet' ? mainnet : testnet;
    try {
      await api.post('/api/bybit-store', { [which]: creds });
      setCredMsg({ ok: true, text: `✓ ${which === 'mainnet' ? 'Live' : 'Demo'} credentials saved` });
    } catch (e) {
      setCredMsg({ ok: false, text: e.message });
    }
    setTimeout(() => setCredMsg(null), 3000);
  }

  async function testConnection() {
    setTesting(true);
    setTestMsg(null);
    try {
      const d = await api.get('/api/bybit/test');
      setTestMsg(d.ok ? { ok: true, text: `✓ Connected — equity $${d.equity} (${d.env})` } : { ok: false, text: `✗ ${d.error}` });
    } catch (e) {
      setTestMsg({ ok: false, text: `✗ ${e.message}` });
    }
    setTesting(false);
  }

  async function savePos() {
    try {
      await api.post('/api/pos-settings', { capital: +posCapital, riskPerTrade: +posRisk, feeRate: +posFeeRate, accountType: posAccountType });
      setPosMsg(true);
      setTimeout(() => setPosMsg(false), 2500);
    } catch { /* ignore */ }
  }

  if (!open) return null;

  return (
    <div className="int-modal-bg open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="int-modal">
        <div className="int-modal-hdr">
          <div className="int-modal-title">⚡ Bybit Integration</div>
          <button className="int-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="int-modal-body">
          <div className="sp-grid" style={{ alignItems: 'start' }}>
            <div className="sp-card">
              <div className="sp-card-title">⚡ Bybit API Credentials</div>
              <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', background: '#090c12', borderRadius: 8, padding: '0.3rem' }}>
                <button onClick={() => switchAccount('mainnet')} style={{ flex: 1, padding: '0.45rem 0.5rem', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', background: env === 'mainnet' ? '#166534' : '#0f1319', color: env === 'mainnet' ? '#4ade80' : '#6b7897', transition: 'all .15s' }}>🟢 Live Account</button>
                <button onClick={() => switchAccount('testnet')} style={{ flex: 1, padding: '0.45rem 0.5rem', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', background: env === 'testnet' ? '#1e3a8a' : '#0f1319', color: env === 'testnet' ? '#60a5fa' : '#6b7897', transition: 'all .15s' }}>🧪 Demo Account</button>
              </div>
              {credMsg && <div style={{ textAlign: 'center', fontSize: 12, marginBottom: '0.6rem', fontWeight: 700, padding: '0.35rem', borderRadius: 6, color: credMsg.ok ? '#4ade80' : '#f87171' }}>{credMsg.text}</div>}
              {env === 'mainnet' ? (
                <div>
                  <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.6rem' }}>🟢 Live (Mainnet) Credentials</div>
                  <div className="s-row"><label>API Key</label><PasswordField value={mainnet.apiKey} onChange={(v) => setMainnet((c) => ({ ...c, apiKey: v }))} placeholder="Live API key…" /></div>
                  <div className="s-row"><label>API Secret</label><PasswordField value={mainnet.apiSecret} onChange={(v) => setMainnet((c) => ({ ...c, apiSecret: v }))} placeholder="Live API secret…" /></div>
                  <button onClick={() => saveAccount('mainnet')} style={{ width: '100%', marginTop: '0.5rem', background: 'linear-gradient(135deg,#166534,#22c55e)', color: '#fff', border: 'none', borderRadius: 8, padding: '0.45rem', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>💾 Save Live Credentials</button>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 12, color: '#60a5fa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.6rem' }}>🧪 Demo (Testnet) Credentials</div>
                  <div className="s-row"><label>API Key</label><PasswordField value={testnet.apiKey} onChange={(v) => setTestnet((c) => ({ ...c, apiKey: v }))} placeholder="Demo API key…" /></div>
                  <div className="s-row"><label>API Secret</label><PasswordField value={testnet.apiSecret} onChange={(v) => setTestnet((c) => ({ ...c, apiSecret: v }))} placeholder="Demo API secret…" /></div>
                  <button onClick={() => saveAccount('testnet')} style={{ width: '100%', marginTop: '0.5rem', background: 'linear-gradient(135deg,#1e3a8a,#3b82f6)', color: '#fff', border: 'none', borderRadius: 8, padding: '0.45rem', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>💾 Save Demo Credentials</button>
                </div>
              )}
              <div style={{ borderTop: '1px solid #1e2535', marginTop: '0.85rem', paddingTop: '0.85rem', display: 'flex', gap: '0.5rem' }}>
                <button onClick={testConnection} disabled={testing} style={{ flex: 1, background: '#1a1f2e', border: '1px solid #252d3d', color: '#e5e9f2', borderRadius: 8, padding: '0.45rem', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{testing ? 'Testing…' : '🔌 Test Active Account'}</button>
              </div>
              {testMsg && <div style={{ textAlign: 'center', fontSize: 13, marginTop: '0.5rem', fontWeight: 600, color: testMsg.ok ? '#4ade80' : '#f87171' }}>{testMsg.text}</div>}
            </div>

            <div className="sp-card" style={{ background: '#0a0d12' }}>
              <div className="sp-card-title">📋 Setup Guide</div>
              <div style={{ fontSize: 13, color: '#7a8499', lineHeight: 1.85, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <div style={{ background: '#0f1319', borderRadius: 8, padding: '0.7rem 0.85rem', borderLeft: '3px solid #f59e0b' }}><div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 12, marginBottom: '0.4rem' }}>🔑 Get API Keys</div>1. Bybit → Account → API Management<br />2. Create key → enable <strong style={{ color: '#e5e9f2' }}>Derivatives Read + Trade</strong><br />3. Bind to your IP (recommended)<br />4. Paste key + secret here</div>
                <div style={{ background: '#0f1319', borderRadius: 8, padding: '0.7rem 0.85rem', borderLeft: '3px solid #60a5fa' }}><div style={{ color: '#60a5fa', fontWeight: 700, fontSize: 12, marginBottom: '0.25rem' }}>🧪 Demo Account</div>Switch to Demo mode on bybit.com → API Management → create key there. Paste in Demo tab above.</div>
                <div style={{ background: '#0f1319', borderRadius: 8, padding: '0.7rem 0.85rem', borderLeft: '3px solid #29ffb8' }}><div style={{ color: '#29ffb8', fontWeight: 700, fontSize: 12, marginBottom: '0.25rem' }}>⚡ Features</div>Place limit orders with SL+TP · Track live PnL · Modify SL/TP · Close positions · Cancel orders</div>
              </div>
            </div>

            <div className="sp-card">
              <div className="sp-card-title">💰 Account &amp; Position Settings</div>
              <div className="s-row"><label>Total Capital (USDT)</label><div style={{ position: 'relative' }}><span style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', fontSize: 13 }}>$</span><input type="number" className="s-input-full" min="1" style={{ paddingLeft: '1.5rem' }} value={posCapital} onChange={(e) => setPosCapital(e.target.value)} /></div></div>
              <div className="s-row"><label>Risk Per Trade (%)</label><div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><input type="range" min="0.1" max="10" step="0.1" value={posRisk} style={{ flex: 1, accentColor: '#f6ad55' }} onChange={(e) => setPosRisk(e.target.value)} /><span style={{ color: '#f6ad55', fontWeight: 700, fontSize: 14, minWidth: 38, textAlign: 'right' }}>{posRisk}%</span></div></div>
              <div className="s-row"><label>Fee Rate (%) <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>per side — taker</span></label><input type="number" className="s-input-full" min="0" max="1" step="0.001" placeholder="0.00" value={posFeeRate} onChange={(e) => setPosFeeRate(e.target.value)} /></div>
              <div className="s-row">
                <label>Account Type</label>
                <select className="s-input-full" value={posAccountType} onChange={(e) => setPosAccountType(e.target.value)}>
                  <option value="futures_cross">Futures — Cross Margin</option>
                  <option value="futures_iso">Futures — Isolated Margin</option>
                  <option value="spot">Spot</option>
                </select>
              </div>
              <button onClick={savePos} style={{ width: '100%', marginTop: '0.9rem', background: 'linear-gradient(135deg,#92400e,var(--accent-amber))', color: '#0f0700', border: 'none', borderRadius: 8, padding: '0.55rem', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-ui)', letterSpacing: '0.2px' }}>💾 Save Settings</button>
              {posMsg && <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--accent-green)', marginTop: '0.45rem', fontWeight: 600 }}>✓ Saved!</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
