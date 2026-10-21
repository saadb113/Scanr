import { useEffect, useState } from 'react';
import { api } from '../../../api/client';

const DEFAULT_ALERTS = { priceAlert: true, orderSummary: true, autopilotMilestone: true, tpSlHit: true, strategyBotAlerts: true, aiAgentAlerts: true };
const ALERT_ROWS = [
  { key: 'priceAlert', icon: '💰', label: 'Price Alerts', desc: 'When a coin hits your set price target' },
  { key: 'orderSummary', icon: '📋', label: 'Order Summary', desc: 'When you place any order (market or limit)' },
  { key: 'autopilotMilestone', icon: '🤖', label: 'Autopilot Milestones', desc: 'When autopilot moves SL or reaches milestone' },
  { key: 'tpSlHit', icon: '🎯', label: 'TP / SL Hit', desc: 'When a position closes by hitting TP or SL' },
  { key: 'strategyBotAlerts', icon: '🤖', label: 'Strategy Bot Alerts', desc: 'Trade notifications from the strategy bot' },
  { key: 'aiAgentAlerts', icon: '🧠', label: 'AI Agent Alerts', desc: 'Trade notifications from the AI Day Trading Agent' },
];

export default function DiscordModal({ open, onClose, onSaved }) {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [alerts, setAlerts] = useState(DEFAULT_ALERTS);
  const [testMsg, setTestMsg] = useState(null);
  const [savedMsg, setSavedMsg] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get('/api/discord/config').then((j) => {
      if (j.webhookUrl) setWebhookUrl(j.webhookUrl);
      if (j.alerts) setAlerts((a) => ({ ...a, ...j.alerts }));
    }).catch(() => {});
  }, [open]);

  async function testWebhook() {
    const url = webhookUrl.trim();
    if (!url) { setTestMsg({ ok: false, text: 'Enter a webhook URL first.' }); return; }
    try {
      const j = await api.post('/api/discord/test', { webhookUrl: url });
      setTestMsg(j.ok ? { ok: true, text: '✓ Test message sent!' } : { ok: false, text: `✗ ${j.error || 'Failed'}` });
    } catch (e) {
      setTestMsg({ ok: false, text: `✗ ${e.message}` });
    }
    setTimeout(() => setTestMsg(null), 5000);
  }

  async function save() {
    try {
      const j = await api.post('/api/discord/config', { webhookUrl: webhookUrl.trim(), alerts });
      if (j.ok) {
        setSavedMsg(true);
        setTimeout(() => setSavedMsg(false), 2500);
        onSaved?.();
      }
    } catch (e) { console.warn('discSaveConfig', e); }
  }

  if (!open) return null;

  return (
    <div className="int-modal-bg open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="int-modal">
        <div className="int-modal-hdr">
          <div className="int-modal-title">💬 Discord Integration</div>
          <button className="int-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="int-modal-body">
          <div className="disc-section">Setup</div>
          <div className="s-row"><label>Discord Webhook URL</label><input type="text" className="s-input-full" placeholder="https://discord.com/api/webhooks/…" autoComplete="off" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} /></div>
          <div style={{ background: '#0f1319', borderRadius: 8, padding: '0.65rem 0.85rem', marginTop: '0.5rem', fontSize: 12, color: '#6b7897', lineHeight: 1.7 }}>
            <div style={{ color: '#9aa3b5', fontWeight: 600, marginBottom: '0.3rem' }}>How to get your webhook URL:</div>
            1. Open Discord → go to any channel<br />
            2. Click ⚙️ Edit Channel → Integrations<br />
            3. Click Webhooks → New Webhook<br />
            4. Copy Webhook URL and paste above
          </div>
          <button onClick={testWebhook} style={{ width: '100%', marginTop: '0.8rem', background: '#1a1f2e', border: '1px solid #252d3d', color: '#e5e9f2', borderRadius: 8, padding: '0.45rem', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>📨 Send Test Message</button>
          {testMsg && <div style={{ textAlign: 'center', fontSize: 12, marginTop: '0.35rem', fontWeight: 600, padding: '0.35rem', borderRadius: 6, color: testMsg.ok ? '#4ade80' : '#f87171' }}>{testMsg.text}</div>}

          <div className="disc-section" style={{ marginTop: '1.2rem' }}>Alert Toggles</div>
          {ALERT_ROWS.map((r) => (
            <div className="disc-toggle-row" key={r.key}>
              <div className="disc-toggle-info"><span className="disc-toggle-label">{r.icon} {r.label}</span><span className="disc-toggle-desc">{r.desc}</span></div>
              <label className="toggle-switch"><input type="checkbox" checked={alerts[r.key]} onChange={(e) => setAlerts((a) => ({ ...a, [r.key]: e.target.checked }))} /><span className="slider" /></label>
            </div>
          ))}

          <button onClick={save} style={{ width: '100%', marginTop: '1.2rem', background: 'linear-gradient(135deg,#5865f2,#7983f5)', color: '#fff', border: 'none', borderRadius: 8, padding: '0.55rem', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>💾 Save Discord Settings</button>
          {savedMsg && <div style={{ textAlign: 'center', fontSize: 13, color: '#48bb78', marginTop: '0.45rem', fontWeight: 600 }}>✓ Saved!</div>}
        </div>
      </div>
    </div>
  );
}
