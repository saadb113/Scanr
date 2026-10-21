import { useCallback, useEffect, useState } from 'react';
import { bybitRequest } from '../../utils/bybit';

// Renders live Bybit futures positions (or, in spot category, wallet coin
// holdings) and the modify/close/autopilot actions on each card. Ported from
// bytLoadPositions()/cdLoadPositions() in app.js / coin-detail.html — both
// pages' Positions tabs were nearly identical, so this is the single shared
// implementation. Polls every 5s while mounted (i.e. while its tab is
// active — the parent page conditionally renders this per-tab, same as the
// legacy bytSwitchTab()/bytStartRefresh() behavior of only refreshing the
// visible tab).
export default function PositionsList({
  creds,
  clockOffset,
  category,
  showAutopilotButton = false,
  autopilotActiveSymbol = null,
  onStartAutopilot,
  onStopAutopilot,
  onModify,
  onCountChange,
  onClosed,
}) {
  const [state, setState] = useState({ loading: true, error: null, positions: [], spotCoins: [] });

  const load = useCallback(async () => {
    if (!creds?.apiKey) {
      setState({ loading: false, error: null, positions: [], spotCoins: [] });
      onCountChange?.(0);
      return;
    }
    try {
      if (category === 'spot') {
        const r = await bybitRequest(creds, 'GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' }, null, clockOffset);
        if (r.retCode !== 0) { setState({ loading: false, error: r.retMsg, positions: [], spotCoins: [] }); return; }
        const coins = (r.result?.list?.[0]?.coin || []).filter((c) => c.coin !== 'USDT' && parseFloat(c.walletBalance) > 0);
        setState({ loading: false, error: null, positions: [], spotCoins: coins });
        onCountChange?.(coins.length);
        return;
      }
      const r = await bybitRequest(creds, 'GET', '/v5/position/list', { category: 'linear', settleCoin: 'USDT' }, null, clockOffset);
      if (r.retCode !== 0) { setState({ loading: false, error: r.retMsg, positions: [], spotCoins: [] }); return; }
      const pos = (r.result?.list || []).filter((p) => parseFloat(p.size) > 0);
      setState({ loading: false, error: null, positions: pos, spotCoins: [] });
      onCountChange?.(pos.length);
    } catch (e) {
      setState({ loading: false, error: e.message, positions: [], spotCoins: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds?.apiKey, creds?.apiSecret, creds?.env, category, clockOffset]);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  async function closePosition(sym, side, qty, label) {
    if (!window.confirm(`Close ${label === 'all' ? 'entire' : '50% of'} ${sym} position?`)) return;
    try {
      const closeSide = side === 'Buy' ? 'Sell' : 'Buy';
      const res = await bybitRequest(creds, 'POST', '/v5/order/create', null, {
        category, symbol: sym, side: closeSide, orderType: 'Market', qty: qty.toString(), timeInForce: 'GTC', reduceOnly: true,
      }, clockOffset);
      if (res.retCode === 0) { onClosed?.('Close order placed'); setTimeout(load, 1200); }
      else onClosed?.(res.retMsg, true);
    } catch (e) { onClosed?.(e.message, true); }
  }

  if (!creds?.apiKey) return <div className="trd-empty">No API credentials — add them in Settings → Bybit.</div>;
  if (state.loading) return <div className="trd-empty">Loading…</div>;
  if (state.error) return <div className="trd-empty trd-error">✗ {state.error}</div>;

  if (category === 'spot') {
    if (!state.spotCoins.length) return <div className="trd-empty">No spot holdings</div>;
    return (
      <>
        {state.spotCoins.map((c) => {
          const bal = parseFloat(c.walletBalance);
          const uval = parseFloat(c.usdValue) || 0;
          const avail = parseFloat(c.availableToWithdraw) || bal;
          return (
            <div key={c.coin} className="trd-pos-card" style={{ borderLeft: '3px solid var(--accent-green)' }}>
              <div className="trd-pos-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="trd-pos-sym">{c.coin}</span>
                  <span className="trd-pos-side long">SPOT</span>
                </div>
                <div style={{ fontWeight: 700, color: 'var(--accent-green)', fontFamily: 'var(--font-mono)' }}>~${uval.toFixed(2)}</div>
              </div>
              <div className="trd-pos-grid">
                <div className="trd-pos-item"><div className="trd-pos-label">Balance</div><div className="trd-pos-val">{bal.toFixed(6)}</div></div>
                <div className="trd-pos-item"><div className="trd-pos-label">Available</div><div className="trd-pos-val">{avail.toFixed(6)}</div></div>
                <div className="trd-pos-item"><div className="trd-pos-label">USD Value</div><div className="trd-pos-val" style={{ color: 'var(--accent-green)' }}>${uval.toFixed(2)}</div></div>
              </div>
            </div>
          );
        })}
      </>
    );
  }

  if (!state.positions.length) return <div className="trd-empty">No open positions</div>;

  return (
    <>
      {state.positions.map((p) => {
        const pnl = parseFloat(p.unrealisedPnl);
        const size = parseFloat(p.size);
        const avgPrice = parseFloat(p.avgPrice);
        const posVal = parseFloat(p.positionValue) > 0 ? parseFloat(p.positionValue) : size * avgPrice;
        const margin = parseFloat(p.positionIM) > 0 ? parseFloat(p.positionIM) : posVal / parseFloat(p.leverage);
        const pnlPct = margin > 0 ? (pnl / margin) * 100 : 0;
        const isLong = p.side === 'Buy';
        const underAutopilot = showAutopilotButton && autopilotActiveSymbol === p.symbol;
        return (
          <div key={p.symbol + p.side} className={`trd-pos-card ${isLong ? 'long-pos' : 'short-pos'}`}>
            {underAutopilot && <span className="trd-ap-badge">Autopilot Active</span>}
            <div className="trd-pos-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="trd-pos-sym">{p.symbol}</span>
                <span className={`trd-pos-side ${isLong ? 'long' : 'short'}`}>{isLong ? '▲ LONG' : '▼ SHORT'}</span>
                <span className="trd-pos-lev">{p.leverage}x</span>
              </div>
              <div className={`trd-pos-pnl ${pnl >= 0 ? 'profit' : 'loss'}`}>
                {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} <span style={{ fontSize: '0.75em', opacity: 0.75 }}>({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)</span>
              </div>
            </div>
            <div className="trd-pos-grid">
              <div className="trd-pos-item"><div className="trd-pos-label">Cost (USDT)</div><div className="trd-pos-val">${posVal.toFixed(2)}</div></div>
              <div className="trd-pos-item"><div className="trd-pos-label">Margin Used</div><div className="trd-pos-val">${margin.toFixed(2)}</div></div>
              <div className="trd-pos-item"><div className="trd-pos-label">Avg Entry</div><div className="trd-pos-val">{avgPrice.toFixed(4)}</div></div>
              <div className="trd-pos-item"><div className="trd-pos-label">Mark Price</div><div className="trd-pos-val">{parseFloat(p.markPrice).toFixed(4)}</div></div>
              <div className="trd-pos-item"><div className="trd-pos-label">Stop Loss</div><div className="trd-pos-val" style={{ color: 'var(--accent-red)' }}>{parseFloat(p.stopLoss) > 0 ? parseFloat(p.stopLoss).toFixed(4) : '—'}</div></div>
              <div className="trd-pos-item"><div className="trd-pos-label">Take Profit</div><div className="trd-pos-val" style={{ color: 'var(--accent-green)' }}>{parseFloat(p.takeProfit) > 0 ? parseFloat(p.takeProfit).toFixed(4) : '—'}</div></div>
            </div>
            <div className="trd-pos-actions">
              <button type="button" className="trd-act-btn modify" onClick={() => onModify?.(p)}>Modify SL/TP</button>
              {showAutopilotButton && (
                underAutopilot ? (
                  <button type="button" className="trd-act-btn ap-stop" onClick={() => onStopAutopilot?.()}>Stop Autopilot</button>
                ) : (
                  <button
                    type="button"
                    className="trd-act-btn autopilot"
                    disabled={!(parseFloat(p.stopLoss) > 0 && parseFloat(p.takeProfit) > 0)}
                    title={!(parseFloat(p.stopLoss) > 0 && parseFloat(p.takeProfit) > 0) ? 'Set SL and TP before starting autopilot' : ''}
                    onClick={() => onStartAutopilot?.({
                      sym: p.symbol, side: p.side, entry: avgPrice, sl: parseFloat(p.stopLoss), tp: parseFloat(p.takeProfit), size,
                    })}
                  >
                    Autopilot
                  </button>
                )
              )}
              <button type="button" className="trd-act-btn half" onClick={() => closePosition(p.symbol, p.side, size / 2, 'half')}>Close 50%</button>
              <button type="button" className="trd-act-btn close" onClick={() => closePosition(p.symbol, p.side, size, 'all')}>Close All</button>
            </div>
          </div>
        );
      })}
    </>
  );
}
