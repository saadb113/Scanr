import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import PasswordField from '../PasswordField';

const PROVIDERS = [
  { id: 'glm', name: 'GLM-4.7-Flash', desc: 'Free · Fast · Good quality', link: 'open.bigmodel.cn' },
  { id: 'kimi', name: 'Kimi K2', desc: 'Paid · Best for trading analysis', link: 'platform.moonshot.ai' },
  { id: 'claude', name: 'Claude Sonnet', desc: 'Paid · Premium reasoning quality', link: 'console.anthropic.com' },
];

export default function KimiModal({ open, onClose, onSaved }) {
  const [provider, setProvider] = useState('glm');
  const [keys, setKeys] = useState({ glm: '', kimi: '', claude: '' });
  const [savedMsg, setSavedMsg] = useState(false);
  const [testMsg, setTestMsg] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get('/api/ai/settings').then((s) => {
      setProvider(s.provider || 'glm');
      setKeys({ glm: s.glmApiKey || '', kimi: s.kimiApiKey || '', claude: s.claudeApiKey || '' });
    }).catch(() => {});
  }, [open]);

  async function save() {
    try {
      const j = await api.post('/api/ai/settings', { provider, kimiApiKey: keys.kimi.trim(), glmApiKey: keys.glm.trim(), claudeApiKey: keys.claude.trim() });
      if (j.ok) {
        setSavedMsg(true);
        setTimeout(() => setSavedMsg(false), 2500);
        onSaved?.();
      }
    } catch (e) { console.warn('aiSaveSettings', e); }
  }

  async function test() {
    setTesting(true);
    setTestMsg({ text: 'Testing…', ok: null });
    try {
      const j = await api.post('/api/ai/test');
      setTestMsg({ text: j.ok ? `✓ ${j.message || 'Connection OK'}` : `✗ ${j.error || 'Test failed'}`, ok: j.ok });
    } catch (e) {
      setTestMsg({ text: `✗ ${e.message}`, ok: false });
    }
    setTesting(false);
    setTimeout(() => setTestMsg(null), 5000);
  }

  if (!open) return null;

  return (
    <div className="int-modal-bg open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="int-modal">
        <div className="int-modal-hdr">
          <div className="int-modal-title">🤖 AI Analysis</div>
          <button className="int-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="int-modal-body">
          <div className="disc-section">AI Provider</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '1.1rem' }}>
            {PROVIDERS.map((p) => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', cursor: 'pointer', padding: '0.6rem 0.75rem', borderRadius: 8, border: `1px solid ${provider === p.id ? '#a855f7' : '#1e2535'}`, background: provider === p.id ? 'rgba(168,85,247,0.07)' : '#0f1319' }}>
                <input type="radio" name="aiProvider" checked={provider === p.id} onChange={() => setProvider(p.id)} style={{ accentColor: '#a855f7', marginTop: 3 }} />
                <div>
                  <div style={{ fontWeight: 600, color: '#e5e9f2', fontSize: '0.87rem' }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: '#6b7897', marginTop: '0.15rem' }}>{p.desc}</div>
                </div>
              </label>
            ))}
          </div>

          <div style={{ display: provider === 'glm' ? 'block' : 'none' }}>
            <div className="disc-section">GLM API Key</div>
            <div style={{ marginBottom: '0.5rem' }}><PasswordField value={keys.glm} onChange={(v) => setKeys((k) => ({ ...k, glm: v }))} placeholder="your-glm-key" /></div>
            <div style={{ fontSize: 12, color: '#4a5568' }}>Get your key at <span style={{ color: '#29ffb8' }}>open.bigmodel.cn</span></div>
          </div>
          <div style={{ display: provider === 'kimi' ? 'block' : 'none' }}>
            <div className="disc-section">Kimi API Key</div>
            <div style={{ marginBottom: '0.5rem' }}><PasswordField value={keys.kimi} onChange={(v) => setKeys((k) => ({ ...k, kimi: v }))} placeholder="sk-…" /></div>
            <div style={{ fontSize: 12, color: '#4a5568' }}>Get your key at <span style={{ color: '#29ffb8' }}>platform.moonshot.ai</span></div>
          </div>
          <div style={{ display: provider === 'claude' ? 'block' : 'none' }}>
            <div className="disc-section">Anthropic API Key</div>
            <div style={{ marginBottom: '0.5rem' }}><PasswordField value={keys.claude} onChange={(v) => setKeys((k) => ({ ...k, claude: v }))} placeholder="sk-ant-…" /></div>
            <div style={{ fontSize: 12, color: '#4a5568' }}>Get your key at <span style={{ color: '#29ffb8' }}>console.anthropic.com</span> — Free credits included on signup.</div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.2rem' }}>
            <button onClick={save} style={{ flex: 1, background: 'linear-gradient(135deg,#6d28d9,#a855f7)', color: '#fff', border: 'none', borderRadius: 8, padding: '0.55rem', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>💾 Save</button>
            <button onClick={test} disabled={testing} style={{ background: '#0f1319', color: '#9aa3b5', border: '1px solid #1a2030', borderRadius: 8, padding: '0.5rem 0.9rem', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>🔌 Test</button>
          </div>
          {savedMsg && <div style={{ textAlign: 'center', fontSize: 13, color: '#48bb78', marginTop: '0.45rem', fontWeight: 600 }}>✓ Saved!</div>}
          {testMsg && <div style={{ textAlign: 'center', fontSize: 12, marginTop: '0.4rem', fontWeight: 600, padding: '0.4rem', borderRadius: 6, color: testMsg.ok === false ? '#f87171' : testMsg.ok === true ? '#4ade80' : '#9aa3b5' }}>{testMsg.text}</div>}
        </div>
      </div>
    </div>
  );
}
