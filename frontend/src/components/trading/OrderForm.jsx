import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import {
  bybitRequest, syncBybitClock, fetchBinanceExchangeInfo, fetchBinanceTicker24hr,
  roundQtyStr, roundPriceStr, decimalsFor,
} from '../../utils/bybit';
import { FUTURES_UNIVERSE } from '../../utils/futuresUniverse';

const GREEN = 'var(--accent-green)';
const RED = 'var(--accent-red)';
const AMBER = 'var(--accent-amber)';

function baseOf(sym) { return (sym || '').replace('USDT', ''); }
function toFullSymbol(text) {
  const up = (text || '').trim().toUpperCase();
  if (!up) return '';
  return up.endsWith('USDT') ? up : up + 'USDT';
}

// Shared Bybit order-entry form used by both Terminal and Coin-Detail.
// Ported from the order-sidebar markup + bytXxx() functions in
// public/js/app.js (Terminal) and the equivalent (now-orphaned, since the
// sidebar markup was removed from the live page — see Coin-Detail porting
// notes) cdXxx() functions in public/pages/coin-detail.html.
//
// qtyModes controls which "Amount" tabs are offered:
//   'cost'   - USDT cost -> qty = cost / entry           (the only mode Terminal's live UI exposes)
//   'qty'    - raw contracts, typed directly
//   'margin' - USDT margin -> qty = margin * leverage / entry
//   'risk'   - % of account equity risked to the SL distance -> qty = (equity * risk%) / |entry-sl|
export default function OrderForm({
  symbol,
  onSymbolChange,
  enableSymbolSearch = false,
  category,
  onCategoryChange,
  creds,
  clockOffset,
  qtyModes = ['cost'],
  showAutopilotToggle = true,
  autopilotMode = 'inline', // 'inline' (Terminal: calls /api/autopilot/start itself) | 'redirect' (Coin-Detail: stores prefill + redirects)
  notifyDiscordOnOrder = false,
  broadcastOrderChannel = false,
  onPlaceOrder,
  onAutopilotStarted,
  onAutopilotRedirect,
  prefill, // optional { dir, entry, sl, tp, maxLev } applied once on mount (cross-page prefill)
  applySignal, // optional { nonce, dir, entry, sl, tp } — re-applied every time `nonce` changes (AI "apply to form")
}) {
  const [dir, setDir] = useState(prefill?.dir === 'SHORT' ? 'Sell' : 'Buy');
  const [orderType, setOrderType] = useState('Limit');
  const [qtyMode, setQtyMode] = useState(qtyModes[0] || 'cost');
  const [entry, setEntry] = useState(prefill?.entry ? String(prefill.entry) : '');
  const [qtyRaw, setQtyRaw] = useState('');
  const [cost, setCost] = useState('');
  const [marginAmt, setMarginAmt] = useState('');
  const [riskPct, setRiskPct] = useState(1);
  const [lev, setLev] = useState(prefill?.maxLev || 10);
  const [marginMode, setMarginMode] = useState('ISOLATED');
  const [slMode, setSlMode] = useState('price');
  const [tpMode, setTpMode] = useState('price');
  const [slPrice, setSlPrice] = useState(prefill?.sl ? String(prefill.sl) : '');
  const [tpPrice, setTpPrice] = useState(prefill?.tp ? String(prefill.tp) : '');
  const [slPnl, setSlPnl] = useState('');
  const [tpPnl, setTpPnl] = useState('');
  const [apMode, setApMode] = useState('manual');
  const [livePrice, setLivePrice] = useState(0);
  const [symInfo, setSymInfo] = useState({ maxLev: 125, qtyStep: 0.001, minQty: 0, tickSize: 0 });
  const [balance, setBalance] = useState({ equity: null, available: null });
  const [placing, setPlacing] = useState(false);
  const [msg, setMsg] = useState(null);
  const [symbolText, setSymbolText] = useState(baseOf(symbol));
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const qtyRef = useRef(0);

  // "Apply to Order Form" from an AI analysis result — re-applied every time
  // applySignal.nonce changes, even if the values themselves repeat.
  useEffect(() => {
    if (!applySignal) return;
    if (applySignal.entry > 0) setEntry(String(applySignal.entry));
    if (applySignal.sl > 0) { setSlMode('price'); setSlPrice(String(applySignal.sl)); }
    if (applySignal.tp > 0) { setTpMode('price'); setTpPrice(String(applySignal.tp)); }
    if (applySignal.dir === 'LONG') setDir('Buy');
    if (applySignal.dir === 'SHORT') setDir('Sell');
    setOrderType('Limit');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applySignal?.nonce]);

  // ── Exchange info (leverage/qty-step/tick-size) + live price ───────────
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchBinanceExchangeInfo(symbol);
        const info = data?.symbols?.[0];
        if (!info || cancelled) return;
        const lot = (info.filters || []).find((f) => f.filterType === 'LOT_SIZE') || {};
        const pf = (info.filters || []).find((f) => f.filterType === 'PRICE_FILTER') || {};
        const maxLev = category === 'spot' ? 1 : 125;
        setSymInfo({
          maxLev,
          qtyStep: parseFloat(lot.stepSize || '0.001') || 0.001,
          minQty: parseFloat(lot.minQty || '0') || 0,
          tickSize: parseFloat(pf.tickSize || '0') || 0,
        });
        setLev((v) => Math.max(1, Math.min(v, maxLev)));
      } catch { /* ignore — chart/order still usable, just no bounds info */ }
    })();
    return () => { cancelled = true; };
  }, [symbol, category]);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await fetchBinanceTicker24hr(symbol);
        const px = parseFloat(d?.lastPrice);
        if (px > 0 && !cancelled) setLivePrice(px);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [symbol]);

  // ── Wallet balance (for display + risk-mode sizing) ─────────────────────
  useEffect(() => {
    if (!creds?.apiKey) return;
    let cancelled = false;
    async function loadBalance() {
      try {
        const r = await bybitRequest(creds, 'GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' }, null, clockOffset);
        if (r.retCode !== 0 || cancelled) return;
        const acct = r.result?.list?.[0];
        if (!acct) return;
        setBalance({
          equity: parseFloat(acct.totalEquity || 0),
          available: parseFloat(acct.totalAvailableBalance || acct.availableBalance || 0),
        });
      } catch { /* ignore */ }
    }
    loadBalance();
    const id = setInterval(loadBalance, 15000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds?.apiKey, creds?.apiSecret, creds?.env, clockOffset]);

  function getEffectiveEntry() {
    const typed = parseFloat(entry);
    if (typed > 0) return typed;
    return livePrice > 0 ? livePrice : 0;
  }

  function getQty() {
    const effEntry = getEffectiveEntry();
    if (qtyMode === 'qty') return parseFloat(qtyRaw) || 0;
    if (qtyMode === 'cost') return effEntry ? (parseFloat(cost) || 0) / effEntry : 0;
    if (qtyMode === 'margin') return effEntry ? ((parseFloat(marginAmt) || 0) * lev) / effEntry : 0;
    if (qtyMode === 'risk') {
      const sl = parseFloat(slPrice);
      const equity = balance.equity;
      if (!effEntry || !sl || sl === effEntry || !equity) return 0;
      return (equity * (riskPct / 100)) / Math.abs(effEntry - sl);
    }
    return 0;
  }

  const effEntry = getEffectiveEntry();
  const qty = getQty();
  qtyRef.current = qty;

  // ── PnL$ <-> price conversion for SL/TP (ported from bytCalcSlFromPnl/bytCalcTpFromPnl) ──
  useEffect(() => {
    if (slMode !== 'pnl') return;
    const pnlInput = parseFloat(slPnl);
    if (Number.isNaN(pnlInput)) { setSlPrice(''); return; }
    const q = qtyRef.current;
    if (!q || !effEntry) return;
    const isLong = dir === 'Buy';
    const p = isLong ? effEntry - Math.abs(pnlInput) / q : effEntry + Math.abs(pnlInput) / q;
    if (p > 0) setSlPrice(p.toFixed(decimalsFor(effEntry)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slMode, slPnl, dir, effEntry]);

  useEffect(() => {
    if (tpMode !== 'pnl') return;
    const pnlInput = parseFloat(tpPnl);
    if (Number.isNaN(pnlInput)) { setTpPrice(''); return; }
    const q = qtyRef.current;
    if (!q || !effEntry) return;
    const isLong = dir === 'Buy';
    const p = isLong ? effEntry + Math.abs(pnlInput) / q : effEntry - Math.abs(pnlInput) / q;
    if (p > 0) setTpPrice(p.toFixed(decimalsFor(effEntry)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpMode, tpPnl, dir, effEntry]);

  // ── Summary (ported from bytUpdateSummary) ─────────────────────────────
  const summary = useMemo(() => {
    const slNum = parseFloat(slPrice) || null;
    const tpNum = parseFloat(tpPrice) || null;
    const posVal = qty && effEntry ? qty * effEntry : null;
    const marginReq = posVal != null ? posVal / lev : null;
    const slDist = effEntry && slNum ? Math.abs(effEntry - slNum) : null;
    const maxLoss = slDist && qty ? slDist * qty : null;
    const tpDist = effEntry && tpNum ? Math.abs(tpNum - effEntry) : null;
    const profit = tpDist && qty ? tpDist * qty : null;
    const rr = maxLoss && profit ? `1 : ${(profit / maxLoss).toFixed(2)}` : '—';
    return { posVal, marginReq, maxLoss, profit, rr };
  }, [qty, effEntry, slPrice, tpPrice, lev]);

  // ── Symbol search (Terminal only) ───────────────────────────────────────
  const matches = useMemo(() => {
    if (!enableSymbolSearch) return [];
    const q = symbolText.toUpperCase().replace('USDT', '').trim();
    if (!q) return [];
    return FUTURES_UNIVERSE
      .filter((s) => s.replace('USDT', '').startsWith(q))
      .concat(FUTURES_UNIVERSE.filter((s) => !s.replace('USDT', '').startsWith(q) && s.replace('USDT', '').includes(q)))
      .slice(0, 25);
  }, [enableSymbolSearch, symbolText]);

  function selectSymbol(sym) {
    setSymbolText(baseOf(sym));
    setDropdownOpen(false);
    onSymbolChange?.(sym);
  }

  async function fetchLivePriceNow(sym) {
    try {
      const d = await fetchBinanceTicker24hr(sym);
      const px = parseFloat(d?.lastPrice);
      return px > 0 ? px : null;
    } catch { return null; }
  }

  function showMsg(text, color) {
    setMsg({ text, color });
    setTimeout(() => setMsg((m) => (m && m.text === text ? null : m)), 4000);
  }

  async function placeOrder() {
    const rawSymbol = enableSymbolSearch ? (toFullSymbol(symbolText)) : symbol;
    if (!rawSymbol) return showMsg('✗ Enter a symbol', RED);

    let q = getQty();
    if (!q || q <= 0) return showMsg('✗ Enter an amount', RED);

    const limitEntry = parseFloat(entry);
    if (orderType === 'Limit' && !(limitEntry > 0)) return showMsg('✗ Enter entry price', RED);

    let slFinal = parseFloat(slPrice) || 0;
    let tpFinal = parseFloat(tpPrice) || 0;

    setPlacing(true);
    try {
      const offset = await syncBybitClock();

      // Market orders with PnL-mode SL/TP: recompute against the live mark
      // price right before sending, same as bytPlaceOrder().
      if (orderType === 'Market' && (slMode === 'pnl' || tpMode === 'pnl')) {
        const livePx = await fetchLivePriceNow(rawSymbol);
        if (livePx > 0) {
          const isLong = dir === 'Buy';
          const dp = decimalsFor(livePx);
          if (slMode === 'pnl' && slPnl) {
            const p = isLong ? livePx - Math.abs(parseFloat(slPnl)) / q : livePx + Math.abs(parseFloat(slPnl)) / q;
            if (p > 0) slFinal = parseFloat(p.toFixed(dp));
          }
          if (tpMode === 'pnl' && tpPnl) {
            const p = isLong ? livePx + Math.abs(parseFloat(tpPnl)) / q : livePx - Math.abs(parseFloat(tpPnl)) / q;
            if (p > 0) tpFinal = parseFloat(p.toFixed(dp));
          }
        }
      }

      if (category === 'linear') {
        await bybitRequest(creds, 'POST', '/v5/position/set-leverage', null, {
          category: 'linear', symbol: rawSymbol, buyLeverage: String(lev), sellLeverage: String(lev),
        }, offset);
        try {
          await bybitRequest(creds, 'POST', '/v5/position/switch-isolated', null, {
            category: 'linear', symbol: rawSymbol, tradeMode: marginMode === 'ISOLATED' ? 1 : 0,
            buyLeverage: String(lev), sellLeverage: String(lev),
          }, offset);
        } catch { /* already set — fine */ }
      }

      const qtyStr = roundQtyStr(q, symInfo.qtyStep);
      const finalQty = parseFloat(qtyStr);
      if (!finalQty || finalQty < symInfo.minQty) {
        const hint = symInfo.minQty > 0 ? ` (min: ${symInfo.minQty})` : '';
        showMsg(`✗ Qty too small after rounding${hint}`, RED);
        setPlacing(false);
        return;
      }

      const orderBody = {
        category, symbol: rawSymbol, side: dir, orderType, qty: qtyStr,
        timeInForce: orderType === 'Market' ? 'IOC' : 'GTC',
      };
      if (category === 'spot' && orderType === 'Market' && dir === 'Buy') orderBody.marketUnit = 'baseCoin';
      if (orderType === 'Limit') orderBody.price = roundPriceStr(limitEntry, symInfo.tickSize);
      if (category !== 'spot') {
        if (slFinal > 0) { orderBody.stopLoss = roundPriceStr(slFinal, symInfo.tickSize); orderBody.slTriggerBy = 'MarkPrice'; }
        if (tpFinal > 0) { orderBody.takeProfit = roundPriceStr(tpFinal, symInfo.tickSize); orderBody.tpTriggerBy = 'MarkPrice'; }
      }

      const res = await bybitRequest(creds, 'POST', '/v5/order/create', null, orderBody, offset);
      if (res.retCode !== 0) {
        showMsg(`✗ ${res.retMsg}`, RED);
        setPlacing(false);
        return;
      }

      const ordId = (res.result?.orderId || '').slice(0, 8);
      showMsg(`✓ Order placed! ID: ${ordId}…`, GREEN);

      if (notifyDiscordOnOrder) {
        api.post('/api/discord/notify/order', {
          symbol: rawSymbol, side: dir, orderType, price: orderType === 'Limit' ? limitEntry : null, qty: finalQty, sl: slFinal, tp: tpFinal,
        }).catch(() => {});
      }
      if (broadcastOrderChannel) {
        try { new BroadcastChannel('orders').postMessage({ type: 'position:new', symbol: rawSymbol, side: dir }); } catch { /* ignore */ }
      }

      if (showAutopilotToggle && apMode === 'autopilot' && slFinal > 0 && tpFinal > 0) {
        let effectiveEntry = (orderType === 'Limit' && limitEntry > 0) ? limitEntry : 0;
        if (!effectiveEntry) effectiveEntry = (await fetchLivePriceNow(rawSymbol)) || 0;
        if (effectiveEntry > 0) {
          if (autopilotMode === 'inline') {
            try {
              await api.post('/api/autopilot/start', { sym: rawSymbol, entry: effectiveEntry, sl: slFinal, tp: tpFinal, side: dir, size: finalQty });
              onAutopilotStarted?.({
                sym: rawSymbol, entry: effectiveEntry, sl: slFinal, initSl: slFinal, tp: tpFinal,
                side: dir, size: finalQty, isLong: dir === 'Buy', lev,
              });
            } catch (e) {
              showMsg(`Order placed, but autopilot failed to start: ${e.message}`, AMBER);
            }
          } else {
            sessionStorage.setItem('bybit_prefill', JSON.stringify({
              sym: rawSymbol, dir: dir === 'Buy' ? 'LONG' : 'SHORT', entry: effectiveEntry, sl: slFinal, tp: tpFinal,
            }));
            onAutopilotRedirect?.();
          }
        }
      }

      onPlaceOrder?.({ ok: true, symbol: rawSymbol, side: dir, qty: finalQty, sl: slFinal, tp: tpFinal });
    } catch (e) {
      showMsg(`✗ ${e.message}`, RED);
    } finally {
      setPlacing(false);
    }
  }

  const isSpot = category === 'spot';
  const placeLabel = isSpot
    ? (dir === 'Buy' ? '▲ Place BUY Order' : '▼ Place SELL Order')
    : (showAutopilotToggle && apMode === 'autopilot'
      ? `🤖 Place ${dir === 'Buy' ? 'LONG' : 'SHORT'} + Start Auto Mode`
      : `${dir === 'Buy' ? '▲' : '▼'} Place ${dir === 'Buy' ? 'LONG' : 'SHORT'} Order`);

  return (
    <div className="trd-order-form">
      <div className="trd-cat-toggle">
        <button type="button" className={`trd-cat-btn ${category === 'linear' ? 'active' : ''}`} onClick={() => onCategoryChange?.('linear')}>Futures</button>
        <button type="button" className={`trd-cat-btn ${isSpot ? 'active' : ''}`} onClick={() => onCategoryChange?.('spot')}>Spot</button>
      </div>

      {enableSymbolSearch && (
        <div className="trd-field" style={{ position: 'relative' }}>
          <label>Symbol</label>
          <input
            className="trd-input"
            placeholder="Search symbol… e.g. SOL"
            autoComplete="off"
            value={symbolText}
            onChange={(e) => { setSymbolText(e.target.value); setDropdownOpen(true); }}
            onFocus={() => setDropdownOpen(true)}
            onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
          />
          {dropdownOpen && matches.length > 0 && (
            <div className="trd-sym-dropdown">
              {matches.map((s) => (
                <div key={s} className="trd-sym-item" onMouseDown={() => selectSymbol(s)}>
                  <span>{baseOf(s)}<em>/USDT</em></span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="trd-dir-row">
        <button type="button" className={`trd-dir-btn long ${dir === 'Buy' ? 'active' : ''}`} onClick={() => setDir('Buy')}>▲ {isSpot ? 'BUY' : 'LONG'}</button>
        <button type="button" className={`trd-dir-btn short ${dir === 'Sell' ? 'active' : ''}`} onClick={() => setDir('Sell')}>▼ {isSpot ? 'SELL' : 'SHORT'}</button>
      </div>

      <div className="trd-avail-row">
        <span>Available {creds?.apiKey && <span className="trd-live-badge">● {creds.env === 'testnet' ? 'DEMO' : 'LIVE'}</span>}</span>
        <span>{balance.available != null ? `$${balance.available.toFixed(2)}` : '—'} USDT</span>
      </div>

      <div className="trd-ot-row">
        <button type="button" className={`trd-ot-tab ${orderType === 'Limit' ? 'active' : ''}`} onClick={() => setOrderType('Limit')}>Limit</button>
        <button type="button" className={`trd-ot-tab ${orderType === 'Market' ? 'active' : ''}`} onClick={() => setOrderType('Market')}>Market</button>
      </div>

      {orderType === 'Limit' && (
        <div className="trd-field">
          <label>Price (USDT)</label>
          <input className="trd-input" type="number" step="any" placeholder="0.00" value={entry} onChange={(e) => setEntry(e.target.value)} />
        </div>
      )}

      {qtyModes.length > 1 && (
        <div className="trd-qty-tabs">
          {qtyModes.map((m) => (
            <button key={m} type="button" className={`trd-qty-mode ${qtyMode === m ? 'active' : ''}`} onClick={() => setQtyMode(m)}>
              {m === 'cost' ? 'Cost' : m === 'margin' ? 'Margin' : m === 'risk' ? 'Risk %' : 'Qty'}
            </button>
          ))}
        </div>
      )}

      <div className="trd-field">
        <label>{qtyMode === 'cost' ? 'Amount (USDT Cost)' : qtyMode === 'margin' ? 'Margin (USDT)' : qtyMode === 'risk' ? 'Risk % of Equity' : 'Quantity (contracts)'}</label>
        {qtyMode === 'cost' && <input className="trd-input" type="number" step="any" placeholder="Enter amount in USDT" value={cost} onChange={(e) => setCost(e.target.value)} />}
        {qtyMode === 'margin' && <input className="trd-input" type="number" step="any" placeholder="Enter margin in USDT" value={marginAmt} onChange={(e) => setMarginAmt(e.target.value)} />}
        {qtyMode === 'qty' && <input className="trd-input" type="number" step="any" placeholder="Enter contracts" value={qtyRaw} onChange={(e) => setQtyRaw(e.target.value)} />}
        {qtyMode === 'risk' && (
          <div className="trd-lev-row">
            <input type="range" className="trd-slider" min="0.25" max="10" step="0.25" value={riskPct} onChange={(e) => setRiskPct(+e.target.value)} />
            <span className="trd-lev-badge">{riskPct}%</span>
          </div>
        )}
        <div className="trd-qty-hint">
          {qty > 0 ? `≈ ${qty.toFixed(6)} contracts${effEntry ? ` · $${(qty * effEntry).toFixed(2)} position` : ''}` : ''}
          {qtyMode === 'risk' && !balance.equity ? ' — balance unavailable, connect API' : ''}
        </div>
      </div>

      {!isSpot && (
        <div className="trd-field">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
            <label style={{ marginBottom: 0 }}>Leverage</label>
            <span className="trd-maxlev-label">Max: {symInfo.maxLev}x</span>
          </div>
          <div className="trd-lev-row">
            <input type="range" className="trd-slider" min="1" max={symInfo.maxLev} value={lev} onChange={(e) => setLev(+e.target.value)} />
            <input type="number" className="trd-lev-badge" min="1" max={symInfo.maxLev} value={lev} onChange={(e) => setLev(Math.max(1, Math.min(+e.target.value || 1, symInfo.maxLev)))} />
            <span style={{ color: 'var(--accent-amber)', fontWeight: 700 }}>×</span>
          </div>
        </div>
      )}

      {!isSpot && (
        <div className="trd-sltp-grid">
          <div className="trd-field">
            <div className="trd-sltp-head">
              <label style={{ marginBottom: 0 }}>Stop Loss</label>
              <div className="trd-mode-tog sl">
                <button type="button" className={slMode === 'price' ? 'active' : ''} onClick={() => setSlMode('price')}>$</button>
                <button type="button" className={slMode === 'pnl' ? 'active' : ''} onClick={() => setSlMode('pnl')}>PnL</button>
              </div>
            </div>
            {slMode === 'price'
              ? <input className="trd-input sl" type="number" step="any" placeholder="Price" value={slPrice} onChange={(e) => setSlPrice(e.target.value)} />
              : <input className="trd-input sl" type="number" step="any" placeholder="Loss e.g. -20" value={slPnl} onChange={(e) => setSlPnl(e.target.value)} />}
          </div>
          <div className="trd-field">
            <div className="trd-sltp-head">
              <label style={{ marginBottom: 0 }}>Take Profit</label>
              <div className="trd-mode-tog tp">
                <button type="button" className={tpMode === 'price' ? 'active' : ''} onClick={() => setTpMode('price')}>$</button>
                <button type="button" className={tpMode === 'pnl' ? 'active' : ''} onClick={() => setTpMode('pnl')}>PnL</button>
              </div>
            </div>
            {tpMode === 'price'
              ? <input className="trd-input tp" type="number" step="any" placeholder="Price" value={tpPrice} onChange={(e) => setTpPrice(e.target.value)} />
              : <input className="trd-input tp" type="number" step="any" placeholder="Profit e.g. 50" value={tpPnl} onChange={(e) => setTpPnl(e.target.value)} />}
          </div>
        </div>
      )}

      {!isSpot && (
        <div className="trd-field">
          <label>Margin Mode</label>
          <select className="trd-input" value={marginMode} onChange={(e) => setMarginMode(e.target.value)}>
            <option value="ISOLATED">Isolated</option>
            <option value="CROSS">Cross</option>
          </select>
        </div>
      )}

      <div className="trd-summary">
        <div className="trd-sum-row"><span>Cost</span><span>{summary.posVal != null ? `$${summary.posVal.toFixed(2)}` : '—'}</span></div>
        <div className="trd-sum-row"><span>Margin Required</span><span>{summary.marginReq != null ? `$${summary.marginReq.toFixed(2)}` : '—'}</span></div>
        <div className="trd-sum-row"><span>Est. Max Loss</span><span style={{ color: RED }}>{summary.maxLoss != null ? `-$${summary.maxLoss.toFixed(2)}` : '—'}</span></div>
        <div className="trd-sum-row"><span>Est. Profit</span><span style={{ color: GREEN }}>{summary.profit != null ? `+$${summary.profit.toFixed(2)}` : '—'}</span></div>
        <div className="trd-sum-row"><span>R : R</span><span>{summary.rr}</span></div>
      </div>

      {!isSpot && showAutopilotToggle && (
        <div className="trd-ap-mode-toggle">
          <button type="button" className={`manual ${apMode === 'manual' ? 'active' : ''}`} onClick={() => setApMode('manual')}>Manual</button>
          <button type="button" className={`autopilot ${apMode === 'autopilot' ? 'active' : ''}`} onClick={() => setApMode('autopilot')}>🤖 Auto Mode</button>
        </div>
      )}
      {!isSpot && showAutopilotToggle && apMode === 'autopilot' && (
        <div className="trd-ap-hint">🤖 Order will be placed and Auto Mode will monitor SL/TP milestones. Requires both SL and TP.</div>
      )}

      <button type="button" className={`trd-place-btn ${dir === 'Sell' ? 'short' : 'long'}`} disabled={placing} onClick={placeOrder}>
        {placing ? 'Placing…' : placeLabel}
      </button>
      {msg && <div className="trd-order-msg" style={{ color: msg.color }}>{msg.text}</div>}
    </div>
  );
}
