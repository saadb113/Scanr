import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/client';

const CARDS = [
  { id: 'bybit', icon: '⚡', name: 'Bybit' },
  { id: 'binance', name: 'Binance Futures', icon: '🟡' },
  { id: 'kimi', icon: '🤖', name: 'AI Models' },
  { id: 'discord', icon: '💬', name: 'Discord' },
  { id: 'telegram', icon: '✈️', name: 'Telegram' },
];

export default function IntegrationsTab({ onOpenModal }) {
  const [status, setStatus] = useState({});
  const [exchange, setExchange] = useState('bybit');
  const [exchangeMsg, setExchangeMsg] = useState(null);

  const loadStatuses = useCallback(async () => {
    try {
      const [bybitJ, binanceJ, aiJ, discJ, tgJ] = await Promise.all([
        api.get('/api/bybit-store').catch(() => ({})),
        api.get('/api/binance-store').catch(() => ({})),
        api.get('/api/ai/settings').catch(() => ({})),
        api.get('/api/discord/config').catch(() => ({})),
        api.get('/api/telegram/config').catch(() => ({})),
      ]);
      const keyMap = { kimi: aiJ?.kimiApiKey, glm: aiJ?.glmApiKey, claude: aiJ?.claudeApiKey };
      setStatus({
        bybit: !!(bybitJ?.mainnet?.apiKey || bybitJ?.testnet?.apiKey),
        binance: !!(binanceJ?.apiKey && binanceJ?.apiSecret),
        kimi: !!keyMap[aiJ?.provider || 'glm'],
        discord: !!discJ?.webhookUrl,
        telegram: !!(tgJ?.telegram?.chatId),
      });
    } catch (e) { console.warn('loadIntegrationStatuses', e); }

    api.get('/api/settings').then((s) => setExchange(s?.defaultExchange === 'binance' ? 'binance' : 'bybit')).catch(() => {});
  }, []);

  useEffect(() => { loadStatuses(); }, [loadStatuses]);

  async function saveExchange(value) {
    setExchange(value);
    try {
      await api.post('/api/settings', { defaultExchange: value });
      setExchangeMsg({ ok: true, text: `✓ Saved (${value})` });
    } catch {
      setExchangeMsg({ ok: false, text: '✗ Save failed' });
    }
    setTimeout(() => setExchangeMsg(null), 2000);
  }

  return (
    <div>
      <div style={{ fontSize: '0.82rem', color: '#6b7897', marginBottom: '1.1rem' }}>Connect external services to unlock notifications and AI analysis.</div>
      <div className="int-grid">
        {CARDS.map((c) => (
          <div className="int-card" key={c.id}>
            <div className="int-icon">{c.icon}</div>
            <div className="int-name">{c.name}</div>
            <div className={`int-status ${status[c.id] ? 'connected' : 'not-set'}`}>
              {status[c.id] ? 'Connected ✅' : (c.id === 'discord' || c.id === 'telegram' ? 'Not set ⚪' : 'Not configured ⚪')}
            </div>
            <button className="int-cfg-btn" onClick={() => onOpenModal(c.id)}>Configure</button>
          </div>
        ))}
      </div>

      <div className="sp-card" style={{ marginTop: '1.2rem', maxWidth: 520 }}>
        <div className="sp-card-title">Default Trading Exchange</div>
        <div className="s-row">
          <label>Preferred Exchange</label>
          <select className="s-input-full" style={{ maxWidth: 260 }} value={exchange} onChange={(e) => saveExchange(e.target.value)}>
            <option value="bybit">Bybit</option>
            <option value="binance">Binance Futures</option>
          </select>
        </div>
        {exchangeMsg && <span style={{ fontSize: '0.82rem', color: exchangeMsg.ok ? '#48bb78' : '#f87171', fontWeight: 600, marginTop: '0.4rem', display: 'inline-block' }}>{exchangeMsg.text}</span>}
      </div>
    </div>
  );
}
