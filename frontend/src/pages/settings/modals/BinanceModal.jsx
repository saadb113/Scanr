import { useState } from 'react';
import { api } from '../../../api/client';
import PasswordField from '../PasswordField';

// The Binance integration's backend was never implemented — /api/binance-store,
// /api/settings/binance/save and /api/settings/binance/test don't exist anywhere in
// server.js, even though the BinanceStore Mongoose model does. Ported as a real UI
// (not stubbed out) so it's ready the moment that backend gets built, but every
// action here will currently fail with a clear message rather than hang silently.
export default function BinanceModal({ open, onClose }) {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [testnet, setTestnet] = useState(true);
  const [msg, setMsg] = useState(null);

  async function testConnection() {
    try {
      await api.post('/api/settings/binance/test', { apiKey, apiSecret, testnet });
      setMsg({ ok: true, text: '✓ Connection OK' });
    } catch (e) {
      setMsg({ ok: false, text: `✗ ${e.message}` });
    }
  }

  async function save() {
    try {
      await api.post('/api/settings/binance/save', { apiKey, apiSecret, testnet });
      setMsg({ ok: true, text: '✓ Saved' });
    } catch (e) {
      setMsg({ ok: false, text: `✗ ${e.message}` });
    }
  }

  async function disconnect() {
    try {
      await api.post('/api/settings/binance/save', { apiKey: '', apiSecret: '' });
      setApiKey(''); setApiSecret('');
      setMsg({ ok: true, text: 'Disconnected' });
    } catch (e) {
      setMsg({ ok: false, text: `✗ ${e.message}` });
    }
  }

  if (!open) return null;

  return (
    <div className="int-modal-bg open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="int-modal">
        <div className="int-modal-hdr">
          <div className="int-modal-title">🟡 Binance Futures Integration</div>
          <button className="int-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="int-modal-body">
          <div className="sp-grid" style={{ alignItems: 'start' }}>
            <div className="sp-card">
              <div className="sp-card-title">🟡 Binance API Credentials</div>
              <div className="s-row"><label>API Key</label><PasswordField value={apiKey} onChange={setApiKey} placeholder="Binance API key…" /></div>
              <div className="s-row"><label>API Secret</label><PasswordField value={apiSecret} onChange={setApiSecret} placeholder="Binance API secret…" /></div>
              <div className="filter-toggle-row" style={{ margin: '0.25rem 0 0.5rem 0' }}>
                <span className="filter-toggle-label"><span className="fdot" style={{ background: '#f59e0b' }} />Use Testnet</span>
                <label className="toggle-switch"><input type="checkbox" checked={testnet} onChange={(e) => setTestnet(e.target.checked)} /><span className="slider" /></label>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={testConnection} style={{ flex: 1, background: '#1a1f2e', border: '1px solid #252d3d', color: '#e5e9f2', borderRadius: 8, padding: '0.45rem', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>🔌 Test Connection</button>
                <button onClick={save} style={{ flex: 1, background: 'linear-gradient(135deg,#a16207,#f59e0b)', color: '#fff', border: 'none', borderRadius: 8, padding: '0.45rem', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>💾 Save</button>
              </div>
              <button onClick={disconnect} style={{ width: '100%', marginTop: '0.6rem', background: '#2d0a0a', border: '1px solid #7f1d1d', color: '#f87171', borderRadius: 8, padding: '0.45rem', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Disconnect</button>
              {msg && <div style={{ textAlign: 'center', fontSize: 13, marginTop: '0.5rem', fontWeight: 600, color: msg.ok ? '#4ade80' : '#f87171' }}>{msg.text}</div>}
            </div>
            <div className="sp-card" style={{ background: '#0a0d12' }}>
              <div className="sp-card-title">📋 Setup Guide</div>
              <div style={{ fontSize: 13, color: '#7a8499', lineHeight: 1.85, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <div style={{ background: '#0f1319', borderRadius: 8, padding: '0.7rem 0.85rem', borderLeft: '3px solid #f59e0b' }}><div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 12, marginBottom: '0.4rem' }}>🔑 Get Futures API Keys</div>1. Binance → API Management<br />2. Enable <strong style={{ color: '#e5e9f2' }}>Futures</strong> permissions<br />3. For testnet use futures testnet keys<br />4. Paste key + secret here</div>
                <div style={{ background: '#0f1319', borderRadius: 8, padding: '0.7rem 0.85rem', borderLeft: '3px solid #60a5fa' }}><div style={{ color: '#60a5fa', fontWeight: 700, fontSize: 12, marginBottom: '0.25rem' }}>🧪 Testnet</div>Keep testnet enabled while testing bot/trade flows. Disable only when you are ready for live trading.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
