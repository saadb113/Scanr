import { useEffect, useRef, useState } from 'react';
import { api } from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';

const DEFAULT_ALERTS = { priceAlert: true, orderSummary: true, autopilotMilestone: true, tpSlHit: true, strategyBotAlerts: true, aiAgentAlerts: true };
const ALERT_ROWS = [
  { key: 'priceAlert', icon: '💰', label: 'Price Alerts', desc: 'When a coin hits your set price target' },
  { key: 'orderSummary', icon: '📋', label: 'Order Summary', desc: 'When you place any order (market or limit)' },
  { key: 'autopilotMilestone', icon: '🤖', label: 'Autopilot Milestones', desc: 'When autopilot moves SL or reaches milestone' },
  { key: 'tpSlHit', icon: '🎯', label: 'TP / SL Hit', desc: 'When a position closes by hitting TP or SL' },
  { key: 'strategyBotAlerts', icon: '🤖', label: 'Strategy Bot Alerts', desc: 'Trade notifications from the strategy bot' },
  { key: 'aiAgentAlerts', icon: '🧠', label: 'AI Agent Alerts', desc: 'Trade notifications from the AI Day Trading Agent' },
];

export default function TelegramModal({ open, onClose, onSaved }) {
  const { user } = useAuth();
  const [botUsername, setBotUsername] = useState('');
  const [isLinked, setIsLinked] = useState(false);
  const [alerts, setAlerts] = useState(DEFAULT_ALERTS);
  const [notConfigured, setNotConfigured] = useState(false);
  const [testMsg, setTestMsg] = useState(null);
  const [savedMsg, setSavedMsg] = useState(false);
  const pollRef = useRef(null);

  const load = async () => {
    try {
      const j = await api.get('/api/telegram/config');
      // The source page read j.botName / j.userId / j.isLinked, none of which the
      // backend actually returns ({telegram, botUsername}) — so "1-click connect"
      // always failed with "Bot not configured by Admin". Fixed to use the real
      // response shape and the logged-in user's own id for the deep link.
      setBotUsername(j.botUsername || '');
      setNotConfigured(!j.botUsername);
      setIsLinked(!!j.telegram?.chatId);
      if (j.telegram?.alerts) setAlerts((a) => ({ ...a, ...j.telegram.alerts }));
    } catch (e) { console.warn('tgLoadConfig', e); }
  };

  useEffect(() => {
    if (!open) return;
    load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [open]);

  function openLink() {
    if (!botUsername || !user?._id) {
      window.alert('System error: Bot not configured by Admin.');
      return;
    }
    window.open(`https://t.me/${botUsername}?start=user_${user._id}`, '_blank');
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const j = await api.get('/api/telegram/config').catch(() => null);
      if (j?.telegram?.chatId) {
        clearInterval(pollRef.current);
        load();
      }
    }, 2000);
  }

  async function disconnect() {
    if (!window.confirm('Unlink Telegram?')) return;
    try {
      await api.post('/api/telegram/disconnect');
      load();
    } catch { /* ignore */ }
  }

  async function testWebhook() {
    try {
      const j = await api.post('/api/telegram/test');
      setTestMsg(j.ok ? { ok: true, text: '✓ Test message sent!' } : { ok: false, text: `✗ ${j.error || 'Failed'}` });
    } catch (e) {
      setTestMsg({ ok: false, text: `✗ ${e.message}` });
    }
    setTimeout(() => setTestMsg(null), 5000);
  }

  async function save() {
    try {
      const j = await api.post('/api/telegram/config', { alerts });
      if (j.ok) {
        setSavedMsg(true);
        setTimeout(() => setSavedMsg(false), 2500);
        onSaved?.();
      }
    } catch (e) { console.warn('tgSaveConfig', e); }
  }

  if (!open) return null;

  return (
    <div className="int-modal-bg open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="int-modal">
        <div className="int-modal-hdr">
          <div className="int-modal-title">✈️ Telegram Integration</div>
          <button className="int-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="int-modal-body">
          <div className="tg-section">Setup (1-Click Connect)</div>

          {notConfigured ? (
            <div style={{ color: '#f87171', fontWeight: 600, padding: '1rem' }}>Telegram Bot not configured. Ask Admin.</div>
          ) : !isLinked ? (
            <div style={{ textAlign: 'center', padding: '1.5rem', background: '#0f1319', borderRadius: 12, marginBottom: '1rem', border: '1px solid #1a2030' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✈️</div>
              <div style={{ fontWeight: 600, fontSize: 15, color: '#e5e9f2', marginBottom: '0.4rem' }}>Connect your Telegram Account</div>
              <div style={{ fontSize: 12, color: '#6b7897', marginBottom: '1rem', lineHeight: 1.5 }}>Click the button below to open Telegram.<br />Click <b>Start</b> in the bot to instantly link your account.</div>
              <button onClick={openLink} style={{ background: '#2481cc', color: 'white', border: 'none', borderRadius: 24, padding: '0.6rem 1.5rem', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg> Open Telegram
              </button>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '1.5rem', background: 'rgba(74, 222, 128, 0.05)', borderRadius: 12, marginBottom: '1rem', border: '1px solid rgba(74, 222, 128, 0.2)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✅</div>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#4ade80', marginBottom: '0.3rem' }}>Telegram is Connected</div>
              <div style={{ fontSize: 12, color: '#9aa3b5', marginBottom: '0.8rem' }}>You will receive your selected alerts here.</div>
              <button onClick={disconnect} style={{ background: 'none', border: '1px solid rgba(248, 113, 113, 0.3)', color: '#f87171', borderRadius: 6, padding: '0.4rem 0.8rem', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Disconnect</button>
            </div>
          )}

          {isLinked && (
            <button onClick={testWebhook} style={{ width: '100%', marginTop: '0.8rem', background: '#1a1f2e', border: '1px solid #252d3d', color: '#e5e9f2', borderRadius: 8, padding: '0.45rem', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>📨 Send Test Message</button>
          )}
          {testMsg && <div style={{ textAlign: 'center', fontSize: 12, marginTop: '0.35rem', fontWeight: 600, padding: '0.35rem', borderRadius: 6, color: testMsg.ok ? '#4ade80' : '#f87171' }}>{testMsg.text}</div>}

          <div className="tg-section" style={{ marginTop: '1.2rem' }}>Alert Toggles</div>
          {ALERT_ROWS.map((r) => (
            <div className="tg-toggle-row" key={r.key}>
              <div className="tg-toggle-info"><span className="tg-toggle-label">{r.icon} {r.label}</span><span className="tg-toggle-desc">{r.desc}</span></div>
              <label className="toggle-switch"><input type="checkbox" checked={alerts[r.key]} onChange={(e) => setAlerts((a) => ({ ...a, [r.key]: e.target.checked }))} /><span className="slider" /></label>
            </div>
          ))}

          <button onClick={save} style={{ width: '100%', marginTop: '1.2rem', background: 'linear-gradient(135deg,#5865f2,#7983f5)', color: '#fff', border: 'none', borderRadius: 8, padding: '0.55rem', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>💾 Save Telegram Settings</button>
          {savedMsg && <div style={{ textAlign: 'center', fontSize: 13, color: '#48bb78', marginTop: '0.45rem', fontWeight: 600 }}>✓ Saved!</div>}
        </div>
      </div>
    </div>
  );
}
