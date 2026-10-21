import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PremiumGate from '../components/PremiumGate';
import OrderForm from '../components/trading/OrderForm';
import PositionsList from '../components/trading/PositionsList';
import OrdersList from '../components/trading/OrdersList';
import AssetsList from '../components/trading/AssetsList';
import AutopilotPanel from '../components/trading/AutopilotPanel';
import ModifyPositionModal from '../components/trading/ModifyPositionModal';
import ModifyOrderModal from '../components/trading/ModifyOrderModal';
import { useBybitCreds } from '../hooks/useBybitCreds';
import { useAutopilot } from '../hooks/useAutopilot';
import { useAiAnalysis } from '../hooks/useAiAnalysis';
import { useTradingViewWidget } from '../hooks/useTradingViewWidget';
import { api, API_BASE } from '../api/client';
import { TF_LABELS } from '../utils/bybit';
import '../components/trading/trading.css';
import './Terminal.css';

export default function Terminal() {
  return (
    <PremiumGate>
      <TerminalContent />
    </PremiumGate>
  );
}

const AI_TF_OPTIONS = ['1', '3', '5', '15', '30', '45', '60', '240', 'D', 'W', 'M'];

function TerminalContent() {
  const [searchParams] = useSearchParams();
  const { creds, hasCreds, clockOffset } = useBybitCreds();
  const autopilot = useAutopilot();
  const ai = useAiAnalysis();

  // One-time bootstrap: a symbol in the URL (?symbol=SOL) or a prefill left
  // in sessionStorage by the AI "Trade on Bybit" button elsewhere, or by
  // Coin-Detail's autopilot redirect. Ported from terminal.html's
  // DOMContentLoaded handler + app.js's bybit_prefill handling.
  const bootRef = useRef(null);
  if (bootRef.current === null) {
    const requested = (searchParams.get('symbol') || '').trim().toUpperCase();
    let prefill = null;
    try { prefill = JSON.parse(sessionStorage.getItem('bybit_prefill')); } catch { prefill = null; }
    sessionStorage.removeItem('bybit_prefill');
    const startSym = prefill?.sym
      ? prefill.sym.toUpperCase()
      : (requested ? (requested.endsWith('USDT') ? requested : `${requested}USDT`) : 'BTCUSDT');
    bootRef.current = { startSym, prefill };
  }

  const [symbol, setSymbol] = useState(bootRef.current.startSym);
  const [category, setCategory] = useState('linear');
  const [activeTab, setActiveTab] = useState('positions');
  const [posCount, setPosCount] = useState(0);
  const [ordCount, setOrdCount] = useState(0);
  const [alertCount, setAlertCount] = useState(0);
  const [toast, setToast] = useState(null);
  const [modifyPosition, setModifyPosition] = useState(null);
  const [modifyOrder, setModifyOrder] = useState(null);
  const [applySignal, setApplySignal] = useState(null);
  const [aiTf, setAiTf] = useState('1');
  const [aiLimitModalOpen, setAiLimitModalOpen] = useState(false);

  // Price alerts
  const [alerts, setAlerts] = useState([]);
  const [paSymbol, setPaSymbol] = useState('');
  const [paPrice, setPaPrice] = useState('');
  const [paDir, setPaDir] = useState('above');
  const [paErr, setPaErr] = useState(null);

  const chartRef = useRef(null);
  const tvOptions = useMemo(() => ({ height: 550 }), []);
  useTradingViewWidget(chartRef, symbol, tvOptions);

  function showToast(text) {
    setToast(text);
    setTimeout(() => setToast((t) => (t === text ? null : t)), 5000);
  }

  // Resume autopilot display if it was already running server-side, and
  // apply any entry/sl/tp that came along with a cross-page prefill.
  useEffect(() => {
    autopilot.checkResume();
    if (bootRef.current.prefill) {
      const p = bootRef.current.prefill;
      setApplySignal({ nonce: Date.now(), entry: p.entry, sl: p.sl, tp: p.tp, dir: p.dir });
    }
    ai.fetchUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cross-tab notice from Coin-Detail after it places an order (BroadcastChannel('orders')).
  useEffect(() => {
    let channel;
    try {
      channel = new BroadcastChannel('orders');
      channel.onmessage = (e) => {
        if (e.data?.type === 'position:new') {
          setActiveTab('positions');
          showToast(`✓ Position opened: ${e.data.symbol || ''}`);
        }
      };
    } catch { /* BroadcastChannel unsupported in this browser — ignore */ }
    return () => channel?.close();
  }, []);

  // Price-alert trigger notifications via socket.io.
  useEffect(() => {
    if (typeof window.io !== 'function') return;
    const sock = window.io(API_BASE || undefined, { withCredentials: true });
    sock.on('price_alert:triggered', (data) => {
      loadAlerts();
      showToast(`💰 Price Alert: ${data.symbol} hit ${data.targetPrice}`);
    });
    return () => sock.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAlerts = useCallback(async () => {
    try {
      const list = await api.get('/api/alerts/price');
      setAlerts(list || []);
      setAlertCount((list || []).length);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (activeTab === 'pricealerts') loadAlerts(); }, [activeTab, loadAlerts]);

  async function submitAlert() {
    setPaErr(null);
    const s = paSymbol.trim().toUpperCase();
    const price = parseFloat(paPrice);
    if (!s) { setPaErr('Enter a symbol.'); return; }
    if (Number.isNaN(price) || price <= 0) { setPaErr('Enter a valid price.'); return; }
    try {
      await api.post('/api/alerts/price', { symbol: s, targetPrice: price, direction: paDir, currentPriceWhenSet: 0 });
      setPaSymbol(''); setPaPrice('');
      loadAlerts();
    } catch (e) {
      setPaErr(e.data?.error || e.message);
    }
  }

  async function deleteAlert(id) {
    try { await api.del(`/api/alerts/price/${id}`); loadAlerts(); } catch { /* ignore */ }
  }

  async function runAI() {
    try {
      await ai.run(symbol, aiTf);
    } catch (e) {
      if (e.limitReached) setAiLimitModalOpen(true);
    }
  }

  function applyAiToForm() {
    if (!ai.result) return;
    const r = ai.result;
    setApplySignal({ nonce: Date.now(), entry: +r.entry || 0, sl: +r.sl || 0, tp: +r.tp || 0, dir: (r.direction || '').toUpperCase() });
  }

  const symBase = symbol.replace('USDT', '');

  return (
    <div className="terminal-page">
      {toast && <div className="term-toast">{toast}</div>}

      <div className="term-top-layout">
        <div className="term-chart-col">
          <div className="term-sym-bar">
            <span className="term-sym-label">{symBase}/USDT</span>
          </div>
          <div id="termTvChart" ref={chartRef} className="term-tv-chart" />
        </div>

        <div className="term-bottom-section">
          <div className="trd-tabs">
            <button type="button" className={`trd-tab ${activeTab === 'positions' ? 'active' : ''}`} onClick={() => setActiveTab('positions')}>Positions <span className="trd-tab-badge">{posCount}</span></button>
            <button type="button" className={`trd-tab ${activeTab === 'orders' ? 'active' : ''}`} onClick={() => setActiveTab('orders')}>Open Orders <span className="trd-tab-badge">{ordCount}</span></button>
            <button type="button" className={`trd-tab ${activeTab === 'assets' ? 'active' : ''}`} onClick={() => setActiveTab('assets')}>Assets</button>
            {category === 'linear' && (
              <button type="button" className={`trd-tab ${activeTab === 'autopilot' ? 'active' : ''}`} onClick={() => setActiveTab('autopilot')}>
                Autopilot <span className="trd-tab-badge" style={{ background: '#3b0764', color: '#a855f7' }}>{autopilot.running ? 'ON' : 'OFF'}</span>
              </button>
            )}
            <button type="button" className={`trd-tab ${activeTab === 'pricealerts' ? 'active' : ''}`} onClick={() => setActiveTab('pricealerts')}>Price Alerts <span className="trd-tab-badge">{alertCount}</span></button>
          </div>

          {activeTab === 'positions' && (
            <div className="trd-page">
              <div className="term-page-head"><span>Live positions · auto-refreshes every 5s</span></div>
              <PositionsList
                creds={creds} clockOffset={clockOffset} category={category}
                showAutopilotButton
                autopilotActiveSymbol={autopilot.running ? (autopilot.position?.sym || autopilot.position?.symbol) : null}
                onStartAutopilot={(pos) => autopilot.start(pos)}
                onStopAutopilot={() => autopilot.stop()}
                onModify={(p) => setModifyPosition(p)}
                onCountChange={setPosCount}
                onClosed={(text, isErr) => showToast((isErr ? '✗ ' : '✓ ') + text)}
              />
            </div>
          )}
          {activeTab === 'orders' && (
            <div className="trd-page">
              <div className="term-page-head"><span>Pending limit orders</span></div>
              <OrdersList
                creds={creds} clockOffset={clockOffset} category={category} allowModify
                onModify={(o) => setModifyOrder(o)}
                onCountChange={setOrdCount}
                onCancelled={(text, isErr) => showToast((isErr ? '✗ ' : '✓ ') + text)}
              />
            </div>
          )}
          {activeTab === 'assets' && (
            <div className="trd-page">
              <div className="term-page-head"><span>Bybit wallet balances</span></div>
              <AssetsList creds={creds} clockOffset={clockOffset} />
            </div>
          )}
          {activeTab === 'autopilot' && category === 'linear' && (
            <div className="trd-page">
              <AutopilotPanel autopilot={autopilot} creds={creds} clockOffset={clockOffset} />
            </div>
          )}
          {activeTab === 'pricealerts' && (
            <div className="trd-page">
              <div className="term-alert-form">
                <div className="trd-field">
                  <label>Symbol</label>
                  <input className="trd-input" style={{ textTransform: 'uppercase' }} placeholder="e.g. BTCUSDT" value={paSymbol} onChange={(e) => setPaSymbol(e.target.value)} />
                </div>
                <div className="trd-field">
                  <label>Target Price</label>
                  <input className="trd-input" type="number" step="any" placeholder="0.00" value={paPrice} onChange={(e) => setPaPrice(e.target.value)} />
                </div>
                <div className="trd-field">
                  <label>Direction</label>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button type="button" className={`term-dir-pill above ${paDir === 'above' ? 'active' : ''}`} onClick={() => setPaDir('above')}>📈 Above</button>
                    <button type="button" className={`term-dir-pill below ${paDir === 'below' ? 'active' : ''}`} onClick={() => setPaDir('below')}>📉 Below</button>
                  </div>
                </div>
                <button type="button" className="term-set-alert-btn" onClick={submitAlert}>Set Alert</button>
              </div>
              {paErr && <div style={{ fontSize: 11, color: 'var(--accent-red)', marginBottom: '0.5rem', fontWeight: 600 }}>{paErr}</div>}
              {alerts.length === 0 ? <div className="trd-empty">No active price alerts</div> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {alerts.map((a) => (
                    <div key={a._id} className="term-alert-row">
                      <span className="term-alert-sym">{a.symbol}</span>
                      <span className="term-alert-price">{a.targetPrice}</span>
                      <span className={`term-alert-dir ${a.direction}`}>{a.direction === 'above' ? '📈 Above' : '📉 Below'}</span>
                      <span className="term-alert-date">{new Date(a.createdAt).toLocaleString()}</span>
                      <button type="button" className="term-alert-del" onClick={() => deleteAlert(a._id)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="term-order-sidebar">
        <OrderForm
          symbol={symbol}
          onSymbolChange={setSymbol}
          enableSymbolSearch
          category={category}
          onCategoryChange={setCategory}
          creds={creds}
          clockOffset={clockOffset}
          qtyModes={['cost']}
          showAutopilotToggle
          autopilotMode="inline"
          notifyDiscordOnOrder
          onAutopilotStarted={(snapshot) => { autopilot.start(snapshot); setActiveTab('autopilot'); }}
          onPlaceOrder={() => setActiveTab('orders')}
          applySignal={applySignal}
        />

        <div className="term-ai-panel">
          <div className="term-ai-head">🤖 AI Analysis</div>
          <select className="trd-input" value={aiTf} onChange={(e) => setAiTf(e.target.value)}>
            {AI_TF_OPTIONS.map((tf) => <option key={tf} value={tf}>{TF_LABELS[tf]}</option>)}
          </select>
          <button type="button" className="term-ai-btn" disabled={ai.loading} onClick={runAI}>
            {ai.loading ? '⏳ Analyzing…' : '🤖 Analyze with AI'}
          </button>
          {ai.usage && (
            <div className="term-ai-usage" style={{ color: ai.usage.isPremium ? 'var(--accent-green)' : (Number(ai.usage.used) >= Number(ai.usage.limit) ? 'var(--accent-red)' : 'var(--text-muted)') }}>
              {ai.usage.isPremium ? 'AI ∞' : `AI ${ai.usage.used}/${ai.usage.limit}`}
            </div>
          )}
          <div className="term-ai-info">{symBase} · {TF_LABELS[aiTf]}</div>
          {ai.error && !ai.loading && <div style={{ color: 'var(--accent-red)', fontSize: 12, padding: '0.5rem' }}>✗ {ai.error.message}</div>}
          {ai.result && !ai.loading && (
            <div className="term-ai-result">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <span style={{ fontWeight: 800, color: ai.result.direction === 'LONG' ? 'var(--accent-green)' : ai.result.direction === 'SHORT' ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                  {ai.result.direction === 'LONG' ? '▲' : ai.result.direction === 'SHORT' ? '▼' : '◆'} {ai.result.direction}
                </span>
                <span style={{ fontSize: 10, fontWeight: 700 }}>{ai.result.confidence}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem', marginBottom: '0.4rem' }}>
                {[['Entry', ai.result.entry], ['SL', ai.result.sl], ['TP', ai.result.tp], ['R:R', ai.result.rr]].map(([l, v]) => (
                  <div key={l} className="term-ai-metric"><div>{l}</div><div>{v != null ? v : '—'}</div></div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: '0.4rem', maxHeight: 80, overflowY: 'auto' }}>{ai.result.reasoning}</div>
              {ai.result.direction !== 'NEUTRAL' && ai.result.entry && ai.result.sl && (
                <button type="button" className="term-ai-apply" onClick={applyAiToForm}>⚡ Apply to Order Form</button>
              )}
            </div>
          )}
        </div>
      </div>

      <ModifyPositionModal
        open={!!modifyPosition} position={modifyPosition} category={category} creds={creds} clockOffset={clockOffset}
        onClose={() => setModifyPosition(null)} onSaved={() => {}}
      />
      <ModifyOrderModal
        open={!!modifyOrder} order={modifyOrder} category={category} creds={creds} clockOffset={clockOffset}
        onClose={() => setModifyOrder(null)} onSaved={() => {}}
      />

      {aiLimitModalOpen && (
        <div className="trd-modal-overlay" onClick={() => setAiLimitModalOpen(false)}>
          <div className="trd-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="trd-modal-title">🤖 Daily Limit Reached</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Free users get a limited number of AI analyses per day. Upgrade to Premium for unlimited AI analysis.
            </div>
            <button type="button" className="trd-modal-save" onClick={() => { window.location.href = '/pricing'; }}>🚀 Upgrade to Premium</button>
            <button type="button" className="trd-place-btn long" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }} onClick={() => setAiLimitModalOpen(false)}>Maybe Later</button>
          </div>
        </div>
      )}

      {!hasCreds && (
        <div className="term-no-creds-hint">
          No Bybit API credentials saved — positions/orders/assets will stay empty. Add them in Settings → Bybit.
        </div>
      )}
    </div>
  );
}
