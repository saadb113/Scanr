import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import OrderForm from '../components/trading/OrderForm';
import PositionsList from '../components/trading/PositionsList';
import OrdersList from '../components/trading/OrdersList';
import AssetsList from '../components/trading/AssetsList';
import ModifyPositionModal from '../components/trading/ModifyPositionModal';
import { useBybitCreds } from '../hooks/useBybitCreds';
import { useAiAnalysis } from '../hooks/useAiAnalysis';
import { useTradingViewWidget } from '../hooks/useTradingViewWidget';
import { bybitRequest, roundQtyStr, fetchBinanceTicker24hr, fetchBinanceExchangeInfo, TF_LABELS } from '../utils/bybit';
import '../components/trading/trading.css';
import './CoinDetail.css';

const TV_CHARTS_KEY = 'SCANR_tv_charts_v1';
// localStorage save/load adapter for the TradingView chart's own drawings —
// ported verbatim from coin-detail.html's tvSaveLoadAdapter.
const tvSaveLoadAdapter = {
  getAllCharts(cb) {
    try {
      const d = JSON.parse(localStorage.getItem(TV_CHARTS_KEY) || '[]');
      cb(d.map((c) => ({ id: c.id, name: c.name, symbol: c.symbol, resolution: c.resolution, timestamp: c.timestamp })));
    } catch { cb([]); }
  },
  removeChart(id, cb) {
    try {
      const d = JSON.parse(localStorage.getItem(TV_CHARTS_KEY) || '[]');
      localStorage.setItem(TV_CHARTS_KEY, JSON.stringify(d.filter((c) => c.id !== id)));
      cb();
    } catch { cb(); }
  },
  saveChart(data, cb) {
    try {
      const d = JSON.parse(localStorage.getItem(TV_CHARTS_KEY) || '[]');
      const id = (data.id != null && data.id !== '') ? String(data.id) : String(Date.now());
      const record = { ...data, id };
      const i = d.findIndex((c) => c.id === id);
      if (i >= 0) d[i] = record; else d.push(record);
      localStorage.setItem(TV_CHARTS_KEY, JSON.stringify(d));
      cb(id);
    } catch { cb(String(Date.now())); }
  },
  getChartContent(id, cb) {
    try {
      const d = JSON.parse(localStorage.getItem(TV_CHARTS_KEY) || '[]');
      const c = d.find((x) => x.id === id);
      cb(c ? c.content : null);
    } catch { cb(null); }
  },
};

const AI_TF_OPTIONS = ['1', '3', '5', '15', '30', '45', '60', '240', 'D', 'W', 'M'];

// Coin-Detail: a lighter, single-symbol trading surface reached from the
// Scanner's coin modal via "More Details" (?sym=SYMBOL). Porting notes:
//
// - NOT premium-gated: the live page has no data-premium-page attribute and
//   never calls enforcePremiumAccess() (unlike Terminal), confirmed by
//   grepping public/pages/coin-detail.html, so no <PremiumGate> wrapper here.
// - The live page's order-form SIDEBAR MARKUP HAS BEEN REMOVED from its
//   HTML (the <!-- Trade sidebar --> comment in coin-detail.html is empty),
//   while cdPlaceOrder()/cdGetQty()/cdCalcFromRisk()/the qty-mode and SL-TP
//   handlers are all still present but now orphaned (they reference
//   getElementById('cdEntry') etc., which no longer exist, and the inline
//   "Stubs for removed order-form functions (sidebar removed)" comment
//   confirms this was intentional). Since the migration brief asks for an
//   order form here and the exact sizing/placement logic for one already
//   exists (just disconnected from any markup), we rebuild it using the
//   same shared <OrderForm> component Terminal uses, rather than shipping a
//   read-only page. This is a deliberate judgment call, not a blind replay
//   of current (brokenly inert) behavior — flagged in the port's report.
export default function CoinDetail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { creds, hasCreds, clockOffset } = useBybitCreds();
  const ai = useAiAnalysis();

  const symbol = (searchParams.get('sym') || 'BTCUSDT').toUpperCase();
  const symBase = symbol.replace('USDT', '');

  const [category, setCategory] = useState('linear');
  const [belowTab, setBelowTab] = useState('positions');
  const [posCount, setPosCount] = useState(0);
  const [ordCount, setOrdCount] = useState(0);
  const [modifyPosition, setModifyPosition] = useState(null);
  const [applySignal, setApplySignal] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTf, setAiTf] = useState('1');
  const [priceInfo, setPriceInfo] = useState({ price: null, pct: null });
  const [toast, setToast] = useState(null);

  const chartRef = useRef(null);
  const tvOptions = useMemo(() => ({
    height: '100%',
    autosize: true,
    enable_publishing: false,
    save_load_adapter: tvSaveLoadAdapter,
    auto_save_delay: 5,
    charts_storage_api_version: '1.1',
    interval: '60',
  }), []);
  useTradingViewWidget(chartRef, symbol, tvOptions);

  useEffect(() => { document.title = `${symBase} — Coin Detail`; }, [symBase]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const d = await fetchBinanceTicker24hr(symbol);
        if (cancelled) return;
        setPriceInfo({ price: parseFloat(d?.lastPrice) || null, pct: parseFloat(d?.priceChangePercent) || 0 });
      } catch { /* ignore */ }
    }
    load();
    const id = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol]);

  function showToast(text) {
    setToast(text);
    setTimeout(() => setToast((t) => (t === text ? null : t)), 4000);
  }

  async function runAI() {
    try {
      await ai.run(symbol, aiTf);
    } catch { /* error already captured on the hook */ }
  }

  function applyAiAndOpenForm() {
    if (!ai.result) return;
    const r = ai.result;
    setApplySignal({ nonce: Date.now(), entry: +r.entry || 0, sl: +r.sl || 0, tp: +r.tp || 0, dir: (r.direction || '').toUpperCase() });
    setAiOpen(false);
  }

  async function sellSpot(coinSymbol, pct) {
    // Thin wrapper kept here (rather than inside AssetsList) because the
    // confirm()/amount math needs a fresh wallet read + instrument step
    // size, same as cdSpotSell().
    const coinName = coinSymbol.replace('USDT', '');
    try {
      const [walletRes, info] = await Promise.all([
        bybitRequest(creds, 'GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' }, null, clockOffset),
        fetchBinanceExchangeInfo(coinSymbol).catch(() => null),
      ]);
      if (walletRes.retCode !== 0) return showToast(`✗ Could not fetch balance: ${walletRes.retMsg}`);
      const coin = (walletRes.result?.list?.[0]?.coin || []).find((c) => c.coin === coinName);
      const available = parseFloat(coin?.walletBalance || coin?.free || 0);
      if (!available) return showToast(`No ${coinName} balance to sell`);
      const lot = (info?.symbols?.[0]?.filters || []).find((f) => f.filterType === 'LOT_SIZE') || {};
      const step = parseFloat(lot.stepSize || '0.001') || 0.001;
      const minQty = parseFloat(lot.minQty || '0') || 0;
      const rawQty = available * pct;
      const qStr = roundQtyStr(rawQty, step);
      const qtyNum = parseFloat(qStr);
      if (!qtyNum || qtyNum < minQty) return showToast(`Qty too small (min ${minQty})`);
      if (!window.confirm(`Market sell ${qStr} ${coinName} (${pct * 100}% of ${available.toFixed(6)})?`)) return;
      const res = await bybitRequest(creds, 'POST', '/v5/order/create', null, { category: 'spot', symbol: coinSymbol, side: 'Sell', orderType: 'Market', qty: qStr, timeInForce: 'IOC' }, clockOffset);
      if (res.retCode === 0) showToast(`✓ Sold ${qStr} ${coinName}`);
      else showToast(`✗ ${res.retMsg}`);
    } catch (e) { showToast(`✗ ${e.message}`); }
  }

  return (
    <div className="coindetail-page">
      {toast && <div className="term-toast">{toast}</div>}

      <div className="cdet-header">
        <Link to="/scanner" className="cdet-back">← Scanner</Link>
        <span className="cdet-sym-badge">{symBase}/USDT</span>
        <span className="cdet-price-badge">{priceInfo.price != null ? `$${priceInfo.price.toFixed(4)}` : '—'}</span>
        {priceInfo.pct != null && (
          <span className="cdet-pct-badge" style={{ color: priceInfo.pct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
            {priceInfo.pct >= 0 ? '+' : ''}{priceInfo.pct.toFixed(2)}%
          </span>
        )}
        <div className="cdet-nav-links">
          <button type="button" className="cdet-nav-btn ai" onClick={() => setAiOpen(true)}>🤖 Analyze</button>
          <Link to="/terminal" className="cdet-nav-btn">🚀 Trade</Link>
        </div>
      </div>

      <div className="cdet-body">
        <div className="cdet-chart-area">
          <div id="cdetTvContainer" ref={chartRef} className="cdet-tv-container" />
        </div>
        <div className="cdet-order-col">
          <OrderForm
            symbol={symbol}
            enableSymbolSearch={false}
            category={category}
            onCategoryChange={setCategory}
            creds={creds}
            clockOffset={clockOffset}
            qtyModes={['qty', 'cost', 'margin', 'risk']}
            showAutopilotToggle
            autopilotMode="redirect"
            notifyDiscordOnOrder={false}
            broadcastOrderChannel
            onAutopilotRedirect={() => setTimeout(() => navigate('/terminal'), 1200)}
            applySignal={applySignal}
          />
        </div>
      </div>

      <div className="cdet-below">
        <div className="trd-tabs">
          <button type="button" className={`trd-tab ${belowTab === 'positions' ? 'active' : ''}`} onClick={() => setBelowTab('positions')}>Positions <span className="trd-tab-badge">{posCount}</span></button>
          <button type="button" className={`trd-tab ${belowTab === 'orders' ? 'active' : ''}`} onClick={() => setBelowTab('orders')}>Orders <span className="trd-tab-badge">{ordCount}</span></button>
          <button type="button" className={`trd-tab ${belowTab === 'assets' ? 'active' : ''}`} onClick={() => setBelowTab('assets')}>Assets</button>
        </div>
        {belowTab === 'positions' && (
          <div className="trd-page">
            <PositionsList
              creds={creds} clockOffset={clockOffset} category={category}
              onModify={(p) => setModifyPosition(p)}
              onCountChange={setPosCount}
              onClosed={(text, isErr) => showToast((isErr ? '✗ ' : '✓ ') + text)}
            />
          </div>
        )}
        {belowTab === 'orders' && (
          <div className="trd-page">
            <OrdersList
              creds={creds} clockOffset={clockOffset} category={category}
              onCountChange={setOrdCount}
              onCancelled={(text, isErr) => showToast((isErr ? '✗ ' : '✓ ') + text)}
            />
          </div>
        )}
        {belowTab === 'assets' && (
          <div className="trd-page">
            <AssetsList creds={creds} clockOffset={clockOffset} filterToSymbols={[symBase, 'USDT']} onSell={sellSpot} />
          </div>
        )}
      </div>

      {!hasCreds && <div className="term-no-creds-hint">No Bybit API credentials saved — add them in Settings → Bybit.</div>}

      {/* AI Analyze drawer */}
      <div className={`cdet-ai-overlay ${aiOpen ? 'open' : ''}`} onClick={() => setAiOpen(false)} />
      <div className={`cdet-ai-drawer ${aiOpen ? 'open' : ''}`}>
        <div className="cdet-ai-drawer-hd">
          <span className="cdet-ai-drawer-title">🤖 AI Analysis</span>
          <select className="cdet-ai-tf-sel" value={aiTf} onChange={(e) => setAiTf(e.target.value)}>
            {AI_TF_OPTIONS.map((tf) => <option key={tf} value={tf}>{TF_LABELS[tf]}</option>)}
          </select>
          <button type="button" className="cdet-ai-close-x" onClick={() => setAiOpen(false)}>✕</button>
        </div>
        <button type="button" className="cdet-ai-run-btn" disabled={ai.loading} onClick={runAI}>
          {ai.loading ? 'Analyzing…' : 'Analyze with AI'}
        </button>
        <div className="cdet-ai-body">
          {!ai.result && !ai.loading && !ai.error && <div className="cdet-ai-placeholder">Select a timeframe and click Analyze</div>}
          {ai.loading && <div className="cdet-ai-placeholder">Fetching candle data…</div>}
          {ai.error && !ai.loading && <div className="cdet-ai-error">Error: {ai.error.message}</div>}
          {ai.result && !ai.loading && (
            <>
              <div className="cdet-ai-result-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '1.05rem', fontWeight: 900, color: ai.result.direction === 'LONG' ? 'var(--accent-green)' : ai.result.direction === 'SHORT' ? 'var(--accent-red)' : 'var(--accent-amber)' }}>{ai.result.direction}</span>
                  <span className="cdet-ai-conf">{ai.result.confidence} CONFIDENCE</span>
                </div>
                <div className="cdet-ai-grid">
                  <div className="cdet-ai-cell"><div>ENTRY</div><div>{ai.result.entry ?? '—'}</div></div>
                  <div className="cdet-ai-cell"><div>R:R</div><div style={{ color: 'var(--accent-amber)' }}>{ai.result.rr ?? '—'}</div></div>
                  <div className="cdet-ai-cell"><div>TAKE PROFIT</div><div style={{ color: 'var(--accent-green)' }}>{ai.result.tp ?? '—'}</div></div>
                  <div className="cdet-ai-cell"><div>STOP LOSS</div><div style={{ color: 'var(--accent-red)' }}>{ai.result.sl ?? '—'}</div></div>
                </div>
              </div>
              <div className="cdet-ai-reasoning"><div className="cdet-ai-reasoning-head">Reasoning</div>{ai.result.reasoning}</div>
              {ai.result.direction !== 'NEUTRAL' && ai.result.entry && ai.result.sl && (
                <button type="button" className="cdet-ai-apply-btn" onClick={applyAiAndOpenForm}>⚡ Apply to Order Form</button>
              )}
            </>
          )}
        </div>
      </div>

      <ModifyPositionModal
        open={!!modifyPosition} position={modifyPosition} category={category} creds={creds} clockOffset={clockOffset}
        onClose={() => setModifyPosition(null)}
      />
    </div>
  );
}
